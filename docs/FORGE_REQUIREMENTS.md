# FORGE 要件

作成: 2026-07-30 ／ 基準コミット: `db25d78`

各項目の詳細要件を**後から書き足すための器**。見出しだけ先に用意してある。
着手するときに、その節へ要件・完了条件・テストを書いてから実装する。

- 現在地と引継ぎ → `../HANDOFF.md`
- 進める順番 → `../BACKLOG.md`
- 設計判断の記録 → `../README.md`
- 作業の約束事 → `../AGENTS.md`

> **このファイルに秘密情報を書かないこと。** token、Publishable Key、service role key、
> Apple Health / FIT の本文、練習記録の実データは載せない。
> 例が必要なときはダミー値を使う。

---

# 第1部 全体制約（AGENTS.md より。変更するときは AGENTS.md も直す）

以下は**個別要件より優先する**。各項目の要件がこれと矛盾する場合、こちらが勝つ。

## 1.1 プロダクトの前提

- 800m 特化のトレーニング管理ツール。利用者は1人（800m PB 1:49.51、目標 1:48台）
- 判断に迷ったら **「1:48台に必要か」** で決める

## 1.2 絶対に守ること

| # | 制約 | 理由 |
| --- | --- | --- |
| C-1 | **LLM を使わない。** 解釈も生成も完全ルールベース | 同じ入力から必ず同じ結果が出ないと、あとで数値を疑えない |
| C-2 | **読めなかったものを推測で埋めない。** 空欄にして理由を出す | 推測値が CFE に流れると、実測と推測の区別がつかなくなる |
| C-3 | **自動で変えたことは理由とセットで出し、却下できるようにする** | 設定が下がったのか実力が上がったのか判別できなくなる |
| C-4 | **CFE と設定ペースを混同しない** | 実行できなかったこと（暑さ・寝不足・設定過大）は能力低下ではない |
| C-5 | **解釈は1か所に集める**（`bulkImport.ts` の `parseRow` が唯一） | 同じ文字列が画面によって違う意味になってはいけない |
| C-6 | **きつい練習＝良い練習、という評価軸を作らない** | RPE の高さ・達成感を加点にしない |
| C-7 | **競技ロジックの数値・閾値を根拠なく変更しない** | 閾値には必ず理由をコメントと README に残す |
| C-8 | **完了済み・手動編集・固定予定を上書きしない** | — |

## 1.3 設計上の構造

- `src/lib/core/` … ドメインロジック（フレームワーク非依存・テスト済み）。**ここが本体**
- `src/lib/db/` … 保存層。`Store` インターフェースが唯一の窓口
- `src/lib/service.ts` … サービス層。API と CLI はここだけを呼ぶ
- `app/` … 画面。Next.js と PWA で共用
- `pwa/` … PWA 固有（エントリ・API シム・Service Worker・E2E）
- `pwa-dist/` … 配信物。生成物だが Git 管理下（GitHub Pages のため）

### 二重の実行環境

同じ画面コードが2経路で動く。

1. **Next.js**: `app/api/*` がサーバー側でサービス層を呼ぶ
2. **PWA**: `pwa/api-shim.ts` が `fetch("/api/...")` を横取りして同じサービス層を直接呼ぶ

- **API を足したら両方に足す。** 片方だけだと片方の環境で静かに壊れる
- **保存層も2つ**（SQLite の `Repo` / IndexedDB の `MemoryStore`）。
  `Store` にメソッドを足したら両方に実装する
- 保存形式を変えたら `exportBackup` / `importBackup` / Supabase snapshot も直す

## 1.4 UI の制約

- 黒・白・グレーが90%、FORGE Green が10%。緑は「今日」「主アクション」「改善方向」だけ
- **数値を主役にする。** カラフルなUI・ゲーム的演出・過剰な影は入れない
- **下部タブは4つ（ホーム／カレンダー／記録／分析）から増やさない**
- ホームは「今やるべきこと」だけ
- 機能を削除・簡略化しない

## 1.5 実装の落とし穴

