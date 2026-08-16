/**
 * workflow.ts の未検証の分岐が、どの関数に集まっているかを出す。
 *
 * 「194本ある」だけでは手が付けられない。関数ごとにまとめれば、
 * どこから埋めれば効くかが決まる。
 */
import fs from "node:fs";

import path from "node:path";

const R = path.resolve(import.meta.dirname, "../..") + "/";
const cov = JSON.parse(fs.readFileSync(R + "coverage/coverage-final.json", "utf8"));
/** 既定は一番空いているファイル。引数で `core/backfill.ts` のように切り替えられる */
const target = process.argv[2] ?? "service/workflow.ts";
const key = Object.keys(cov).find((k) => k.replace(/\\/g, "/").endsWith(target));
if (!key) {
  console.error(target + " がカバレッジに無い。先に npm run test:coverage を実行してください。");
  process.exit(1);
}
const file = cov[key];

const src = fs.readFileSync(R + "src/lib/" + target, "utf8").split("\n");
const DECL = /^(?:export\s+)?(?:async\s+)?(?:function|const)\s+([A-Za-z_$][\w$]*)/;
const decls = [];
src.forEach((l, i) => {
  const m = DECL.exec(l);
  if (m) decls.push({ name: m[1], line: i + 1 });
});
const nameAt = (line) => {
  let found = "（トップレベル）";
  for (const d of decls) {
    if (d.line <= line) found = d.name;
    else break;
  }
  return found;
};

// 未検証の分岐を関数ごとに数える
const perFn = new Map();
for (const [id, counts] of Object.entries(file.b)) {
  const loc = file.branchMap[id];
  const line = loc?.loc?.start?.line ?? loc?.line;
  if (!line) continue;
  const missed = counts.filter((c) => c === 0).length;
  if (missed === 0) continue;
  const fn = nameAt(line);
  const cur = perFn.get(fn) ?? { branches: 0, lines: new Set() };
  cur.branches += missed;
  cur.lines.add(line);
  perFn.set(fn, cur);
}

// 一度も呼ばれていない関数
const neverCalled = [];
for (const [id, count] of Object.entries(file.f)) {
  if (count > 0) continue;
  const loc = file.fnMap[id];
  const line = loc?.decl?.start?.line;
  neverCalled.push(loc?.name || nameAt(line ?? 0));
}

console.log("=== 未検証の分岐が多い関数（上位12） ===");
const rows = [...perFn].sort((a, b) => b[1].branches - a[1].branches).slice(0, 12);
for (const [fn, v] of rows) {
  const lines = [...v.lines].sort((a, b) => a - b);
  console.log(
    `  ${String(v.branches).padStart(3)}本  ${fn.padEnd(28)} 行 ${lines[0]}〜${lines[lines.length - 1]}`
  );
}
console.log(`\n=== 一度も呼ばれていない関数（${neverCalled.length}個） ===`);
console.log("  " + neverCalled.slice(0, 20).join(", "));
