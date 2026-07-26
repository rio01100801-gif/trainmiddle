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

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const from = path.join(root, "pwa");
const to = path.join(root, "pwa-dist");

const FILES = [
  "sw.js",
  "index.html",
  "manifest.webmanifest",
  "icon-180.png",
  "icon-192.png",
  "icon-512.png",
  "icon-maskable-512.png",
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
console.log(`静的ファイルを配りました（Service Worker: ${v}）`);