| # | 落とし穴 | 対策 |
| --- | --- | --- |
| T-1 | コンポーネントの中でコンポーネントを定義する | 再描画のたびに `<input>` が作り直され、iOS で1文字ごとにキーボードが閉じる。**画面には何も出ない。** E2E の N-1 が見張っている |
| T-2 | 入力中に入力欄を組み替える | 解釈はデバウンスし、構造が実際に変わったときだけ組み替える。値は減る方向で捨てない |
| T-3 | iOS Safari がストレージを消す | 書き出し（M-12）を維持する |
| T-4 | 通ることだけ確認した E2E | **壊れた状態で落ちるところまで確認する** |
| T-5 | z-index の取り合い | タブバー30 / FAB 50 / 確認ダイアログ60。ダイアログは必ず FAB より上 |
| T-6 | Tailwind の `pb-[calc(...)]` が生成されない | CSS 変数にしてから `pb-[var(--x)]` と書く |
| T-7 | `getByRole(name)` は既定で部分一致 | 完全一致が要るときは `exact: true` |
| T-8 | 日付に依存する E2E | 固定日付を使う。現在日時に依存させない |

## 1.6 作業の手順

1. コアロジックを `src/lib/core/` に足し、テストを書く
2. `src/lib/service.ts` から使えるようにする
3. `app/api/*` と `pwa/api-shim.ts` の**両方**に API を足す
4. 画面を作る
5. E2E に経路を足す
6. `npm run verify`
7. `README.md` に「なぜその閾値か」「なぜその置き場所か」を残す

**先に失敗するテストを書き、赤いことを確認してから実装する。**

## 1.7 禁止事項

- `any` / `ts-ignore` / `ts-expect-error` の追加
- テストの削除・skip・only・無効化
- エラーの握りつぶし
- 無関係な大規模リファクタリング
- `git reset --hard` / `git checkout --` による既存変更の破棄
- force push / rebase / 履歴書き換え
- `package-lock.json` の削除
- service role key など秘密鍵をクライアントへ置くこと
- token・健康データ本文をログや報告へ出すこと
- **実行していない検証を成功と報告すること**

## 1.8 配信（許可が出るまで実行しない）

- リリースのたびに `pwa/sw.js` の `VERSION` を1つ上げる（上げないと端末に届かない）
- `npm run build:all` → `build:static` が版数を表示するので目で確認
- **push は2本**。main だけでは配信物は差し替わらない

---

# 第2部 項目別の詳細要件

`FORGE_BACKLOG.md` の順番に対応する。着手時にその節を埋める。

各節には最低限これを書く。

- 現状（コード上の事実）
- 根本原因
- 要件
- 対象ファイル・関数・型
- 保存・更新・再読込のデータフロー
- Next.js と PWA の差
- SQLite と IndexedDB の差
- `exportBackup` / Supabase 同期への影響
- 追加するテスト（**先に失敗させる**）
- 完了条件
- リスク
- 決めた閾値とその理由

---

## 2.1 保存・再読込の4不具合

### NEXT-001 目標レースのボーダータイムが再表示時に消える

**対応済み（2026-07-30）。commit / push / 配信は未実施。詳細は `HANDOFF.md`。**

- **現状**: 報告された「消える」症状は着手時点で既に直っていた。
  往復を見る7件のテストは修正前から緑（SQLite / IndexedDB / 通過点レース /
  旧 Race JSON / `exportBackup` 往復）。
- **根本原因（実際に残っていた欠陥）**: `Number.isFinite(0)` が `true` のため
  `0` と負のボーダーが保存を素通りする。`planHeatPace` の
  `race.borderTimeSec ?? goalTargetSec + 2` は `0` を nullish と見なさないので、
  予選の通過目安が **−0.5秒** になる。画面には値が出たままで気づけない。
  さらに `importBackup` は `saveGoalAndRaces` を通らないため、
  他端末の壊れた値と Supabase の pull が正規化を素通りしていた。
- **対象**: `src/lib/service.ts` の `normalizeRaceBorders`（新規）／
  `saveGoalAndRaces` ／ `importBackup` の races。
  `app/goal/page.tsx` は変更なし（画面側の検証は元から正しい）。
- **決めた閾値と理由**: 着順 `>= 1`、タイム `> 0` だけを残す。
  以前の `Math.max(1, ...)` による1着への丸めは廃止。
  丸めると「0が入ってきた」のか「1着通過」なのかが後から区別できなくなるため
  （読めなかったものは推測で埋めない）。
