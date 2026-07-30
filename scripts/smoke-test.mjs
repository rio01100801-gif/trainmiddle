/**
 * 配信後スモークテスト（運用整備、2026-07-31で追加）。
 *
 * 公開URL（既定: README記載のGitHub Pages）に対して、非破壊的なHTTP GETだけを行う。
 * 書き込み系操作・Googleログインの完遂・実際の健康データの使用は一切しない
 * （instructions通り）。ブラウザでの実際の描画・操作確認（4タブ表示・初期化・
 * console error等）は npm run e2e / npm run e2e:update が同じビルド成果物
 * （pwa-dist）に対してローカルで既に行っているため、ここでは重複させない。
 * このスクリプトは「配信されたものが取得可能で、壊れていないか」だけを見る。
 *
 * 実行:  node scripts/smoke-test.mjs
 *        node scripts/smoke-test.mjs https://example.com/  （別環境を指定）
 */
const target = process.argv[2] ?? "https://rio01100801-gif.github.io/trainmiddle/";
const base = target.endsWith("/") ? target : `${target}/`;

// GitHub Pagesの反映遅延を考慮したタイムアウト（無限待機しない）
const TIMEOUT_MS = 15000;

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal, cache: "no-store" });
  } finally {
    clearTimeout(timer);
  }
}

const checks = [];
function record(name, ok, detail) {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

console.log(`=== スモークテスト対象: ${base} ===\n`);

let html;
try {
  const res = await fetchWithTimeout(base);
  record("index.html 取得", res.ok, `HTTP ${res.status}`);
  html = res.ok ? await res.text() : "";
} catch (error) {
  record("index.html 取得", false, String(error.message ?? error));
  html = "";
}

// index.htmlが参照しているアセットが実在するかを見る（古いhash参照が残っていないか）
const assetRefs = new Set();
for (const m of html.matchAll(/(?:src|href)="(\.\/[a-zA-Z0-9_.-]+)"/g)) {
  assetRefs.add(m[1].replace(/^\.\//, ""));
}
// バージョンクエリは除いて比較（?v=forge-vNN はキャッシュバスト用）
const namedAssets = [...assetRefs].map((a) => a.split("?")[0]);

for (const asset of namedAssets) {
  try {
    const res = await fetchWithTimeout(base + asset);
    const ct = res.headers.get("content-type") ?? "(無し)";
    record(`asset: ${asset}`, res.ok, `HTTP ${res.status} / ${ct}`);
  } catch (error) {
    record(`asset: ${asset}`, false, String(error.message ?? error));
  }
}

// build-info.json（存在すれば読む。旧配信物には無い可能性があるため必須にしない）
try {
  const res = await fetchWithTimeout(base + "build-info.json");
  if (res.ok) {
    const info = await res.json();
    record(
      "build-info.json",
      typeof info.version === "string",
      `version=${info.version} commit=${info.commit}`
    );
  } else {
    console.log(`  (build-info.json 無し・HTTP ${res.status}。旧配信物の可能性）`);
  }
} catch {
  console.log("  (build-info.json 取得失敗。旧配信物の可能性）");
}

// manifest.webmanifestの内容が妥当なJSONか
try {
  const res = await fetchWithTimeout(base + "manifest.webmanifest");
  const json = res.ok ? await res.json() : null;
  record("manifest.webmanifest が妥当なJSON", !!json?.name, json ? `name=${json.name}` : "");
} catch (error) {
  record("manifest.webmanifest が妥当なJSON", false, String(error.message ?? error));
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n=== ${checks.length - failed.length}/${checks.length} 件OK ===`);
if (failed.length > 0) {
  console.error(
    "失敗あり。配信を続けるかロールバックするかは、失敗の種類（一時的なCDN反映遅延か、" +
      "本当に壊れているか）を見て判断してください。数分待って再実行するのも有効です。"
  );
  process.exit(1);
}
