# FORGE 引継ぎ

作成: 2026-07-30 ／ 作成者: Claude Code（Codex からの引継ぎ調査に基づく）

このファイルは**次の担当が最初に読むもの**。詳しい設計判断は `README.md`、
作業の約束事は `AGENTS.md`（= `CLAUDE.md` と同一内容）にある。

- 未対応の作業一覧 → `docs/FORGE_BACKLOG.md`
- 各項目の詳細要件 → `docs/FORGE_REQUIREMENTS.md`

> **秘密情報を書かないこと。** token、Publishable Key、service role key、
> Apple Health / FIT の本文、練習記録の実データはこのファイルに載せない。

---

## リポジトリ

| 項目 | 値 |
| --- | --- |
| 作業ディレクトリ | `C:\Users\吏央\Downloads\FORGE` |
| remote (origin) | `https://github.com/rio01100801-gif/trainmiddle.git` |
| 公開URL | `https://rio01100801-gif.github.io/trainmiddle/` |
| 配信元 | `gh-pages` ブランチ（`main:pwa-dist` の中身をルートに置く） |

## branch / HEAD

| 項目 | 値 |
| --- | --- |
| branch | `main` |
| HEAD | `d997ddb`（`fix: Supabase Storageの初回push未検出を修正`） |
| `origin/main` との差 | **0 / 0**（完全一致・push済み） |

直近コミット:

```
d997ddb fix: Supabase Storageの初回push未検出を修正
479e894 docs: forge-v34配信後の状態とRLS適用結果を反映
4364d1e fix: Supabase Storageの保存先を利用者ごとに分離
bf0e7db docs: 実機確認結果(BUG-02〜04・症状2とも再現なし)を反映
5799a62 docs: HANDOFF.mdをforge-v33配信後の状態に更新
fd15365 fix: 目標レースのボーダー正規化と同期の統合・OAuth復帰を修正
db25d78 feat: FORGEのアイコンと起動画面・UIを刷新
6424518 feat: 自動生成メニューの個別適応と多様性を改善
227c972 feat: 競技指標と個人補正ロジックを改善
f304ab8 fix: Supabase初回同期の未作成応答を処理
```

## 未コミット変更

**なし。** NEXT-001 と NEXT-002（Phase 2-1〜2-4）は `d997ddb` までコミット・push・
gh-pages配信済み（2026-07-30・`forge-v35`）。内容は下の「NEXT-001 の完了記録」「NEXT-002」を参照。

> 過去に、同じディレクトリで複数のエージェントが並行編集し、
> 一方の未コミット変更が消えかけた経緯がある。**同時に走らせないこと。**

## 配信状態

| 項目 | 値 |
| --- | --- |
| ソース `pwa/sw.js` | `forge-v35` |
| `pwa-dist/sw.js` | `forge-v35` |
| 公開中（`gh-pages`） | `forge-v35`（配信済み・2026-07-30） |
| `main:pwa-dist` と `gh-pages` の tree | **一致（配信済み・未配信の差分なし）** |

---

## 現在のテスト状況

✅ **緑。** 2026-07-30 に `db25d78` で `npm run verify` を実行して確認した（着手前のベースライン）。
NEXT-001 の修正後も緑（下の「NEXT-001 の完了記録」を参照）。

- テスト件数: **804件 / 52ファイル**（NEXT-001 着手前は 771件 / 50ファイル）。
  `AGENTS.md` と `README.md` の「574件」という記載は**古い**。次に触るとき直す。
- 静的に確認できた事実:
  - `ts-ignore` / `ts-expect-error` … **0件**
  - `.only(` / `.skip(` / `xit(` / `xdescribe(` … **0件**
  - TODO / FIXME / WIP / 仮実装マーカー … **0件**
    （`src/lib/service.ts:1490` の「とりあえず入れておく」は禁止事項を説明する
    コメント本文であり、実装マーカーではない）

**次の担当が最初にやること**: `npm install` → `npx playwright install chromium` → `npm run verify`。
失敗した場合は「既存の不良」として記録し、自分の変更による不良と必ず区別する。

### コマンド

```
typecheck   tsc --noEmit -p tsconfig.json（--max-old-space-size=2048 付き）
test        vitest run --maxWorkers=1 --minWorkers=1
build:all   build:pwa(bun) && build:css && build:static
e2e         node pwa/e2e.mjs（iPhone幅・実操作）
e2e:update  node pwa/e2e-update.mjs（更新経路）
verify      typecheck && test && build:all && e2e && e2e:update
```

