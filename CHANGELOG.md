# FORGE 変更履歴

**このファイルは過去の記録。** 現在地は `HANDOFF.md`、未完了は `BACKLOG.md`、
設計理由は `README.md` を見る。

ここに書いた件数・バージョンは**その時点の事実**であって、今の値ではない。
最新のテスト件数は `npm test` の出力、配信中の版は `pwa/sw.js` の `VERSION` が正。

新しい記録を上に足す。古い記録は書き換えない（当時そう判断した記録なので、
あとから直すと「なぜそうしたか」が読めなくなる）。

---

## forge-v109（2026-08-17・靴の用途を複数）

設計理由は `README.md`「靴の用途を複数選べるようにした」を参照。

- `ShoeProfile.purpose`（単数）→ `purposes`（配列）。**古い単数データも読む**
- 「決めていない」は他と併用しない（`normalizePurposes`）
- 1つでも噛み合えば加点、ただし**加点は1回だけ**（選ぶほど有利にしない）

あわせて、**曜日によって落ちるE2E**を3件直した（今日が固定曜日に当たる火・土は必ず赤だった）。

- S-9: 固定枠は変更が断られるのが正しい。断りの理由が出ることも見る
- 処方と欄の一致: 画面で選べるカテゴリに対象を限る（有酸素だとフォームが開かない）
- ホーム: 今日の枠は固定枠だと**消せも変えられもしない**（isFixed は予定に保存された値）。
  日付に依らない範囲だけを見るようにし、**未実施の部分をstepの文に書く**

反省: 「固定枠が原因」と決めつけて曜日の固定を外し、それに依存する検査を5件落とした。
1回の実行で3件まとめてプローブすれば、推測での往復を減らせた。

---

## forge-v108（2026-08-17・主練習の時間帯）

主練習が午後で固定だったのを、曜日ごとに選べるようにした。
設計理由は `README.md`「主練習の時間帯を選べるようにした」を参照。

- `weekTemplate.ts` に `mainTimeOfDay` を足した（未設定は午後）。**枠の中身は動かさない**
- 補助枠は主練習の反対側に置く（同じ時間帯に2本入るとidが衝突して片方消える）
- 検証の文を主/補助の言い方にした（午前に主練習を置いた日に逆さまになっていた）
- メニュー設定に曜日ごとの「主練習 午前／午後」を足した

反省: E2Eが**一度空振り**した。前のブロックが周期モードにしたままで、
行が「1日目」になっていて「火曜」の選択が見つからなかった。
検査したい状態は検査の側で作る（曜日モードに戻してから見る）。

---

## forge-v107（2026-08-17・3秒で読める画面）

利用者からの指摘「メニュー名だけでなく設定タイムまで切れている」。
設計理由は `README.md`「3秒で読める画面にする」を参照。

- `core/prescriptionSummary.ts` — 処方を**切ってよい部分と切ってはいけない部分**に分ける
  （距離×本数・設定・レストは切らない）。`isRedundantName` で重複する名称を省く
- `core/analysisHeadline.ts` — 分析の結論・行動・リスクの並べ方
- カレンダー: 2段表示（`種目｜距離×本数` / `設定｜レスト`）。操作（✎・＋）は `⋯` で畳む
- 分析: 最上部は3つだけ。根拠は開くまでDOMに出さない。不足データは1カードに統合
- **固定の「＋」を削除。** 余白も詰めた
- ホーム: 数字と結論を先に、理由は畳む（消さない）

作業中に見つけて直したもの:

- `40分ジョグ （カレンダー反映テスト）` の括弧が「形」に混ざり、
  **215pxの切れない塊**になって320px幅で32pxはみ出していた。
  括弧の中を落とし、呼び名が長ければ時間だけにする
- `--fab-clearance` を0にしたら最下部がタブバーに触れた（20px残した）

反省: **壊して確認を1つずつE2Eで回して時間をかけすぎた**（1回5分 × 十数回）。
同じ変更に対する複数の破壊は1回のE2Eにまとめられた。

もう1つ。ホームの検査が**一度空振りした**。
「注記があれば見る」だけにしていたので、その日の処方に注記が無くて検査ごと飛び、
理由を最初から出す実装に変えても落ちなかった。
検査したい状態は検査の側で作る。

---

## forge-v106（2026-08-17・ポイント練習前のアップ）

アップを**主練習の子データ**として記録する。設計理由は `README.md`
「ポイント練習前のアップ」を参照。

- `core/warmup.ts` — 型・語彙・集計・正規化・型（テンプレート）・FITのアップ区間からの組み立て
- `core/warmupInsight.ts` — 相性の分析。3回未満は数字を出さない
- 距離・時間・負荷・シューズ走行距離には足し、**週間の刺激回数・カテゴリ配分・
  CFE・進行段階には流さない**
- 記録画面に折りたたみの入力欄（前回と同じ／型／FITから）、分析画面に傾向
- `/api/warmup` は読むだけ。保存は `/api/results` を通る

作業中に見つけて直したもの:

- 靴を履き替えた日、アップのぶんが主練習の靴に加算されていた。
  アップの靴が指定されていればそちらに足すようにした（回数は増やさない）

