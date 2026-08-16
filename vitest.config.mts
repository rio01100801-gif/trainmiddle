import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

/*
 * 閾値は別ファイルに置く。
 * 設定に直接書くと、下げたことが設定の変更に紛れて見えなくなる。
 * 数字だけのファイルなら、差分に「下げた」がそのまま出る。
 */
const thresholds = JSON.parse(
  fs.readFileSync(path.resolve(root, "scripts/ci/coverage-thresholds.json"), "utf8")
);
// 説明文はファイルの中に置く（別ファイルに逃がすと、数字だけ見て意味を忘れる）
delete thresholds._comment;

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    /*
     * カバレッジ。
     *
     * 目的は「何%あるか」ではなく **どこが検証されていないかを知ること**。
     * テストは1400件以上あるが、どこが厚くてどこが薄いのかが分からない状態だった。
     *
     * 閾値は**測った現在値をそのまま下限**にしてある。
     * 根拠なく90%のような数字を置かない——通らない閾値は無視されるようになり、
     * 結局なにも守らなくなる。下げないことだけを保証して、直すたびに手で上げる。
     *
     * line だけでなく branch と function も見る。
     * line だけだと「通ったが分岐の片側しか踏んでいない」が隠れる。
     * ルールエンジンや期分けは分岐そのものが仕様なので、そこが見えないと意味がない。
     */
    coverage: {
      provider: "v8",
      // json は「どの行のどの分岐が空いているか」を出すのに要る（coverage-report.mjs の相棒）
      reporter: ["text-summary", "json-summary", "json", "html"],
      reportsDirectory: "coverage",
      /*
       * 画面（app/）は入れない。node環境のユニットテストからは実行されないので、
       * 入れると0%が並んで全体の数字が意味を失う。画面はE2Eが見ている。
       */
      include: ["src/lib/**/*.ts"],
      exclude: ["src/lib/**/index.ts", "src/lib/**/*.d.ts"],
      thresholds,
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(root, "src"),
    },
  },
});
