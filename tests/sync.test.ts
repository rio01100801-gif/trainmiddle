/**
 * S-11 同期の判断
 *
 * 一番避けたいのは「黙って上書きして記録が消える」こと。
 * 両方が動いていたら必ず本人に選ばせる。
 */
import { describe, expect, it } from "vitest";
import {
  authRedirectLanding,
  decideSync,
  googleAuthorizeUrl,
  metaOf,
  normalizeSyncConfig,
  oauthRedirectTo,
  validateSyncConfig,
} from "@/lib/core/sync";

const A = { exportedAt: "2026-07-27T09:00:00Z", totalCount: 100 };
const B = { exportedAt: "2026-07-28T09:00:00Z", totalCount: 110 };
const C = { exportedAt: "2026-07-28T10:00:00Z", totalCount: 105 };

describe("同期の判断", () => {
  it("同じなら何もしない", () => {
    expect(decideSync({ local: A, remote: A, lastSynced: A }).action).toBe("in_sync");
  });

  it("クラウドが空なら送る", () => {
    expect(decideSync({ local: A }).action).toBe("first_push");
  });

  it("端末が空なら取り込む", () => {
    expect(decideSync({ remote: A }).action).toBe("first_pull");
  });

  it("端末だけが進んでいれば送る", () => {
    expect(decideSync({ local: B, remote: A, lastSynced: A }).action).toBe("push");
  });

  it("クラウドだけが進んでいれば取り込む", () => {
    expect(decideSync({ local: A, remote: B, lastSynced: A }).action).toBe("pull");
  });

  it("両方が進んでいたら黙って上書きせず選ばせる", () => {
    const d = decideSync({ local: B, remote: C, lastSynced: A });
    expect(d.action).toBe("conflict");
    expect(d.choices).toHaveLength(3);
    // 迷ったときの既定は統合（消えない方）
    expect(d.choices![0].key).toBe("merge");
    for (const c of d.choices!) expect(c.note.length).toBeGreaterThan(5);
  });

  it("時計のずれだけで新しい方を採らない", () => {
    // リモートの方が時刻は新しいが、前回同期から動いていない
    const past = { exportedAt: "2026-07-29T00:00:00Z", totalCount: 100 };
    const d = decideSync({ local: B, remote: past, lastSynced: past });
    expect(d.action).toBe("push");
  });

  it("前回の同期が分からなければ、両方あるときは選ばせる", () => {
    expect(decideSync({ local: B, remote: C }).action).toBe("conflict");
  });
});

describe("メタの取り出し", () => {
  it("件数の合計で中身の違いを見る", () => {
    expect(metaOf({ exportedAt: "x", counts: { a: 2, b: 3 } })).toEqual({
      exportedAt: "x",
      totalCount: 5,
    });
  });

  it("書き出しが無ければ undefined", () => {
    expect(metaOf({})).toBeUndefined();
  });
});

describe("設定の検証", () => {
  const publishable = "sb_publishable_1234567890123456789012_12345678";

  it("正しい設定は通る", () => {
    expect(
      validateSyncConfig({ url: "https://abcd.supabase.co", anonKey: publishable })
    ).toBeUndefined();
  });

  it("未設定は未設定と分かる", () => {
    expect(validateSyncConfig({})).toBe("未設定です");
  });

  it("片方だけ入っている状態で通信を始めない", () => {
    expect(validateSyncConfig({ url: "https://abcd.supabase.co" })).toContain("Publishable Key");
    expect(validateSyncConfig({ anonKey: publishable })).toContain("Project URL");
  });

  it("URLの形が違えば教える", () => {
    expect(validateSyncConfig({ url: "http://example.com", anonKey: publishable })).toContain("形");
  });

  it("前後の空白・改行・末尾スラッシュと全角記号を正規化する", () => {
    expect(
      normalizeSyncConfig({
        url: " \nｈｔｔｐｓ：／／ＡＢＣＤ．ｓｕｐａｂａｓｅ．ｃｏ／ \r",
        anonKey: ` \n${publishable}\r `,
      })
    ).toEqual({
      url: "https://abcd.supabase.co",
      anonKey: publishable,
    });
  });

  it("Secret Keyはクライアントへ保存させない", () => {
    expect(
      validateSyncConfig({
        url: "https://abcd.supabase.co",
        anonKey: ["sb", "secret", "test-only-value"].join("_"),
      })
    ).toContain("Secret Key");
  });
});

describe("OAuthの戻り先", () => {
  it("PC版はNext.jsの同期画面へ直接戻る", () => {
    expect(
      oauthRedirectTo(
        { origin: "http://localhost:3000", pathname: "/sync" },
        false
      )
    ).toBe("http://localhost:3000/sync");
  });

  it("PWA版はハッシュと競合しないクエリで同期画面への復帰意図を残す", () => {
    expect(
      oauthRedirectTo(
        {
          origin: "https://rio01100801-gif.github.io",
          pathname: "/trainmiddle/index.html",
        },
        true
      )
    ).toBe("https://rio01100801-gif.github.io/trainmiddle/index.html?sync=1");
  });

  it("authorize URLにGoogleと完全なredirect_toを設定する", () => {
    const authorize = new URL(
      googleAuthorizeUrl(
        {
          url: "https://abcd.supabase.co/",
          anonKey: "sb_publishable_1234567890123456789012_12345678",
        },
        "https://example.com/sync"
      )
    );
    expect(authorize.origin).toBe("https://abcd.supabase.co");
    expect(authorize.pathname).toBe("/auth/v1/authorize");
    expect(authorize.searchParams.get("provider")).toBe("google");
    expect(authorize.searchParams.get("redirect_to")).toBe("https://example.com/sync");
  });
});

describe("OAuthの戻りを受け取った後の着地", () => {
  /*
   * 実機で確認された不具合: サインインは成功してトークンも保存されるのに、
   * ホーム画面に戻ったまま同期画面へ遷移しない。
   *
   * 原因は、着地先の判断が `?sync=1` というクエリの残存に依存していたこと。
   * このクエリは自前では守れない。Supabase の Redirect URLs にPWAのURLが
   * 登録されていないと、Supabaseは指定した redirect_to を無視して
   * Site URL へ飛ばすため、クエリごと落ちる（Authorization Code横取り耐性のための仕様で、
   * FORGE側のバグではなく設定依存の外部要因）。
   *
   * captureAuthRedirect が何か拾えた時点で、それは必ず signInWithGoogle が
   * 発行した redirect_to からの戻りである（他にこのURLへ来る経路が無い）。
   * したがって `?sync=1` の有無を問わず、トークンを受け取れたら同期画面へ戻ってよい。
   */
  it("PWA（ハッシュルーティング）は sync=1 が無くてもハッシュで同期画面へ戻す", () => {
    expect(authRedirectLanding(true, "/trainmiddle/index.html")).toEqual({
      hash: "#/sync",
    });
  });

  it("Next.js は sync=1 が無くても /sync へ戻す", () => {
    expect(authRedirectLanding(false, "/")).toEqual({ pathname: "/sync" });
  });

  it("Next.js で既に /sync にいるなら遷移しない", () => {
    expect(authRedirectLanding(false, "/sync")).toEqual({});
  });
});
