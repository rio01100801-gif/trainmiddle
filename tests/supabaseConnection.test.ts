import { describe, expect, it } from "vitest";
import {
  clearSyncConfig,
  fetchSnapshot,
  getLastSynced,
  getSession,
  getSyncConfig,
  parseAuthRedirectHash,
  putSnapshot,
  saveLastSynced,
  saveSession,
  saveSyncConfig,
  testConnection,
} from "../app/components/supabase";
import { fakeJwt } from "./helpers";

const KEY = "sb_publishable_1234567890123456789012_12345678";

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

describe("Supabase設定の保存", () => {
  it("初回保存後に再読込した値が一致する", () => {
    const storage = new MemoryStorage();
    const saved = saveSyncConfig(
      {
        url: " https://FIRST.supabase.co/ \n",
        anonKey: ` ${KEY}\n`,
      },
      storage
    );

    expect(saved.config).toEqual({
      url: "https://first.supabase.co",
      anonKey: KEY,
    });
    expect(getSyncConfig(storage)).toEqual(saved.config);
  });

  it("間違ったURLから正しいURLへ変更すると古い値と旧セッションを残さない", () => {
    const storage = new MemoryStorage();
    saveSyncConfig({ url: "https://wrong.supabase.co", anonKey: KEY }, storage);
    saveSession({ accessToken: "old-project-token" }, storage);
    saveLastSynced({ exportedAt: "2026-07-27T00:00:00Z", totalCount: 10 }, storage);

    const saved = saveSyncConfig(
      { url: "https://correct.supabase.co/", anonKey: KEY },
      storage
    );

    expect(saved.changed).toBe(true);
    expect(getSyncConfig(storage).url).toBe("https://correct.supabase.co");
    expect(getSession(storage)).toBeUndefined();
    expect(getLastSynced(storage)).toBeUndefined();
  });

  it("ページ再読込・PWA再起動相当でもlocalStorageから同じ設定を読む", () => {
    const storage = new MemoryStorage();
    saveSyncConfig({ url: "https://reload.supabase.co", anonKey: KEY }, storage);

    expect(getSyncConfig(storage)).toEqual({
      url: "https://reload.supabase.co",
      anonKey: KEY,
    });
  });

  it("保存領域が拒否した場合は成功扱いにせず例外にする", () => {
    const storage = new MemoryStorage();
    storage.setItem = () => {
      throw new Error("quota denied");
    };

    expect(() =>
      saveSyncConfig({ url: "https://fail.supabase.co", anonKey: KEY }, storage)
    ).toThrow("保存領域へ書き込めませんでした");
  });

  it("接続設定だけを消し、他のlocalStorage値は残す", () => {
    const storage = new MemoryStorage();
    storage.setItem("forge:unrelated", "keep");
    saveSyncConfig({ url: "https://clear.supabase.co", anonKey: KEY }, storage);
    saveSession({ accessToken: "token" }, storage);

    clearSyncConfig(storage);

    expect(getSyncConfig(storage)).toEqual({});
    expect(getSession(storage)).toBeUndefined();
    expect(storage.getItem("forge:unrelated")).toBe("keep");
  });
});

describe("Supabase実接続テスト", () => {
  it("Auth settingsのJSONを確認して初めて成功にする", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({ external: { google: true } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });

    const result = await testConnection(
      { url: "https://ok.supabase.co/", anonKey: KEY },
      { fetchImpl }
    );

    expect(result.ok).toBe(true);
    expect(result.urlHost).toBe("ok.supabase.co");
    expect(result.status).toBe(200);
  });

  it("HTTP成功でもSupabase Authの応答でなければ失敗にする", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({ hello: "world" }), { status: 200 });

    const result = await testConnection(
      { url: "https://wrong-response.supabase.co", anonKey: KEY },
      { fetchImpl }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("response");
  });

  it("不正なKeyの401をURL障害と区別する", async () => {
    const fetchImpl: typeof fetch = async () => new Response(null, { status: 401 });
    const result = await testConnection(
      { url: "https://key.supabase.co", anonKey: KEY },
      { fetchImpl }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("key");
      expect(result.status).toBe(401);
    }
  });

  it("タイムアウトを区別する", async () => {
    const fetchImpl: typeof fetch = (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    const result = await testConnection(
      { url: "https://timeout.supabase.co", anonKey: KEY },
      { fetchImpl, timeoutMs: 5 }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("timeout");
  });

  it("ホストに届くno-cors probeでCORS失敗をDNS失敗と分ける", async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      if (calls === 1) throw new TypeError("Failed to fetch");
      return new Response(null, { status: 200 });
    };
    const result = await testConnection(
      { url: "https://cors.supabase.co", anonKey: KEY },
      { fetchImpl }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("cors");
  });

  it("通常fetchと到達確認の両方が失敗したらDNS・通信障害にする", async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new TypeError("Failed to fetch");
    };
    const result = await testConnection(
      { url: "https://dns.supabase.co", anonKey: KEY },
      { fetchImpl }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("dns");
  });
});

