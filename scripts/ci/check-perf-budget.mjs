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

for (const rel of Object.keys(budget.budgets)) {
  const full = path.join(root, rel);
  if (!fs.existsSync(full)) {
    console.error(`✗ ${rel} が存在しない（npm run build:allを先に実行）`);
    failed = true;
    continue;
  }
  const size = fs.statSync(full).size;
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
