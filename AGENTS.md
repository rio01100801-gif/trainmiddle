# FORGE — 作業のときに読むもの

800m特化のトレーニング管理ツール。利用者は1人（伊藤吏央、800m PB 1:49.51、目標 1:48台）。
判断に迷ったら **「1:48台に必要か」** で決める。

詳しい設計判断は `README.md` に全部書いてある。ここには作業のときに必要なことだけ。

---

## 最初にやること

```bash
npm install
npx playwright install chromium     # E2E用
npm run verify                      # 型 → テスト → ビルド → E2E
```

`npm run verify` が通らない状態でコミットしない。

`npm run typecheck` は `app/` 配下のTSXも検査する。
これまでの開発環境（クラウドサンドボックス）はnpmが塞がっていて `@types/react` を入れられず、
画面側は型検査できていなかった。**移行後はここが効く。**
過去に出た「＋ボタンが反応しない」「キーボードが消える」は、どちらもこの層の不具合だった。

## コマンド

| 目的 | コマンド |
| --- | --- |
| 型チェック（画面含む全体） | `npm run typecheck` |
| 型チェック（コアだけ） | `npm run typecheck:core` |
| ユニットテスト（574件） | `npm test` |
| PWAのビルド一式 | `npm run build:all` |
| E2E（iPhone幅で実操作） | `npm run e2e` |
| 更新経路のE2E | `npm run e2e:update` |
| 全部 | `npm run verify` |
| Next.js版を動かす | `npm run dev` |

PWAのビルドには **bun** が要る（`npm i -g bun`）。理由は下の「二重の実行環境」を参照。

## 配信

`pwa-dist/` の中身をそのまま GitHub Pages に置いている。

```bash
npm run build:all
# pwa-dist/ をコミットして push
```

**リリースのたびに `pwa/sw.js` の `VERSION` を上げる。** 上げないと Service Worker の
install が走らず、端末に新しい版が届かない。`build:static` が版数を表示するので確認する。

---

## 構造

```
src/lib/core/     ドメインロジック。フレームワーク非依存・テスト済み。ここが本体
src/lib/db/       保存層。Store インターフェースが唯一の窓口
src/lib/service.ts サービス層。APIとCLIはここだけを呼ぶ
app/              画面（Next.js App Router）。PWAでもそのまま使う
app/api/          Next.js のAPIルート
pwa/              PWA固有（エントリ・APIシム・Service Worker・E2E）
pwa/shims/        PWAビルド時に next/link と next/navigation を差し替える実装
pwa-dist/         配信物。ビルド生成物だがリポジトリに入れている（GitHub Pagesのため）
tests/            ユニットテスト
```

### 二重の実行環境

同じ画面コードが2つの経路で動く。

1. **Next.js**: `app/api/*` がサーバー側でサービス層を呼ぶ
2. **PWA**: `pwa/api-shim.ts` が `fetch("/api/...")` を横取りして、同じサービス層を直接呼ぶ

**APIを足したら両方に足すこと。** 片方だけだと、片方の環境で静かに動かなくなる。
`app/api/<name>/route.ts` と `pwa/api-shim.ts` の `routes` は必ず対で書く。

保存層も2つある（SQLiteの `Repo` と IndexedDBの `MemoryStore`）。
`Store` インターフェースにメソッドを足したら両方に実装する。

SQLiteの実体は3つから自動で選ぶ（bun:sqlite → node:sqlite → better-sqlite3）。
`node:sqlite` を優先するのは、better-sqlite3 がネイティブビルドを要求し、
Windowsでは Visual Studio Build Tools が無いと失敗するため。
better-sqlite3 は optionalDependencies なので、入らなくても動く。

PWAビルドが `next/link` を `pwa/shims/` に差し替えるのは `scripts/build-pwa.mjs`。
tsconfig の paths を使っていないのは、Next.js 側のビルドにも効いてしまうため。

---

