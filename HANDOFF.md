# FORGE 引継ぎ — いまどうなっているか

**このファイルは現在地だけを書く。** 過去の記録は `CHANGELOG.md`、
残っている作業は `BACKLOG.md`、なぜその設計かは `README.md`。

| 文書 | 役割 |
| --- | --- |
| `README.md` | なぜその設計にしたか |
| `HANDOFF.md` | いまどうなっているか（このファイル） |
| `BACKLOG.md` | 何が残っているか |
| `CHANGELOG.md` | 何をやってきたか |
| `CLAUDE.md` / `AGENTS.md` | 作業のときの約束事（同一内容） |
| `OPERATIONS.md` | 障害対応・リリース手順・ロールバック |
| `MIGRATION.md` | 別のPCへ移すとき |

> **秘密情報を書かないこと。** token、Publishable Key、service role key、
> Apple Health / FIT の本文、練習記録の実データはこのファイルに載せない。

---

## 数字を書き写さない

このファイルは何度も、古いテスト件数や古い版数を抱えたまま置き去りになってきた。
**手で書いた数字は必ず腐る。** 直近の実例:

- `AGENTS.md` と `README.md` は574件のまま、実際は3倍近くあった
- 「574件は古い。次に触るとき直す」という注記自体が、その後ずっと放置された
- README は Supabase 同期を実装したあとも「クラウド保存は未実装」のままだった

だから**このファイルに件数・版数を書かない。** 出どころを1つに決める。

| 知りたいこと | 唯一の正 |
| --- | --- |
| テスト件数 | `npm test` の出力 |
| カバレッジ | `npm run test:coverage` → `npm run coverage:report` |
| 配信中の版 | `pwa/sw.js` の `VERSION` と `pwa-dist/build-info.json`（一致は `npm test` が検査） |
| HEAD・差分 | `git log` / `git status` |
| 何が残っているか | `BACKLOG.md` |

`scripts/ci/check-doc-numbers.mjs` が、文書への件数の手書きを禁止している
（`CHANGELOG.md` だけは例外。あれは当時の事実の記録なので書いてよい）。

---

## リポジトリ

| 項目 | 値 |
| --- | --- |
| 作業ディレクトリ | `C:\Users\吏央\Downloads\FORGE` |
| remote (origin) | `https://github.com/rio01100801-gif/trainmiddle.git` |
| 公開URL | `https://rio01100801-gif.github.io/trainmiddle/` |
| branch | `main` |
| 配信元 | `gh-pages` ブランチ（`main:pwa-dist` の中身をルートに置く） |

配信は push が2本ある。**main だけでは配信物が差し替わらない。**
手順は `OPERATIONS.md`、または `npm run release:check` を先に実行して確認する。

---

## 最初にやること

```bash
npm install
npx playwright install chromium
npm run verify
```

**失敗したら「既存の不良」として記録し、自分の変更による不良と必ず区別する。**

`npm run verify` は typecheck → test → build:all → e2e → e2e:update の順。
`VERSION` を上げた直後は先に `npm run build:all` を通すこと
（配信物との一致を検査するテストがあるので、ビルド前だと落ちる）。

---

## いま進めていること

`BACKLOG.md` の **A-1（カバレッジの空白を埋める）**。

埋め終わったもの: `weekTemplate`（周期の枠検証）・`split600`（600m通過の材料判定）・
記録画面の判定と組み立て・サービス層の未検証経路・シューズ推薦に渡す文脈と心拍の使いどころ。

直前に入れたシューズ推薦は、**先に機能を足してテストが後になり、閾値を割った**。
`npm run test:coverage` はコミット前に通すこと（`npm run verify` には入っていない）。

アップ（forge-v106）は主練習の子データ。**流す先と流さない先の境界**が全部なので、
`tests/warmupAggregation.test.ts` を先に読む。

**次に手を付けるのは `src/lib/service/workflow.ts`。** 未検証の分岐が突出して多く、
生成と波及の中心なので**一番慎重さが要る**。頭が新しいときにやること。

始め方:

```bash
npm run test:coverage && npm run coverage:report
```

**既存の数値ロジック（CFEの係数・閾値）は、検証結果が出るまで変更しない。**
凍結するのは係数であって、コードの整理まで止める意味ではない。

---

## 検証で確認できている状態

`npm run verify` が緑であること以外に、静的に守っているもの。

| 項目 | 見ているもの |
| --- | --- |
| `ts-ignore` / `ts-expect-error` | 0件（`npm run ci:forbidden`） |
| `.only(` / `.skip(` / `xit(` / `xdescribe(` | 0件 |
| `: any` | 上限以内（`scripts/ci/check-forbidden-patterns.mjs` の基準値） |
| APIの対応 | `app/api/*` と `pwa/api-shim.ts` が対（`npm run ci:api-parity`） |
| 秘密情報 | `npm run ci:secrets` |
| 配信物のVERSION | `tests/buildVersionConsistency.test.ts` |
| 文書の数字の手書き | `npm run ci:docs` |
| サービス層の import の向き | `npm run ci:layers`（下から上への import で落ちる） |
| 入れ子のコンポーネント | `npm run ci:nested`（0件。iOSでキーボードが閉じる原因） |
| カバレッジ | `npm run test:coverage`（閾値は下げない。埋めたぶんだけ手で上げる） |

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
- **実行していない検証を成功と報告すること**

最後の1つが一番起きやすい。
検査を書いたら、**わざと壊して落ちることまで確認する**（`CLAUDE.md` の「落とし穴」）。
**特に `node -e` は避ける。** シェルを1回通るので `d` `s` `` が黙って消え、
正規表現が別物になる。置換したつもりで何も置換していない検査が
何度も生まれた（`replaced: true` を必ず出して確かめる）。
スクリプトはファイルに書いて `node script.mjs` で走らせる。
