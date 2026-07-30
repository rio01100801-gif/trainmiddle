# FORGE 運用ガイド

作成: 2026-07-31（運用整備）。障害発生時・リリース時に読むもの。
設計判断の理由は `README.md`、作業の約束事は `CLAUDE.md`（`AGENTS.md`と同一）を参照。

外部監視サービス・分析SDKは導入していない。診断はすべて端末内で完結し、
本人が明示的に開かない限り何も表示・送信しない。

---

## 1. バージョンの一貫性

FORGEには役割の異なる「バージョン」が複数ある。混同しないこと。

| 名前 | 場所 | 役割 | リリースごとに上げるか |
| --- | --- | --- | --- |
| `VERSION`（Service Worker） | `pwa/sw.js` | Cache Storageの名前・アイコンのcache-bust query。**これが実質唯一の「アプリのリリース版」** | **必ず上げる**（上げないとinstallが走らず端末に更新が届かない） |
| `package.json`の`version` | `package.json` | 未使用の飾り（他のどこからも参照されない） | 触らなくてよい |
| IndexedDBの`AppState.version` | `pwa/memory-store.ts` | 永続化データの内部形式バージョン（現在は`1`固定） | 通常は上げない（下記「6. migration」参照） |
| `BackupFile.version` | `src/lib/core/backup.ts` | 書き出しファイル形式のバージョン | 形式そのものを変えたときだけ |
| `build-info.json` | `pwa-dist/build-info.json`（ビルド生成物） | 配信物がどのソースコミットから作られたかの記録（`version`/`commit`/`builtAt`） | 自動生成（`npm run build:all`のたびに更新） |

`build-info.json`と診断画面（`/diagnostics`）が、配信物とソースの対応を
秘密情報なしに確認できる場所。`tests/buildVersionConsistency.test.ts`が
`pwa/sw.js`と`pwa-dist/sw.js`・`build-info.json`のVERSIONが一致しているかを
自動確認する（ズレ＝ビルドし忘れたままcommitした証拠）。

---

## 2. CI（`.github/workflows/ci.yml`）

`main`へのpushと、`main`向けのPull Requestで自動実行する。**本番Supabase・
実際のGoogle OAuth・実際のGitHub Pagesには一切接続しない**（秘密情報も使わない
ため、フォークからのPRでも安全）。**mainへの自動配信（gh-pages push）は行わない**
——配信は今までどおり本人の手動操作。

実行順序: `npm ci`（lockfile厳守）→ Playwright導入 → typecheck →
`npm run ci:checks`（秘密情報の簡易走査・禁止パターン・API/shim対応）→
unit test → `npm run build:all`（アトミック）→ 性能予算確認 →
pwa-distの差分確認（コミット済みpwa-distとビルドし直した結果が一致するか）→
E2E → 更新経路E2E → `npm audit`（結果を記録するだけで止めない。理由は下記）。

Node 24 / bun 1.3.14 に固定（`actions/setup-node`・`oven-sh/setup-bun`の
バージョン指定）。ジョブ全体に30分の上限（無限待機を避ける）。E2Eが失敗した
場合だけ`shots/`をartifactとして保存する（合成テストデータのみのため、
健康情報・トークンは含まれない）。

**Storeインターフェースの実装漏れ検出**: `Repo implements Store` /
`MemoryStore implements Store`とTypeScriptの`implements`で宣言済みのため、
実装漏れがあれば`npm run typecheck`の時点で機械的に検出される
（別途チェックスクリプトを作る必要が無い）。

**npm auditをビルド失敗にしない理由**: 現時点の7件（`next@14`系・
`vitest`のdevDependency系）は既にP0監査・今回の運用整備で個別に判断済み
（`next@16`への移行は破壊的変更のため別タスク、`vitest`のcriticalは
`--ui`未使用のため実害なし）。既知・判断済みの残存項目でビルドを毎回
赤くするのは、新しい脆弱性の見落としにつながる（「いつも赤い」は無視される）。
新しい脆弱性が増えていないかは`npm audit`の出力を都度見て判断する。

