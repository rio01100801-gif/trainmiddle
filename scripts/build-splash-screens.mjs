/**
 * iOSの起動画像（apple-touch-startup-image）を作る。
 *
 * なぜ要るか:
 * iOSのホーム画面PWAは、manifest の background_color を見ない（あれはAndroid/Chrome用）。
 * 起動画像が無いと、コールド起動のあいだ **白い画面** が出る。
 * アプリがメモリから落ちたあとに開くと毎回それが挟まる。
 *
 * どう作るか:
 * 実際にビルド済みの index.html を各機種のサイズで開いて撮る。
 * 静止画を別に組むと、本物のスプラッシュとわずかにズレて
 * 「起動画像 → 本体」の切り替わりで画がガタつく。同じものを撮れば飛ばない。
 *
 * - bundle.js は止める（読み込むとスプラッシュが消えるため）
 * - prefers-reduced-motion を有効にして撮る。フェードインの途中を撮らないため
 *
 * 実行: node scripts/build-splash-screens.mjs
 * 出力: pwa/splash-<幅>x<高さ>.png（build-static.mjs が pwa-dist へコピーする）
 */
import fs from "fs";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { loadChromium, launchOptions } from "../pwa/e2e-env.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "pwa-dist");
const outDir = path.join(root, "pwa");

if (!fs.existsSync(path.join(dist, "index.html"))) {
  throw new Error("pwa-dist がありません。先に npm run build:all を実行してください。");
}

/**
 * 対象。iOSは**サイズが完全一致したときだけ**起動画像を使うので、
 * 機種ごとに1枚ずつ要る。縦向きのみ（manifest が orientation: portrait のため）。
 */
export const SCREENS = [
  { w: 440, h: 956, dpr: 3, note: "16 Pro Max" },
  { w: 430, h: 932, dpr: 3, note: "14/15/16 Pro Max・15/16 Plus" },
  { w: 402, h: 874, dpr: 3, note: "16 Pro" },
  { w: 393, h: 852, dpr: 3, note: "14/15/16 Pro" },
  { w: 428, h: 926, dpr: 3, note: "12/13/14 Pro Max" },
  { w: 390, h: 844, dpr: 3, note: "12/13/14/15" },
  { w: 375, h: 812, dpr: 3, note: "X/XS/11 Pro・12/13 mini" },
  { w: 414, h: 896, dpr: 3, note: "XS Max・11 Pro Max" },
  { w: 414, h: 896, dpr: 2, note: "XR・11" },
  { w: 414, h: 736, dpr: 3, note: "8 Plus" },
  { w: 375, h: 667, dpr: 2, note: "SE2/SE3・8" },
  { w: 320, h: 568, dpr: 2, note: "SE1" },
];

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
};
const server = http.createServer((req, res) => {
  const url = (req.url || "/").split("?")[0];
  const file = path.join(dist, url === "/" ? "index.html" : decodeURIComponent(url));
  if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] ?? "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(8897, r));

const chromium = await loadChromium();
const browser = await chromium.launch(launchOptions());

for (const s of SCREENS) {
  const ctx = await browser.newContext({
    viewport: { width: s.w, height: s.h },
    deviceScaleFactor: s.dpr,
    // フェードインの途中を撮らない（reduced-motion側で最終状態が決まる）
    reducedMotion: "reduce",
  });
  const page = await ctx.newPage();
  // 読み込ませるとスプラッシュが消えてしまう
  await page.route("**/bundle.js", (r) => r.abort());
  await page.goto("http://localhost:8897/");
  await page.waitForSelector("#splash");
  await page.waitForTimeout(350);
  const name = `splash-${s.w * s.dpr}x${s.h * s.dpr}.png`;
  await page.screenshot({ path: path.join(outDir, name) });
  await ctx.close();
  console.log(`${name}（${s.w}x${s.h} @${s.dpr}x / ${s.note}）`);
}

await browser.close();
server.close();
console.log(`起動画像 ${SCREENS.length}枚を pwa/ に出しました。`);
