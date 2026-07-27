import { describe, it, expect } from "vitest";
import { computeReadiness } from "@/lib/core/readiness";
import { makeSession, makeResult, testAthlete } from "./helpers";

const base = (over: Partial<Parameters<typeof computeReadiness>[0]> = {}) => ({
  session: makeSession("2026-08-04", "high_lactate"),
  athlete: testAthlete(),
  signal: "green" as const,
  acwr: 1.0,
  daysSinceLastQuality: 4,
  recentQualityResults: [],
  ...over,
});

describe("セッション準備度スコア", () => {
  it("条件が揃っていれば100", () => {
    const r = computeReadiness(base());
    expect(r.score).toBe(100);
    expect(r.level).toBe("high");
  });

  it("黄信号を主に評価し、ACWR増加側は補助的に-4", () => {
    const r = computeReadiness(base({ signal: "yellow", acwr: 1.32 }));
    expect(r.score).toBe(86);
    expect(r.level).toBe("high");
  });

  it("赤信号なら質を入れるなという判定になる", () => {
    const r = computeReadiness(base({ signal: "red" }));
    expect(r.score).toBeLessThan(60);
    expect(r.headline).toContain("有酸素か休養");
  });

  it("ACWR1.5超でも単独では練習不可を決めない", () => {
    const r = computeReadiness(base({ acwr: 1.7 }));
    expect(r.score).toBe(90);
    expect(r.breakdown.find((c) => c.label === "ACWR")!.delta).toBe(-10);
  });

  it("回復間隔が中1日未満なら-15（質練習のみ）", () => {
    expect(computeReadiness(base({ daysSinceLastQuality: 1 })).score).toBe(85);
    // aerobic には回復間隔の減点を適用しない
    const aerobic = computeReadiness(
      base({ session: makeSession("2026-08-04", "aerobic"), daysSinceLastQuality: 1 })
    );
    expect(aerobic.breakdown.some((c) => c.label === "回復間隔")).toBe(false);
    expect(aerobic.score).toBe(100);
  });

  it("直近の未達が続くと減点される", () => {
    const s = makeSession("2026-07-28", "high_lactate");
    const r = computeReadiness(
      base({
        recentQualityResults: [
          makeResult(s, { achievement: "failed" }),
          makeResult(s, { achievement: "partial" }),
        ],
      })
    );
    expect(r.score).toBe(91); // -6 -3
  });

  it("heat_tolerance=low かつ28℃以上で-8。normalなら減点なし", () => {
    expect(computeReadiness(base({ tempC: 31 })).score).toBe(92);
    expect(
      computeReadiness(base({ athlete: testAthlete({ heatTolerance: "normal" }), tempC: 31 })).score
    ).toBe(100);
  });

  it("ERROR級違反があれば-25", () => {
    expect(computeReadiness(base({ errorViolationCount: 1 })).score).toBe(75);
  });

  it("0未満にはならない", () => {
    const r = computeReadiness(
      base({ signal: "red", acwr: 1.9, daysSinceLastQuality: 0, errorViolationCount: 2, tempC: 33 })
    );
    expect(r.score).toBe(0);
    expect(r.level).toBe("low");
  });

  it("RPEの高さや達成感は一切加点されない（減点方式・上限100）", () => {
    const r = computeReadiness(base());
    expect(r.breakdown.every((c) => c.delta <= 0)).toBe(true);
    expect(r.score).toBeLessThanOrEqual(100);
  });

  it("内訳が必ず返る（ブラックボックスにしない）", () => {
    const r = computeReadiness(base({ signal: "yellow", acwr: 1.32 }));
    expect(r.breakdown.length).toBeGreaterThanOrEqual(3);
    expect(r.breakdown.find((c) => c.label === "疲労シグナル")!.detail).toContain("黄");
  });
});
