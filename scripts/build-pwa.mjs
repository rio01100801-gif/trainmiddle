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
const outfile = path.join(root, "pwa-dist", "bundle.js");

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

const result = await Bun.build({
  entrypoints: [path.join(root, "pwa", "entry.tsx")],
  outdir: path.join(root, "pwa-dist"),
  naming: "bundle.js",
  target: "browser",
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