---

## 3. `npm run verify` の構成

```
typecheck → test → build:all（アトミック） → e2e → e2e:update
```

子コマンドはいずれか1つでも失敗すればそこで停止する（`&&`連結）。
`npm run ci:checks`・`npm run ci:perf-budget`は`verify`には含まれていない
（CIでは別ステップとして実行。ローカルの通常確認では毎回走らせるほど
重要度が高くない軽量チェックのため、CIで見れば十分と判断）。

`npm run build:all:unsafe`は旧来の非アトミック版（3コマンドを素で連結）。
開発中の素早い個別再ビルド用に残してあるが、リリース判断には使わないこと。

---

## 4. アトミックPWAビルド

`npm run build:all` → `scripts/build-all-atomic.mjs`。

`.pwa-dist-staging/`（一時ディレクトリ）へ`build:pwa`/`build:css`/
`build:static`を順に実行し、**3つとも成功して初めて**`pwa-dist/`を置き換える
（`pwa-dist`→`.pwa-dist-backup`→`staging`を`pwa-dist`へ改名→backup削除）。
途中で失敗したら`pwa-dist/`には一切触れない。

- 古いhash付きchunkファイル（`chunk-*.js`）は毎回staging作成時に掃除する
  （以前は積み上がる一方だった）
- `SETUP-GUIDE.txt`/`setup-guide.html`（ビルドで生成しない手動管理ファイル）は
  既存の`pwa-dist/`から引き継ぐ
- 置き換え直前に必要なファイルが全部揃っているか確認する（欠けていたら失敗扱い）
- Windowsでは、直前まで開いていたファイルハンドル（プレビューサーバー等）が
  原因で`rename`が一時的に失敗することがある。最大8回・300ms間隔でリトライする
- 削除は`safeRemove()`経由のみ（対象パスがstaging/backupの絶対パスと完全一致
  する場合だけ許可。ワークスペース外や広いディレクトリを誤削除しない）

---

## 5. Service Worker更新経路

`pwa/sw.js`が既に持っている設計（変更していない。動作の要約）:

- `install`: 新しいVERSIONのcacheへ全アセットを`reload`指定で取得（HTTPキャッシュ
  を迂回）→ `skipWaiting()`
- `activate`: 現在のVERSION以外のcacheを削除 → `clients.claim()`
- fetch: `index.html`/`bundle.js`/`styles.css`/`manifest.webmanifest`は
  **ネットワーク優先**（取れなければcacheへfallback）。アイコン等は**cache優先**
- 他オリジン（Supabase等）のリクエストには一切介入しない

**`skipWaiting`を使っているため、新版は取得できた時点で即activateする**
（ユーザーの明示操作を待たない）。入力中の強制リロードはしていない
（activate自体はページの再読込を伴わない。次回のnavigation/reloadで新版が使われる）。
既存のE2E（`npm run e2e:update`）がinstall→activate→オフライン起動の一連を確認する。

**VERSIONを上げ忘れるとバイト列が変わらず、installが一度も走らない**ため、
「本番だけ古い」の最頻出原因になる。`tests/buildVersionConsistency.test.ts`が
これを機械的に検出する。

---

## 6. データのmigration方針

SQLite（`src/lib/db/schema.ts`）・IndexedDB（`pwa/memory-store.ts`）とも、
**個別のマイグレーションスクリプトを持たない設計**になっている。

- SQLite: 全テーブルが`json TEXT`列主体の`CREATE TABLE IF NOT EXISTS`。
  型定義（TypeScript側）にフィールドを足しても、JSON列の中身が増えるだけで
  スキーマ変更は不要
- IndexedDB: 単一store・単一キーに`AppState`全体をシリアライズ。読込時
  `{ ...emptyState(), ...state }`で、保存されていたデータの上に新しい既定値を
  マージする。新しいコレクションを追加しても、古いデータには自動的に空配列等の
  既定値が補われる