- **DB / migration**: 不要（任意フィールドのまま。保存形式を変えていない）。
- **Next.js と PWA の差**: 無し。`app/api/goal/route.ts` と `pwa/api-shim.ts` は
  どちらも同じ `saveGoalAndRaces` を呼ぶ。API の追加は無い。
- **追加したテスト**: `tests/goalRaces.test.ts` 12件（SQLite / IndexedDB を同じ検証で回す）、
  `pwa/e2e.mjs` に1経路。**修正前に4件赤**（両保存層で `0`・負が保存される／通過目安が −0.5秒）、
  `importBackup` 経路の1件も別途赤を確認してから修正。
  E2E は**UI検証を壊すと落ちること**を確認してから復元した（T-4）。
- **完了条件（達成済み）**: `npm run verify` が修正前・修正後とも緑
  （`ALL E2E PASS` / `UPDATE E2E PASS`。当時の件数は CHANGELOG.md を見る）。
  SQLite / IndexedDB の両方で往復。Next.js / PWA の両経路が同じ `saveGoalAndRaces` を通る。
  `exportBackup` 往復で残る。旧 Race JSON が読める。VERSION は `forge-v32` のまま。
- **残り**: 実機 `forge-v32` で元の症状が再現するかの確認。
  再現するなら、直したのとは別の原因が残っている。

### BUG-02（旧 NEXT-002） プラン再生成でメニューが重複する

*未記入*

### BUG-03（旧 NEXT-003） カレンダー編集後に表示が更新されない

*未記入*

### BUG-04（旧 NEXT-004） 通過点レースがカレンダーで「予定なし」になる

*未記入*

---

## 2.2 Supabase・Google OAuth・PWA同期

### 2.2.1 接続設定と検証

**実機診断済み（2026-07-30）。** 接続テストは `種別: ok ／ HTTP 200`。
Supabase プロジェクトは実在し、URL・Publishable Key とも正しい。設定・検証は問題なし。

### 2.2.2 Google サインインの往復（ハッシュルーティングとの競合）

**対応済み（Phase 2-2・未コミット）。**

- **現状**: サインインは成功しトークンも保存されるのに、ホーム画面に戻ったまま
  同期画面へ遷移しない症状を実機で再現した。同期画面を開き直すとサインイン済みと
  表示されるため、トークンの受け取り自体は成功していた。
- **根本原因（確認済み）**: `app-shell.tsx` の受け取りが、戻り先の `?sync=1` という
  クエリが残っていることを前提に「同期画面へ戻るか」を判断していた。このクエリは
  自前では守れない。Supabase の Redirect URLs にアプリのURLを登録していないと、
  Supabase は指定した `redirect_to` を無視して Site URL へ飛ばすため、クエリごと
  落ちる（横取り耐性の仕様。FORGE側の不具合ではなく設定依存の外部要因）。
  本人に確認したところ、症状が起きていた当時、Redirect URLs には
  `https://rio01100801-gif.github.io/trainmiddle/**` が**登録されていなかった**
  （相談中に追加）。時系列と設定状態の両方で裏が取れている。
- **対象**: `src/lib/core/sync.ts` の `authRedirectLanding`（新規・純関数）／
  `app/components/app-shell.tsx`（判断を委譲するだけに変更）。
- **決めた方針**: `captureAuthRedirect` が何か拾えた時点で、それは必ず
  `signInWithGoogle` が発行した `redirect_to` からの戻りである（他にこのURLへ
  来る経路が無い）。したがって `?sync=1` の有無を問わず同期画面へ戻してよい。
- **DB / migration**: 不要。
- **Next.js と PWA の差**: `AppShell` は共通実装（`app/layout.tsx` と `pwa/entry.tsx`
  の両方が使う唯一の実装）なので、変更は自動的に両方へ及ぶ。`authRedirectLanding` は
  `isHashNavigationRuntime()` の真偽で分岐する。
- **追加したテスト**: `tests/sync.test.ts` に3件（先に赤を確認）。`pwa/e2e.mjs` に
  「`?sync=1` が欠けた復帰でも同期画面へ戻る」経路を追加し、判定を元に戻すと
  タイムアウトで落ちることを確認して復元（T-4）。