## 守ること

**LLMを使わない。** 一括入力もメニュー解釈も完全ルールベース。
同じ入力からは必ず同じ結果が出ること。あとで数値を疑うときに、これが無いと追えない。

**読めなかったものを推測で埋めない。** 空欄にして理由を出す。
「たぶんこうだろう」で埋めた値がCFEに流れると、どれが実測でどれが推測か分からなくなる。

**自動で変えたことは理由とセットで出し、本人が却下できるようにする。** 黙って数値を書き換えない。
設定が下がったのか実力が上がったのかを、あとから判別できなくなる。

**CFEと設定ペースを混同しない。** CFEは能力の推定、設定ペースは今日出せる値。
実行できなかったこと（暑さ・寝不足・設定が高すぎた）は能力低下ではないので、
設定だけを動かしてCFEは触らない。

**解釈は1か所に集める。** メニュー本文の解釈は `bulkImport.ts` の `parseRow` が唯一の実装。
`prescription.ts` はそれに日付を足して呼んでいるだけ。
同じ文字列が画面によって違う意味になってはいけない。

**デザインはFORGEの規則に従う。** 黒・白・グレーが90%、アクセントの FORGE Green が10%。
カラフルなUI・ゲーム的な演出・過剰な影は入れない。数値を主役にする。
下部タブは4つ（ホーム／カレンダー／記録／分析）から増やさない。

**きつい練習＝良い練習、という評価軸を作らない。** RPEの高さや達成感を加点にしない。

---

## 落とし穴

**コンポーネントの中でコンポーネントを定義しない。**

```tsx
function Form() {
  const L = ({ children }) => <label>{children}</label>;   // ダメ
  return <L><input /></L>;
}
```

再描画のたびに別の関数になるので、Reactが中身の `<input>` を作り直す。
フォーカスが外れ、iOSでは1文字打つたびにキーボードが閉じる。
**画面には何も出ないので気づけない。** E2Eの「N-1」がこれを見張っている。

**入力欄を動的に組み替えるときは、入力中に作り直さない。**
解釈はデバウンスしてから走らせ、構造（種別・距離・本数）が実際に変わったときだけ組み替える。
値は減る方向では捨てない（打ち間違いで一時的に減ったときに入れ直しになる）。

**iOSのSafariはストレージを消すことがある。** だから書き出し（M-12）が要る。

**E2Eは「壊れた状態で落ちるか」まで確認する。** 通ることだけ確認した検証は、
実は何も見ていないことがある。特に見た目に出ない不具合（N-1）で重要。

---

## 変更の作法

1. コアロジックを `src/lib/core/` に足し、テストを書く
2. `src/lib/service.ts` から使えるようにする
3. `app/api/*` と `pwa/api-shim.ts` の両方にAPIを足す
4. 画面を作る
5. E2Eに経路を足す
6. `npm run verify`
7. `README.md` に「なぜその閾値か」「なぜその置き場所か」を残す

閾値を決めたら、必ず理由をコメントに書く。
数字だけが残ると、あとで動かしていいのか分からなくなる。

### 締め（毎回やる）

タスクが完了して `npm run verify` が通ったら、**確認を取ったうえで**ここまでやる。

1. `pwa/sw.js` の `VERSION` を上げる
2. `npm run build:all`
3. 変更内容を1行で説明するメッセージで commit して push

**`VERSION` を上げ忘れると端末に更新が届かない。** Service Worker の install が走らないので、
ビルドし直して配信しても古い版が動き続ける。ここを省略しない。
`build:static` が版数を表示するので、`forge-vN` が上がっていることを目で確認する。

push は2本ある。main だけだと配信物は差し替わらない。

```bash
git add -A && git commit -m "<変更内容を1行で>" && git push origin main
```

```bash
git push origin $(git commit-tree main:pwa-dist -p origin/gh-pages -m "deploy: forge-vN"):gh-pages
```