---

## 完了済み

コード上に実装が存在するもの。**「検証済み」という意味ではない。**
下表のうち NEXT-001 だけが**未コミット**で、それ以外はコミット済み。

| 領域 | 内容 |
| --- | --- |
| **NEXT-001**（2026-07-30・未コミット） | 目標レースのボーダー。**往復は元から動いていた**。実際に直したのは「`0`／負のボーダーが保存され、予選の通過目安が −0.5秒 になる」欠陥。`normalizeRaceBorders` を `saveGoalAndRaces` と `importBackup` の両方から通す。テスト12件追加・E2E 1経路追加・`npm run verify` 緑。**実機での再現確認だけ残り**。詳細は `docs/FORGE_REQUIREMENTS.md` 2.1 |
| 一括入力ぶんの下流接続 | `toSessionAndResult` が構造化記録を持つ。週次レビュー・同一処方比較・M-2 の材料に流れる |
| 取込済みデータの作り直し | `rebuildPastDerived`（ホーム初回表示で1度だけ自動実行） |
| 1本ごとの心拍 | `RepResult.avgHr`。同一処方比較・M-2 の疲労判定に接続 |
| 区間ごとのレスト | `RepResult.restAfterSec`（300+600+300 のような複合に対応） |
| 3値の相互計算 | 距離・時間・平均ペースのうち2つで残りが決まる |
| メニュー入力の統一 | `PrescriptionFields` を記録・編集・追加・自作メニュー登録で共用 |
| 不足カテゴリの提案 | `coverage.ts`（4週間のバランス）。カレンダーにも要約を表示 |
| 生成の漸進モデル | `progression.ts`。フェーズ×週×直近の実行状況で内容が変わる |
| 進め方の2案提示 | TODAY で選択。案は保存せず既存 Session に書き込む |
| 他選手メニューの換算 | `athleteConvert.ts`（相対強度を自分の CFE に当て直す） |
| 心拍の実利用 | `heartRate.ts`（最大心拍の基準・相対強度・暑熱の切り分け） |
| 同期の判断ロジック | `sync.ts`（ネットワーク非依存。競合時は必ず本人に選ばせる） |
| 同期の設定画面 | `/sync`。未設定でも成立する（設定しなければ何も起きない） |
| Codex 追加分 | セッション形式の複数候補化、プラン再生成の識別（安定ID / `origin`）、曜日の `preferred`/`fixed`、高負荷分類（`trainingClassification.ts`）、ボーダータイム、アイコン刷新 |

**Codex が追加したロジックは未レビュー。** 数値定数は変更されていないことは確認済み
（`227c972` と `6424518` の差分に、変更された数値定数は無し）。

## 作業中

**なし。** NEXT-002 は Phase 2-1〜2-4 まで commit・push・配信（`forge-v35`）済み。
残るのは「配信後に実機で同期が正しく動くか」の最終確認のみ（本人へ依頼中）。
次のNEXTには着手していない。

---

## NEXT-002（Phase 2-4 まで完了・commit d997ddb・forge-v35配信済み・実機最終確認待ち）

**Supabase 設定、Google OAuth、PWA 同期の調査・修正**

`docs/FORGE_BACKLOG.md` の項目2。

### 今回やったこと（Phase 2-1: 統合の安全性）✅

**統合（merge）で、この端末の練習がクラウドの古い予定に上書きされていた。**

`/sync` の pull（`app/sync/page.tsx:160`）と、競合時の「両方を残す（統合）」は
どちらも `importBackup(..., "merge")` を通る。その `mergeById` が同じIDを
**無条件で上書き**していたため、クラウドに残っていた自動生成予定が、
この端末の**完了済み・本人編集・固定枠・手動追加・遡り入力**を消していた。

AGENTS.md の「完了済み・手動編集・固定予定を上書きしない」に反しており、
「両方を残す」と書いてあるボタンが片方を消す状態だった。

- `mergeById` に `keepExisting` を足し、残した件数を `kept` で返す
- `importBackup` の sessions で `isOwnedByAthlete` を適用（`replace` では適用しない。
  本人が「クラウドを優先」を選んだ経路なので）
