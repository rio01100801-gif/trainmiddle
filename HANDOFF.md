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
| HEAD | `b0fa6e1`（`feat: 分析画面に28日統合タイムラインと同一処方比較のRPE/翌日脚表示を追加`。forge-v42としてgh-pages配信済み） |
| `origin/main` との差 | **0 / 0**（完全一致）。ただし本セッションの5件の不具合修正（下記）が**未コミット** |

直近コミット:

```
b0fa6e1 feat: 分析画面に28日統合タイムラインと同一処方比較のRPE/翌日脚表示を追加
ca23f3a feat: 疲労兆候による低リスク候補優先を既存生成ロジックに追加
059ec4a fix: 実運用で見つかった4件の不具合を修正
10c1bf4 release: AGENTS.md/CLAUDE.mdの同期漏れを修正し forge-v39 を配信
125aa05 feat: 運用整備（CI・アトミックビルド・診断画面・runbook）を追加
80bbcc1 fix: セキュリティ・プライバシー監査で見つかった問題を修正
dba5f56 fix: トレーニングロジック統合監査で見つかった3件のバグを修正
e654778 fix: 統合監査で見つけた既存バグ2件を修正
a9ec349 feat: P0監査の残り3項目（依存関係・危険な提案防止・API認証）に対応
8900c7d feat: FIT/Garmin取込基盤とPWA保存保証・UI/UXアクセシビリティ改善を追加
9d14ead docs: NEXT-002完了（forge-v35実機確認済み）を反映
```

**本番Supabaseへの対応（2026-07-31・リポジトリ外の作業）**: `forge`バケットの
RLSを本人と一緒に手動で確認・整理済み。旧設計の緩いポリシー3つ
（`forge_select_own_snapshot`/`forge_insert_own_snapshot`/`forge_update_own_snapshot`。
特にINSERTに`owner_id`条件が無かった）を削除し、`forge_own_folder_*`
（uid別パスで正しく分離済み）の4つだけが残る状態にした。bucketも
private・50MB・`application/json`限定に設定済み。

**実機iPhone受入試験（2026-07-31）**: forge-v38を実機Safari・ホーム画面PWA
両方で確認済み（4タブ表示・データ保持・Googleログイン/同期・オフライン起動・
診断情報画面いずれもOK）。

## リファレンスUI刷新（2026-07-31〜・進行中）

`FORGE_UI_IMPLEMENTATION_BUNDLE.zip`（`COPY_THIS_PROMPT.txt` ＋ リファレンス画像13点）に
基づくビジュアル刷新。**ドメインロジックには触れていない。**
全8フェーズのうち Phase 0〜3 まで完了。計画は `.claude/plans/swirling-petting-oasis.md`。

### 完了（全8フェーズ）

| Phase | 内容 |
| --- | --- |
| 0 | ブランド資産・トークン |
| 1 | 下部ナビ |
| 2 | TODAY画面 |
| 3 | カレンダー・分析（PERFORMANCE新設） |
| 4 | AIメニュー・記録サマリー（新規画面 `/summary`） |
| 5 | セッション実行画面 |
| 6 | アプリアイコン・スプラッシュ |
| 7 | 視覚回帰の baseline 確定 |

**核心の技術判断**: リファレンスの光跡は写実的なレンダリングだが、
**カード内のトラックはSVGで描いている**。アプリアイコンの写実素材を敷いてみたところ
文字が読めなくなり、拡大して確認するとリファレンスのカード内トラックは
写真ではなく細い光の弧だと判明したため。写実素材はアイコン・スプラッシュ用に温存。
ワードマークは `00-app-icon.jpeg` から白い字形だけをアルファ抜きし、
CSSの `mask` として使う（斜体テキストは指示書が明確に禁止している）。

**画像パスの解決**: `app/globals.css` の `url("./brand-wordmark.png")` に寄せてある。
CSSの `url()` は「そのCSSファイルの位置」を基準に解決されるので、
Next.js（`app/` 基準）でもPWA（`pwa-dist/` 基準）でも同じ記述で正しく解決される。
JS側でパスを組み立てると必ずどちらかで壊れる。実体は `app/` と `pwa/` の2箇所に置き、
`scripts/build-static.mjs` のコピー配列と `pwa/sw.js` の `ASSETS` の両方に登録が必要。

### 本人と合意した判断（リファレンスと現行が矛盾する箇所）

1. **下部タブは4つのまま**（リファレンスは5つ）。`CLAUDE.md` の明記ルール優先。
   リファレンス自身もアイコン一覧では4つしか描いておらず内部矛盾している
2. **カレンダーは月グリッドにしない**。リストのまま chrome を削って密度を上げる。
   本人がカレンダーでやるのは行ごとの編集・削除・追加であり、
   1日＝点1つのグリッドではどれもできない。「強度を一目で」は
   ACWR・カバレッジ・ルール警告が既により正確にやっている
3. **表示言語は混在**。構造ラベルは英語（TODAY / RECOVERY / WEEKLY SUMMARY /
   CALENDAR / PERFORMANCE）、本文は日本語。リファレンスがその構成
4. **セッション実行画面のタイマーは作らない**。見た目だけ寄せる（新機能は別スコープ）
5. **分析はPERFORMANCEを4つ目のセグメントとして足す**（置き換えない）。
   置き換えると制限因子・600m通過・同一処方比較・CFE推移・ACWR・カバレッジ・
   レース分析が全部消える

### 視覚回帰ハーネス `pwa/visual.mjs`

```bash
npm run visual
```

8画面（splash / today / calendar / analytics / results / ai-menu / session-run /
summary）× 3幅（390 / 393 / 430）＝ **24枚**を撮り、`visual/baseline/` と比べる。
意図した変更なら `npm run visual:update` で baseline を更新する。

時刻を `2026-08-15`（レースまで41日＝リファレンスと同条件）に固定し、
プランを `2026-06-01` から生成、基準日より前に実施記録（設定タイムのある
セッションは本ごとのタイム）を入れてから撮る。固定しないと毎回違う絵が出る。

