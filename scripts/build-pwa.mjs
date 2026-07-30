/**
 * PWA（pwa-dist/bundle.js）をビルドする。
 *
 * なぜ専用スクリプトが要るか:
 * app/ 配下の画面は Next.js と PWA の両方で使い回している。
 * そのため import は "next/link" / "next/navigation" のままにしてあるが、
 * PWA は Next.js のサーバーを持たないので、本物の Next.js は動かない。
 * ここでビルド時に pwa/shims/ の実装へ差し替える。
 *
 * tsconfig の paths で解決しないのは、Next.js 側のビルドにも効いてしまい、
 * `npm run dev` で本物の next/link が使われなくなるため。
 * 差し替えは「PWAをビルドするときだけ」に限定する必要がある。
 *
 * 実行:  bun scripts/build-pwa.mjs
 */
import path from "path";
import fs from "fs";

if (typeof Bun === "undefined") {
  console.error(
    [
      "このスクリプトは bun で実行してください。",
      "  bun scripts/build-pwa.mjs",
      "",
      "bun が無い場合:",
      "  curl -fsSL https://bun.sh/install | bash    # macOS / Linux",
      "  npm install -g bun                          # npm 経由でも入ります",
    ].join("\n")
  );
  process.exit(1);
}

const root = path.resolve(import.meta.dir, "..");
/*
 * 運用整備で追加: build:all をアトミック化する scripts/build-all-atomic.mjs から
 * 一時ディレクトリへ書き出させるための上書き先。未設定なら従来どおり pwa-dist。
 */
const distDir = process.env.FORGE_PWA_DIST
  ? path.resolve(root, process.env.FORGE_PWA_DIST)
  : path.join(root, "pwa-dist");
const outfile = path.join(distDir, "bundle.js");
fs.mkdirSync(distDir, { recursive: true });

/*
 * chunkのファイル名にはハッシュが入る（下のBun.buildのnaming参照）ため、
 * 内容が変わるたびに新しいファイル名になり、Bun.buildは古いchunkを消してくれない。
 * 消さずに積み上げていくと、二度と読まれない古いchunkが配信物に残り続ける。
 * ビルドのたびに一度全部消してから作り直す（stale chunk掃除）。
 */
function tryReaddir(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}
for (const name of tryReaddir(distDir)) {
  if (/^chunk-.*\.js$/.test(name)) {
    fs.rmSync(path.join(distDir, name), { force: true });
  }
}

/** next/* を PWA 用の実装に差し替える */
const nextShim = {
  name: "next-shim",
  setup(build) {
    build.onResolve({ filter: /^next\/link$/ }, () => ({
      path: path.join(root, "pwa", "shims", "link.tsx"),
    }));
    build.onResolve({ filter: /^next\/navigation$/ }, () => ({
      path: path.join(root, "pwa", "shims", "navigation.tsx"),
    }));
  },
};

/*
 * splitting: true にすると、entry.tsx内の動的import（`await import(...)`）が
 * 別ファイル（chunk）に分かれる。FIT解析（fit-file-parser、Garmin公式の
 * プロファイル定義を丸ごと含み重い）を、FIT画面を実際に開いたときだけ
 * 読み込むようにするため（対象1・2とは無関係。bundleサイズ対策）。
 *
 * chunkのファイル名にはハッシュが入るため、内容が変わればファイル名も変わる。
 * pwa/sw.js の isAppShell() は index.html/bundle.js/styles.css/manifestだけを
 * network-first にしており、chunkはそこに含めていない。含めなくてよい理由は、
 * ハッシュ付きファイル名を持つ以上「同じ名前なのに中身が古い」が起きないため
 * （cache-first で問題ない。むしろ毎回取りに行かない分、通常の再訪問が速くなる）。
 *
 * ESM出力になるため index.html 側の <script> は type="module" にする必要がある
 * （pwa/index.html を参照）。
 */
const result = await Bun.build({
  entrypoints: [path.join(root, "pwa", "entry.tsx")],
  outdir: distDir,
  naming: {
    entry: "bundle.js",
    chunk: "chunk-[hash].js",
    asset: "[name]-[hash].[ext]",
  },
  target: "browser",
  format: "esm",
  splitting: true,
  minify: true,
  plugins: [nextShim],
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

// 差し替えが効いているかを確認する。
// 効いていないと本物の next/link が入り、画面遷移が全部死んだ状態で出荷される。
const code = await Bun.file(outfile).text();
if (!code.includes("__HASH_NAV__")) {
  console.error(
    "next/link の差し替えが効いていません（__HASH_NAV__ が bundle に入っていない）。" +
      "pwa/shims/ が読まれているか確認してください。"
  );
  process.exit(1);
}

const kb = Math.round((code.length / 1024) * 10) / 10;
console.log(`bundle.js を書き出しました（${kb} KB）`);
