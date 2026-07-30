/**
 * 運用整備（2026-07-31）で追加。
 *
 * CLAUDE.mdの原則「app/api/<name>/route.ts と pwa/api-shim.ts の routes は
 * 必ず対で書く」を機械的に確認する。片方だけ足すと、Next.js版かPWA版の
 * どちらかで静かに動かなくなる（画面には出ない）。
 *
 * 実行:  node scripts/ci/check-api-shim-parity.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const apiDir = path.join(root, "app", "api");
const routeDirs = fs
  .readdirSync(apiDir, { withFileTypes: true })
  .filter((e) => e.isDirectory() && fs.existsSync(path.join(apiDir, e.name, "route.ts")))
  .map((e) => `/api/${e.name}`)
  .sort();

const shimText = fs.readFileSync(path.join(root, "pwa", "api-shim.ts"), "utf8");
const shimRoutes = [...shimText.matchAll(/"(\/api\/[a-zA-Z0-9_-]+)"/g)]
  .map((m) => m[1])
  .filter((v, i, arr) => arr.indexOf(v) === i)
  .sort();

const onlyInNextApi = routeDirs.filter((r) => !shimRoutes.includes(r));
const onlyInShim = shimRoutes.filter((r) => !routeDirs.includes(r));

let failed = false;
if (onlyInNextApi.length > 0) {
  console.error("app/api/*/route.ts にあるが pwa/api-shim.ts に無い:");
  for (const r of onlyInNextApi) console.error(`  ${r}`);
  failed = true;
}
if (onlyInShim.length > 0) {
  console.error("pwa/api-shim.ts にあるが app/api/*/route.ts に無い:");
  for (const r of onlyInShim) console.error(`  ${r}`);
  failed = true;
}

if (!failed) {
  console.log(`Next.js API と PWA shim の対応OK（${routeDirs.length}ルート）`);
}
process.exit(failed ? 1 : 0);
