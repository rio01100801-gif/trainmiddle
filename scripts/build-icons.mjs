/**
 * pwa/icon-master.png から配信用PNGを生成する。
 *
 * 通常アイコンは原本をフルブリードで使い、OS側の角丸マスクに任せる。
 * maskableだけは円形などで切り抜かれてもFORGEの文字が欠けないよう、
 * 黒背景の中央80%程度に主要要素を収める。
 *
 * 実行: node scripts/build-icons.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { loadChromium, launchOptions } from "../pwa/e2e-env.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pwa = path.join(root, "pwa");
const publicDir = path.join(root, "public");
const sourcePath = path.join(pwa, "icon-master.png");

if (!fs.existsSync(sourcePath)) {
  throw new Error("pwa/icon-master.png がありません。アイコン原本を配置してください。");
}

const source = `data:image/png;base64,${fs.readFileSync(sourcePath).toString("base64")}`;
const TARGETS = [
  { size: 512, out: "icon-512.png", inset: 0 },
  { size: 192, out: "icon-192.png", inset: 0 },
  { size: 180, out: "icon-180.png", inset: 0 },
  { size: 32, out: "icon-32.png", inset: 0 },
  { size: 512, out: "icon-maskable-512.png", inset: 9 },
];

const chromium = await loadChromium();
const browser = await chromium.launch(launchOptions());
fs.mkdirSync(publicDir, { recursive: true });

for (const target of TARGETS) {
  const page = await browser.newPage({
    viewport: { width: target.size, height: target.size },
    deviceScaleFactor: 1,
  });
  const inset = (target.size * target.inset) / 100;
  const renderedSize = target.size - inset * 2;

  await page.setContent(`<!doctype html>
    <meta charset="utf-8">
    <style>
      html, body {
        width: ${target.size}px;
        height: ${target.size}px;
        margin: 0;
        overflow: hidden;
        background: #000;
      }
      .crop {
        position: absolute;
        inset: ${inset}px;
        width: ${renderedSize}px;
        height: ${renderedSize}px;
        overflow: hidden;
        background: #000;
      }
      img {
        position: absolute;
        left: -5%;
        top: -5%;
        width: 110%;
        height: 110%;
        display: block;
        object-fit: cover;
      }
    </style>
    <div class="crop"><img src="${source}" alt=""></div>`);
  await page.locator("img").waitFor({ state: "visible" });
  const outputPath = path.join(pwa, target.out);
  await page.screenshot({ path: outputPath });
  fs.copyFileSync(outputPath, path.join(publicDir, target.out));
  await page.close();
  console.log(`${target.out} を icon-master.png から生成しました（${target.size}px）`);
}

await browser.close();