**この設計が対応できないケース**: 既存フィールドの意味を変える・型を破壊的に
変える・列制約を追加する、といった変更。今のところ発生していないが、発生した
場合は個別の変換コードを書く必要がある（汎用のmigration runnerは無い）。

`AppState.version`は現在`1`固定。将来version 2が必要になった場合、
`loadState()`内の分岐を増やして対応する（今回は追加していない。現時点で
そこまでの破壊的変更が発生していないため）。

バックアップ（`BackupFile.version`）・復元は`importBackup`が
`validateBackup`で形を確認してから`repo.transaction()`内で全消去→書き込みを行う
（検証をすり抜けた想定外データで途中失敗しても開始前の状態へ完全に戻る。
既存実装。今回変更していない）。

---

## 7. ロールバック

| 対象 | 方法 |
| --- | --- |
| UI/JS配信物（gh-pages） | 過去のgh-pagesコミットへ`git push`で戻す（`git log gh-pages`で対象を探す） |
| Service Worker | 配信物のロールバックと同時に行う。**VERSIONを古い値に戻すだけでは不十分**——ロールバック後の配信物にも、現在のVERSIONとは異なる新しいVERSION文字列を付けて再ビルドしないと、`install`が走らず端末に反映されない（VERSION文字列の大小は関係なく、「前回配信したVERSIONと違う文字列か」だけが問題） |
| DB schema / IndexedDB migration | 個別のdownマイグレーションは無い（6節参照）。基本方針は**forward fix**（前に進めて直す）。どうしても戻す必要がある場合はバックアップからの復元を使う |
| Supabase RLS / Storage設定 | `supabase/migrations/`配下のSQLファイルにロールバック用SQLをコメントで残してある。実行前に必ず現在のポリシーを確認するSELECTを先に流すこと |
| データ内容 | M-12の書き出し（バックアップファイル）から復元。復元は「置き換え」と「統合（merge）」を選べる |
| 認証設定 | 設定→同期→「接続設定を消す」（ローカル設定のみ削除。練習データは消えない） |
| main（コード） | `git revert`で戻す（`git reset --hard`はリモートと共有した履歴には使わない） |

`scripts/release-check.mjs`が実行時点のHEADを「ロールバック対象」として
表示する（記録するだけで何もしない）。

---

## 8. 診断情報（`/diagnostics`）

設定 → 診断情報から明示的に開く画面（自動表示・自動送信は一切しない）。

表示する内容: アプリバージョン・ソースコミット・ビルド日時・実行環境
（browser/standalone）・origin・オンライン状態・Service Worker状態・
Supabase設定の有無とホスト名（Project URL全体は出さない）・サインイン状態
（有無のみ）・最終クラウド同期・最終バックアップ書き出し。

表示しないもの: Publishable Key全文・access/refresh token・
Authorizationヘッダー・健康データ本文・FIT本文・バックアップ本文・
service role key（そもそもコード上に存在しない）。

「コピーする」は、コピー内容を画面上のテキストエリアに**先に表示**してから
クリップボードへコピーする（見えないものを黙って送らない）。外部への
自動送信機能は無い。

---

## 9. エラー処理の方針（今回の判断）

Next.js APIは調査の結果、既に`{ error: string }` + 適切なHTTP status
（400/401、今回追加した認可は401）という最小限の形に揃っていた
（`src/lib/core/apiError.ts`として明文化。挙動は変えていない）。
スタックトレースはクライアントへ返していない（`.message`のみ渡す）。

同期・OAuth周りは`ConnectionTest`（`app/components/supabase.ts`）が
`kind: "url" | "key" | "offline" | "timeout"`で既に構造化されている。

