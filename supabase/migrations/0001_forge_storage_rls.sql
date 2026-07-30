-- FORGE: Supabase Storage（forgeバケット）の利用者分離RLS
--
-- セキュリティ・プライバシー監査（2026-07-31）で作成。
-- **このファイルは自動適用しません。** Supabaseダッシュボードの SQL Editor に
-- 手動で貼り付けて実行してください（本番プロジェクトへの直接適用はリポジトリの
-- 外側の操作のため、エージェントからは行いません）。
--
-- 背景: アプリのコード（app/components/supabase.ts の snapshotObjectPath）は
-- `forge/<uid>/snapshot.json` というパス規約でオブジェクトを保存します。
-- しかし「そのパス規約を守る」ことを強制しているのは常にRLSポリシー側であり、
-- パスの組み立て自体はクライアントの都合でしかありません。
-- README.md の旧手順は `using (bucket_id = 'forge')` という
-- **バケット全体に効く**（= 認証済みなら誰でも他人のsnapshot.jsonを読み書き
-- できる）ポリシーを案内していたため、コードの前提と食い違っていました。
-- このSQLは、実際に強制される条件をコードの前提（uid別フォルダ）に一致させます。

-- ============================================================
-- 手順1: 現在のポリシーを確認する（実行して、既存ポリシー名を控える）
-- ============================================================
select policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'storage' and tablename = 'objects';

-- ============================================================
-- 手順2: 旧・バケット全体ポリシーを削除する
-- ============================================================
-- README旧手順どおりに作っていた場合、Storage UIでの既定の命名は
-- 「<bucket名> <操作> <role>」のような形になることが多いですが、
-- ダッシュボードでカスタム名を付けていた場合は上のSELECT結果の
-- policyname に置き換えてください。以下はよくある既定名の例です。
-- 存在しない名前は IF EXISTS のため安全に無視されます。
drop policy if exists "forge select" on storage.objects;
drop policy if exists "forge insert" on storage.objects;
drop policy if exists "forge update" on storage.objects;
drop policy if exists "forge delete" on storage.objects;
drop policy if exists "Give users access to own folder" on storage.objects;

-- ============================================================
-- 手順3: 利用者ごとに分離した新ポリシーを作る
-- ============================================================
-- (storage.foldername(name))[1] は "<uid>/snapshot.json" の "<uid>" 部分。
-- auth.uid() と一致する場合のみ許可する。

create policy "forge: select own folder"
on storage.objects for select
to authenticated
using (
  bucket_id = 'forge'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "forge: insert own folder"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'forge'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "forge: update own folder"
on storage.objects for update
to authenticated
using (
  bucket_id = 'forge'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'forge'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- DELETEは現状アプリのコードからは呼ばれていない（クラウド上のスナップショットを
-- 消す機能が無い。README.md「データ削除とプライバシー」参照）が、将来のため・
-- Supabaseダッシュボードから手動削除する場合の安全のために用意しておく。
create policy "forge: delete own folder"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'forge'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- ============================================================
-- 手順4: バケット自体の設定（MIME type・サイズ上限）
-- ============================================================
-- バックアップスナップショットはJSONのみ。上限はアプリ側の
-- BACKUP_MAX_BYTES（50MB, src/lib/core/backup.ts）と揃えておく。
update storage.buckets
set public = false,
    file_size_limit = 52428800, -- 50MB
    allowed_mime_types = array['application/json']
where id = 'forge';

-- ============================================================
-- 手順5: 確認（本番データを変更しない、読み取りのみ）
-- ============================================================
-- 5-1. ポリシー一覧が意図どおりか
select policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'storage' and tablename = 'objects' and qual::text like '%forge%';

-- 5-2. バケット設定
select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'forge';

-- ============================================================
-- 手動確認手順（SupabaseダッシュボードのSQL Editorではできないため、
-- 実際のアプリ操作 or REST呼び出しで確認する）
-- ============================================================
-- A. 本人のSELECT/INSERT/UPDATEが成功する
--    → 設定→同期→サインイン→保存（アプリの通常操作で確認できる）
-- B. 他人のオブジェクトへはSELECT/INSERT/UPDATE/DELETEいずれも失敗する
--    → 2つ目のGoogleアカウントでサインインし、1つ目のuidのパスを直接
--      REST（GET/PUT/DELETE `${url}/storage/v1/object/forge/<相手のuid>/snapshot.json`）
--      で叩く。RLSにより403/404相当で拒否されることを確認する。
-- C. 未認証（Authorizationヘッダ無し）ではどの操作も失敗する
--    → curlでAuthorizationヘッダを外して同じREST呼び出しを行い、拒否を確認する。

-- ============================================================
-- ロールバック（この変更を取り消す場合。旧ポリシーへは戻さないこと——
-- 旧ポリシーは全利用者が他人のデータを読み書きできる脆弱な状態だったため）
-- ============================================================
-- drop policy if exists "forge: select own folder" on storage.objects;
-- drop policy if exists "forge: insert own folder" on storage.objects;
-- drop policy if exists "forge: update own folder" on storage.objects;
-- drop policy if exists "forge: delete own folder" on storage.objects;

-- ============================================================
-- 既存データの移行について
-- ============================================================
-- 4364d1e（2026-07-27頃）の時点で、アプリのコードは既に
-- `forge/<uid>/snapshot.json` 形式でしか読み書きしない。このRLS変更は
-- 「そのパス以外へのアクセスを弾く」だけなので、既にこの形式で保存されている
-- 利用者のデータには影響しない（消えない・移動しない）。
-- 万が一、RLS変更前の旧仕様（`forge/snapshot.json` 直下・uidなし）の
-- オブジェクトが残っている場合は、新ポリシー適用後は本人でも読めなくなる。
-- Storageダッシュボードで直接確認し、残っていれば手動で
-- `forge/<uid>/snapshot.json` へコピーしてから元を削除すること
-- （データ消失防止のため、コピー確認後に削除する順序を守る）。
