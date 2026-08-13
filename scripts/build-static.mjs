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
import { createHash } from "crypto";

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

/*
 * iOSの起動画像。機種ごとに1枚あるので名前を並べず拾う。
 * 無ければ静かに飛ばす（起動画像を作っていない状態でもビルドは通す）。
 * 実体の生成は scripts/build-splash-screens.mjs。
 */
const splashScreens = fs
  .readdirSync(from)
  .filter((f) => /^splash-\d+x\d+\.png$/.test(f));

fs.mkdirSync(to, { recursive: true });
for (const f of [...FILES, ...splashScreens]) {
  const src = path.join(from, f);
  if (!fs.existsSync(src)) continue;
  fs.copyFileSync(src, path.join(to, f));
}

/*
 * 分割された chunk をプリキャッシュ対象へ差し込む。
 *
 * chunk のファイル名にはハッシュが入るので pwa/sw.js には書けない。
 * 差し込まないと、インストール直後にオフラインへ入ったとき、
 * 遅延読み込みしている画面だけが開けない（キャッシュにも無く、通信も無い）。
 *
 * build:pwa が先に走っている前提。無ければ空のままにして、静かに続ける
 * （分割していない構成でもビルドは通す）。
 */
const swPath = path.join(to, "sw.js");
const chunkFiles = fs
  .readdirSync(to)
  .filter((f) => /^chunk-.*\.js$/.test(f))
  .sort();
const swSource = fs.readFileSync(swPath, "utf8");
if (!swSource.includes("const CHUNKS = [];")) {
  throw new Error(
    "pwa/sw.js に差し込み先（const CHUNKS = [];）がありません。sw.js を変えたならここも合わせてください。"
  );
}
fs.writeFileSync(
  swPath,
  swSource.replace(
    "const CHUNKS = [];",
    `const CHUNKS = [${chunkFiles.map((f) => `"./${f}"`).join(", ")}];`
  )
);

// 版数を出す。上げ忘れは配信後に気づいても手遅れになる
const sw = fs.readFileSync(swPath, "utf8");
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
 * 配信物とソースの対応を追跡する。ただしコミットID・現在時刻を直接書くと、
 * 同じソースをCIで再ビルドしただけでpwa-distへ差分が出る。
 * tracked + untracked（ignore除外）の入力内容から指紋を作り、再現可能にする。
 */
function sourceFingerprint() {
  try {
    const files = execSync("git ls-files --cached --others --exclude-standard -z", {
      cwd: root,
    })
      .toString()
      .split("\0")
      .filter((file) => file && !file.startsWith("pwa-dist/"))
      .sort();
    const hash = createHash("sha256");
    for (const file of files) {
      hash.update(file);
      hash.update("\0");
      const absolutePath = path.join(root, file);
      // `git ls-files --cached`には作業ツリーで削除した追跡ファイルも含まれる。
      // 削除を無視せず明示的なマーカーとしてfingerprintへ含める。
      hash.update(fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath) : "<deleted>");
      hash.update("\0");
    }
    return `source-${hash.digest("hex").slice(0, 12)}`;
  } catch (error) {
    throw new Error("ソースfingerprintを生成できませんでした", { cause: error });
  }
}
fs.writeFileSync(
  path.join(to, "build-info.json"),
  JSON.stringify(
    {
      version: v,
      commit: sourceFingerprint(),
      builtAt: process.env.SOURCE_DATE_EPOCH
        ? new Date(Number(process.env.SOURCE_DATE_EPOCH) * 1000).toISOString()
        : "reproducible",
    },
    null,
    2
  )
);

console.log(
  `静的ファイルを配りました（Service Worker: ${v} / アイコンURLに ?v=${v} を付与 / ` +
    `プリキャッシュするchunk ${chunkFiles.length}件）`
);