反省: E2Eの組み立てで**推測したセレクタを何度も書いた**（保存ボタン名・確認ダイアログ・
主観の呼び名・RPEスライダー）。既存のE2Eに同じことをしている箇所があったので、
先に読んでから書けば1回で済んだ。
RPEは「未入力のとき真ん中を指している」ため、同じ値を入れても
Reactが変化として扱わない。`setSlider` で真ん中と違う値を入れる必要がある。

---

## forge-v105（2026-08-17・シューズ推薦）

登録した靴のうち、その日の練習に合う1足を薦める。設計理由は `README.md`
「シューズの推薦」を参照。

- `core/shoeProfile.ts` — 種類ごとの既定値と、項目ごとの手動上書き。上書きが必ず勝つ
- `core/shoeRecommend.ts` — 推薦の唯一の実装。練習の種類・場所・天候・疲労・痛み・
  走行距離から並べる。同点は登録順（毎回同じ結果が出る）
- 画面3か所（設定で性格を編集 / 練習詳細に推薦と理由 / 記録で推薦順に並べる）
- 実績が3回に満たないうちは「まだ足りません」と断る。**「学習済み」と見せない**

作業中に見つけて直したもの:

- トレッドミルにスパイクが1番で出ていた。場所違いの −8 ではポイント練習の加点に
  負けていた。ベルトを切るので −20 にして実質外した
- 痛みで靴を選び直したのに、**選ばれた靴の側に理由が出ていなかった**。
  注意書きは順位を下げた靴に付くので、いつもと違う靴が出た日に理由が読めなかった
- `deleteShoe` が知らないidでも `deleted: true` を返していた（消していないのに消したと言う）

反省: **機能を先に足してテストが後になり、カバレッジ閾値を割った状態でコミットしていた。**
`npm run verify` にカバレッジは入っていないので気づけない。埋めたうえで閾値を上げ直した。

---

## forge-v46（2026-08-01・報告4件）

利用者からの報告4件。詳細な設計判断はREADME.md
「実運用で見つかった4件の修正（forge-v46 / 2026-08-01）」を参照。

1. **`1000m×4` が `396m×12` と読まれる** → `deriveFitActuals` が lap 1つ＝1本と
   数えていた。時計で1000mの中を400/400/200と刻むと本のlapが3つ入る。
   `groupIntoReps` を足し、間に休みのlapが無く時刻が連続しているメインlapを
   1本にまとめる。通過タイムは `RepResult.splitsSec` に残して `/summary` に出す。
   距離は `snapToTrackDistance` でトラックの距離に丸める（3%以内・forge-v48で追加）。
   丸めたら警告に出す。近いものが無ければ実測のまま
2. **固定枠をやらなかったときにカレンダーから外せない** → 固定枠にも
   `SessionEditSheet` を開けるようにし、内容は変えられないと断ったうえで
   「やらなかった」だけ記録できるようにした。消さずに中止（`status: "skipped"`）に
   するので実施率に残り、再生成で復活しない。`restoreSkippedSession`
   （`DELETE /api/skip`）で戻せる。固定枠は後ろ倒ししない
3. **カレンダーの表示期間** → 既定を2週間から1週間に。選んだ期間を端末に覚えさせる
   （`app/components/view-pref.ts`。Storeには入れない）
4. **分析タブが文字の壁** → 心拍を帯＋位置の図に（`HrRow`）、制限因子の妥当域と
   PB・目標を同じ数直線に（`LimiterScale`）、週次レビューの本文を畳んだ。
   文は消していない（開けば読める）

### ついでに直したもの（視覚回帰ハーネスの不具合2件）

`pwa/visual.mjs` が**スプラッシュのつもりでアプリ本体を撮っていた**。
Service Worker が bundle.js をキャッシュから返すので `route(..., abort)` が効かず、
その状態のまま baseline が固定されていた。`serviceWorkers: "block"` を入れて解決。

同じページで、時刻の固定が `page.addInitScript` にあったためスプラッシュ用の
別ページには効かず、「GOOD MORNING / GOOD EVENING」が撮った時間帯で
変わっていた。`context.addInitScript` に移した。

### E2Eに足した経路

- 固定枠を「やらなかった」→ 一覧から外れる →「戻す」で復帰する
- 既定表示が1週間になったので、検証用セッションを作る日付を
  表示範囲（今週の月曜から7日）に合わせた（`calendarWeek`）
- 週次レビューの本文は畳んであるので、M-11は開いてから中身を見る

### 未着手

- なし（報告4件はすべて実装済み）

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
信頼度0.15 ③残りをペース昇順に並べ、隣接比が最大のところで速い群と遅い群に
切る（比が1.20未満なら切らない。`MIN_GROUP_SEPARATION`。根拠はREADME）
④速い群が空ならインターバル構成があると決めつけず全て「不明」（0.3・警告つき）
⑤速い群が見つかれば、その前後でウォームアップ／クールダウン、間の遅いlapは
リカバリー、速いlap自体はメイン疾走。信頼度は遅い群の下限からのペース差で
連続的に決まる。

当初は中央値×0.93で切っていたが、W-up/C-downのlapが無いFITで
`300m×4` が `300m×1` になる不具合があり、2026-08-01 に隔たり方式へ変更した
（README「なぜ中央値をやめたか」）。

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