- **守ったことを黙らない。** `RestoreReport.kept` と `warnings` を、
  データ管理画面と同期画面の両方に出す
  （`/api/backup` の応答は `{ ok, report }`。`report.warnings` の取り違えで空になっていた）

検証: 追加18件が**修正前16件赤 → 修正後緑**。E2E を1経路追加し、
**保護を外すと3つとも落ちること**を確認して復元（T-4）。`npm run verify` 緑
（**801件 52ファイル** / `ALL E2E PASS` / `UPDATE E2E PASS`）。

### Phase 2-3: Storage の利用者分離 ✅

**保存先が全利用者共通のままだった。** `forge/snapshot.json` は固定パスで、
Google OAuthでサインインできる誰か（想定外の第三者を含む）が同じファイルを
読み書きできる状態だった。利用者が1人でも、公開URL・OAuthを使う以上
「認可は不要」と判断しない、という方針（`docs/FORGE_BACKLOG.md` 項目11）どおり対応。

- 保存先を `forge/<uid>/snapshot.json`（利用者ごと）に変更
- `uid` は `accessToken`（SupabaseのJWT）の `sub` クレームから取り出す
  （`src/lib/core/sync.ts` の新規 `jwtSubject`。既存の `jwtRole` と同じ
  デコード基盤を共有するようリファクタ）
- `uid` が取り出せない場合は**通信せず**明確なエラーにする（共有パスへの
  黙ったフォールバックは分離の意味を失わせるため実装していない）

検証: `tests/sync.test.ts` に4件、`tests/supabaseConnection.test.ts` に2件追加
（先に赤を確認）。E2E は per-user パスへの経路に更新し、**旧共有パスに戻すと
ユニット3件・E2E3件とも落ちること**を確認して復元（T-4）。`npm run verify` 緑
（**810件 52ファイル** / `ALL E2E PASS` / `UPDATE E2E PASS`）。

**外部設定（本人対応・完了）**: Supabase の SQL Editor で RLS ポリシー4本
（SELECT/INSERT/UPDATE/DELETE、`(storage.foldername(name))[1] = auth.uid()::text`）
を適用。当初 `docs/FORGE_REQUIREMENTS.md` に用意したSQLに
`alter table storage.objects enable row level security;` を含めていたが、
実機で `ERROR: 42501: must be owner of table objects` になったため削除
（`storage.objects` は SQL Editor の `postgres` ロールの持ち物ではなく、
Supabaseのプロジェクトでは作成時点でRLSが既に有効なため、この行は不要だった）。
`create policy` 4本のみで適用成功。ドキュメントは訂正済み。

**「未解明点」は解消した**（下のPhase 2-4を参照）。RLS適用直後に古いコードで
成功したのは謎のままだが、実害があったのはPhase 2-4のバグの方だった。

### Phase 2-4: 個人用パスへの初回pushが失敗する不具合を修正 ✅

`forge-v34` 配信後、本人が実機で「いま同期する」を実行したところ、次のエラーが出た。

```
クラウドの読み取りに失敗しました（HTTP 400）。
Supabase: NoSuchKey / not_found / Object not found。
「forge」バケットの存在と、authenticated向けSELECT・INSERT・UPDATEポリシーを確認してください。
```

**根本原因**: 個人用パス（`forge/<uid>/snapshot.json`）は誰も一度も書き込んでいない
ため、実際のSupabaseは初回pushで `code: "NoSuchKey"`（S3互換のオブジェクト未存在
コード）を含む本文を返した。`isMissingSnapshot`（`app/components/supabase.ts`）は
`payload.code` を最優先で見て文字列 `"not_found"` とだけ比較していたため、
`"NoSuchKey"` と一致せず「初回同期」と判定できなかった。`error` フィールドには
従来どおり `"not_found"` が入っていたが、`code` を優先していたため見ていなかった。
テスト環境のダミー応答には `code` フィールドが無かったため、この不具合はユニット
テストでは検出できず、**実機の初回pushで初めて顕在化した。**

- `isNotFoundCode` を追加し、`code` と `error` のどちらかが `"not_found"` または
  `"nosuchkey"`（大小文字問わず）であれば未存在と判定するよう緩和
- `message`（`"Object not found"`）は引き続き主な決め手として必須のまま

