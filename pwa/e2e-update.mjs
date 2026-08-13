/**
 * 更新経路のE2E: 配信ファイルを差し替えたとき、端末側に新版が届くか。
 *
 * 以前の Service Worker は全ファイルをキャッシュ優先で返していたため、
 * GitHub Pages 側を差し替えても端末は古い bundle.js を使い続けていた。
 * ここではその回帰を防ぐために、実際に配信内容を書き換えて検証する。
 *
 * 1. 旧版を配信 → 起動 → SWが制御を取る
 * 2. 配信ディレクトリの中身を差し替える（新版）
 * 3. 1回目のリロード → キャッシュ（旧版）が即返ること。裏で新版を取る
 * 4. 2回目のリロード → 新版が表示されること
 * 5. オフラインにしても起動できること（キャッシュが機能していること）
 *
 * 3で「旧版が出ること」まで見ているのは速さの回帰を防ぐため。
 * ここで新版が出るなら、キャッシュを即返さず通信を待っているということ。
 */
import { DIST, launchOptions, loadChromium } from "./e2e-env.mjs";
import http from "http";
import fs from "fs";
import path from "path";
import os from "os";

const SRC = DIST;
const SERVE = path.join(os.tmpdir(), "serve-update");
fs.rmSync(SERVE, { recursive: true, force: true });
fs.mkdirSync(SERVE, { recursive: true });
for (const f of fs.readdirSync(SRC)) fs.copyFileSync(path.join(SRC, f), path.join(SERVE, f));

// 旧版の目印を index.html に入れておく
const indexPath = path.join(SERVE, "index.html");
const baseHtml = fs.readFileSync(indexPath, "utf8");
fs.writeFileSync(indexPath, baseHtml.replace("</body>", '<div id="ver">OLD</div></body>'));

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
};
const server = http.createServer((req, res) => {
  const p = req.url.split("?")[0];
  const file = path.join(SERVE, p === "/" ? "index.html" : p);
  try {
    const data = fs.readFileSync(file);
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(file)] ?? "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(data);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(8792, r));

const chromium = await loadChromium();
const b = await chromium.launch(launchOptions());
const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const step = (m) => console.log("STEP:", m);
const fail = (m) => {
  console.log("FAIL:", m);
  process.exitCode = 1;
};

// ---- 1. 旧版を起動し、SWが制御を取るまで待つ ----
await page.goto("http://localhost:8792/");
await page.waitForFunction(() => !document.getElementById("splash"), { timeout: 15000 });
await page.waitForFunction(() => navigator.serviceWorker.controller !== null, { timeout: 15000 });
if (!(await page.locator("#ver").textContent()) .includes("OLD")) fail("旧版が表示されていない");
step("旧版の起動＋Service Worker登録OK");

// ---- 2. 配信側を新版に差し替える ----
// ここが肝心: sw.js は一切変更しない。
// Service Worker の install は sw.js のバイト列が変わったときにしか走らない。
// 「バージョンを上げ忘れた」「bundle.js だけ差し替えた」は現実に起きるので、
// その場合でも新版が届くことを保証する必要がある。
// （旧仕様の全ファイルキャッシュ優先だと、ここで永久に旧版のままになる）
fs.writeFileSync(indexPath, baseHtml.replace("</body>", '<div id="ver">NEW</div></body>'));
step("配信ファイルを新版に差し替え（sw.js は据え置き）");

/*
 * ---- 3. 新版が届くか（stale-while-revalidate なので1回遅れ）----
 *
 * 以前はネットワーク優先で、1回のリロードで新版になった。
 * 起動のたびに通信を待つのをやめた（キャッシュを即返す）ので、契約が変わった。
 *   1回目のリロード … 手元のキャッシュ＝旧版が出る。裏で新版を取ってキャッシュへ
 *   2回目のリロード … 新版が出る
 * 「いつか届く」ではなく**ちょうど次の起動で届く**ことまで見る。
 * 1回目で既に新版になるなら、それは裏取りではなく通信待ちをしている証拠なので、
 * それも失敗として扱う（速さの回帰を見逃さないため）。
 */
await page.reload();
await page.waitForFunction(() => !document.getElementById("splash"), { timeout: 15000 });
const afterFirst = await page.locator("#ver").textContent();
if (afterFirst?.includes("NEW")) {
  fail("1回目のリロードで新版が出た（キャッシュを即返さず通信を待っている）");
} else {
  step("1回目はキャッシュ即返しOK（通信を待たない）");
}

// 裏の取得がキャッシュに入るのを待つ
await page.waitForTimeout(1200);
await page.reload();
await page.waitForFunction(() => !document.getElementById("splash"), { timeout: 15000 });
let updated = true;
await page
  .waitForFunction(() => document.getElementById("ver")?.textContent === "NEW", {
    timeout: 15000,
  })
  .catch(() => {
    updated = false;
    fail("2回目のリロードでも旧版のまま（裏での更新が効いていない）");
  });
if (updated) step("次の起動で新版が反映OK（VERSION据え置きでも届く）");

// ---- 4. オフラインでも起動できるか ----
await ctx.setOffline(true);
await page.reload();
await page
  .waitForFunction(() => !document.getElementById("splash"), { timeout: 15000 })
  .catch(() => fail("オフラインで起動できない"));
const offlineBody = await page.textContent("body");
if (!offlineBody || offlineBody.trim().length < 20) fail("オフライン時の描画が空");
step("オフライン起動OK");

/*
 * オフラインで**遅延読み込みの画面**が開くか。
 *
 * TODAY以外の画面は別ファイル（chunk）に分けてある。chunkをプリキャッシュ
 * していないと、一度も開いていない画面はオフラインで開けない
 * （キャッシュにも無く、通信も無い）。起動だけ見ていても気づけない。
 * 差し込みは scripts/build-static.mjs、受け側は pwa/sw.js の CHUNKS。
 */
let lazyOk = true;
const lazyFail = (m) => {
  lazyOk = false;
  fail(m);
};
for (const [path, expect] of [
  ["/analysis", "分析"],
  ["/past", "過去データ"],
]) {
  await page.goto(`http://localhost:8792/#${path}`);
  await page.reload();
  await page
    .waitForFunction(() => !document.getElementById("splash"), { timeout: 15000 })
    .catch(() => lazyFail(`オフラインで ${path} が起動しない`));
  // Suspenseの「読み込み中…」で止まっていないこと（= chunkが取れている）
  await page
    .waitForFunction(
      () => !(document.body.textContent ?? "").includes("読み込み中…"),
      { timeout: 10000 }
    )
    .catch(() => lazyFail(`オフラインで ${path} のchunkを読めていない（読み込み中のまま）`));
  const body = (await page.textContent("body")) ?? "";
  if (!body.includes(expect)) {
    lazyFail(`オフラインで ${path} が描画されない（「${expect}」が無い）`);
  }
}
if (lazyOk) step("オフラインで遅延読み込みの画面も開くOK（chunkがプリキャッシュされている）");
await ctx.setOffline(false);

console.log(
  process.exitCode ? "=== UPDATE E2E FAILED ===" : "=== UPDATE E2E PASS ==="
);
await b.close();
server.close();
