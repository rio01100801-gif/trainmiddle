import { describe, it, expect } from "vitest";
import {
  grpSecPerM,
  specificPace,
  buildAerobicProfile,
  estimateLtFromMarkers,
  estimateCriticalVelocity,
  isGrayZonePace,
} from "@/lib/core/pace";
import type { FitnessMarker } from "@/lib/core/types";

describe("4-2 ペース自動計算", () => {
  it("GRP: 1:48.0 → 0.135秒/m", () => {
    expect(grpSecPerM(108.0)).toBeCloseTo(0.135, 4);
  });

  it("モデリング核: 1:48.0 → 400m 54.0 / 300m 40.5 / 200m 27.0（100%側）", () => {
    expect(specificPace(108.0, "modeling", 400).targetSecSlow).toBeCloseTo(54.0, 1);
    expect(specificPace(108.0, "modeling", 300).targetSecSlow).toBeCloseTo(40.5, 1);
    expect(specificPace(108.0, "modeling", 200).targetSecSlow).toBeCloseTo(27.0, 1);
  });

  it("高乳酸: 1:48.0 → 300m 39.3〜38.5", () => {
    const p = specificPace(108.0, "high_lactate", 300);
    expect(p.targetSecSlow).toBeCloseTo(39.3, 1); // 97%
    expect(p.targetSecFast).toBeCloseTo(38.5, 1); // 95%
  });

  it("経済走: 1:48.0 → 600m 84.2〜85.9", () => {
    const p = specificPace(108.0, "race_economy", 600);
    expect(p.targetSecFast).toBeCloseTo(84.2, 1); // 104%
    expect(p.targetSecSlow).toBeCloseTo(85.9, 1); // 106%
  });

  it("神経系: 1:48.0 → 200m 24.8〜23.8", () => {
    const p = specificPace(108.0, "neural", 200);
    expect(p.targetSecSlow).toBeCloseTo(24.8, 1); // 92%
    expect(p.targetSecFast).toBeCloseTo(23.8, 1); // 88%
  });

  it("経済走の導入期: 週0は106%から、週4で104%に到達", () => {
    const w0 = specificPace(108.0, "race_economy", 600, 0);
    expect(w0.targetSecFast).toBeCloseTo(600 * 0.135 * 1.06, 1);
    const w4 = specificPace(108.0, "race_economy", 600, 4);
    expect(w4.targetSecFast).toBeCloseTo(600 * 0.135 * 1.04, 1);
    const w9 = specificPace(108.0, "race_economy", 600, 9);
    expect(w9.targetSecFast).toBeCloseTo(600 * 0.135 * 1.04, 1); // 下限104%
  });

  it("有酸素: 実測データが無い場合は isEstimated フラグが立つ", () => {
    const p = buildAerobicProfile([], "2026-04-01", 110);
    expect(p.isEstimated).toBe(true);
    expect(p.sourceDescription).toContain("推定");
  });

  it("有酸素: 実測(8km@3:50/km相当)からLT算出、CV=LT-6〜8、ジョグ=LT+60〜80", () => {
    const marker: FitnessMarker = {
      id: "m1",
      date: "2026-03-25",
      type: "workout",
      description: "8kmペース走",
      resultLapsSec: Array(8).fill(230), // 3:50/km × 8km
      lapDistancesM: Array(8).fill(1000),
      avgHr: 186,
    };
    const p = buildAerobicProfile([marker], "2026-04-01");
    expect(p.isEstimated).toBe(false);
    expect(p.ltPaceSecPerKm).toBeCloseTo(230, 0);
    expect(p.cvPaceSecPerKm.fast).toBeCloseTo(222, 0);
    expect(p.cvPaceSecPerKm.slow).toBeCloseTo(224, 0);
    expect(p.jogPaceSecPerKm.fast).toBeCloseTo(290, 0);
    expect(p.jogPaceSecPerKm.slow).toBeCloseTo(310, 0);
  });

  it("90日より古い実測は使わない", () => {
    const marker: FitnessMarker = {
      id: "m1",
      date: "2025-11-01",
      type: "workout",
      description: "古いペース走",
      resultLapsSec: Array(8).fill(230),
      lapDistancesM: Array(8).fill(1000),
    };
    expect(estimateLtFromMarkers([marker], "2026-04-01")).toBeUndefined();
  });

  it("回復ジョグと用途不明の自動取込をLT材料へ混ぜない", () => {
    const threshold: FitnessMarker = {
      id: "threshold",
      date: "2026-03-28",
      type: "workout",
      purpose: "threshold",
      description: "閾値走",
      resultLapsSec: [8 * 230],
      lapDistancesM: [8000],
    };
    const recovery: FitnessMarker = {
      ...threshold,
      id: "recovery",
      purpose: "recovery",
      description: "回復ジョグ",
      resultLapsSec: [8 * 300],
    };
    const imported: FitnessMarker = {
      ...threshold,
      id: "ah-2026-03-29-800",
      purpose: "unknown",
      description: "Apple Health",
      resultLapsSec: [8 * 280],
    };
    const estimate = estimateLtFromMarkers(
      [threshold, recovery, imported],
      "2026-04-01"
    )!;
    expect(estimate.ltPaceSecPerKm).toBeCloseTo(230, 0);
    expect(estimate.excluded.map((sample) => sample.description)).toEqual(
      expect.arrayContaining(["回復ジョグ", "Apple Health"])
    );
  });

  it("異なる3000m・5000m実測が揃えばCVを距離-時間直線から算出する", () => {
    const markers: FitnessMarker[] = [
      {
        id: "lt",
        date: "2026-03-25",
        type: "workout",
        purpose: "threshold",
        description: "閾値走",
        resultLapsSec: [8 * 210],
        lapDistancesM: [8000],
      },
      {
        id: "3k",
        date: "2026-03-26",
        type: "race",
        purpose: "race",
        description: "3000m",
        resultLapsSec: [540],
        lapDistancesM: [3000],
      },
      {
        id: "5k",
        date: "2026-03-27",
        type: "race",
        purpose: "race",
        description: "5000m",
        resultLapsSec: [930],
        lapDistancesM: [5000],
      },
    ];
    const direct = estimateCriticalVelocity(markers, "2026-04-01", 205)!;
    expect(direct.paceSecPerKm).toBeCloseTo(195, 1);
    const profile = buildAerobicProfile(markers, "2026-04-01");
    expect(profile.cvEstimate).toBeDefined();
    expect(profile.cvSourceDescription).toContain("異なる2距離");
  });

  it("良好に完遂したCV実績があればLT固定差ではなく次のCV処方へ使う", () => {
    const markers: FitnessMarker[] = [
      {
        id: "lt",
        date: "2026-03-25",
        type: "workout",
        purpose: "threshold",
        description: "閾値走",
        resultLapsSec: [8 * 220],
        lapDistancesM: [8000],
      },
      {
        id: "cv-result",
        date: "2026-03-30",
        type: "workout",
        purpose: "cv",
        description: "1000m×4 CV（正式結果）",
        resultLapsSec: [207, 208, 207, 208],
        lapDistancesM: [1000, 1000, 1000, 1000],
        rpe: 7,
      },
    ];
    const profile = buildAerobicProfile(markers, "2026-04-01");
    expect(profile.cvPaceSecPerKm.fast).toBeCloseTo(206.5, 1);
    expect(profile.cvPaceSecPerKm.slow).toBeCloseTo(208.5, 1);
    expect(profile.cvSourceDescription).toContain("完遂CV実績1件");
  });

  it("グレーゾーン判定: LT+30〜50秒/km", () => {
    expect(isGrayZonePace(260, 230)).toBe(true);
    expect(isGrayZonePace(300, 230)).toBe(false);
    expect(isGrayZonePace(250, 230)).toBe(false);
  });
});
