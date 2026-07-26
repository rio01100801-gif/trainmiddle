/**
 * S-11 同期の判断
 *
 * 一番避けたいのは「黙って上書きして記録が消える」こと。
 * 両方が動いていたら必ず本人に選ばせる。
 */
import { describe, expect, it } from "vitest";
import { decideSync, metaOf, validateSyncConfig } from "@/lib/core/sync";

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
  it("正しい設定は通る", () => {
    expect(
      validateSyncConfig({ url: "https://abcd.supabase.co", anonKey: "ey..." })
    ).toBeUndefined();
  });

  it("未設定は未設定と分かる", () => {
    expect(validateSyncConfig({})).toBe("未設定です");
  });

  it("片方だけ入っている状態で通信を始めない", () => {
    expect(validateSyncConfig({ url: "https://abcd.supabase.co" })).toContain("anon key");
    expect(validateSyncConfig({ anonKey: "ey..." })).toContain("Project URL");
  });

  it("URLの形が違えば教える", () => {
    expect(validateSyncConfig({ url: "http://example.com", anonKey: "ey" })).toContain("形");
  });
});
