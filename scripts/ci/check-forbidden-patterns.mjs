/**
 * 運用整備（2026-07-31）で追加。CIで実行する。
 *
 * 禁止パターンの検出:
 * - @ts-ignore / @ts-expect-error（src/app/pwa/tests）: ゼロ件（既存も0件のため）
 * - test.only / it.only / describe.only / .skip（tests/*.test.ts）: ゼロ件
 * - ": any"（src/app/pwa、テスト除く）: ラチェット式。scripts/ci/any-baseline.json の
 *   件数を超えたら失敗する（増えたらCIが落ちる。減らすのは自由）。
 *
 * 実行:  node scripts/ci/check-forbidden-patterns.mjs
 *        node scripts/ci/check-forbidden-patterns.mjs --update-baseline （anyの現在数で上書き）
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const updateBaseline = process.argv.includes("--update-baseline");

function walk(dir, exts, exclude = []) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (exclude.some((e) => full.includes(e))) continue;
    if (entry.isDirectory()) {
      out.push(...walk(full, exts, exclude));
    } else if (exts.some((ext) => entry.name.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

const EXCLUDE = ["node_modules", "pwa-dist", ".next"];
const appFiles = [
  ...walk(path.join(root, "src"), [".ts", ".tsx"], EXCLUDE),
  ...walk(path.join(root, "app"), [".ts", ".tsx"], EXCLUDE),
  ...walk(path.join(root, "pwa"), [".ts", ".tsx"], EXCLUDE),
].filter((f) => !f.endsWith(".test.ts") && !f.endsWith(".test.tsx"));
const testFiles = walk(path.join(root, "tests"), [".ts"], EXCLUDE);
const allSourceFiles = [...appFiles, ...testFiles];

let failed = false;
const problems = [];

// 1. @ts-ignore / @ts-expect-error（ゼロ件）
for (const f of allSourceFiles) {
  const text = fs.readFileSync(f, "utf8");
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    if (/@ts-ignore|@ts-expect-error/.test(line)) {
      problems.push(`${path.relative(root, f)}:${i + 1}: @ts-ignore/@ts-expect-error は禁止`);
      failed = true;
    }
  });
}

// 2. test.only / it.only / describe.only / .skip（テストのみ・ゼロ件）
for (const f of testFiles) {
  const text = fs.readFileSync(f, "utf8");
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    if (/\b(describe|it|test)\.(only|skip)\s*\(/.test(line)) {
      problems.push(`${path.relative(root, f)}:${i + 1}: .only()/.skip() は禁止（恒常的な不具合を隠す）`);
      failed = true;
    }
  });
}

// 3. ": any"（ラチェット式）
let anyCount = 0;
for (const f of appFiles) {
  const text = fs.readFileSync(f, "utf8");
  const matches = text.match(/:\s*any\b/g);
  if (matches) anyCount += matches.length;
}

const baselinePath = path.join(root, "scripts", "ci", "any-baseline.json");
const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));

if (updateBaseline) {
  fs.writeFileSync(
    baselinePath,
    JSON.stringify({ ...baseline, count: anyCount }, null, 2) + "\n"
  );
  console.log(`baseline を ${anyCount} 件に更新しました`);
} else if (anyCount > baseline.count) {
  problems.push(
    `": any" が ${anyCount}件（基準 ${baseline.count}件から増加）。` +
      `正当な理由があれば --update-baseline で更新すること`
  );
  failed = true;
} else {
  console.log(`": any" ${anyCount}件（基準 ${baseline.count}件以内）`);
}

if (problems.length > 0) {
  console.error("\n=== 禁止パターン検出 ===");
  for (const p of problems) console.error(`  ${p}`);
}

process.exit(failed ? 1 : 0);
