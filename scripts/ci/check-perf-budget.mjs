/**
 * 運用整備（2026-07-31）で追加。配信物サイズの予算を超えていないか確認する。
 *
 * Lighthouse等は導入していない（新しい依存を増やさない方針・実行コストの割に
 * 単一利用者アプリでの価値が薄い）。ここではビルド済みファイルサイズの
 * 退行検出だけを見る。npm run build:all の後に実行すること。
 *
 * 実行:  node scripts/ci/check-perf-budget.mjs
 *        node scripts/ci/check-perf-budget.mjs --update-baseline （現在値で上書き）
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const budgetPath = path.join(root, "scripts", "ci", "perf-budget.json");
const budget = JSON.parse(fs.readFileSync(budgetPath, "utf8"));
const updateBaseline = process.argv.includes("--update-baseline");

let failed = false;
const measured = {};

/*
 * `*` を含むキーは、その形に一致するファイルの合計を見る。
 *
 * 画面を分けてからは bundle.js だけを見ても足りない。
 * 分けたぶんは chunk-*.js に移るので、bundle.js は小さいまま
 * 全体が太っていく、ということが起きうる。
 *   pwa-dist/bundle.js  … 起動のたびに読む量（ここが体感に直結する）
 *   pwa-dist/*.js       … 配信物全体の量
 * の両方を見る。
 */
function measureSize(rel) {
  if (!rel.includes("*")) {
    const full = path.join(root, rel);
    if (!fs.existsSync(full)) return undefined;
    return fs.statSync(full).size;
  }
  const dir = path.join(root, path.dirname(rel));
  if (!fs.existsSync(dir)) return undefined;
  const pattern = new RegExp(
    "^" + path.basename(rel).split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$"
  );
  const files = fs.readdirSync(dir).filter((f) => pattern.test(f));
  if (files.length === 0) return undefined;
  return files.reduce((sum, f) => sum + fs.statSync(path.join(dir, f)).size, 0);
}

for (const rel of Object.keys(budget.budgets)) {
  const size = measureSize(rel);
  if (size === undefined) {
    console.error(`✗ ${rel} が存在しない（npm run build:allを先に実行）`);
    failed = true;
    continue;
  }
  measured[rel] = size;
  const limit = budget.budgets[rel];
  const pct = ((size / limit) * 100).toFixed(0);
  if (size > limit) {
    console.error(
      `✗ ${rel}: ${size}バイト（予算${limit}バイトを超過・${pct}%）`
    );
    failed = true;
  } else {
    console.log(`  ${rel}: ${size}バイト（予算の${pct}%）`);
  }
}

if (updateBaseline) {
  const next = {
    ...budget,
    measuredAt: new Date().toISOString().slice(0, 10),
    measured,
    budgets: Object.fromEntries(
      Object.entries(measured).map(([k, v]) => [k, Math.round(v * 1.2)])
    ),
  };
  fs.writeFileSync(budgetPath, JSON.stringify(next, null, 2) + "\n");
  console.log("perf-budget.json を現在値+20%で更新しました");
  process.exit(0);
}

process.exit(failed ? 1 : 0);