describe("OAuth callbackの解析", () => {
  it("implicit flowのtokenをセッションへ変換する", () => {
    expect(
      parseAuthRedirectHash(
        "#access_token=access&refresh_token=refresh&expires_at=1900000000"
      )
    ).toEqual({
      kind: "session",
      session: {
        accessToken: "access",
        refreshToken: "refresh",
        expiresAt: 1900000000,
      },
    });
  });

  it("Supabaseが返したOAuthエラーを利用者向けメッセージにする", () => {
    const parsed = parseAuthRedirectHash(
      "#error=access_denied&error_code=bad_oauth_callback&error_description=Denied"
    );
    expect(parsed?.kind).toBe("error");
    if (parsed?.kind === "error") {
      expect(parsed.message).toContain("bad_oauth_callback");
      expect(parsed.message).toContain("Denied");
    }
  });
});

describe("Supabase Storage同期", () => {
  const config = { url: "https://storage.supabase.co", anonKey: KEY };
  const session = { accessToken: fakeJwt({ sub: "user-abc" }) };

  it("404を未作成スナップショットとして扱う", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({ message: "Object not found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });

    await expect(fetchSnapshot(config, session, { fetchImpl })).resolves.toBeUndefined();
  });

  it("SupabaseのHTTP 400 not_found / Object not foundを初回状態として扱う", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          statusCode: "404",
          error: "not_found",
          message: "Object not found",
        }),
        { status: 400, headers: { "content-type": "application/json" } }
      );

    await expect(fetchSnapshot(config, session, { fetchImpl })).resolves.toBeUndefined();
  });

  it("HTTP 400でもBucket not foundは初回状態にせず設定不備を返す", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          code: "not_found",
          message: "Bucket not found",
        }),
        { status: 400, headers: { "content-type": "application/json" } }
      );

    await expect(fetchSnapshot(config, session, { fetchImpl })).rejects.toThrow(
      "Privateバケット「forge」を作成"
    );
  });

  it("読み取りの400を空扱いせずバケット・RLS診断として返す", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          statusCode: "400",
          error: "Bad Request",
          message: "new row violates row-level security policy",
        }),
        { status: 400, headers: { "content-type": "application/json" } }
      );

    await expect(fetchSnapshot(config, session, { fetchImpl })).rejects.toThrow(
      "SELECT・INSERT・UPDATEポリシー"
    );
  });

  it("書き込みの403へSupabase本文とRLSの直し方を付ける", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          statusCode: "403",
          error: "Unauthorized",
          message: "new row violates row-level security policy",
        }),
        { status: 403, headers: { "content-type": "application/json" } }
      );

    await expect(putSnapshot(config, session, { exportedAt: "2026-07-27" }, { fetchImpl }))
      .rejects.toThrow("StorageのRLSで拒否されています");
  });

  it("書き込みの401を期限切れサインインとして案内する", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({ message: "Invalid JWT" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });

    await expect(putSnapshot(config, session, {}, { fetchImpl })).rejects.toThrow(
      "Googleで再サインイン"
    );
  });

  it("成功時は同じオブジェクトをupsertし、認証値を本文やエラーへ混ぜない", async () => {
    const fetchImpl: typeof fetch = async (input, init) => {
      expect(String(input)).toBe(
        "https://storage.supabase.co/storage/v1/object/forge/user-abc/snapshot.json"
      );
      expect(init?.method).toBe("POST");
      expect(new Headers(init?.headers).get("x-upsert")).toBe("true");
      expect(init?.body).toBe(JSON.stringify({ exportedAt: "2026-07-27" }));
      return new Response(null, { status: 200 });
    };

    await expect(
      putSnapshot(config, session, { exportedAt: "2026-07-27" }, { fetchImpl })
    ).resolves.toBeUndefined();
  });

  /*
   * Phase 2-3: 保存先を利用者ごとに分ける。
   * 以前は全利用者が同じ forge/snapshot.json を共有しており、
   * OAuthで誰がサインインしても同じファイルを読み書きできた。
   */
  it("利用者IDごとに異なるパスへ保存する（他の利用者のファイルに触れない）", async () => {
    const other = { accessToken: fakeJwt({ sub: "user-xyz" }) };
    const seenPaths: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      seenPaths.push(new URL(String(input)).pathname);
      return new Response(null, { status: 200 });
    };

    await putSnapshot(config, session, { exportedAt: "2026-07-27" }, { fetchImpl });
    await putSnapshot(config, other, { exportedAt: "2026-07-27" }, { fetchImpl });

    expect(seenPaths).toEqual([
      "/storage/v1/object/forge/user-abc/snapshot.json",
      "/storage/v1/object/forge/user-xyz/snapshot.json",
    ]);
  });

  it("アクセストークンから利用者IDを取り出せない場合は通信せず、値を含まない明確なエラーにする", async () => {
    const brokenSession = { accessToken: "not-a-jwt" };
    const fetchImpl: typeof fetch = async () => {
      throw new Error("この場合は通信してはいけない");
    };

    await expect(
      fetchSnapshot(config, brokenSession, { fetchImpl })
    ).rejects.toThrow("サインイン情報を確認できません");
    await expect(
      putSnapshot(config, brokenSession, { exportedAt: "2026-07-27" }, { fetchImpl })
    ).rejects.toThrow("サインイン情報を確認できません");
  });
});