**判定はハッシュ比較**。上記のとおり固定してあるので、同じ実装からは
バイト単位で同じPNGが出る（実測済み）。だから pixelmatch のような
画像差分ライブラリを足していない。どこが変わったかは
`visual/current/` と `visual/baseline/` を並べて見るほうが速い。

**忠実度は自動差分できない**（リファレンスはベゼル入りの合成モックアップで
解像度も縦横比も違う）。撮った画像を人が `reference-ui/crops/*.jpeg` と
並べて見比べ、差分を言葉にして直す。自動差分できるのは回帰のほうだけ。

**ハマりどころ**: スプラッシュは Reactがマウントすると自分で消えるので
`bundle.js` を読ませずに撮っている。また「アプリを準備しています」が
無限に点滅するため、撮る直前にその要素だけアニメーションを止めている
（全部止めると入場アニメが初期状態に戻る）。

### リファレンスに届いていない点（記録）

スプラッシュのトラックは、リファレンスでは遠近のついた楕円で左へ光跡の尾が
抜けていく。こちらは正面から見た楕円で尾は無い。写実的なレンダリングの
再現はSVGの範囲を超えるため、差が残っている。

### 配信について

**まだ push・配信はしていない。** 実機に出す前に本人の確認を取ること。

---

## 未コミット変更

**あり（2026-07-31・実運用で見つかった5件を修正。これから commit・push・配信する）。**
`npm run verify`（typecheck・test 979件・build:all・e2e・e2e:update）が
全て成功済み。VERSIONは`forge-v42`のまま未更新（締め作業でforge-v43に上げる）。

利用者からの報告7件のうち、情報不足の2件（FIT読み取り精度の具体例待ち／
「文字が読みにくい」の対象画面待ち）を除いた5件を実装した。詳細な設計判断・
検証方法はREADME.mdの「実運用で見つかった5件の修正（2026-07-31）」を参照。
要約:

1. **カレンダーの✎ボタンが2件目以降のセッションに届かない** →
   `editable`（単数）を`editableSessions`（配列）にし、非固定セッションの
   数だけ✎を出す
2. **カンマ区切り入力欄でカンマが打てない** → 実施タイム欄の
   `inputMode="decimal"`を削除（数値専用キーボードにカンマキーが無かった）
3. **FIT取込でランニングダイナミクス（ピッチ・ストライド・上下動・接地時間・
   気温）を取得** → `fitParse.ts`を拡張。湿度はFITの標準フィールドに
   無いため対象外
4. **「ジョグ＋坂ダッシュ」等の複合メニューを生成時点で分割** →
   `DayTemplate.combinedJogMin`を追加し、`hillSprints`/`strides`/
   「刺激入れ（流し）」からジョグ部分を別セッションとして自動生成
5. **曜日の優先設定で複数種目に対応してほしい** → 調査の結果、既存の
   「神経系」枠が(4)の`strides()`経由で既にジョグ込みになることが分かり、
   新しい型・UIは追加せず`SLOT_LABELS`の表示名だけ変更した

**前回（forge-v42・2026-07-31・コミット`b0fa6e1`・配信済み）**: 「分析・
データ可視化機能の再設計」という6フェーズの大規模提案を検討し、大半を
見送って28日間統合タイムライン（`src/lib/core/timeline.ts`）と同一処方
比較表のRPE/翌日脚表示の2点だけを実装。見送った理由・詳細はREADME.mdの
該当節を参照。

**前回（forge-v41・2026-07-31・コミット`ca23f3a`・配信済み）**: 「刺激ベース
・トレーニング生成エンジン」への大規模移行提案を検討し、核心の着想
（`recentFatigueSignal`）だけを既存アーキテクチャへの最小拡張で実装。

次に取りかかる担当（または本人）がやること:
1. README.mdの「セキュリティ・プライバシー監査」節末尾「指摘したが今回直して
   いないこと」、および`OPERATIONS.md`にある未着手項目を次の作業候補として
   扱ってよい
2. FIT読み取り精度（メニュー内容の誤判定）は、具体的にどのメニューがどう
   誤判定されたかの実例が無いと正しい箇所を直せているか確認できない。
   本人から実例が来たら着手する
3. 「文字が読みにくい」はどの画面か（メニュー本文？「メニューの根拠を確認」
   画面？警告文？）を本人に確認してから着手する
4. 刺激ベース生成エンジン・分析画面再設計の本格導入は見送ったが、指示書
   自体は会話ログに残っている。個人反応データ・新規データ収集が進んだ
   将来、再検討の余地はある（README.md参照）

---

NEXT-001 と NEXT-002（Phase 2-1〜2-4）は `d997ddb` までコミット・push・
gh-pages配信済み（2026-07-30・`forge-v35`）。内容は下の「NEXT-001 の完了記録」「NEXT-002」を参照。

> 過去に、同じディレクトリで複数のエージェントが並行編集し、
> 一方の未コミット変更が消えかけた経緯がある。**同時に走らせないこと。**

## 配信状態

| 項目 | 値 |
| --- | --- |
| ソース `pwa/sw.js` | `forge-v43`（未コミットのローカル変更） |
| `pwa-dist/sw.js` | `forge-v43`（5件の修正を反映してローカルビルド済み・未配信） |
| 公開中（`gh-pages`） | `forge-v42`（配信済み・2026-07-31。timeline機能まで） |
| `main:pwa-dist` と `gh-pages` の tree | 今回の変更ぶんは配信の許可待ち |

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

**NEXT-006（統合監査）実装・検証済み・未コミット。** NEXT-003（P0監査7対象）・
NEXT-004（FIT取込 Phase 1〜6）・NEXT-005（UI/UX 1〜5）は
commit済み（`8900c7d` / `a9ec349`）だが**push・配信は未実施**。
優先順位メモの次項目は「トレーニングロジック統合監査」（4と5の間に挿入
された項目）→「セキュリティ・プライバシー監査」。

