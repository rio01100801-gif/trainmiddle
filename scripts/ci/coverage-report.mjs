/**
 * カバレッジの読み方を1つに決める。
 *
 * `npm run test:coverage` が出す数字を、**どこが検証されていないか**の順に並べる。
 * 全体の%だけを見ると「92%あるから十分」で終わり、どの分岐が空白なのか分からない。
 *
 * 見るのは branch を主にする。line は「その行を通った」しか言わないので、
 * if の片側しか踏んでいなくても緑になる。ルールエンジンや期分けは
 * **分岐そのものが仕様**なので、line だけでは何も保証していない。
 */
import fs from "node:fs";
import path from "node:path";

const summaryPath = path.resolve("coverage/coverage-summary.json");
if (!fs.existsSync(summaryPath)) {
  console.error("coverage/coverage-summary.json がありません。先に npm run test:coverage を実行してください。");
  process.exit(1);
}
const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));

const rows = [];
for (const [file, v] of Object.entries(summary)) {
  if (file === "total") continue;
  const normalized = file.split(path.sep).join("/");
  const short = normalized.includes("/src/lib/")
    ? normalized.slice(normalized.indexOf("/src/lib/") + "/src/lib/".length)
    : normalized;
  rows.push({
    file: short,
    branchPct: v.branches.pct,
    linePct: v.lines.pct,
    funcPct: v.functions.pct,
    uncoveredBranches: v.branches.total - v.branches.covered,
    uncoveredFuncs: v.functions.total - v.functions.covered,
  });
}

const t = summary.total;
console.log("=== 全体 ===");
for (const key of ["lines", "branches", "functions", "statements"]) {
  console.log(
    `  ${key.padEnd(11)} ${String(t[key].pct).padStart(6)}%  (${t[key].covered}/${t[key].total})`
  );
}

console.log("\n=== 未検証の分岐が多い順（上位15） ===");
console.log("  未検証  ファイル                              branch   line   func");
for (const r of [...rows].sort((a, b) => b.uncoveredBranches - a.uncoveredBranches).slice(0, 15)) {
  if (r.uncoveredBranches === 0) break;
  console.log(
    `  ${String(r.uncoveredBranches).padStart(5)}  ${r.file.padEnd(36)}` +
      `${String(r.branchPct).padStart(6)}%${String(r.linePct).padStart(7)}%${String(r.funcPct).padStart(7)}%`
  );
}

console.log("\n=== 一度も呼ばれていない関数が多い順（上位10） ===");
for (const r of [...rows].sort((a, b) => b.uncoveredFuncs - a.uncoveredFuncs).slice(0, 10)) {
  if (r.uncoveredFuncs === 0) break;
  console.log(`  ${String(r.uncoveredFuncs).padStart(4)}  ${r.file}`);
}
