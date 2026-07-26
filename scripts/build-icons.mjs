/**
 * アイコンのPNGを SVG から書き出す（R-3）
 *
 * 原本は pwa/icon.svg（大サイズ用）と pwa/icon-small.svg（小サイズ用）。
 * PNGを直接置き換えると、次に形を直したときに原本とズレるので、必ずここから作る。
 *
 * ラスタライズは E2E で既に入れている Chromium を使う。
 * このためだけに画像ライブラリを増やさない（ネイティブビルドが要るものは
 * Windowsで入らないことがあり、環境ごとに結果が変わる）。
 *
 * 実行:  node scripts/build-icons.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { loadChromium, launchOptions } from "../pwa/e2e-env.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pwa = path.join(root, "pwa");

/**
 * 180 / 192 は小さい。ワードマークを入れると、
 * ホーム画面の実寸（約60pt）で文字が潰れて読めない汚れになる。
 * 小サイズはトラックだけの簡略版にして、形の判別を優先する。
 */
const TARGETS = [
  { size: 512, svg: "icon.svg", out: "icon-512.png" },
  { size: 192, svg: "icon-small.svg", out: "icon-192.png" },
  { size: 180, svg: "icon-small.svg", out: "icon-180.png" },
  // maskable は OS 側が好きな形で切り抜く。中央60%に収めた別版を使う
  { size: 512, svg: "icon-maskable.svg", out: "icon-maskable-512.png" },
];

const chromium = await loadChromium();
const browser = await chromium.launch(launchOptions());

for (const t of TARGETS) {
  const svg = fs.readFileSync(path.join(pwa, t.svg), "utf8");
  const page = await browser.newPage({
    viewport: { width: t.size, height: t.size },
    deviceScaleFactor: 1,
  });
  await page.setContent(
    `<!doctype html><meta charset="utf-8">` +
      `<style>html,body{margin:0;padding:0;background:transparent}` +
      `svg{display:block;width:${t.size}px;height:${t.size}px}</style>` +
      svg
  );
  await page.screenshot({ path: path.join(pwa, t.out), omitBackground: true });
  await page.close();
  console.log(`${t.out} を ${t.svg} から書き出しました（${t.size}px）`);
}

await browser.close();