---

## NEXT-006（統合監査: 入力→保存→同期→分析→提案→バックアップ）✅ 実装・検証済み・未コミット

**優先順位メモ**の4番目。FIT/Garmin取込（Phase 1〜6）が既存サブシステムと
正しく噛み合っているかを7つの結合点について確認し、**既存のバグを2件発見・
修正**した。

FIT由来のセッションは2種類ある（`backfilled: true`の新規セッション／
Phase 6の紐付け済み＝`processResult`経由で`backfilled`が立たない）ため、
両方が正しく扱われるかを見る必要があった。

**PASSだった5点**: ACWR/負荷計算・週次レビュー（M-11）・カバレッジ確認・
`fitImports`の同期ラウンドトリップ・`isOwnedByAthlete`の保護（両種類とも
OR条件でカバー済み）。

### バグ1: 週次サマリーから過去データが抜け落ちていた

`weeklySummary`（`rules.ts`。ホーム・分析画面の週間カテゴリ集計・転移度
スコア）が`ctx.sessions`＝**ルール評価用にbackfilledを除いたリスト**を
使っており、「その週に実際に何をやったか」の集計として過小評価になって
いた。ACWR・週次レビュー・カバレッジ確認は未フィルタの全セッションを
使っており**ここだけ食い違っていた**。`RuleContext`に`allSessions`を
追加し`weeklySummary`だけ切り替え（ルール評価そのものは今まで通り
backfilled除外を維持）。FIT固有ではなく一括入力由来の過去データでも
起きていた既存バグ。

### バグ2: `rebuildFitDerived`が紐付け済み取込を壊す（潜在バグ）

全レコードを無条件に`buildBackfilledSessionAndResult`へ通していたため、
**紐付け済みレコードを作り直すと元の計画済みセッションではなく新規の
`fit-s-*`を作り、元セッションが結果を失って孤立**していた。
`record.sessionId === \`fit-s-${record.id}\``で判定して分岐し、紐付け済みは
取込時と同じ経路（`buildLinkedResult` + `processResult`）で作り直す。
紐付け先が消えていたら新規作成に化けさせず`orphaned`として報告。
現状どのAPIからも呼ばれていない（テストのみ）が、READMEで「分類ロジックを
直した後に実行するもの」としている以上、実行した瞬間に全紐付けが壊れる
ところだった。

### 検証

両バグとも**直す前の状態に戻すとテストが実際に赤くなることを確認**（T-4）。
バグ2は回帰テスト2件を追加し、`wasBackfilled`を常に`true`にする改変で
両方赤くなることを確認。`npm run verify`緑（**900件 60ファイル** /
`ALL E2E PASS` / `UPDATE E2E PASS`）。VERSIONは`forge-v35`のまま。

### 指摘したが直していないこと

バックアップ・同期スナップショットに**FIT元ファイル（base64）が全件入る**
ため、取込が増えるほどサイズが際限なく膨らむ（Supabaseスナップショット・
モバイル回線の転送量に影響）。正しさの問題ではなく保持期間・間引きの
方針判断が要るため記録に留めた。

---

## NEXT-005（UI/UX・iPhone操作性・アクセシビリティ改善 1〜5）✅ 実装・検証済み・未コミット

**優先順位メモ**の3番目（FIT/Garminの後、統合監査の前）。NEXT-004でFIT/Garmin
Phase 1〜4が完了した時点で、Phase 5・6（二重登録防止・既存予定との紐付け）の
計画を提示したが、「先に優先順位メモの次項目（UI/UX）に進む」という指示で
Phase 5・6は保留し、こちらへ着手。

`docs/FORGE_BACKLOG.md`の「9. アイコン・ロード画面・アプリ内UI」「10. iPhone・
アクセシビリティ」を調査し、実機無しで対応・検証できる項目から着手する計画を
提示 →「いいよ」で1〜3を承認、続けて4〜5も「これ」で承認を得て実施。

### 1. 320px幅（iPhone SE相当）での横スクロール検証

既存のE2E横はみ出しチェックは390px幅でしか回っていなかった。同じチェックを
320px幅でも実行するようにした（`pwa/e2e.mjs`）。実装変更は無し、検証範囲を
広げただけ——結果、既存コードのまま320px幅でも横スクロールは発生しないことを
確認できた。

### 2. タップ領域44×44の統一

`.seg button`（40px→44px）、`app/results/page.tsx`故障ログの「+記録する」
トグル（32px→44px）、`app/plan-settings/page.tsx`自作メニューの「+登録する」
トグル（36px→44px）、カレンダー期間送り矢印（高さ44pxはあったが幅が不足→
`min-w-[44px]`追加、`aria-label`も付与）。FIT取込lap一覧の`<select>`（32px）は
密なレビュー用リストのため対象外にした（README参照）。

E2Eにセグメントタブの高さ・期間送りボタンの幅の実測チェックを追加。**T-4で
両方の数値を戻して赤に戻ることを確認して復元。**

### 3. ConfirmDialogのアクセシビリティ

`role="dialog"`/`aria-modal="true"`/`aria-labelledby`、開いた瞬間のフォーカス
移動、Escapeで閉じる、Tabキーのフォーカストラップ（ダイアログの外へ抜けない）、
閉じたときに呼び出し元へフォーカスを戻す——を`ConfirmDialog`
（`app/components/ui.tsx`）に追加。`ConfirmButton`はこれを内部で使うため
自動的に反映される。

`onCancel`はほとんどの呼び出し元がインライン関数で渡すため、`useEffect`の
依存配列にそのまま入れると親の再描画のたびにフォーカスが先頭ボタンへ
引き戻されるバグになる。最新の関数はrefで保持し、effectの依存は`open`だけにした。