検証: `tests/supabaseConnection.test.ts` に1件追加（実機で見た実際のペイロード
そのまま）。**修正前ロジックに戻すとユニット1件・E2E2件が落ちること**を確認して
復元（T-4）。`npm run verify` 緑（**811件 52ファイル** / `ALL E2E PASS` /
`UPDATE E2E PASS`）。**その後 `forge-v35` として commit / push / gh-pages配信まで
完了済み**（2026-07-30）。

### 完了条件

- [x] Phase 2-0〜2-3 実機で確認済み
- [x] `npm run verify` 緑
- [x] commit `4364d1e` → push → gh-pages配信（`forge-v34`）
- [x] RLSポリシー適用済み（本人確認）
- [x] Phase 2-4: 個人用パスへの初回push不具合を発見・修正
- [x] commit `d997ddb` → push → gh-pages配信（`forge-v35`）
- [ ] **`forge-v35` 配信後の同期動作を実機で再確認** — まだ本人からの報告を受けていない

### 今回やったこと（Phase 2-0 + 2-2）✅

**実機診断で切り分けた。** 接続テストは `種別: ok ／ HTTP 200` — Supabase プロジェクトは
実在し、URL・Publishable Key とも正しい。「プロジェクトが無い」という当初の推測は外れた。

サインイン後にホームへ戻る症状を実機で再現し、**同期画面を開き直すとサインイン済みと
表示される**ことを確認した。つまり**トークンは受け取れているが、画面遷移だけが起きない**。

**根本原因（確認済み）**: `app-shell.tsx` のトークン受け取りが、戻り先に `?sync=1` という
クエリが残っていることを前提に「同期画面へ戻るか」を判断していた。このクエリは
自前では守れない。Supabase の **Redirect URLs** にこのアプリのURLを登録していないと、
Supabase は指定した `redirect_to` を無視して **Site URL** へ飛ばすため、クエリごと落ちる
（横取り耐性のための仕様で、FORGE側の不具合ではなく設定依存の外部要因）。
その結果、トークンは保存されるのに画面だけホームに居座っていた。

**本人に確認済み**: 症状が起きていた当時、Supabase の Redirect URLs には
`https://rio01100801-gif.github.io/trainmiddle/**` のワイルドカードエントリが
**入っていなかった**（今回の相談中に追加）。上記の推測は当て推量ではなく、
時系列と設定状態の両方で裏が取れている。

**直したこと**: `captureAuthRedirect` が何か拾えた時点で、それは必ず
`signInWithGoogle` が発行した `redirect_to` からの戻りである（他にこのURLへ来る経路が
無い）。そこで `?sync=1` の有無を問わず同期画面へ戻すようにした。判断は
`src/lib/core/sync.ts` の `authRedirectLanding`（新規・純関数）に集約し、
`app-shell.tsx` はそれを呼ぶだけにした。

検証: `tests/sync.test.ts` に3件追加（先に赤を確認）。E2E に
「`?sync=1` が欠けた復帰でも同期画面へ戻る」経路を追加し、**判定を元に戻すと
タイムアウトで落ちること**を確認して復元（T-4）。`npm run verify` 緑
（**804件 52ファイル** / `ALL E2E PASS` / `UPDATE E2E PASS`）。
**その後 `forge-v33` として commit / push / gh-pages配信まで完了済み**（2026-07-30）。

**症状2（iPhone「サーバに接続できません」）も、`forge-v33` 配信後の実機確認で
再現しなくなったことを本人に確認済み**（2026-07-30）。

ただし**根本原因は確定していない。** 私が直接コード上の原因を特定して直したのは
症状1（`?sync=1` 依存）だけで、症状2については以下のどれで直ったか切り分けていない。

- 元々の報告どおり「最初にURLを打ち間違えた」ことによる一時的な状態で、
  正しいURLへ直した時点で既に解消していた可能性
- Redirect URLs にワイルドカードを追加したことによる副次的な解消
- 症状1の修正コードが症状2にも効いていた可能性

**推測で「直った理由」を断定しない。** 現時点で言えるのは「本人の実機で再現しなくなった」
という事実のみ。今後また同様の症状が出た場合は、あらためて実機で切り分けが必要。

**外部設定は対応済み。** Site URL は `https://rio01100801-gif.github.io/trainmiddle/`、
Redirect URLs に `https://rio01100801-gif.github.io/trainmiddle/**` を含む3件が
登録されていることを本人のスクリーンショットで確認した（2026-07-30）。
コード側の修正（`?sync=1` に依存しない）と合わせて、二重の安全策になっている。

