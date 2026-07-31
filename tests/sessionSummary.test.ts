/**
 * 記録サマリー。既存の SessionResult から機械的に導けること、
 * 処方文の解釈をしないこと、種別で平均の意味を取り違えないことを固定する。
 */
import { describe, expect, it } from "vitest";
import { buildSessionSummary, fmtClock, fmtLap } from "@/lib/core/sessionSummary";
import { makeResult, makeSession } from "./helpers";

function interval(times: number[], distanceM = 600) {
  const s = makeSession("2026-05-18", "race_economy", {
    prescription: "600m×3 @86秒 r7分",
  });
  const r = makeResult(s, {
    rpe: 8,
    note: "調子良く、最後まで安定して走れた。",
    interval: {
      reps: times.length,
      distanceM,
      restType: "jog",
      restSec: 420,
      results: times.map((t, i) => ({ index: i, distanceM, actualSec: t })),
    },
  });
  return { s, r };
}

describe("記録サマリー", () => {
  it("見出しは構造化データから作る（処方文を解釈しない）", () => {
    const { s, r } = interval([85.7, 85.2, 84.3]);
    expect(buildSessionSummary(s, r).headline).toBe("600m × 3");
  });

  it("合計・平均・最速を出す", () => {
    const { s, r } = interval([85.7, 85.2, 84.3]);
    const v = buildSessionSummary(s, r);
    expect(v.totalSec).toBe(255.2);
    expect(v.avgSec).toBeCloseTo(85.1, 1);
    expect(v.bestSec).toBe(84.3);
  });

  it("最速の本だけ isBest が立つ", () => {
    const { s, r } = interval([85.7, 85.2, 84.3]);
    const v = buildSessionSummary(s, r);
    expect(v.reps.map((x) => x.isBest)).toEqual([false, false, true]);
  });

  it("インターバルの平均は「1本平均」であってペースではない", () => {
    const { s, r } = interval([85.7, 85.2, 84.3]);
    expect(buildSessionSummary(s, r).avgLabel).toBe("AVG LAP");
  });

  it("持続走は距離・時間・1kmあたりで組み立て、平均はペース扱いにする", () => {
    const s = makeSession("2026-05-18", "aerobic", { prescription: "40分ジョグ" });
    const r = makeResult(s, {
      continuous: { distanceKm: 10, durationMin: 50, avgPaceSecPerKm: 300 },
    });
    const v = buildSessionSummary(s, r);
    expect(v.headline).toBe("10km 50分");
    expect(v.totalSec).toBe(3000);
    expect(v.avgSec).toBe(300);
    expect(v.avgLabel).toBe("AVG PACE");
    expect(v.bestSec).toBeUndefined();
    expect(v.reps).toEqual([]);
  });

  it("バーの比率は最速が1で、遅い本ほど短い（0にはしない）", () => {
    const { s, r } = interval([90, 85, 80]);
    const v = buildSessionSummary(s, r);
    const ratios = v.reps.map((x) => x.ratio);
    expect(ratios[2]).toBe(1); // 最速
    expect(ratios[0]).toBeLessThan(ratios[1]);
    expect(ratios[0]).toBeGreaterThan(0.5);
  });

  it("タイムが1本も読めなければ持続走側の組み立てに落ちる", () => {
    const s = makeSession("2026-05-18", "race_economy");
    const r = makeResult(s, {
      interval: { reps: 3, distanceM: 600, restType: "jog", results: [] },
    });
    expect(buildSessionSummary(s, r).reps).toEqual([]);
  });

  it("メモとRPEをそのまま持ち回る", () => {
    const { s, r } = interval([85.7, 85.2, 84.3]);
    const v = buildSessionSummary(s, r);
    expect(v.note).toBe("調子良く、最後まで安定して走れた。");
    expect(v.rpe).toBe(8);
  });

  it("表示の整形: 1分未満は秒だけ、超えたら m:ss.s", () => {
    expect(fmtLap(41.6)).toBe("41.6");
    expect(fmtLap(85.7)).toBe("1:25.7");
    expect(fmtClock(255.2)).toBe("4:15");
  });
});
