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

`npm run verify` は typecheck → **test:coverage** → build:all → e2e → e2e:update の順。
カバレッジの閾値も verify で見る（以前は入っておらず、閾値を割ったまま配信したことがある）。
`VERSION` を上げた直後は先に `npm run build:all` を通すこと
（配信物との一致を検査するテストがあるので、ビルド前だと落ちる）。

---

## いま進めていること

**手を止めて、使ってみる段階。**

直近で予定生成・テーパー・漸進モデルにまとめて手を入れた（内容は `CHANGELOG.md`）。
**まだ1本も実際に走られていない。** プランもテーパーも設定ペースの帯も、
現実に当たっていない状態で積み増すと、次に何か出たときに切り分けにくくなる。

次に何かあったら、まず「どの版から出たか」を `CHANGELOG.md` で辿ること。

### 残っているもの

`BACKLOG.md` を正とする。技術的に止まっているのは **A-2c だけ**
（本人の実測が要る）。ほかは着手できる状態にある。

優先度をつけるなら **F-3（設定ペースの分類器の境界）**。
いま存在する不整合で、101〜103%帯が読み返すと高乳酸側に入る。
実害が出るのは本文を読み返す経路（一括入力・写真転記・本文編集）だけなので急がないが、
放置すると「保存された値」と「本文の読み」が割れたままになる。

### 触るときに気をつけること

**予定生成（`periodization.ts`）は中枢。** 週の枠の決め方・テーパーの境界・
制限因子の振り替え・漸進の段が互いに噛み合っている。1か所だけ変えると
別のどれかが崩れることが実際に何度も起きた。
変える前に、**レースの曜日を変えて7通り測る**こと（曜日で結果が変わる）。

**検査は壊して確かめる。** 通ることだけ見た検査が、実は何も見ていなかった例が
今日だけで4回あった（対象が存在しない・別の規則が先に効く・振る舞いが偶然一致する）。

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
