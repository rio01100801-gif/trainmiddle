/**
 * PWAの静的ファイルを pwa-dist へ配る。
 *
 * sw.js は毎回コピーする必要がある。
 * Service Worker は install が走らないと新しい版が有効にならず、
 * install はファイルのバイト列が変わったときにしか走らない。
 * pwa/sw.js の VERSION を上げたのに配り忘れると、更新が端末に届かない。
 *
 * 実行:  node scripts/build-static.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const from = path.join(root, "pwa");
/*
 * 運用整備で追加: build:all をアトミック化する scripts/build-all-atomic.mjs から
 * 一時ディレクトリへ書き出させるための上書き先。未設定なら従来どおり pwa-dist。
 */
const to = process.env.FORGE_PWA_DIST
  ? path.resolve(root, process.env.FORGE_PWA_DIST)
  : path.join(root, "pwa-dist");

const FILES = [
  "sw.js",
  "index.html",
  "manifest.webmanifest",
  "icon-32.png",
  "icon-180.png",
  "icon-192.png",
  "icon-512.png",
  "icon-maskable-512.png",
  /*
   * ブランド資産。styles.css の url("./brand-wordmark.png") が
   * pwa-dist/ 基準で解決されるので、ここに置く必要がある。
   */
  "brand-wordmark.png",
];

fs.mkdirSync(to, { recursive: true });
for (const f of FILES) {
  const src = path.join(from, f);
  if (!fs.existsSync(src)) continue;
  fs.copyFileSync(src, path.join(to, f));
}

// 版数を出す。上げ忘れは配信後に気づいても手遅れになる
const sw = fs.readFileSync(path.join(to, "sw.js"), "utf8");
const v = /const VERSION = "([^"]+)"/.exec(sw)?.[1] ?? "不明";

/*
 * アイコンのURLに版数を付ける。
 *
 * iOSはホーム画面に追加した時点でアイコンを焼き付けるので、
 * 追加し直さないと新しいアイコンにならない。
 * そのうえ Safari は icon-180.png 自体もキャッシュしているため、
 * 追加し直しても古い画像のままになることがある。
 * URLが変われば確実に取り直すので、版数をクエリで付ける。
 *
 * 手で書くと上げ忘れるので、ここで sw.js の VERSION から入れる。
 * manifest 側も同じ理由で付ける（Androidのインストール済みアイコン対策）。
 */
const indexPath = path.join(to, "index.html");
fs.writeFileSync(
  indexPath,
  fs
    .readFileSync(indexPath, "utf8")
    .replace(/(href="\.\/icon-[\w-]+\.png)"/g, `$1?v=${v}"`)
);
const manifestPath = path.join(to, "manifest.webmanifest");
fs.writeFileSync(
  manifestPath,
  fs
    .readFileSync(manifestPath, "utf8")
    .replace(/("src": "\.\/icon-[\w-]+\.png)"/g, `$1?v=${v}"`)
);

/*
 * 運用整備で追加: 配信物がどのソースコミットから作られたかを追跡できるようにする。
 * 秘密情報は含まない（version・commit・生成時刻のみ）。診断画面（app/settings）が
 * これを読んで表示する。commitが取れない環境（gitが無い等）でも失敗させない。
 */
function currentCommit() {
  try {
    const dirty = execSync("git status --porcelain", { cwd: root }).toString().trim().length > 0;
    const hash = execSync("git rev-parse --short HEAD", { cwd: root }).toString().trim();
    return dirty ? `${hash}-dirty` : hash;
  } catch {
    return "unknown";
  }
}
fs.writeFileSync(
  path.join(to, "build-info.json"),
  JSON.stringify(
    { version: v, commit: currentCommit(), builtAt: new Date().toISOString() },
    null,
    2
  )
);

console.log(`静的ファイルを配りました（Service Worker: ${v} / アイコンURLに ?v=${v} を付与）`);
