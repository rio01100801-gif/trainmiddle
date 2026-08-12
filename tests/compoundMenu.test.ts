/**
 * 複合メニューの入力。
 *
 * `1000×4＋200×3 r3min-5min-200jog` のように
 *   ・"距離×本数" のかたまりが2つ以上
 *   ・レストが場所ごとに違う
 * 形を落とさずに読む。以前は先頭のかたまり（1000×4）と先頭のレスト（3min）
 * だけを採り、**残りは何も言わずに消えていた**。
 */
import { describe, expect, it } from "vitest";
import { parseRow, parseRepBlocks, parseSegments } from "@/lib/core/bulkImport";

const TODAY = "2026-08-12";
const row = (body: string) => parseRow(`8/12 ${body}`, 1, TODAY);

describe("かたまりを全部拾う", () => {
  it("2つ以上の 距離×本数 を落とさない", () => {
    expect(parseRepBlocks("1000×4＋200×3")).toEqual([
      { distanceM: 1000, reps: 4, targetSec: undefined },
      { distanceM: 200, reps: 3, targetSec: undefined },
    ]);
  });

  it("セット表記（×2×2）は総本数に畳む", () => {
    expect(parseRepBlocks("300(41-42)×2×2")[0]).toEqual({
      distanceM: 300,
      reps: 4,
      targetSec: 41,
    });
  });

  it("複合なら区間に展開する（本数ぶん並ぶ）", () => {
    const segs = parseSegments("1000×4＋200×3");
    expect(segs).toHaveLength(7);
    expect(segs.filter((s) => s.distanceM === 1000)).toHaveLength(4);
    expect(segs.filter((s) => s.distanceM === 200)).toHaveLength(3);
  });

  it("1かたまりのときは展開しない（単発を複合セット扱いにしない）", () => {
    expect(parseSegments("300m×6")).toHaveLength(0);
  });
});

describe("1000×4＋200×3 r3min-5min-200jog", () => {
  const r = row("1000×4＋200×3 r3min-5min-200jog");

  it("消えた区間があることを黙らない（混在を本文で伝える）", () => {
    expect(r.issues.join()).toContain("1000・200m");
  });

  it("代表距離は本数の多いほう", () => {
    expect(r.repDistanceM).toBe(1000);
    expect(r.reps).toBe(4);
  });

  it("レストは3種類とも表記として残す", () => {
    expect(r.restNote).toBe("r3min-5min-200jog");
  });

  it("構造化する値は先頭を代表にし、代表にしたことを伝える", () => {
    expect(r.restSec).toBe(180);
    expect(r.issues.join()).toContain("レストが3種類");
    expect(r.issues.join()).toContain("3min");
  });
});

describe("既存の書き方を壊さない", () => {
  it("300m×6 r5分", () => {
    const r = row("300m×6 r5分");
    expect(r.repDistanceM).toBe(300);
    expect(r.reps).toBe(6);
    expect(r.restSec).toBe(300);
    // 単発なので混在の警告もレスト複数の警告も出ない
    expect(r.issues.join()).not.toContain("混ざっています");
    expect(r.issues.join()).not.toContain("レストが");
  });

  it("300(42)＋600(1:26)＋600(1:26)（括弧つきの複合）", () => {
    const r = row("300(42)＋600(1:26)＋600(1:26)");
    expect(r.repDistanceM).toBe(600);
    expect(r.reps).toBe(2);
  });

  it("1000m×4 @3:15 r3分", () => {
    const r = row("1000m×4 @3:15 r3分");
    expect(r.repDistanceM).toBe(1000);
    expect(r.reps).toBe(4);
    expect(r.restSec).toBe(180);
    expect(r.issues).toHaveLength(0);
  });
});
