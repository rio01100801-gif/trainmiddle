import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..");

describe("画面ファイルのリポジトリ構造", () => {
  it("実行時DBだけをignoreし、app/data画面は追跡対象にする", () => {
    const ignoreRules = readFileSync(path.join(root, ".gitignore"), "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    expect(ignoreRules).toContain("/data/");
    expect(ignoreRules).not.toContain("data/");
  });

  it("PWAのデータ管理routeが共通画面を参照する", () => {
    const entry = readFileSync(path.join(root, "pwa", "entry.tsx"), "utf8");
    const page = readFileSync(path.join(root, "app", "data", "page.tsx"), "utf8");

    /*
     * 見たいのは「共通画面を使い回しているか」であって、importの書き方ではない。
     * 静的importに固定していると、遅延読み込みへ変えただけで落ちる
     * （実際 forge-v80 で画面をchunkに分けたときに落ちた）。
     * 参照していること + 画面側で描画していること、の2点で見る。
     */
    expect(entry).toMatch(/import\(["']\.\.\/app\/data\/page["']\)|from ["']\.\.\/app\/data\/page["']/);
    expect(entry).toContain("<SharedDataPage />");
    expect(page).toContain("export default function DataPage()");
  });

  it("画面用ヘルパーにNext.js予約名のroute.tsを使わない", () => {
    expect(existsSync(path.join(root, "app", "components", "route.ts"))).toBe(false);
    expect(existsSync(path.join(root, "app", "components", "route-query.ts"))).toBe(true);
  });
});