**init/save/load/sync/OAuth/Storage/backup/migration/FIT/ZIP/AppleHealth/
SW更新/プラン生成を横断する共通のerror code・retryableフラグ体系への
全面統一は、今回は行わなかった。** 理由: 単一利用者アプリの規模に対して、
数十箇所の呼び出し元を横断的に触るリスクが見合わない。既存の「最小限の
修正に留める」方針（CLAUDE.md）に反する。将来、実際にエラー種別の見分けが
つかず困った具体的な場面が出てきたら、その箇所から個別に構造化する方が安全。

---

## 10. プライバシーを守る運用ログ（今回は導入しない）

外部テレメトリは追加しない（指示どおり）。端末内のリングバッファ式ログ
基盤の新設も、今回は見送った。理由: 現状の本番コード（`src/lib/`・`app/`）に
`console.error`/`console.log`が1件も無く、ログ基盤を作っても記録する対象が
無い。8節の診断画面が「今の状態」を十分にカバーしており、「過去に何が
起きたかの時系列ログ」が無いと診断できなかった具体的な事例もまだ無い。
必要になったら、実際に困った箇所からピンポイントで最小限のログを足す方が、
何を記録するか（＝何を漏らさないか）の判断を都度きちんと行える。

---

## 11. パフォーマンス予算

`scripts/ci/perf-budget.json`に実測値（2026-07-31時点）と、そこから+20%の
予算を記録している。`npm run ci:perf-budget`（CIで自動実行）が退行を検出する。

| ファイル | 実測 | 予算（+20%） |
| --- | --- | --- |
| `pwa-dist/bundle.js` | 898,077 バイト | 1,077,692 バイト |
| `pwa-dist/styles.css` | 27,426 バイト | 32,911 バイト |

Lighthouse等は導入していない（新規依存を増やさない方針・単一利用者アプリでの
費用対効果が薄いと判断）。正当な理由でサイズが増える場合は
`node scripts/ci/check-perf-budget.mjs --update-baseline`で更新する。

---

## 12. リリース前チェックリスト

### 自動（`npm run release:check` が一括で行う）

- [ ] worktreeの状態表示（clean/dirty）
- [ ] VERSION比較（作業ツリー / HEAD / gh-pages配信済み）
- [ ] `npm run verify`（typecheck・test・アトミックbuild:all・e2e・e2e:update）
- [ ] pwa-distの差分表示
- [ ] commit/pushで実行される予定の操作をすべて表示（実行はしない）
- [ ] ロールバック対象commitの記録

個別にも実行可能: `npm run ci:checks`（秘密情報・禁止パターン・API/shim対応）・
`npm run ci:perf-budget`・`npm audit`。

### 手動（本人が行う）

- [ ] `git diff`で変更内容を実際に確認した
- [ ] Supabase migrationが必要なら適用し、確認SQLで結果を見た
- [ ] Supabase RLSが意図通りか確認した（他ユーザーのオブジェクトを読めないこと）
- [ ] Google OAuthのRedirect URLに変更が無いか確認した（変更した場合はSupabase側にも反映）
- [ ] 実機iPhone（Safari・ホーム画面standalone両方）で開き直した
- [ ] オフラインで起動できることを確認した
- [ ] 更新通知が出て、再読込で新版になることを確認した
- [ ] バックアップの書き出し・復元を1回試した
- [ ] Googleサインイン・クラウド同期を試した
- [ ] FIT・Apple Healthの取込を試した（変更が関係する場合）
- [ ] セッション記録・カレンダー編集を試した
- [ ] 分析画面の表示を確認した

---

## 13. リリーススクリプトの使い方

```bash
npm run release:check
```

**常にdry-runで、commit/pushは一切行わない。** 表示された内容を確認したうえで、
これまでどおり本人が手で以下を実行する（CLAUDE.md「締め」参照）。

```bash
# 1. pwa/sw.js の VERSION を上げる
# 2. npm run build:all
# 3. commit・push
git add -A && git commit -m "<変更内容を1行で>" && git push origin main
git push origin $(git commit-tree main:pwa-dist -p origin/gh-pages -m "deploy: forge-vN"):gh-pages
```

