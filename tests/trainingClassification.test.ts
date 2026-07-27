import { describe, expect, it } from "vitest";
import {
  isGlycolyticSession,
  isHighLoadSession,
  isLongRun,
  trainingLoadClass,
} from "@/lib/core/trainingClassification";
import { runRuleEngine } from "@/lib/core/rules";
import { ctx, makeSession, violationsOf } from "./helpers";

describe("練習の主負荷分類", () => {
  it("閾値とCVは有酸素高強度で、高乳酸・解糖系には数えない", () => {
    const threshold = makeSession("2026-07-06", "threshold");
    const cv = makeSession("2026-07-08", "cv");
    expect(trainingLoadClass(threshold.category)).toBe("aerobic_high");
    expect(trainingLoadClass(cv.category)).toBe("aerobic_high");
    expect(isGlycolyticSession(threshold)).toBe(false);
    expect(isGlycolyticSession(cv)).toBe(false);
  });

  it("ロングジョグは低〜中強度有酸素で、高乳酸には数えない", () => {
    const longRun = makeSession("2026-07-12", "aerobic", {
      durationMin: 75,
      distanceKm: 14,
    });
    expect(trainingLoadClass(longRun.category)).toBe("aerobic_low");
    expect(isLongRun(longRun)).toBe(true);
    expect(isGlycolyticSession(longRun)).toBe(false);
  });

  it("短い神経刺激は一律に高負荷へ数えない", () => {
    const neural = makeSession("2026-07-07", "neural", {
      prescription: "100m流し × 4本（完全休息）",
      durationMin: 30,
    });
    expect(trainingLoadClass(neural.category)).toBe("neuromuscular");
    expect(isHighLoadSession(neural)).toBe(false);
  });
});

describe("組み合わせ警告", () => {
  it("高乳酸・中距離特異的の集中を内訳つきで検出する", () => {
    const violations = runRuleEngine(
      ctx({
        sessions: [
          makeSession("2026-07-06", "high_lactate"),
          makeSession("2026-07-08", "modeling"),
          makeSession("2026-07-10", "race_economy"),
        ],
      })
    );
    const warning = violationsOf(violations, "RULE-04")[0];
    expect(warning.level).toBe("ERROR");
    expect(warning.message).toContain("高乳酸・解糖系1回");
    expect(warning.message).toContain("中距離特異的2回");
  });

  it("中距離特異的と高乳酸が連日なら対象名を含める", () => {
    const a = makeSession("2026-07-06", "high_lactate", { name: "300m反復" });
    const b = makeSession("2026-07-07", "race_economy", { name: "600m経済走" });
    const warning = violationsOf(runRuleEngine(ctx({ sessions: [a, b] })), "RULE-03")[0];
    expect(warning.message).toContain("300m反復");
    expect(warning.message).toContain("600m経済走");
  });
});