**検証**: このプロジェクトには単体テストでReactコンポーネントを描画する土台
（jsdom・testing-library）が無く、既存の方針（コアロジックは単体テスト・画面は
E2E）に合わせ、E2E（自作メニュー削除の確認ダイアログを流用）で
role/aria-modal・Escape・フォーカス復帰・フォーカストラップの4点をキーボード
操作で確認。**T-4でrole/aria-modal属性の削除、Tabのラップアラウンド処理の
無効化をそれぞれ行い、両方とも赤に戻ることを確認して復元。**

### 4. iOSキーボード対策（interactive-widget=resizes-content）

編集フォーム（`SessionEditSheet`・カレンダー追加シート）を調べると、保存
ボタンは`position: fixed`ではなく通常のフローにあり、ネイティブのフォーカス
スクロールで足りる作りだった——固定位置の保存ボタンが隠れる問題は無かった。
一方、下部タブバー・FABは`position: fixed`で、iOSはキーボード表示中も
レイアウトビューポートを縮めないため裏に取り残される可能性がある。独自の
`visualViewport`監視JSではなく、標準の**`interactive-widget=resizes-content`**
をviewport metaに追加（`pwa/index.html`・`app/layout.tsx`。後者は
`viewportFit: "cover"`も無かったため併せて追加——既存の抜けだった）。

検証: E2Eでmetaタグの内容を確認。**実機での最終確認は別途必要**（Chromiumは
キーボードによるビューポート縮小を再現しない）。

### 5. 状態表現を色だけに頼らない（StatusText）

色だけで警告・エラーを示していた箇所24個のうち21個（同じ`<p style={{color:
"var(--red|amber)"}}>`という形）を共通コンポーネント`StatusText`
（`app/components/ui.tsx`。既存の`ViolationList`のアイコン・色の組み合わせに
揃え、`role="alert"/"status"`を付与）へ機械的に置き換え。残り3個は太字という
色以外の視覚的区別が既にあるため対象外、`Notices`（ホームの1行通知）は項目に
よって色の意味が違う（片方は警告色でなくニュートラル）ため、警告色の項目
だけに条件付きでアイコン・roleを追加。

検証: E2E（S-6の他選手メニュー換算。PBの差を10秒超にして`converted.notes`が
実際に出るケースに変更）で`StatusText`がrole/アイコンつきで描画されることを
確認——1箇所の実装なので、ここで確認できれば他20箇所の呼び出しも同じ実装を
経由していることの裏付けになる。**T-4でrole/アイコンの出力を削り、赤に戻る
ことを確認して復元。**

`npm run verify`緑（**875件 60ファイル** / `ALL E2E PASS` / `UPDATE E2E PASS`）。
`bundle.js`は892,757バイト（Phase 4の891,467バイトから+1,290バイトのみ）。
VERSIONは`forge-v35`のまま。

### 残っていること

- 実機確認待ちの既存項目（アプリアイコン・起動画面・Safe Area・iOSキーボード
  対策の最終確認）はそのまま
- 色だけに頼っていた24箇所のうち21箇所は`StatusText`へ置き換え済み。残り3箇所
  （太字による区別が既にある箇所）と`Notices`の一部は意図的に対象外（README参照）

---

## NEXT-004（FIT/Garmin取込 Phase 1〜6・全項目完了）✅ 実装・検証済み・未コミット

**優先順位メモ**（P0監査 → FIT/Garmin → UI/UX → 統合監査 → トレーニングロジック監査 →
セキュリティ監査 → 運用整備 → 配信実行 → 実機受入試験 → データ分析）の2番目に着手。
9 Phaseの全量は一度にやらず、**Phase 1（ファイル選択と安全な受信）だけ**実装。

### 事前調査で判明した重要な事実（実装方針を決めた根拠）