- **完了条件（達成済み）**: `npm run verify` 緑（/
  `ALL E2E PASS` / `UPDATE E2E PASS`）。VERSION は `forge-v32` のまま。
- **症状2（iPhone「サーバに接続できません」）**: `forge-v33` 配信後、本人が実機で
  再現しないことを確認した（2026-07-30）。**ただし根本原因は未確定。** 症状1の
  コード修正・Redirect URLs へのワイルドカード追加・当初の入力ミスURLの解消の
  どれが効いたかは切り分けていない。推測で断定しない。
- **外部設定（対応済み）**: Supabase の Authentication → URL Configuration に、
  Site URL `https://rio01100801-gif.github.io/trainmiddle/` と、
  Redirect URLs（`.../trainmiddle/` / `.../index.html?sync=1` /
  `.../trainmiddle/**` の3件、うちワイルドカードの1件が他2件を包含）が
  登録済みであることをスクリーンショットで確認した（2026-07-30）。
  コード側の修正と合わせて二重の安全策になっている。

### 2.2.3 スナップショット同期（push / pull / 競合）

**Phase 2-1 で統合（merge）の安全性のみ対応済み。** 詳細は `HANDOFF.md` の
「NEXT-002」を参照。実データでの push / pull 往復は Supabase プロジェクトが
本人環境にできたため理論上は検証可能になったが、**今回はまだ実施していない**。

### 2.2.4 Supabase 側で必要な設定（SQL・管理画面）

- **Authentication → URL Configuration**（2.2.2 の対応に必須）:
  Site URL を `https://rio01100801-gif.github.io/trainmiddle/` に、
  Redirect URLs に `https://rio01100801-gif.github.io/trainmiddle/**` を追加。
- **Storage bucket・RLS**（Phase 2-3・**完了**。commit `4364d1e`・`forge-v34`配信・
  RLSポリシー適用済み）: `docs/FORGE_BACKLOG.md` 項目2/11 を参照。

  コード側は `forge/snapshot.json`（全利用者共通）から `forge/<uid>/snapshot.json`
  （利用者ごと）への保存先分離を実装。RLSポリシーは以下の手順で本人が適用済み
  （2026-07-30）。**配信後の実機での最終同期確認だけ残っている。**

  1. **まず一度、現在のコードで同期を1回実行する**（`いま同期する`）。
     これにより `forge/<uid>/snapshot.json` が新規作成される
     （旧 `forge/snapshot.json` は自動移行しない。ローカルのSQLite/IndexedDBが
     常に正本なので、再送信すればよい）。
  2. Supabase の **SQL Editor** で以下を実行する。

     > `alter table storage.objects enable row level security;` は**実行しないこと**。
     > 実機で試したところ `ERROR: 42501: must be owner of table objects` になった。
     > `storage.objects` は SQL Editor の `postgres` ロールの持ち物ではなく、
     > Supabaseのプロジェクトでは作成時点でこのテーブルのRLSが既に有効なので、
     > この行はそもそも不要。`create policy` の4本だけを実行すればよい。

     ```sql
     -- forgeバケット内、自分のUIDフォルダ配下だけを読み書きできるようにする
     create policy "forge_own_folder_select"
     on storage.objects for select
     to authenticated
     using (
       bucket_id = 'forge'
       and (storage.foldername(name))[1] = auth.uid()::text
     );

     create policy "forge_own_folder_insert"
     on storage.objects for insert
     to authenticated
     with check (
       bucket_id = 'forge'
       and (storage.foldername(name))[1] = auth.uid()::text
     );

     create policy "forge_own_folder_update"
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

     create policy "forge_own_folder_delete"
     on storage.objects for delete
     to authenticated
     using (
       bucket_id = 'forge'
       and (storage.foldername(name))[1] = auth.uid()::text
     );
     ```

  3. 適用後、同期をもう一度実行して push/pull できることを確認する。
  4. 旧 `forge/snapshot.json`（フォルダ無しのルート直下）は、上のポリシーだと
     `(storage.foldername(name))[1]` が空になるため誰からも読めなくなる。
     害はない（ローカルが正本のため）が、Supabaseダッシュボードの
     Storageブラウザから手動で削除してもよい（任意・急がない）。

  **ロールバック**: ポリシーを削除すれば元の状態（RLS無し）に戻る。
  `drop policy "forge_own_folder_select" on storage.objects;` のように
  4つのポリシー名を指定して削除する。

