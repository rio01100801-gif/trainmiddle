/**
 * 運用整備（2026-07-31）で追加。
 * scripts/ci/* が現在のリポジトリに対して正常終了することを確認する
 * （スクリプト自体が壊れていないかの回帰テスト。中身の詳細な単体テストではない）。
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "child_process";
import path from "path";

const root = path.resolve(__dirname, "..");

function run(script: string): { code: number; out: string } {
  try {
    const out = execFileSync("node", [path.join(root, script)], {
      cwd: root,
      encoding: "utf8",
    });
    return { code: 0, out };
  } catch (error: unknown) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, out: (e.stdout ?? "") + (e.stderr ?? "") };
  }
}

describe("scripts/ci/* が現在のリポジトリに対して通る", () => {
  it("check-secrets.mjs", () => {
    const r = run("scripts/ci/check-secrets.mjs");
    expect(r.code, r.out).toBe(0);
  });

  it("check-forbidden-patterns.mjs", () => {
    const r = run("scripts/ci/check-forbidden-patterns.mjs");
    expect(r.code, r.out).toBe(0);
  });

  it("check-api-shim-parity.mjs", () => {
    const r = run("scripts/ci/check-api-shim-parity.mjs");
    expect(r.code, r.out).toBe(0);
  });
});