### なぜ次がこれか

BUG-02〜04 は**実機 iPhone でしか再現確認できない**。実機の結果を待つ間に進められて、
かつ他の多くの項目の前提になるのが同期。ただし下の「先に片付かないと進まないもの」に注意。

### いま実装されているもの（コード上の事実。**検証済みという意味ではない**）

| 置き場所 | 中身 |
| --- | --- |
| `src/lib/core/sync.ts` | ネットワーク非依存の判断。`decideSync` / `metaOf` / `normalizeSyncConfig` / `validateSyncConfig` / `oauthRedirectTo` / `googleAuthorizeUrl` / `authRedirectLanding`（新規） |
| `app/components/supabase.ts` | 実通信と端末側の保存。設定の読み書き、`signInWithGoogle`、`testConnection`、`getSyncDiagnostics`、`parseAuthRedirectHash` / `captureAuthRedirect`、`fetchSnapshot` / `putSnapshot` |
| `app/components/app-shell.tsx` | OAuth復帰の受け取り。着地判断は `authRedirectLanding` に委譲 |
| `app/sync/page.tsx` | `/sync` 設定画面。未設定でも成立する |
| `tests/sync.test.ts` / `tests/supabaseConnection.test.ts` | 42件・緑 |
| `pwa/e2e.mjs` の S-11 | 同期設定・接続診断・OAuth復帰（`?sync=1` あり／無し両方）・Storage RLS診断・クラウド保存・設定のみ削除 |

同期の中身は `exportBackup` / `importBackup` の payload をそのまま使う。
**保存形式を変えると同期にも波及する。**

### 未解決として報告されている症状

1. ~~**PC**: Google サインインまで進めるが、そのあと FORGE のホーム画面に戻る~~
   → **Phase 2-2 で対処済み（原因確定・実機再現済み）**
2. **iPhone（PWA / Safari）**: 「サーバに接続できません」が出る。**未再現**。
   最初に URL を打ち間違え、その後修正した経緯あり。症状1とは別原因の可能性がある

### コード上で分かっている穴

- **Storage の置き場所が全利用者共通**（`app/components/supabase.ts:537-538` の
  `BUCKET = "forge"` / `OBJECT = "snapshot.json"`）。利用者IDでパスが分かれていない。
  RLS の設計とセットなので、`docs/FORGE_BACKLOG.md` の項目11とも重なる
- ~~`importBackup` の統合が同じIDを無条件で上書きする~~ → **Phase 2-1 で対処済み**。
  完了済み・本人編集・固定枠・手動追加・遡り入力は統合で残し、残した件数を画面に出す
- ~~OAuth復帰が `?sync=1` の残存を前提にしていた~~ → **Phase 2-2 で対処済み**

### 先に片付かないと進まないもの（🔑 リポジトリ外）

`HANDOFF.md` 下部の「外部設定待ち」の6件。**これが終わるまで実データの往復は検証できない。**
コードだけで進められるのは、設定の正規化・診断・判断ロジック・ハッシュ経路の扱いまで。

### 着手時に決めること（症状2に着手する場合。**この節を埋めてから実装に入る**）

- 症状2を**先に実機で再現**する。再現しないものを直さない（NEXT-001 の教訓）
- 失敗するテストを先に書く。ネットワークを使わない層（`sync.ts`）で書けるところまで書く
- Next.js と PWA の両経路 / SQLite と IndexedDB の両保存層を確認する
- `exportBackup` の形式に触るかどうかを最初に決める（触るなら影響範囲が一段広がる）
- 秘密情報を扱う。**token・key・健康データ本文をログや報告に出さない**

詳細要件は `docs/FORGE_REQUIREMENTS.md` の 2.2 に書く（現在は未記入）。

---

## NEXT-001 の完了記録（2026-07-30・commit fd15365 / forge-v33 配信済み）

**目標レースのボーダータイムが再表示時に消える** → ✅ 対応済み

- **報告された症状は着手時点で既に直っていた。** 往復を見る7件のテストは修正前から緑
- **実際に直したのは別の欠陥**: `Number.isFinite(0)` が `true` のため `0`／負のボーダーが
  保存を素通りし、`planHeatPace` の `?? ` も `0` を nullish と見なさないので、
  予選の通過目安が **−0.5秒** になる。**画面には値が出たままで気づけない**。
  `importBackup` は `saveGoalAndRaces` を通らないので、そちらにも同じ規則を通した
