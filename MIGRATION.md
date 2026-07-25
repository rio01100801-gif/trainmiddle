# Claude Code への移行手順

この作業を手元のPCに移すための手順。所要15分ほど。

## 1. 必要なもの

| もの | 用途 | 入れ方 |
| --- | --- | --- |
| Node.js 20以上 | 全般 | https://nodejs.org |
| bun | PWAのビルド | `npm install -g bun`（あとからでよい） |
| git | バージョン管理 | 大抵は入っている |
| Claude Code | 作業 | `npm install -g @anthropic-ai/claude-code` |

## 2. 置く

`FORGE-source.zip` を展開する。中身がリポジトリ一式。

```bash
unzip FORGE-source.zip -d forge
cd forge
npm install
npx playwright install chromium
```

### つまずいたときの対処

**`npm install` が `EPERM: operation not permitted, mkdir 'C:\'` で失敗する**

PowerShellがプロジェクトのフォルダではなく、Cドライブの一番上にいる。
プロンプトが `PS C:\>` になっていたらこれ。
`cd ` と打ってからフォルダをPowerShellにドラッグ＆ドロップすれば移動できる。
`dir` で `package.json` が見えれば正しい場所にいる。

**`better-sqlite3` のビルドで失敗する**

Node 24 では better-sqlite3 のビルド済みバイナリが無く、
ソースからのコンパイル（Visual Studio Build Tools が必要）に落ちるため。

対処は済んでいる。SQLiteは Node 22.5 以降に標準で入っている `node:sqlite` を使うようにしてあり、
`better-sqlite3` は optionalDependencies なので、ビルドに失敗しても `npm install` は完走する。
それでも赤い警告が出ることがあるが、無視してよい。

**`claude` が見つからない**

インストール先（`%USERPROFILE%\.local\bin`）にPATHが通っていない。

```powershell
[Environment]::SetEnvironmentVariable("Path", [Environment]::GetEnvironmentVariable("Path","User") + ";$env:USERPROFILE\.local\bin", "User")
```

を実行してPowerShellを開き直す。

## 3. 動くことを確認する

```bash
npm run verify
```

型チェック → ユニットテスト574件 → ビルド → E2E → 更新経路E2E が順に走る。
全部通れば移行できている。

手元で画面を見るには:

```bash
npm run dev          # http://localhost:3000（Next.js版）
```

PWA版をそのまま見るには、`pwa-dist` を静的配信する。

```bash
npm run build:all
npx serve pwa-dist   # あるいは python3 -m http.server -d pwa-dist 8080
```

同じWi-Fiに繋がっていれば、iPhoneから `http://<PCのIP>:8080` で開ける。
zipを受け取って上書きする往復が要らなくなる。

## 4. GitHubに繋ぐ

いま GitHub には `pwa-dist` の中身だけを置いていると思うので、
ソースも同じリポジトリに入れておく（`pwa-dist/` はそのまま残す）。

```bash
git init
git add .
git commit -m "FORGE: ソース一式を追加"
git remote add origin <リポジトリのURL>
git push -u origin main
```

以降のリリースは、

```bash
npm run build:all
git add -A && git commit -m "..." && git push
```

## 5. Claude Code を起動する

```bash
cd forge
claude
```

リポジトリ直下の `CLAUDE.md` を自動で読むので、設計方針・落とし穴・
やってはいけないことは引き継がれる。詳しい設計判断は `README.md` にある。

最初に投げるといいこと:

- 「`npm run verify` を通して、いまの状態を確認して」
- 「改修指示書v5までの実装内容を README から要約して」

## 移行して変わること

**画面のコードに型チェックが効くようになる。** この作業をしていたクラウド環境は
npmレジストリが塞がっていて `@types/react` を入れられず、`app/` 配下のTSXは
型検査できていなかった（コアロジックは検査済み）。
「＋ボタンが反応しない」「キーボードが消える」はどちらもこの層の不具合だった。

移行後は `npm run typecheck` が画面も含めて全部を見る。
**初回は既存の型エラーが出るかもしれない。** これまで一度も検査できていない範囲なので、
出たら潰していけばいい（動作している以上、致命的なものは残っていないはず）。

**画面を動かしながら直せる。** `npm run dev` で即座に確認できる。

**iOSアプリ化に進める。** Macがあれば Capacitor でラップしてビルドできる。

## 移行しても変わらないこと

会話の文脈は移らない。ただし設計判断は `README.md` と `CLAUDE.md` に文章で残してある。
改修指示書（v2〜v5）も、何を意図した変更だったかの記録として使える。
