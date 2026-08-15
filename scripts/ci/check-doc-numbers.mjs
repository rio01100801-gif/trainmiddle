/**
 * 文書に「いまの数字」を手で書くのを禁止する。
 *
 * 何度も同じことが起きた。
 *   ・`AGENTS.md` と `README.md` は「574件」のまま、実際は3倍近くあった
 *   ・「574件は古い。次に触るとき直す」という注記自体が放置された
 *     （その注記を書いた時点の実数は804件で、それも今は違う）
 *   ・README は Supabase 同期を実装したあとも「クラウド保存は未実装」のままだった
 *
 * **手で直す運用はすでに失敗している。** 数字を書き換えるだけでは同じことが起きるので、
 * 書けないようにする。知りたい値は必ずコマンドの出力から取る。
 *
 * 例外は `CHANGELOG.md`。あれは**その時点の事実の記録**なので、
 * 当時の件数・版数が書いてあってよい（むしろ書き換えてはいけない）。
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");

/** 過去の記録なので数字を残してよいもの */
const HISTORY_FILES = new Set(["CHANGELOG.md"]);

const TARGET_DIRS = [".", "docs"];

const RULES = [
  {
    // 「1438件のテスト」「574件 / 52ファイル」など
    pattern: /(?<![0-9])\d{2,5}\s*件(?=\s*(?:\/|のテスト|・|）|\)|$|\s))/gu,
    why: "テスト件数は文書に書かない。`npm test` の出力を見る",
    // 「33ルート」「312ファイル走査」のような、テストと無関係な件数まで拾わないための除外
    allowNear: /ルート|走査|違反|不具合|報告|項目|所|箇所|回|本|日|週|km|秒|px|pt|MB|KB/u,
  },
  {
    // 「現在は forge-v45」のように、いまの版を名指ししているもの
    pattern: /(?:現在|いま|最新|配信中)[^\n]{0,12}forge-v\d+/gu,
    why: "配信中の版は文書に書かない。`pwa/sw.js` の VERSION が唯一の正",
  },
];

const problems = [];

for (const dir of TARGET_DIRS) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) continue;
  for (const name of fs.readdirSync(abs)) {
    if (!name.endsWith(".md")) continue;
    if (HISTORY_FILES.has(name)) continue;
    const rel = path.join(dir, name).split(path.sep).join("/");
    const text = fs.readFileSync(path.join(abs, name), "utf8");
    const lines = text.split("\n");

    for (const rule of RULES) {
      lines.forEach((line, i) => {
        // 禁止そのものを説明している行は対象外（この検査の説明文で落ちないように）
        if (line.includes("書かない") || line.includes("書き写さない")) return;
        for (const m of line.matchAll(rule.pattern)) {
          if (rule.allowNear) {
            const after = line.slice(m.index + m[0].length, m.index + m[0].length + 12);
            if (rule.allowNear.test(after)) continue;
            const before = line.slice(Math.max(0, m.index - 12), m.index);
            if (rule.allowNear.test(before)) continue;
          }
          problems.push(`${rel}:${i + 1}  「${m[0].trim()}」 — ${rule.why}`);
        }
      });
    }
  }
}

if (problems.length > 0) {
  console.error("文書に手書きの数字があります:\n");
  for (const p of problems) console.error("  " + p);
  console.error(
    "\n手で直す運用はすでに失敗しています（README/AGENTS が574件のまま放置された）。" +
      "\n数字を書き換えるのではなく、出どころのコマンドを案内してください。" +
      "\n過去の記録として残したい場合は CHANGELOG.md に書いてください。"
  );
  process.exit(1);
}

console.log("文書に手書きの数字なしOK（CHANGELOG.md は過去の記録なので対象外）");
