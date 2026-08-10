import { describe, expect, it } from "vitest";
import { apiRequest } from "../app/components/api-client";

describe("API変更操作の成功判定", () => {
  it("2xxのJSONだけを成功として返す", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({ ok: true }), { status: 200 });
    await expect(apiRequest("/api/test", undefined, { fetchImpl })).resolves.toEqual({ ok: true });
  });

  it("HTTP 400のエラーを成功扱いしない", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({ error: "端末へ保存できません" }), { status: 400 });
    await expect(apiRequest("/api/test", undefined, { fetchImpl })).rejects.toThrow(
      "端末へ保存できません"
    );
  });

  it("HTTP 200でもerror本文があれば成功扱いしない", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({ error: "永続化に失敗しました" }), { status: 200 });
    await expect(apiRequest("/api/test", undefined, { fetchImpl })).rejects.toThrow(
      "永続化に失敗しました"
    );
  });
});
