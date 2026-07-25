/**
 * E2Eの共通部品: Playwright の読み込みと配信ディレクトリの解決。
 *
 * 開発環境によって playwright の置き場所が違う。
 * インストール済みのものを普通に import できるならそれを使い、
 * できない場合だけ、この開発コンテナに置いてある絶対パスを見る。
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DIST = path.join(ROOT, "pwa-dist");

/** この開発コンテナ固有の置き場所（無ければ無視される） */
const SANDBOX_PLAYWRIGHT = "/home/claude/.npm-global/lib/node_modules/playwright/index.mjs";
const SANDBOX_CHROMIUM = "/opt/pw-browsers/chromium";

export async function loadChromium() {
  try {
    const mod = await import("playwright");
    return mod.chromium;
  } catch {
    if (fs.existsSync(SANDBOX_PLAYWRIGHT)) {
      const mod = await import(SANDBOX_PLAYWRIGHT);
      return mod.chromium;
    }
    console.error(
      "playwright が見つかりません。`npm i -D playwright && npx playwright install chromium` を実行してください。"
    );
    process.exit(1);
  }
}

/** ブラウザ本体の場所。指定が要るのはこのコンテナだけ */
export function launchOptions() {
  return fs.existsSync(SANDBOX_CHROMIUM) ? { executablePath: SANDBOX_CHROMIUM } : {};
}
