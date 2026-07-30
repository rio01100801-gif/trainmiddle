/**
 * リリース前チェック（運用整備、2026-07-31で追加）。
 *
 * このスクリプトは常にdry-runで、git の commit / push は一切行わない。
 * 「何が起きるか」を実行前に見せるためのもの。実際の commit / push は、
 * これまでどおり本人が確認したうえで手で行う（CLAUDE.mdの「締め」手順）。
 *
 * やること:
 *   1. worktreeの状態（clean/dirty）を表示
 *   2. VERSION（pwa/sw.js）を、HEADにコミット済みの値・gh-pagesに配信済みの値と比較
 *   3. npm run verify を実行（失敗したらここで止める。以降は実行しない）
 *   4. npm run build:all を実行（アトミック。失敗しても pwa-dist は壊れない）
 *   5. pwa-dist の差分を表示
 *   6. コミットメッセージ候補・main/gh-pagesへの操作予定を「表示するだけ」
 *   7. ロールバック対象（現在のHEAD）を記録
 *
 * 実行:  node scripts/release-check.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function sh(cmd, opts = {}) {
  return execSync(cmd, { cwd: root, encoding: "utf8", ...opts }).trim();
}
function shOk(cmd) {
  try {
    return { ok: true, out: sh(cmd) };
  } catch (error) {
    return { ok: false, out: error.stdout?.toString().trim() ?? String(error.message) };
  }
}

console.log("=== リリース前チェック（dry-run。commit/pushは行いません） ===\n");

// 1. worktree状態
const status = sh("git status --porcelain");
const rollbackTarget = sh("git rev-parse HEAD");
console.log(`現在のHEAD（ロールバック対象として記録）: ${rollbackTarget}`);
if (status) {
  console.log("worktree: 変更あり（これがリリース対象の差分になります）");
  console.log(
    status
      .split("\n")
      .map((l) => `  ${l}`)
      .join("\n")
  );
} else {
  console.log("worktree: clean（コミットする変更がありません）");
}

// 2. VERSION比較
console.log("\n--- VERSION比較 ---");
const swPath = path.join(root, "pwa", "sw.js");
const currentVersion = /const VERSION = "([^"]+)"/.exec(
  fs.readFileSync(swPath, "utf8")
)?.[1];
console.log(`作業ツリーのVERSION: ${currentVersion}`);

const headSw = shOk("git show HEAD:pwa/sw.js");
const headVersion = headSw.ok
  ? /const VERSION = "([^"]+)"/.exec(headSw.out)?.[1]
  : "(取得失敗)";
console.log(`HEADにコミット済みのVERSION: ${headVersion}`);

sh("git fetch origin gh-pages --quiet").length; // 失敗しても続行（オフライン等）
const ghPagesSw = shOk("git show origin/gh-pages:sw.js");
const ghPagesVersion = ghPagesSw.ok
  ? /const VERSION = "([^"]+)"/.exec(ghPagesSw.out)?.[1]
  : "(取得失敗。オフラインまたはgh-pages未取得)";
console.log(`gh-pagesに配信済みのVERSION: ${ghPagesVersion}`);

if (currentVersion === headVersion && currentVersion === ghPagesVersion) {
  console.log(
    "⚠ 3つとも同じVERSIONです。今回リリースする変更があるなら、VERSIONを上げ忘れている可能性があります。"
  );
}

// 3. verify
console.log("\n--- npm run verify ---");
console.log("(typecheck → test → build:all → e2e → e2e:update。数分かかります)");
const verify = shOk("npm run verify");
if (!verify.ok) {
  console.error("\n✗ npm run verify が失敗しました。ここで停止します。");
  console.error(verify.out.split("\n").slice(-40).join("\n"));
  process.exit(1);
}
console.log("✓ npm run verify 成功");

// 4. build:all は verify に含まれるため、ここでは差分だけ確認
console.log("\n--- pwa-dist の差分（コミットされる内容） ---");
const diffStat = sh("git diff --stat -- pwa-dist || true");
console.log(diffStat || "(差分なし。VERSIONを上げ忘れていないか確認してください)");

// 5. コミットメッセージ候補・操作予定（表示のみ）
console.log("\n--- 実行予定の操作（表示のみ・実行しません） ---");
console.log("1) git add -A");
console.log('2) git commit -m "<変更内容を1行で>"');
console.log("3) git push origin main");
console.log(
  '4) git push origin $(git commit-tree main:pwa-dist -p origin/gh-pages -m "deploy: ' +
    currentVersion +
    '"):gh-pages'
);
console.log(
  "\n※ 4番目はmainとは別に、pwa-distの中身だけをgh-pagesへ積む方式（既存の運用を維持）。"
);
console.log(
  `※ ロールバックする場合は、mainを ${rollbackTarget} に戻し、gh-pagesも同様の commit-tree で古い pwa-dist から作り直してください。`
);

console.log("\n=== dry-run完了。上記を確認のうえ、本人が実際のcommit/pushを行ってください ===");
