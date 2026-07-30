/**
 * 運用整備（2026-07-31）で追加。簡易的な秘密情報の埋め込み検査。
 *
 * 高度な検出（gitleaks等）は入れていない（新しい依存を増やさない方針）。
 * 「実際に値が埋め込まれている」典型パターンだけを見る、best-effortの網。
 * ここを通っても秘密が無い保証にはならない——最終的な確認はコードレビューで行う。
 *
 * 実行:  node scripts/ci/check-secrets.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const EXCLUDE_DIRS = ["node_modules", ".git", ".next", "pwa-dist", "shots"];
const SCAN_EXTS = [".ts", ".tsx", ".mjs", ".js", ".json", ".md", ".sql", ".html", ".txt"];

// このファイル自身は誤検知の元になるパターン文字列を含むため除外する
const SELF = path.relative(root, fileURLToPath(import.meta.url));

const PATTERNS = [
  { name: "AWSアクセスキー", re: /AKIA[0-9A-Z]{16}/ },
  { name: "PEM秘密鍵ヘッダ", re: /-----BEGIN (RSA |EC |)PRIVATE KEY-----/ },
  { name: "Supabase Secret Key", re: /sb_secret_[A-Za-z0-9_-]{10,}/ },
  {
    name: "Supabase service_role JWTらしき値の代入",
    re: /(service_role|SERVICE_ROLE)[^\n]{0,40}["']eyJ[A-Za-z0-9_-]{20,}\./,
  },
  {
    name: "GitHub Personal Access Token",
    re: /gh[ps]_[A-Za-z0-9]{20,}/,
  },
];

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDE_DIRS.includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full));
    } else if (SCAN_EXTS.some((ext) => entry.name.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

const files = walk(root);
const problems = [];

for (const f of files) {
  const rel = path.relative(root, f);
  if (rel === SELF) continue;
  const text = fs.readFileSync(f, "utf8");
  for (const { name, re } of PATTERNS) {
    const m = re.exec(text);
    if (m) {
      const line = text.slice(0, m.index).split("\n").length;
      // 値そのものは出さない（検出したことと種類・場所だけ）
      problems.push(`${rel}:${line}: ${name}らしき値を検出`);
    }
  }
}

if (problems.length > 0) {
  console.error("=== 秘密情報らしき値を検出 ===");
  for (const p of problems) console.error(`  ${p}`);
  console.error(
    "\n実際に秘密情報であれば、コミットからの削除に加えて該当キーの失効・再発行が必要です。"
  );
  process.exit(1);
}
console.log(`秘密情報の簡易検査OK（${files.length}ファイル走査）`);
