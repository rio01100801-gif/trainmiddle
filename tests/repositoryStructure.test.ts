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

    expect(entry).toContain('import SharedDataPage from "../app/data/page"');
    expect(page).toContain("export default function DataPage()");
  });

  it("画面用ヘルパーにNext.js予約名のroute.tsを使わない", () => {
    expect(existsSync(path.join(root, "app", "components", "route.ts"))).toBe(false);
    expect(existsSync(path.join(root, "app", "components", "route-query.ts"))).toBe(true);
  });
});
