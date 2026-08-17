import { describe, it, expect } from "vitest";
import { buildAerobicProfile, ltFallback } from "../src/lib/core/pace";
import type { FitnessMarker } from "../src/lib/core/types";

/*
 * 実測が足りないときのLT推定。
 *
 * ここで固定したいのは値そのものではなく、**3つの経路が同じ答えに寄ること**。
 * 以前は800mからの一段推定だけで、同じ選手の実測経路と23秒/km食い違っていた。
 * CVはCFEを更新しないので、そのずれは画面のどこにも出なかった。
 */

const RIO_1500M = 236; // 3:56
const RIO_CFE_800M = 109.5; // 1:49.5

describe("ltFallback", () => {
  it("1500mPBがあれば1500mから推定する", () => {
    const r = ltFallback(RIO_CFE_800M, RIO_1500M);
    expect(r.lt).toBeCloseTo(195.1, 1);
    expect(r.source).toContain("1500m");
  });

  it("1500mPBが無ければCFEから推定する", () => {
    const r = ltFallback(RIO_CFE_800M, undefined);
    expect(r.lt).toBeCloseTo(194.4, 1);
    expect(r.source).toContain("CFE");
  });

  it("1500mとCFEの答えが5秒/km以内に収まる", () => {
    // 揃わない係数は使わない。揃わなければどちらかが間違っている。
    const a = ltFallback(RIO_CFE_800M, RIO_1500M).lt;
    const b = ltFallback(RIO_CFE_800M, undefined).lt;
    expect(Math.abs(a - b)).toBeLessThanOrEqual(5);
  });

  it("実測（5000m 15:22 → 約196秒/km）とも5秒/km以内で揃う", () => {
    const measured = 196;
    expect(Math.abs(ltFallback(RIO_CFE_800M, RIO_1500M).lt - measured)).toBeLessThanOrEqual(5);
    expect(Math.abs(ltFallback(RIO_CFE_800M, undefined).lt - measured)).toBeLessThanOrEqual(5);
  });

  it("CFEも無ければ既定値から推定して落ちない", () => {
    const r = ltFallback(undefined, undefined);
    expect(Number.isFinite(r.lt)).toBe(true);
    expect(r.lt).toBeGreaterThan(0);
  });

  it("1500mPBが0や負なら使わない（未入力と同じ扱い）", () => {
    expect(ltFallback(RIO_CFE_800M, 0).source).toContain("CFE");
    expect(ltFallback(RIO_CFE_800M, -1).source).toContain("CFE");
  });

  it("速い1500mほどLTも速い", () => {
    expect(ltFallback(undefined, 220).lt).toBeLessThan(ltFallback(undefined, 250).lt);
  });

  it("旧係数1.6の値（219秒/km）はもう返さない", () => {
    // 実測経路と23秒/km食い違っていた値。回帰したら落とす。
    expect(ltFallback(RIO_CFE_800M, undefined).lt).toBeLessThan(210);
  });
});

describe("buildAerobicProfile のフォールバック", () => {
  const noMarkers: FitnessMarker[] = [];

  it("1500mPBを渡すとそちらを採用し、出どころを書く", () => {
    const p = buildAerobicProfile(noMarkers, "2026-08-18", RIO_CFE_800M, undefined, RIO_1500M);
    expect(p.ltPaceSecPerKm).toBeCloseTo(195.1, 1);
    expect(p.sourceDescription).toContain("1500m");
    expect(p.isEstimated).toBe(true);
    expect(p.confidence).toBe("low");
  });

  it("1500mPBが無ければCFEから。どちらの段でも推定の印は立つ", () => {
    const p = buildAerobicProfile(noMarkers, "2026-08-18", RIO_CFE_800M);
    expect(p.ltPaceSecPerKm).toBeCloseTo(194.4, 1);
    expect(p.sourceDescription).toContain("CFE");
    expect(p.isEstimated).toBe(true);
  });

  it("実測マーカーがあれば1500mPBより実測が優先される", () => {
    // 実測経路（estimateLtFromMarkers）には触っていないことの確認。
    const markers: FitnessMarker[] = [
      {
        id: "m1",
        date: "2026-08-01",
        type: "test",
        description: "5000m",
        resultLapsSec: [184, 185, 184, 184, 185],
        lapDistancesM: [1000, 1000, 1000, 1000, 1000],
        purpose: "threshold",
      },
    ];
    const p = buildAerobicProfile(markers, "2026-08-18", RIO_CFE_800M, undefined, RIO_1500M);
    expect(p.sourceDescription).not.toContain("実測データ不足");
  });
});
