/**
 * npm run build:all のアトミック版。
 *
 * 運用整備（2026-07-31）で追加。従来の build:all は
 * build:pwa → build:css → build:static を順に実行し、それぞれが
 * pwa-dist/ へ直接書き込んでいた。途中（例: build:css）が失敗すると、
 * bundle.js だけ新しくて manifest/sw.js は古い、という配信不可能な
 * 中途半端な状態が pwa-dist/ に残ってしまう。
 *
 * ここでは一時ディレクトリ（.pwa-dist-staging）へ全部書き出し、
 * 3ステップすべて成功した場合だけ pwa-dist/ を置き換える。
 * 失敗時は pwa-dist/ に一切触れない。
 *
 * build:pwa / build:css / build:static を個別に叩く用途（開発中の
 * 素早い再ビルド）はこれまでどおり pwa-dist/ へ直接書く動作を維持する
 * （このスクリプトが唯一の入口ではない）。
 *
 * 実行:  node scripts/build-all-atomic.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

/*
 * 全ての引数はこのファイル内のリテラル・自リポジトリ内パスのみ（外部入力は無い）。
 * execFileSync + shell:true は引数配列がエスケープされない旨のdeprecation警告が
 * 出るため、ここでは自前でダブルクォートして1つのコマンド文字列にする。
 */
function q(arg) {
  return `"${arg.replace(/"/g, '\\"')}"`;
}
function run(cmd, args) {
  execSync([cmd, ...args.map(q)].join(" "), { cwd: root, env, stdio: "inherit" });
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(root, "pwa-dist");
const stagingDir = path.join(root, ".pwa-dist-staging");
const backupDir = path.join(root, ".pwa-dist-backup");

/*
 * 削除は必ずこの関数を経由させる。誤って広いディレクトリを消さないための
 * 最終防衛線: 対象パスが staging か backup の絶対パスと完全一致する場合のみ許可する。
 */
function safeRemove(target) {
  if (target !== stagingDir && target !== backupDir) {
    throw new Error(`safeRemove: 想定外のパスは削除しない (${target})`);
  }
  fs.rmSync(target, { recursive: true, force: true });
}

/** ビルドでは触らない静的ファイル（手動管理）。staging へ引き継ぐ */
const CARRY_OVER_FILES = ["SETUP-GUIDE.txt", "setup-guide.html"];

/** 完了後にstagingへ揃っているべきファイル。欠けていたら失敗扱いにする */
const REQUIRED_FILES = [
  "bundle.js",
  "sw.js",
  "index.html",
  "manifest.webmanifest",
  "styles.css",
  "icon-32.png",
  "icon-180.png",
  "icon-192.png",
  "icon-512.png",
  "icon-maskable-512.png",
  "build-info.json",
];

function fail(message) {
  console.error(`✗ ビルド失敗: ${message}`);
  safeRemove(stagingDir);
  process.exit(1);
}

/*
 * Windowsでは、直前まで開いていたファイルハンドル（アンチウイルスの
 * スキャン・エクスプローラー・簡易ローカルサーバー等）が原因で
 * fs.renameSync が一時的に EBUSY/EPERM を返すことがある。
 * 少し待って数回リトライする（同期的にブロックする sleep を使う）。
 */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
function renameWithRetry(from, to, attempts = 8, delayMs = 300) {
  for (let i = 0; i < attempts; i++) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (error) {
      const retryable = error.code === "EBUSY" || error.code === "EPERM";
      if (!retryable || i === attempts - 1) throw error;
      sleepSync(delayMs);
    }
  }
}

console.log("=== アトミックビルド開始 ===");
safeRemove(stagingDir); // 前回失敗時の残骸があれば掃除
fs.mkdirSync(stagingDir, { recursive: true });

// 手動管理ファイルを引き継ぐ（既存 pwa-dist にある場合のみ）
for (const f of CARRY_OVER_FILES) {
  const src = path.join(distDir, f);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(stagingDir, f));
  }
}

const env = { ...process.env, FORGE_PWA_DIST: ".pwa-dist-staging" };

try {
  console.log("--- build:pwa (staging) ---");
  run("bun", ["scripts/build-pwa.mjs"]);
} catch {
  fail("build:pwa が失敗しました（詳細は上のログを参照）");
}

try {
  console.log("--- build:css (staging) ---");
  run("npx", [
    "tailwindcss",
    "-i",
    "app/globals.css",
    "-o",
    path.join(stagingDir, "styles.css"),
    "--minify",
  ]);
} catch {
  fail("build:css が失敗しました（詳細は上のログを参照）");
}

try {
  console.log("--- build:static (staging) ---");
  run("node", ["scripts/build-static.mjs"]);
} catch {
  fail("build:static が失敗しました（詳細は上のログを参照）");
}

// 揃っているべきファイルの最終確認
const missing = REQUIRED_FILES.filter((f) => !fs.existsSync(path.join(stagingDir, f)));
if (missing.length > 0) {
  fail(`staging に必要なファイルが無い: ${missing.join(", ")}`);
}

// VERSION表示（従来のbuild:staticログと同じ情報をここでも出す）
const swText = fs.readFileSync(path.join(stagingDir, "sw.js"), "utf8");
const version = /const VERSION = "([^"]+)"/.exec(swText)?.[1] ?? "不明";

// 置き換え: 既存pwa-distをbackupへ退避 → stagingをpwa-distへ改名 → backup削除
console.log("--- pwa-dist を置き換え ---");
safeRemove(backupDir);
try {
  if (fs.existsSync(distDir)) {
    renameWithRetry(distDir, backupDir);
  }
  renameWithRetry(stagingDir, distDir);
  safeRemove(backupDir);
} catch (error) {
  // 置き換え失敗時、pwa-distが消えたままにしない（backupがあれば戻す）
  if (fs.existsSync(backupDir) && !fs.existsSync(distDir)) {
    try {
      renameWithRetry(backupDir, distDir);
    } catch {
      /* 復元も失敗した場合はエラーメッセージで手動対応を促す */
    }
  }
  fail(
    `pwa-dist の置き換えに失敗しました（${error.code ?? error.message}）。` +
      `他のプロセスがpwa-distを開いていないか確認してください` +
      `（プレビューサーバー・エクスプローラー等）。`
  );
}

console.log(`=== アトミックビルド完了（Service Worker: ${version}） ===`);