---

## 2.3 データ完全性・バックアップ・migration・障害復旧

### 2.3.1 PWA の保存保証

*未記入*

### 2.3.2 バックアップの検証と原子的復元

*未記入*

### 2.3.3 migration と後方互換

*未記入*

### 2.3.4 障害復旧（runbook）

*未記入*

---

## 2.4 量を増やす・曜日優先・4週間バランス・練習分類

### 2.4.1 4週間のバランスと入れ替え提案

*未記入*

### 2.4.2 「量を増やす」の反映範囲

*未記入*

### 2.4.3 曜日の preferred / fixed

*未記入*

### 2.4.4 高負荷分類

*未記入*

---

## 2.5 LT・CV・ジョグ・ACWR・高乳酸間隔・個人補正

### 2.5.1 有酸素系の処方根拠

*未記入*

### 2.5.2 ACWR の扱い

*未記入*

### 2.5.3 高乳酸間隔と個人補正

*未記入*

### 2.5.4 M-2 設定調整の4材料

*未記入*

---

## 2.6 自動生成メニューの偏り・テンプレート・progression

### 2.6.1 漸進モデル

*未記入*

### 2.6.2 セッション形式の選択

*未記入*

### 2.6.3 2案提示

*未記入*

---

## 2.7 FIT・Garmin

### 2.7.1 プラットフォーム仕様の確認（着手前に必須）

*未記入。**できないことを、できるように見せる実装をしない。***

### 2.7.2 ファイル受信と安全性検証

*未記入*

### 2.7.3 解析（メッセージ・単位・タイムゾーン）

*未記入*

### 2.7.4 ラップからのインターバル復元

*未記入*

### 2.7.5 3層データモデル

*未記入*

### 2.7.6 二重登録防止と既存予定への紐付け

*未記入*

### 2.7.7 分析・次回提案への反映

*未記入*

---

## 2.8 Apple Health

### 2.8.1 大容量ファイルの処理

*未記入*

### 2.8.2 ZIP 対応

*未記入*

### 2.8.3 XML 解析の正確性

*未記入*

### 2.8.4 重複防止と識別

*未記入*

### 2.8.5 用途確認と紐付け

*未記入*

### 2.8.6 分析への実接続（保存と利用を区別する）

*未記入*

---

## 2.9 アイコン・ロード画面・アプリ内UI

### 2.9.1 アイコン

*未記入*

### 2.9.2 起動画面

*未記入*

---

## 2.10 iPhone・アクセシビリティ

### 2.10.1 Safe Area とレイアウト

*未記入*

### 2.10.2 フォームと入力保持

*未記入*

### 2.10.3 状態表示とエラー復旧

*未記入*

### 2.10.4 アクセシビリティ

*未記入*

---

## 2.11 セキュリティ・認証認可・RLS

### 2.11.1 脅威モデル

*未記入*

### 2.11.2 秘密情報の管理

*未記入。**値そのものは書かない。** 種類・場所・対応だけを書く。*

### 2.11.3 Next.js API の認証・認可

*未記入*

### 2.11.4 Supabase Storage の利用者分離と RLS

*未記入*

### 2.11.5 ファイル取込の安全性

*未記入*

### 2.11.6 XSS・URL・ヘッダー

*未記入*

---

## 2.12 CI・診断・PWA更新・ロールバック

### 2.12.1 CI

*未記入*

### 2.12.2 バージョンの一貫性

*未記入*

### 2.12.3 診断情報（秘密を出さない）

*未記入*

### 2.12.4 Service Worker 更新経路

*未記入*

### 2.12.5 ロールバック

*未記入*

---

## 2.13 全体最終監査

*未記入*

---

## 2.14 配信

*未記入*

---

## 2.15 実機iPhone受入試験

*未記入*

---

## 2.16 個人補正の評価（3〜6週間後）

### 2.16.1 評価計画（データを見る前に決めておく）

*未記入。最小サンプル数・除外規則・判定基準を、データ取得前にここへ書く。
後から基準を決めると、必ず後付けの解釈になる。*

### 2.16.2 評価結果

*未記入*