---

## 14. 配信後スモークテスト

```bash
npm run smoke
# 別環境を指定する場合:
node scripts/smoke-test.mjs https://example.com/
```

公開URLへの**非破壊的なGETのみ**（書き込み・Googleログインの完遂はしない）。
確認内容: `index.html`取得・参照アセット（bundle.js/styles.css/manifest等）の
取得可否とContent-Type・`build-info.json`のバージョン・manifestの妥当性。
GitHub Pagesの反映遅延を考慮し15秒でタイムアウトする（無限待機しない）。

実際のブラウザでの描画・操作確認（4タブ表示・初期化・console error）は
`npm run e2e`が同じビルド成果物に対してローカルで既に行っている
（本番URLに対してGoogleログインを自動化するのは指示により行わない）。

---

## 15. 障害対応runbook

**共通の原則**: どのケースでも、最初にやることは**バックアップと診断**。
「とりあえずPWAを削除」「ストレージを全削除」を最初の一手にしない
（練習データが消える。iOSは元々ストレージを消すことがあるため、
これ以上失う操作を安易に選ばない）。

### 1. アプリが起動しない

- **症状**: 画面が白い・真っ暗・何も表示されない
- **確認**: ブラウザの開発者ツールでconsoleエラーを見る。`/diagnostics`が
  開ければそちらも見る
- **最初の安全な操作**: 何もしない（データを触る前にエラー内容を控える）
- **原因候補**: `index.html`のスクリプトが変数名衝突で丸ごと落ちている
  （README「R-2」参照）・ネットワーク不通でbundle.js取得失敗・IndexedDB利用不可
- **復旧**: エラー内容に応じて個別対応。原因不明なら直前のgh-pagesコミットへ
  ロールバック（7節）
- **やってはいけない**: ストレージの全削除
- **確認**: `npm run smoke`で配信物自体が壊れていないか確認

### 2. ロード画面から進まない

- **症状**: スプラッシュ（起動2.8秒の画面）で止まる
- **確認**: `/diagnostics`のService Worker状態・オンライン状態
- **最初の安全な操作**: 一度アプリを完全に閉じて開き直す
- **原因候補**: `bundle.js`の取得失敗・`splash-cache`の値が壊れている
- **復旧**: オフラインなら通信を確認。オンラインでも直らなければ
  ブラウザのキャッシュ（このアプリのService Worker cacheのみ、他サイトは
  触らない）をクリア
- **やってはいけない**: いきなりIndexedDBを消す

### 3. 古い画面が表示される

- **症状**: 直したはずの不具合が直っていない・古いUIのまま
- **確認**: `/diagnostics`のアプリバージョン・ソースコミットを、実際に
  配信したはずのVERSIONと比較
- **最初の安全な操作**: ハードリロード（キャッシュ無視の再読込）を試す
- **原因候補**: VERSIONを上げ忘れて配信した（`install`が走っていない）・
  gh-pagesへのpushを忘れた・CDNの反映遅延
- **復旧**: VERSIONを上げて再ビルド・再配信。`npm run smoke`で配信物の
  バージョンを確認
- **確認**: `tests/buildVersionConsistency.test.ts`が次回以降これを防ぐ

### 4. Service Workerが更新されない

- **症状**: 3と似るが、開発者ツールのApplication/Service Workerタブで
  waiting状態のまま進まない
- **確認**: 複数タブ・複数ウィンドウで同じアプリを開いていないか
  （waitingは既存タブが閉じるまで残ることがある。`skipWaiting`はあるが
  activate後の実際の反映は次のnavigationから）
- **最初の安全な操作**: 他のタブ・ウィンドウを全部閉じてから開き直す
- **原因候補**: 複数タブが古いversionのページを保持し続けている
- **復旧**: 全タブを閉じて再度開く。それでも直らなければService Worker
  registrationの解除（開発者ツールから）→再読込

