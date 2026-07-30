import { describe, it, expect } from "vitest";
import { checkApiAuth } from "@/lib/core/apiAuth";

describe("checkApiAuth（Next.js APIの認可判定）", () => {
  it("トークン未設定・開発環境なら通す（ローカル開発の摩擦を増やさない）", () => {
    const r = checkApiAuth({ token: undefined, provided: null, nodeEnv: "development" });
    expect(r.ok).toBe(true);
  });

  it("トークン未設定・環境不明（テスト等）でも通す", () => {
    const r = checkApiAuth({ token: undefined, provided: null, nodeEnv: undefined });
    expect(r.ok).toBe(true);
  });

  it("統合監査で追加: トークン未設定・本番相当なら閉じる（fail closed）", () => {
    const r = checkApiAuth({ token: undefined, provided: null, nodeEnv: "production" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(401);
      expect(r.message).toContain("FORGE_API_TOKEN");
    }
  });

  it("トークン設定済み・ヘッダ一致なら通す", () => {
    const r = checkApiAuth({ token: "secret", provided: "secret", nodeEnv: "production" });
    expect(r.ok).toBe(true);
  });

  it("トークン設定済み・ヘッダ不一致なら401", () => {
    const r = checkApiAuth({ token: "secret", provided: "wrong", nodeEnv: "production" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(401);
  });

  it("トークン設定済み・ヘッダ無しなら401", () => {
    const r = checkApiAuth({ token: "secret", provided: null, nodeEnv: "development" });
    expect(r.ok).toBe(false);
  });
});