- 変更: `src/lib/service.ts`（`normalizeRaceBorders`）/ `tests/goalRaces.test.ts`（新規12件）/
  `pwa/e2e.mjs`（1経路）/ `README.md` / `pwa-dist/bundle.js`。`app/goal/page.tsx` は変更なし
- 検証: 修正前に4件赤 →修正後12件緑。E2E は**壊すと落ちることを確認**して復元（T-4）。
  `npm run verify` 緑（783件 51ファイル / `ALL E2E PASS` / `UPDATE E2E PASS`）。
  当時は VERSION 未更新だったが、**その後 `forge-v33` としてビルド・commit・push・
  gh-pages配信まで完了済み**（2026-07-30）

**残り**: 実機 `forge-v33`（配信済みの最新版）で元の症状が再現するかの確認。
再現するなら、直したのとは別の原因が残っている。

根拠と閾値の理由は `docs/FORGE_REQUIREMENTS.md` の 2.1 と `README.md` にある。

---

## 禁止事項

- `git reset --hard` / `git checkout --` による既存変更の破棄
- force push / rebase / 履歴書き換え
- `package-lock.json` の削除
- テストの削除・skip・only・無効化
- `any` / `ts-ignore` / `ts-expect-error` の追加
- エラーの握りつぶし
- 競技ロジックの数値・閾値を根拠なく変更すること
- 完了済み練習・手動編集メニューの上書き
- 無関係な大規模リファクタリング
- service role key など秘密鍵をクライアントへ置くこと
- token・健康データ本文をログや報告へ出すこと
- 実行していない検証を成功と報告すること
- **今回の指示範囲**: VERSION 更新・commit・push・gh-pages 配信

## 外部設定待ち

リポジトリ外の操作が必要で、コードだけでは完了できないもの。

| 項目 | 必要な操作 | 誰が |
| --- | --- | --- |
| Supabase プロジェクト | 作成（無料枠・Tokyo リージョン） | 本人 |
| Storage bucket | `forge` を Private で作成 | 本人 |
| Storage の RLS | **利用者ごとにパスを分離**するポリシー（`<auth.uid()>/snapshot.json`）。現状の想定は全利用者共通の `snapshot.json` で、分離が未適用 | 本人（SQL は担当が提示） |
| Google OAuth | Cloud Console でクライアントID作成 → Supabase に登録 | 本人 |
| Redirect URL | Supabase の URL Configuration に公開URLを追加 | 本人 |
| 接続情報 | Project URL と Publishable（anon）key をアプリの `/sync` に入力 | 本人 |

⚠️ **キーを担当者に渡す必要はない。** 値は本人の端末にだけ入る。
`service_role` キーは絶対にクライアントへ置かない。

## 実機確認待ち

自動テストでは確認できず、実機 iPhone が要るもの。

| # | 確認すること |
| --- | --- |
| 1 | **BUG-02〜04 が `forge-v33`（配信済み最新版）で今も再現するか**（最優先）。あわせて NEXT-001 の元症状（ボーダーが消える）と NEXT-002 の症状1（サインイン後にホームへ戻る）が直っているか、症状2（「サーバに接続できません」）が再現するかも確認する |
| 2 | Safari と ホーム画面 PWA の両方で起動できる |
| 3 | Google サインイン後に FORGE の同期画面へ戻る（PC / iPhone 両方） |
| 4 | PWA と Safari で認証状態・保存領域が別であること |
| 5 | オフラインで起動し、記録できる |
| 6 | 更新（新 VERSION）を受け取ったあともデータが残る |
| 7 | ホーム画面アイコンが新しいものになる（**一度削除して追加し直す必要がある**） |
| 8 | キーボード表示中に保存ボタンが隠れない／1文字ごとに閉じない |
| 9 | Safe Area（ノッチ・ホームインジケータ）と重ならない |
| 10 | FIT / Apple Health の取込が実用的な時間で終わる |

> iOS のホーム画面アイコンは追加時に焼き付けられるため、配信を差し替えても変わらない。
> 削除→再追加が必要で、その際にストレージが分離されている点に注意（バックアップを先に取る）。