### 5. PWA（ホーム画面）だけ古い

- **症状**: Safariでは新しいのに、ホーム画面に追加したアプリだけ古い
- **確認**: `/diagnostics`のorigin・実行環境（standalone/browser）
- **原因候補**: PWAとSafariでストレージ・Service Worker registrationが
  別（README既知の注意点）
- **復旧**: PWA側で個別に開き直す・再読込する
- **やってはいけない**: PWAを削除して入れ直す（先に他の手段を試す）

### 6. SafariとPWAでデータが異なる

- **症状**: 同じ端末なのに記録が違う
- **確認**: `/diagnostics`をSafari・PWA両方で開き、originが同じか確認
- **原因**: これは不具合ではなく仕様（ブラウザとstandalone PWAは
  ストレージが別。README「S-11」既知の注意点）
- **復旧**: どちらか片方を正として、書き出し→もう片方で取り込む（統合モード）

### 7. クラウド読込に失敗

- **症状**: 同期画面で「クラウドから読み込めません」等のエラー
- **確認**: `/diagnostics`のSupabase host・サインイン状態・オンライン状態。
  同期画面の「接続をテスト」で`kind`（url/key/offline/timeout）を確認
- **最初の安全な操作**: ローカルデータは触らない（読込失敗であり、
  ローカルは無事）
- **原因候補**: Project URL/Keyの入力ミス・Supabase側の障害・RLS設定ミス
- **復旧**: 「接続をテスト」の結果に従う。RLSが疑わしい場合は
  `supabase/migrations/0001_forge_storage_rls.sql`の確認SQLを実行
- **やってはいけない**: ローカルデータを消して「クラウドから作り直す」

### 8. クラウド書込に失敗

- **症状**: 同期で「送信できません」
- **確認**: 7と同様。加えてファイルサイズ（バックアップ50MB上限）
- **最初の安全な操作**: ローカルには保存済みのはずなので、まずローカルの
  バックアップを手動で書き出しておく（M-12）
- **原因候補**: RLSで拒否・サイズ超過・トークン期限切れ
- **復旧**: RLS確認（7節SQL参照）。トークン期限切れなら再サインイン

### 9. RLS拒否

- **症状**: 「row-level security policy」を含むエラー
- **確認**: `supabase/migrations/0001_forge_storage_rls.sql`の確認SQLで
  現在のポリシーを見る
- **最初の安全な操作**: 何もしない（これは正しく拒否されている可能性が高い＝
  安全側に倒れている）
- **原因候補**: ポリシー未適用・別プロジェクトの設定を使っている・
  サインイン中のuidとオブジェクトパスの不一致
- **復旧**: 確認SQLで実際のポリシーとパスを照合する
- **やってはいけない**: RLSを無効化する・bucketをpublicにする

### 10. OAuth後に別画面へ移動

- **症状**: Googleサインイン後、FORGEのホームなど想定外の画面に飛ぶ
- **確認**: Supabase Authの「Redirect URLs」設定に、現在のoriginが
  登録されているか（README「S-11」手順5参照）
- **復旧**: 接続診断に表示される`OAuth redirectTo`をRedirect URLsへ追加

### 11. IndexedDB migration失敗

- **症状**: 起動時にエラー、または`emptyState()`のまま何も表示されない
- **確認**: `/diagnostics`は開けるはず（診断画面自体はIndexedDBに依存しない）
- **最初の安全な操作**: 直近のバックアップファイルがあるか確認する
- **原因候補**: 6節の「対応できないケース」（破壊的な型変更）に該当する変更が
  入った
- **復旧**: バックアップから復元。無ければコード側の`loadState()`の
  マージ処理を見直す（forward fix）
- **やってはいけない**: `indexedDB.deleteDatabase`を試す前にバックアップを取る

### 12. データが消えたように見える

