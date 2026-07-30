/**
 * 運用整備（2026-07-31）で追加。
 *
 * pwa/sw.js（ソース）と pwa-dist/sw.js（配信物）のVERSIONが一致しているかを見る。
 * ズレる典型例: pwa/sw.js のVERSIONだけ上げて npm run build:all を忘れたままcommitした
 * （更新が端末に届かない、CLAUDE.mdで最も強く警告されている失敗）。
 *
 * このテストはビルド済みの pwa-dist/ を前提にする（npm run verify は
 * build:all の後に test を走らせる想定のため、通常の実行順では問題にならない）。
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const root = path.resolve(__dirname, "..");

function extractVersion(swPath: string): string | undefined {
  const text = fs.readFileSync(swPath, "utf8");
  return /const VERSION = "([^"]+)"/.exec(text)?.[1];
}

describe("配信物のVERSION整合性", () => {
  it("pwa-dist/build-info.jsonが存在し、必要なキーを持つ", () => {
    const infoPath = path.join(root, "pwa-dist", "build-info.json");
    expect(fs.existsSync(infoPath)).toBe(true);
    const info = JSON.parse(fs.readFileSync(infoPath, "utf8"));
    expect(typeof info.version).toBe("string");
    expect(typeof info.commit).toBe("string");
    expect(typeof info.builtAt).toBe("string");
  });

  it("pwa/sw.jsとpwa-dist/sw.jsのVERSIONが一致する（ビルド忘れ検出）", () => {
    const sourceVersion = extractVersion(path.join(root, "pwa", "sw.js"));
    const shippedVersion = extractVersion(path.join(root, "pwa-dist", "sw.js"));
    expect(sourceVersion).toBeDefined();
    expect(shippedVersion).toBeDefined();
    expect(shippedVersion).toBe(sourceVersion);
  });

  it("pwa-dist/build-info.jsonのversionもpwa/sw.jsと一致する", () => {
    const sourceVersion = extractVersion(path.join(root, "pwa", "sw.js"));
    const info = JSON.parse(
      fs.readFileSync(path.join(root, "pwa-dist", "build-info.json"), "utf8")
    );
    expect(info.version).toBe(sourceVersion);
  });
});
