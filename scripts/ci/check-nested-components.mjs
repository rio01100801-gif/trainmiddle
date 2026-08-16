/**
 * コンポーネントの中でコンポーネントを定義していないか見張る。
 *
 * これは FORGE で一番たちの悪い不具合の作り方。
 *
 *   function Form() {
 *     const L = ({ children }) => <label>{children}</label>;   // ダメ
 *     return <L><input /></L>;
 *   }
 *
 * 再描画のたびに `L` が別の関数になるので、React は中身の `<input>` を
 * 「別の要素」と見て作り直す。フォーカスが外れ、iOSでは1文字打つたびに
 * キーボードが閉じる。**画面には何も出ないので気づけない。**
 *
 * E2Eの N-1 が見張っているが、あれは `設定(秒)` の欄1つだけ。
 * 部品を切り出すたびに検査を足していくのは追いつかないので、
 * **形のほうを禁じる**。欄が増えても勝手に守られる。
 *
 * 判定: 字下げされた位置にある大文字始まりの関数宣言で、JSXを返しているもの。
 * モジュール直下のコンポーネントは字下げ0なので引っかからない。
 */
import fs from "node:fs";
import path from "node:path";

const ROOTS = ["app", "pwa"];
const ROOT = path.resolve(import.meta.dirname, "../..");

/** 大文字始まり＝コンポーネント。字下げがある＝何かの中 */
const NESTED_DECL =
  /^(\s+)(?:const|let|function)\s+([A-Z][A-Za-z0-9_]*)\s*(?:=\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::[^=]+)?=>|\()/;

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      walk(full, out);
    } else if (name.endsWith(".tsx")) {
      out.push(full);
    }
  }
  return out;
}

const problems = [];
for (const root of ROOTS) {
  const abs = path.join(ROOT, root);
  if (!fs.existsSync(abs)) continue;
  for (const file of walk(abs)) {
    const rel = path.relative(ROOT, file).split(path.sep).join("/");
    const lines = fs.readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      const m = NESTED_DECL.exec(line);
      if (!m) return;
      // 次の数行にJSXがあればコンポーネント。無ければただの関数・定数
      const ahead = lines.slice(i, i + 6).join("\n");
      if (!/<[A-Za-z][\w.]*[\s/>]/.test(ahead)) return;
      problems.push(
        `${rel}:${i + 1}  ${m[2]} — 関数の中でコンポーネントを定義しています`
      );
    });
  }
}

if (problems.length > 0) {
  console.error("コンポーネントの中でコンポーネントを定義しています:\n");
  for (const p of problems) console.error("  " + p);
  console.error(
    "\n再描画のたびに別の関数になるので、React が中身の input を作り直します。" +
      "\n入力中にフォーカスが外れ、iOSでは1文字打つたびにキーボードが閉じます。" +
      "\n**画面には何も出ないので気づけません。**" +
      "\n\nモジュール直下（字下げ0）に出して、必要な値は props で渡してください。"
  );
  process.exit(1);
}

console.log("入れ子のコンポーネントなしOK");