- **症状**: 練習記録が表示されない
- **最初の安全な操作**: **何も削除・復元・再インストールしない。** まず
  `/diagnostics`でorigin・実行環境を確認する（Safari/PWAの取り違え、6番の
  ケースであることが多い）
- **原因候補**: 環境違い（6番）・フィルタ条件で表示範囲外・iOSのストレージ消去
  （既知の注意点。だからM-12の書き出しがある）
- **復旧**: 環境を確認。本当に消えていた場合は直近のバックアップから復元

### 13. バックアップ復元失敗

- **症状**: 「復元できません」エラー
- **確認**: エラーメッセージ（`validateBackup`の検証結果がそのまま出る）
- **最初の安全な操作**: 復元前の検証で弾かれているだけなら、既存データは
  無傷（`importBackup`は検証完了まで既存データを消さない設計）
- **原因候補**: ファイル破損・別アプリの別形式ファイル
- **復旧**: 別のバックアップファイルを試す

### 14. FIT読込失敗

- **症状**: 「取込内容が不足しています」等
- **確認**: ファイルサイズ（5MB上限）・拡張子ではなく中身で判定している点
- **復旧**: 元のFITファイルをGarmin Connect等から再エクスポート

### 15. Apple Health読込が終わらない

- **症状**: 取込処理が終わらない
- **確認**: ファイルサイズ（500MB上限）。数年分のXMLは巨大になりうる
- **最初の安全な操作**: 処理を待つ（正規表現パースでDOMパーサ不使用のため
  比較的重い）。ブラウザタブを閉じない
- **復旧**: 上限を超えている場合は期間を絞ったエクスポートを試す

### 16. 配信物が壊れた

- **症状**: 一部のファイルだけ404・古いまま
- **確認**: `npm run smoke`で配信物の状態を確認
- **原因候補**: gh-pagesへのpush不完全・commit-tree方式の取り違え
- **復旧**: 直前の正常なgh-pagesコミットへロールバック（7節）

### 17. mainは正常だがgh-pagesが古い

- **症状**: mainには最新のコードがあるのに配信されていない
- **確認**: `npm run release:check`のVERSION比較（gh-pages配信済みの値）
- **原因**: gh-pagesへのpush（2本目のpush）を忘れた、または失敗した
- **復旧**: `git push origin $(git commit-tree main:pwa-dist -p origin/gh-pages -m "deploy: forge-vN"):gh-pages`
  を再実行

### 18. 誤ったreleaseを配信した

- **症状**: 配信直後に不具合に気づいた
- **最初の安全な操作**: 慌てて上書きしない。まず何が起きているか
  `npm run smoke`と`/diagnostics`で確認
- **復旧**: 7節「UI/JS配信物」のロールバック手順（過去のgh-pagesコミットへ戻す）。
  **VERSIONは新しい文字列にして再ビルドする**こと（古いVERSIONへ戻しても
  installが走らず端末に反映されない）
- **復旧確認**: `npm run smoke`で正しいVERSIONが返っていることを確認

---

## 16. このドキュメントとテストの対応

| 項目 | 検証手段 |
| --- | --- |
| VERSION整合性 | `tests/buildVersionConsistency.test.ts` |
| アトミックビルドの失敗時無害性 | 手動でのT-4検証済み（sabotage→pwa-dist無傷を確認）。自動テスト化は今回未実施 |
| API/shim対応 | `npm run ci:api-parity`（CIで自動実行） |
| Store実装漏れ | `npm run typecheck`（TypeScriptの`implements`で担保） |
| 秘密情報混入 | `npm run ci:secrets`（CIで自動実行） |
| 禁止パターン | `npm run ci:forbidden`（CIで自動実行） |
| 性能予算 | `npm run ci:perf-budget`（CIで自動実行） |
| リリース前確認 | `npm run release:check`（手動実行・dry-run） |
| 配信後の疎通 | `npm run smoke`（手動実行・非破壊） |