- **Garmin Connect のiPhoneアプリにはFITを書き出す・共有する機能が無い。** 個別
  アクティビティの書き出しは **Garmin ConnectのWeb版でのみ**可能
  （[Garmin Forums](https://forums.garmin.com/apps-software/mobile-apps-web/f/garmin-connect-web/421060/exporting-individual-activity-raw-data)）
- **iOS SafariはWeb Share Target API未対応**で、PWAを共有先に登録できない
  （[MDN](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/share_target)）
- 上記2点により **`share_target`は実装しない**（実現できない共有方式を動くように
  見せない、という指示に従った）。導線は「Safariで connect.garmin.com を開く →
  Web版でFIT書き出し（ファイルアプリに保存）→ FORGEで通常のファイル選択」

### やったこと

`validateFitBytes`（`src/lib/core/fitImport.ts`、新規）を追加。拡張子ではなく
FITプロトコルのヘッダー（`.FIT`シグネチャ、`header_size`が12/14、宣言された
`data_size`と実ファイルサイズの整合）で判定する。サイズ上限5MB（800m練習の
FITは通常数十〜数百KBという用途上の根拠、コメントに残した）。CRC値そのものの
検証はPhase 2（`fit-file-parser`導入時）に委ねる。

`pwa/entry.tsx` に `FitImportCard`（Apple Healthカードと同じ場所・パターン）を追加。
ファイル選択→検証結果表示のみで、**解析・保存はまだしない**（Phase 2以降）。
ファイル名はReactの自動エスケープで描画（HTML化しない）。ファイル内容はログに
出さない。二重送信は`busy`ガードで防止。

Web Workerは今回のファイルサイズ想定（同期処理で数十ms以内）では見送り、
サイズ上限チェックを読み込み前に置くことで画面の固まりを防ぐ。

### 見つけたテストの落とし穴（アプリのバグではない）

E2Eで「拡張子だけ.fitの非FITファイル」を模したフィクスチャの1バイト目が
たまたま`header_size`として不正な値になり、狙っていた`bad_signature`ではなく
`bad_header`で拒否されていた。アプリ側は正しく動作しており、フィクスチャの
作り方を直した（`header_size`は正しいがシグネチャだけ不正、という形に変更）。

### 検証

先に赤を確認（10件）→ 実装 → 緑。**署名チェックを無効化すると1件赤に戻ることを
確認して復元**（T-4）。`npm run verify` 緑（**845件 56ファイル** / `ALL E2E PASS` /
`UPDATE E2E PASS`）。VERSIONは`forge-v35`のまま。

### 変更ファイル（Phase 1）

新規: `src/lib/core/fitImport.ts` / `tests/fitImport.test.ts`（10件）。
変更: `pwa/entry.tsx`（`FitImportCard`）/ `pwa/e2e.mjs`（1経路）/ `README.md`。

### Phase 2: FIT解析（file_id / session / lap / record / event を区別）✅

**採用ライブラリ**: `fit-file-parser`（MIT、`npm install`で追加）。理由と選定過程は
README参照。**bundle.jsが約873KB→約1307KB（+約434KB）に増加**——Garmin公式の
FIT SDKプロファイル定義を丸ごと含むため。今回は許容したが、次のPhaseに
進む前に一度立ち止まって確認したい点として残す（下記「相談したいこと」）。

`parseFitFile`（`src/lib/core/fitParse.ts`、新規）が session/lap/record/event/
file_idを区別して抽出し、FORGEの単位（km・秒/km・UTC ISO文字列）へ変換する。
NaN・Infinity・負数・ゼロ除算は推測で埋めず`undefined`にする。

**重要な発見**: FITのfield番号は**メッセージ種別ごとに異なる**（例:
`avg_heart_rate`はsessionがfield 16、lapはfield 15）。これは実際に
`FitEncoder`で組み立てて`FitParser`でデコードし、ライブラリ本体のプロファイル
定義ファイルと突き合わせて確認した（当初の想定は誤りだった）。テスト用
フィクスチャ（`tests/fixtures/fitEncoder.ts`）はこの確認済みの番号を使っている。

**タイムゾーン**: `activity`メッセージの`timestamp`（UTC）と`local_timestamp`
（デバイスのローカル時刻）の差からUTCオフセットを求める。`local_timestamp`が
無ければ推測せず未確定のまま（iPhoneの現在タイムゾーンでは代用しない）。

`pwa/entry.tsx`の`FitImportCard`をPhase 2まで拡張し、構造検証に続けて実際に
解析し、種目・距離・時間・平均心拍・lap/record件数・タイムゾーンを表示する。

検証: 先に赤を確認（11件、うち1件は自分のテストの計算ミスで修正）→ 緑。
E2Eに本物のFITメッセージ（`FitEncoder`で組み立て）を使った解析確認を追加。
**sport抽出を壊すと1件赤に戻ることを確認して復元**（T-4）。`npm run verify`緑
（**856件 57ファイル** / `ALL E2E PASS` / `UPDATE E2E PASS`）。`npm audit`の
脆弱性件数は7件のまま変化なし（`fit-file-parser`由来の新規脆弱性なし）。

### 変更ファイル（Phase 2）

新規: `src/lib/core/fitParse.ts` / `tests/fitParse.test.ts`（11件）/
`tests/fixtures/fitEncoder.ts`（テスト用FIT組み立て）。
変更: `package.json`・`package-lock.json`（`fit-file-parser`追加）/
`pwa/entry.tsx` / `pwa/e2e.mjs` / `README.md`。

### Phase 2.5: コード分割によるbundleサイズ対策 ✅

Phase 2完了時点の+434KBについて(a)許容/(b)動的import分割の2択を提示 →
「おすすめで」の指示により(b)を実施。

`scripts/build-pwa.mjs`を`format: "esm"` / `splitting: true`に変更し、
`pwa/entry.tsx`の`FitImportCard`から`fitImport.ts`・`fitParse.ts`の読み込みを
`await import(...)`による動的importに変更。`pwa/index.html`の`<script>`は
`type="module"`が必須になったため変更。生成されるchunkはファイル名に
ハッシュが入るため（`chunk-[hash].js`）、`pwa/sw.js`の`isAppShell()`
（network-first対象）には含めていない——ハッシュ付きファイル名は「同じ名前
なのに中身が古い」が原理的に起きないため、cache-first（既定の分岐）で問題ない。

**結果**: `bundle.js`は約1307KB→**880,189バイト**（元の873KB相当＝
`872,693バイト`とほぼ同水準、増分は約+7.5KBのみ）。FIT関連コードは
`chunk-69sycd27.js`（425,121バイト）に分離され、FIT画面を開いた時だけ読み込む。

**新たな制約**: 一度もFIT取込を開いていない状態でオフラインだとchunkが未
キャッシュのため使えない（起動自体には影響しない）。一度オンラインで開けば
以後はService Workerのキャッシュ経由でオフラインでも使える。

**検証**: E2Eに新規経路を追加——「一度使えばオフラインでも解析できる
（chunkがキャッシュ済み）」。`page.goto("about:blank")`→オフライン化→
再度URLへ`goto`という**本物の文書再読み込み**で検証（ハッシュ変更だけの
擬似ナビゲーションでは検証にならないため、途中で作り直した）。
`npm run verify`緑（**856件 57ファイル** / `ALL E2E PASS` / `UPDATE E2E PASS`、
うち3経路がFIT関連）。VERSIONは`forge-v35`のまま。`npm audit`の脆弱性件数
（7件）は変化なし。

### Phase 3: ラップ→区間の自動分類（ウォームアップ／メイン／リカバリー／レスト／クールダウン）✅

着手前に単独の計画を提示 →「いいよ」で承認を得て実施。

`classifyLaps`（`src/lib/core/intervalClassify.ts`、新規）がPhase 2で抽出した
lap列をペース（`elapsedSec/distanceKm`）と列内の位置だけで分類する。**ルール
ベースのみ・LLM不使用**。心拍は個人差・当日のコンディション由来の変動が
大きいため判定に使わない。

判定手順: ①距離0は「レスト」固定信頼度0.85 ②距離・時間欠落は推測せず「不明」
信頼度0.15 ③残りの中央値より7%以上速い（`FAST_RATIO=0.93`。根拠はREADME）
lapを「速い」とする ④「速い」lapが1つも無ければインターバル構成があると
決めつけず全て「不明」（0.3・警告つき） ⑤「速い」lapが見つかれば、その前後で
ウォームアップ／クールダウン、間の非「速い」lapはリカバリー、「速い」lap自体は
メイン疾走。信頼度は中央値からのペース差で連続的に決まる。

保存はまだしない（3層データモデルはPhase 4）。`pwa/entry.tsx`の
`FitImportCard`に、lapごとの行（番号・ペース・種別プルダウン・信頼度%）を
追加。プルダウンでの変更はこの画面上だけの一時的なもの（保存されない旨を
明記）。`intervalClassify.ts`は重い依存を持たないため、Phase 2のような
動的import化はしていない（静的importでも bundle への影響は無視できる小ささ）。

**検証**: 先にユニットテスト（`tests/intervalClassify.test.ts`、6件）を書いて
実装 → 緑。**fast/slow判定の不等号を反転させて赤に戻ることを確認して復元**
（T-4）。E2Eに新規経路を追加——ウォームアップ→メイン→リカバリー→メイン→
クールダウンの構成を持つ実際のFIT（`FitEncoder`で組み立て）を読み込ませ、
5行の分類結果（`["warmup","main","recovery","main","cooldown"]`）・信頼度(%)
表示・プルダウンでの手動修正が実際に反映されることを確認。**同経路をJSXの
条件式を壊して(`laps.length > 999`)赤に戻ることを確認して復元**（T-4）。

`npm run verify`緑（**862件 58ファイル** / `ALL E2E PASS` / `UPDATE E2E PASS`、
うち4経路がFIT関連）。`bundle.js`は884,798バイト（Phase 2.5の880,189バイトから
+4,609バイトのみ）。VERSIONは`forge-v35`のまま。

### Phase 4: 3層データモデルでの保存 ✅

着手前に単独の計画を提示。生バイトを保存するか（(a)保存する／(b)しない）を
確認 →「a」で承認を得て実施。

**3層**: ①元ファイル（生バイト・base64）②自動解析（`FitParseResult` +
自動判定`IntervalClassifyResult`）③確認済み（本人が画面上で直した後の
`confirmedKinds`）。①②は`FitImportRecord`（新規:
`src/lib/core/fitToSession.ts`）としてそのまま保存。③だけから
`Session`/`SessionResult`を導く純粋関数`fitToSessionAndResult`は
`PastEntry`の`toSessionAndResult`と同じ考え方（確認済み層だけから機械的に
決まり、何度re-runしても同じ結果）。再導出用に`rebuildFitDerived`も用意。

メイン疾走→本、その直後から次の「メイン」または「クールダウン」の**手前まで**
を合算してリカバリー（`restAfterSec`/`restAfterDistanceM`）にする——
**クールダウンまで含めてしまうバグを一度作り、単体テストの想定値
（最後の本のrestAfterはundefinedのはず）が420秒になって発覚、直した**。
カテゴリはCFEがあれば実測ペースとGRP比較（`categoryFromTarget`。一括入力と
同じ関数を再利用）、無ければ距離だけの暫定値＋警告。日付はlapの開始時刻＋
`utcOffsetSec`、無ければUTC基準＋警告。`backfilled: true`を立てる
（過去データ遡り入力と同じ扱いで、ルールエンジン評価・自動生成上書き・
バックアップmerge保護の対象外になる。`isOwnedByAthlete`が`backfilled`を
見ているため追加コード不要）。

保存はAPI経由で新規追加（`app/api/fit-import/route.ts` /
`pwa/api-shim.ts`の両方）。**クライアントで解析・分類済みのデータをそのまま
POSTし、サーバー側では再解析しない**（本人が確認した内容と保存内容を一致
させるため。重いfit-file-parserをサーバーに持ち込む必要もない）。
`Store`に`saveFitImport`/`listFitImports`を追加（SQLite: `fit_imports`
テーブル、IndexedDB: `fitImports`配列）。バックアップの書き出し・復元
（M-12・`ID_KEYED_COLLECTIONS`）にも対応。

UIは`FitImportCard`に「この内容で登録する」ボタン。登録後はボタンを引っ込め
連打による重複だけは防ぐ（二重登録の検知そのものはPhase 5）。

**検証**: `fitToSessionAndResult`の単体テスト7件（`tests/fitToSession.test.ts`）
——**restAfterの境界バグをT-4で検出**（クールダウンも含める版に戻すと
420秒 vs undefinedの期待値で赤）。サービス層テスト6件
（`tests/fitImportService.test.ts`）——`saveResult`だけを失敗させるProxyで
「保存の途中で失敗したら先に書き込んだ分（元ファイル・Session）もロール
バックされる」ことを確認（対象2と同じ`repo.transaction()`の保護）。
**トランザクションを外すと実際に赤へ戻ることを確認して復元**（T-4）。
E2Eに新経路2件——「登録する→記録画面（練習結果タブ）に実際に反映される」。

`npm run verify`緑（**875件 60ファイル** / `ALL E2E PASS` / `UPDATE E2E PASS`、
うち6経路がFIT関連）。`bundle.js`は891,467バイト（Phase 3の884,798バイトから
+6,669バイトのみ）。VERSIONは`forge-v35`のまま。`npm audit`の脆弱性件数
（7件）は変化なし。

### Phase 5: 二重登録防止 ✅

NEXT-005（UI/UX）完了後、優先順位メモに従い保留していたこちらへ復帰
（「保留中のFIT/Garmin Phase 5・6に戻る」の指示）。

同じFITをもう一度登録すると、Phase 4までは`FitImportRecord.id`が
`fit-${Date.now()}`で毎回新規生成されるため**完全に別の記録として二重登録**
されていた。**元ファイル（`rawBytesBase64`）が既存の取込と完全一致すれば
同じidを再利用する**方式にした——`saveFitImport`/`saveSession`/`saveResult`
はどれも同じidへの`INSERT...ON CONFLICT DO UPDATE`（IndexedDBも同id上書き）
なので、再登録は新規の二重登録ではなく上書きになる。一括入力（`pe-bulk-*`）
やApple Health（`ah-*`）が内容から決まるidで自然に二重登録を防いでいるのと
同じ考え方。ハッシュ関数は使わず生バイト列の完全一致で判定（完全一致以外は
別記録として扱う。推測しない）。

**副次的に見つけた問題**: `id`が`Date.now()`だけだったため、短時間に別の
FITを続けて取り込むとミリ秒が衝突し無関係な記録を上書きしうる状態だった。
乱数を足して修正（`fit-${Date.now()}-${ランダム6文字}`）。

`importFitFile`の戻り値に`duplicate: boolean`を追加。`FitImportCard`は
duplicateに応じてメッセージを出し分ける。

**検証**: 単体テスト3件追加（同じ生バイト→id再利用・件数不変、分類を直して
再登録→内容が実際に更新される、生バイトが違えば別記録）。E2Eで実際のUI
操作から確認——同じファイルを選び直しても`input`の`change`が発火しないことが
分かり、`about:blank`経由の文書再読み込みを挟む形に修正。**T-4で一致判定を
無効化し、単体テスト2件・E2E2経路すべてが赤に戻ることを確認して復元。**

`npm run verify`緑（**878件 60ファイル** / `ALL E2E PASS` / `UPDATE E2E PASS`、
うち8経路がFIT関連）。`bundle.js`は893,128バイト（Phase 4の891,467バイトから
+1,661バイトのみ）。VERSIONは`forge-v35`のまま。

### Phase 6: 既存の計画済みセッションとの紐付け ✅

着手前に単独の計画を提示 →「いいよ」で承認を得て実施。

先に通常の記録経路`processResult`を調査——単なる保存ではなく、`status`を
`planned`→`completed`にし、**CFE更新・ルールエンジン・以降の予定への波及**
まで行うことを確認。FIT取込Phase 1〜5（`backfilled: true`）はこれらを意図的に
スキップしていたが、**計画済みセッションに紐付ける場合は、手入力で記録した
場合と同じ扱いにすべき**と判断（「今日やる予定だった練習を、手入力の代わりに
FITで正確に記録する」ことと同じため）。

`src/lib/core/fitToSession.ts`を分割: `deriveFitActuals`（lap列から実測データ
だけを導く純粋関数）／`buildBackfilledSessionAndResult`（従来の新規backfilled
セッション）／`buildLinkedResult`（既存セッションのSessionResultだけを作る。
`backfilled`は立てない）。`fitToSessionAndResult`はこの2つの組み合わせとして
後方互換のまま維持（既存テスト・`rebuildFitDerived`は無改修で通った）。

`importFitFile`に`linkToSessionId`を追加。省略時（1回目）はその日の
`status: "planned"`セッションを探し、あれば保存せず`needsConfirmation`＋
候補一覧を返す。2回目に文字列（紐付け先）か`null`（新規登録）を渡すと確定。
APIルートは`body`をそのまま渡す実装だったため、フィールド追加だけで
Next.js・PWA両方に対応できた（新規エンドポイント不要）。

計画とFITの実測内容が食い違っていても検知しない——**手入力の既存経路
（`ResultForm`）も同様に検知していない**ことを確認済みなので、ここだけ
新しく厳しくしない。RPE・主観的しんどさはFITから取れないため、backfilledと
同じ既定値を使う（後で記録画面から直せる）。

**検証**: 単体テスト5件（計画済みが無ければ従来通り／あれば確認だけで
何も保存しない／複数候補を全部返す／紐付けで`processResult`が実際に走り
`backfilled`は立たない／新規登録を選ぶと計画済みセッションはそのまま残る）。
E2Eで実際に計画済みセッションを作り、同日のFIT取込→確認画面→紐付け選択→
`status`が`completed`になることまで確認（テスト専用に足したセッションは
後続の間隔違反テストへの影響を避けるため終了時に削除）。**T-4で計画済み
セッションの検出処理、`processResult`経由の保存をそれぞれ無効化し、両方とも
赤に戻ることを確認して復元。**

E2E構築時の落とし穴2件: ①IndexedDBの保存は250msデバウンスされており、
`fetch`直後に文書を読み直すと直前の書き込みが消えることがある（待ち時間を
追加）。②同じFITファイルを選び直す再現には文書ごとの再読み込みが要る
（Phase 5と同じ問題）。

`npm run verify`緑（**883件 60ファイル** / `ALL E2E PASS` / `UPDATE E2E PASS`、
うち9経路がFIT関連）。`bundle.js`は896,020バイト（Phase 5の893,128バイトから
+2,892バイトのみ）。VERSIONは`forge-v35`のまま。`npm audit`の脆弱性件数
（7件）は変化なし。

これでFIT/Garmin取込（Phase 1〜6）が完了。

### 完了条件

- [x] 先に赤、実装後に緑（Phase 1〜6とも）
- [x] `npm run verify` 緑
- [x] Garmin共有仕様を実際に確認した上で実装方針を決定
- [x] FIT field番号を実際にエンコード・デコードして確認（推測に頼らない）
- [x] bundleサイズ対策（動的import・コード分割）
- [x] ラップ→区間の自動分類（ルールベース・信頼度・手動修正表示）
- [x] 3層データモデルでの保存（元ファイル・自動解析・確認済み）
- [x] 二重登録防止（生バイト列の完全一致でid再利用）
- [x] 既存の計画済みセッションとの紐付け（通常の記録経路を再利用）
- [x] README更新
- [ ] commit・push・配信（指示により保留）

---

## NEXT-003（P0監査 対象1・2・7・6・3。全7対象すべてに着手）✅ 実装・検証済み・未コミット

第三者P0監査の7対象のうち、外部設定に依存しない2つに着手（対象4・5はNEXT-002で対応済み）。

### 対象1: PWAの保存保証

`persistState`（`pwa/memory-store.ts`）が `void` を返し、IndexedDB・localStorage
両方の失敗が呼び出し側に伝わらなかった。`Promise<PersistOutcome>` 化し、失敗理由
（`quota`/`unavailable`/`unknown`）を返す。IndexedDBアクセスは注入可能にして
（新規テストライブラリなし）テストで分岐を検証。`pwa/entry.tsx` に
`PersistFailureBanner`（失敗時のみ表示、`role="alert"`）と、`pagehide`/
`visibilitychange` での `flushPendingState()` 呼び出しを追加。

### 対象2: 安全なバックアップ復元

`isBackupFile` が `format`/`version`/`data` の存在しか見ておらず、`replace` は
検証前に `resetAll()` していた。`validateBackup`（`src/lib/core/backup.ts`）を
新規追加し、各コレクションが配列か・idが文字列かを `resetAll()` より前に確認。
さらに `Store.transaction()`（新規、SQLiteは実BEGIN/COMMIT/ROLLBACK、
MemoryStoreはスナップショット差し戻し）で実際の書き込みを包み、検証をすり抜けた
想定外のデータで途中失敗しても開始前の状態へ完全に戻す。

**実際に確認した効果**: `validateBackup` を外すと、IndexedDB側は壊れたセッション
（idが数値）を**例外すら出さずそのままpushしてしまう**（配列pushに型チェックが
無いため）。検証を先に置くことがIndexedDB経路では唯一の防御と確認できた。

### 変更ファイル

`src/lib/db/store.ts`（`transaction`追加）/ `src/lib/db/repo.ts`（実装）/
`pwa/memory-store.ts`（`persistState`・`flushPendingState`・`transaction`）/
`pwa/entry.tsx`（バナー・flush配線）/ `src/lib/core/backup.ts`（`validateBackup`）/
`src/lib/service.ts`（`importBackup`の並べ替え）/ `README.md`。
新規テスト: `tests/pwaPersist.test.ts`（7件）/ `tests/storeTransaction.test.ts`（6件）/
`tests/backupAtomicity.test.ts`（11件）。

### 検証

先に赤を確認 → 実装 → 緑。**`validateBackup`を外すと2件赤に戻ることを確認して復元**（T-4）。
`npm run verify` 緑（**835件 55ファイル** / `ALL E2E PASS` / `UPDATE E2E PASS`）。
`npm audit`: 既存の脆弱性（Next.js/PostCSS連鎖、メジャー更新が必要）のみで、
今回の変更とは無関係・対象7（依存関係）の範囲。VERSIONは`forge-v35`のまま。

### 対象7・6・3（P0監査の残り）✅ 実装・検証済み・未コミット

FIT/Garmin（NEXT-004）・UI/UX（NEXT-005）完了後、指示により保留していた
P0監査の残り3項目に着手（対象7→6→3の順）。

**対象7: 依存関係と基本セキュリティ**——`npm audit`の7件は`next@14`本体・
同梱postcss由来で、修正には`next@16`へのメジャー移行が要る（`app/`共有
アーキテクチャへの影響が大きく、P0監査のついでにはやらない。対象3の
ローカル限定待受で実露出は抑制済み。理由をREADMEに明記）。`vite`系3件は
devDependencyのみで配信物に含まれず実害なし。秘密情報のハードコードは
無し。`.gitignore`に`.env`系を追加。バックアップJSON・Apple Health XML
取込にFITと同じ考え方のサイズ上限を追加
（`BACKUP_MAX_BYTES=50MB`／`HEALTH_XML_MAX_BYTES=500MB`）。

**対象6: 危険なトレーニング提案の防止**——既存の`checkPastEntry`
（実測の妥当性チェック）と同じ閾値を再利用した`checkTargetPaces`/
`checkSessionPlausibility`（`src/lib/core/sanity.ts`）を新規追加し、
`addSession`・`editSession`（**forceでも越えられない**）・`regeneratePlan`
（生成ロジックのバグで出た枠だけを除外し件数報告）の3箇所に配線。
手入力の経路（カレンダー＋／編集シート）で実際に桁の打ち間違いを拾う
ことを確認。

**対象3: Next.js APIの認証・認可**——`next dev`/`next start`が既定で
`0.0.0.0`待受だったため、`-H 127.0.0.1`に固定（同じLAN上の別端末から
`/api/backup?download=1`で全データを読めていた問題を解消）。加えて
`middleware.ts`（新規）で`FORGE_API_TOKEN`環境変数設定時のみ全APIに
共有シークレットを要求（未設定時は無効＝ローカル開発の摩擦を増やさない）。
配信されているPWAはNext.jsサーバーを使わないため無関係。

**検証**: 対象7は単体テスト＋T-4。対象6は単体テスト＋service層テスト＋
T-4（`addSession`/`editSession`それぞれ）＋E2Eで既存の手動編集・プラン
生成フローに回帰が無いことを確認。対象3は実際に`npm run dev`を起動し
ホスト表示とcurlでのトークン認証（401/401/200）を手動確認——**Next.js
サーバー機能そのものであり配信PWAには影響しないため、これを継続的に
検証する自動テストは無い**（手動確認のみ）。

`npm run verify`緑（**897件 60ファイル** / `ALL E2E PASS` / `UPDATE E2E PASS`）。
VERSIONは`forge-v35`のまま。

これでP0監査7対象すべてに着手完了（対象1・2・4・5・7・6・3）。

### 完了条件

- [x] T1〜T7相当のテストが先に赤、実装後に緑
- [x] `npm run verify` 緑
- [x] 両方失敗する状況で画面に保存失敗が出る
- [x] 不正バックアップのreplace後、既存データが残っている
- [x] 既存の正常バックアップが読める（回帰テストで固定）
- [x] README更新
- [ ] commit・push・配信（指示により保留）

---

## NEXT-002（完了・commit d997ddb・forge-v35配信済み・実機確認済み）

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
- [x] **`forge-v35` 配信後の同期動作を実機で再確認** — 本人確認済み（2026-07-30）

**NEXT-002 はこれで全条件を満たし完了。**

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
