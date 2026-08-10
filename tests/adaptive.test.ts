/**
 * M-2 設定の自動調整 / M-9 暑熱補正 / M-3 中止基準
 *
 * ここで守りたいのは「実行できなかった」を能力低下として扱わないこと。
 * 設定だけを動かし、CFEは触らない。
 */
import { describe, it, expect } from "vitest";
import {
  EASE_DEVIATION_SEC,
  MAX_EASE_PCT,
  adjustPrescription,
  dailyAdjustment,
  executionSamples,
  executionTrend,
  jogEfficiency,
  repsOf,
} from "@/lib/core/adaptive";
import { heatPaceAdjustment, normalizeForHeat } from "@/lib/core/heatPace";
import { abortCriteria, evaluateReps } from "@/lib/core/abort";
import { makeSession } from "./helpers";
import type { Session, SessionResult } from "@/lib/core/types";

function hl(date: string, targetSec = 41.5): Session {
  return makeSession(date, "high_lactate", {
    prescription: `300m × 4 @${targetSec}秒 r5分`,
    targetPaces: [{ distanceM: 300, targetSecFast: targetSec - 0.5, targetSecSlow: targetSec + 0.5 }],
  });
}

function res(
  session: Session,
  times: number[],
  over: Partial<SessionResult> = {}
): SessionResult {
  return {
    id: `r-${session.id}`,
    sessionId: session.id,
    date: session.date,
    actualLapsSec: times,
    lapDistancesM: times.map(() => 300),
    interval: {
      reps: 4,
      distanceM: 300,
      targetSec: 41.5,
      restType: "jog",
      restSec: 300,
      results: times.map((t, i) => ({ index: i + 1, distanceM: 300, targetSec: 41.5, actualSec: t })),
    },
    achievement: "achieved",
    rpe: 8,
    subjective: "hard",
    ...over,
  };
}

describe("直近の実行状況", () => {
  it("短縮した最終本は予定距離へ換算し、速い500m実績と誤解しない", () => {
    const session = makeSession("2026-07-15", "high_lactate", {
      prescription: "500m×3 @69-70秒 r10分",
      targetPaces: [{ distanceM: 500, targetSecFast: 69, targetSecSlow: 70 }],
    });
    const result: SessionResult = {
      id: "r-shortened-500",
      sessionId: session.id,
      date: session.date,
      actualLapsSec: [70.9, 67.7, 56],
      lapDistancesM: [500, 500, 400],
      interval: {
        reps: 3,
        distanceM: 500,
        targetSec: 69.5,
        restSec: 600,
        results: [
          { index: 1, distanceM: 500, targetSec: 69.5, actualSec: 70.9 },
          { index: 2, distanceM: 500, targetSec: 69.5, actualSec: 67.7 },
          {
            index: 3,
            distanceM: 400,
            plannedDistanceM: 500,
            targetSec: 55.6,
            plannedTargetSec: 69.5,
            actualSec: 56,
          },
        ],
      },
      completedReps: 2,
      prescribedReps: 3,
      aborted: true,
      achievement: "partial",
      rpe: 9,
      subjective: "hard",
    };
    const samples = executionSamples([session], [result], "high_lactate", "2026-07-22");
    expect(samples).toHaveLength(1);
    expect(samples[0].actualMeanSec).toBeCloseTo((70.9 + 67.7 + 70) / 3, 5);
    expect(samples[0].aborted).toBe(true);
  });

  it("設定より遅い状態が3回続いたら緩める", () => {
    const s = [hl("2026-07-01"), hl("2026-07-08"), hl("2026-07-15")];
    const r = [
      res(s[0], [44.0, 44.2, 44.1, 44.3]),
      res(s[1], [43.8, 44.0, 44.4, 44.6]),
      res(s[2], [44.2, 44.5, 44.3, 44.8]),
    ];
    const trend = executionTrend(executionSamples(s, r, "high_lactate", "2026-07-22"));
    expect(trend.verdict).toBe("ease");
    expect(trend.meanDeviationSec).toBeGreaterThan(EASE_DEVIATION_SEC);
    expect(trend.factor).toBeGreaterThan(1);
    expect(trend.factor).toBeLessThanOrEqual(1 + MAX_EASE_PCT);
  });

  it("2回では判断しない（たまたま悪い週で設定を下げない）", () => {
    const s = [hl("2026-07-08"), hl("2026-07-15")];
    const r = [res(s[0], [44.5, 44.6, 44.8, 45.0]), res(s[1], [44.4, 44.9, 45.1, 45.2])];
    const trend = executionTrend(executionSamples(s, r, "high_lactate", "2026-07-22"));
    expect(trend.verdict).toBe("hold");
    expect(trend.reason).toContain("直近3回");
  });

  it("3回とも設定より速ければ締める。ただし緩めるときより控えめ", () => {
    const s = [hl("2026-07-01"), hl("2026-07-08"), hl("2026-07-15")];
    const r = [
      res(s[0], [40.5, 40.6, 40.4, 40.3]),
      res(s[1], [40.2, 40.4, 40.3, 40.1]),
      res(s[2], [40.0, 40.2, 40.1, 40.0]),
    ];
    const trend = executionTrend(executionSamples(s, r, "high_lactate", "2026-07-22"));
    expect(trend.verdict).toBe("tighten");
    expect(trend.factor).toBeLessThan(1);
    expect(trend.factor).toBeGreaterThanOrEqual(1 - 0.015);
  });

  it("打ち切りが2回あれば3回そろわなくても緩める", () => {
    const s = [hl("2026-07-08"), hl("2026-07-15")];
    const r = [
      res(s[0], [41.6, 44.5], { completedReps: 2, prescribedReps: 4 }),
      res(s[1], [41.8, 44.8], { completedReps: 2, prescribedReps: 4 }),
    ];
    const trend = executionTrend(executionSamples(s, r, "high_lactate", "2026-07-22"));
    expect(trend.verdict).toBe("ease");
    expect(trend.reason).toContain("打ち切り");
  });

  it("暑熱下の実測は判断材料から外す", () => {
    const s = [hl("2026-07-01"), hl("2026-07-08"), hl("2026-07-15")];
    const r = [
      res(s[0], [44.0, 44.2, 44.1, 44.3], { heatFlagged: true }),
      res(s[1], [43.8, 44.0, 44.4, 44.6], { heatFlagged: true }),
      res(s[2], [44.2, 44.5, 44.3, 44.8], { heatFlagged: true }),
    ];
    const samples = executionSamples(s, r, "high_lactate", "2026-07-22");
    expect(samples).toHaveLength(0);
    expect(executionTrend(samples).verdict).toBe("hold");
  });

  it("同カテゴリでも反復距離が違う実績を個人補正へ混ぜない", () => {
    const old300 = hl("2026-07-08");
    const recent600 = makeSession("2026-07-15", "high_lactate", {
      prescription: "600m × 2 @86秒 r8分",
      targetPaces: [{ distanceM: 600, targetSecFast: 85, targetSecSlow: 87 }],
    });
    const next300 = hl("2026-07-22");
    const r600: SessionResult = {
      ...res(recent600, [85.5, 86]),
      interval: {
        reps: 2,
        distanceM: 600,
        targetSec: 86,
        restType: "full",
        restSec: 480,
        results: [85.5, 86].map((actualSec, index) => ({
          index: index + 1,
          distanceM: 600,
          targetSec: 86,
          actualSec,
        })),
      },
      lapDistancesM: [600, 600],
    };
    const samples = executionSamples(
      [old300, recent600, next300],
      [res(old300, [42, 42, 42, 42]), r600],
      "high_lactate",
      next300.date,
      undefined,
      next300
    );
    expect(samples).toHaveLength(1);
    expect(samples[0].distanceM).toBe(300);
  });

  it("設定より速くても高RPE・重い脚が続く場合は設定を締めない", () => {
    const sessions = [hl("2026-07-01"), hl("2026-07-08"), hl("2026-07-15")];
    const results = sessions.map((session) =>
      res(session, [40, 40.2, 40.1, 40], {
        achievement: "achieved",
        rpe: 9,
        nextDayLegs: "heavy",
      })
    );
    const trend = executionTrend(
      executionSamples(sessions, results, "high_lactate", "2026-07-22")
    );
    expect(trend.verdict).toBe("hold");
  });
});

describe("ジョグを状態の測定値として使う", () => {
  function jog(date: string, pace: number, hr: number): SessionResult {
    return {
      id: `j-${date}`,
      sessionId: `sj-${date}`,
      date,
      actualLapsSec: [],
      continuous: { distanceKm: 10, durationMin: 50, avgPaceSecPerKm: pace, avgHr: hr },
      achievement: "achieved",
      rpe: 3,
      subjective: "easy",
    };
  }

  it("同じペース帯で心拍が上がっていれば疲労とみなす", () => {
    const r = [
      jog("2026-06-25", 300, 148),
      jog("2026-06-28", 302, 150),
      jog("2026-07-01", 298, 149),
      jog("2026-07-21", 300, 156),
      jog("2026-07-23", 301, 155),
    ];
    const e = jogEfficiency(r, "2026-07-25");
    expect(e.fatigued).toBe(true);
    expect(e.deltaBpm).toBeGreaterThanOrEqual(4);
  });

  it("本数が足りなければ判定しない", () => {
    const e = jogEfficiency([jog("2026-07-20", 300, 150)], "2026-07-25");
    expect(e.fatigued).toBe(false);
    expect(e.note).toContain("足りません");
  });
});

describe("当日の状態", () => {
  it("赤信号は質を入れない", () => {
    const d = dailyAdjustment(undefined, "red");
    expect(d.blocked).toBe(true);
  });

  it("黄信号は強度を維持して量を30%減らす（既存ルールと同じ扱い）", () => {
    const d = dailyAdjustment(undefined, "yellow");
    expect(d.factor).toBe(1);
    expect(d.repFactor).toBeCloseTo(0.7, 3);
  });

  it("疲労と睡眠から秒で調整量を出す", () => {
    const d = dailyAdjustment(
      { date: "2026-07-25", legFatigue: 4, overallFatigue: 4, sleepQuality: 2 },
      "green"
    );
    expect(d.factor).toBeGreaterThan(1);
    expect(d.reasons.length).toBeGreaterThanOrEqual(3);
  });

  it("調整量には上限がある", () => {
    const d = dailyAdjustment(
      { date: "2026-07-25", legFatigue: 5, overallFatigue: 5, sleepQuality: 1, restingHr: 60 },
      "green",
      undefined,
      48
    );
    expect(d.factor).toBeLessThanOrEqual(1.02001);
  });
});

describe("処方の作り直し", () => {
  it("緩めた量を秒で出し、理由を必ず添える", () => {
    const session = hl("2026-07-28");
    const s = [hl("2026-07-01"), hl("2026-07-08"), hl("2026-07-15")];
    const r = [
      res(s[0], [44.0, 44.2, 44.1, 44.3]),
      res(s[1], [43.8, 44.0, 44.4, 44.6]),
      res(s[2], [44.2, 44.5, 44.3, 44.8]),
    ];
    const trend = executionTrend(executionSamples(s, r, "high_lactate", "2026-07-22"));
    const p = adjustPrescription({
      session,
      trend,
      daily: dailyAdjustment({ date: "2026-07-28", legFatigue: 4 }, "green"),
    });
    expect(p.hasChange).toBe(true);
    expect(p.offsetSecPerRep).toBeGreaterThan(0);
    expect(p.reasons.join()).toContain("平均乖離");
    expect(p.changes.some((c) => c.triggeredBy === "M-2")).toBe(true);
  });

  it("変化が無ければ提案しない", () => {
    const session = hl("2026-07-28");
    const p = adjustPrescription({
      session,
      trend: executionTrend([]),
      daily: dailyAdjustment(undefined, "green"),
    });
    expect(p.hasChange).toBe(false);
  });

  it("本数は処方から読む", () => {
    expect(repsOf(hl("2026-07-28"))).toBe(4);
  });
});

describe("M-9 暑熱補正", () => {
  it("WBGTが無ければ補正しない", () => {
    const a = heatPaceAdjustment({ tempC: 33 });
    expect(a.applied).toBe(false);
    expect(a.factor).toBe(1);
  });

  it("暑熱耐性が低いと補正が大きい", () => {
    const normal = heatPaceAdjustment({ tempC: 33, humidityPct: 70, heatTolerance: "normal" });
    const low = heatPaceAdjustment({ tempC: 33, humidityPct: 70, heatTolerance: "low" });
    expect(low.pct).toBeGreaterThan(normal.pct);
    expect(low.applied).toBe(true);
  });

  it("有酸素系は対象外", () => {
    const a = heatPaceAdjustment({ tempC: 33, humidityPct: 70, category: "aerobic" });
    expect(a.applied).toBe(false);
  });

  it("補正した設定で走った実測は、涼しい条件相当に戻してから評価する", () => {
    const a = heatPaceAdjustment({ tempC: 33, humidityPct: 70, heatTolerance: "low" });
    const actual = 44.0;
    const normalized = normalizeForHeat(actual, a);
    expect(normalized).toBeLessThan(actual);
    expect(normalized).toBeCloseTo(actual / a.factor, 5);
  });
});

describe("M-3 中止基準", () => {
  it("高乳酸は1本でも超えたら止める", () => {
    const c = abortCriteria("high_lactate", 41.5);
    expect(c.maxConsecutiveOver).toBe(1);
    expect(c.toleranceSec).toBe(2.0);
    const e = evaluateReps([41.6, 44.0], 41.5, 4, c);
    expect(e.verdict).toBe("stop");
  });

  it("CVは2本連続で止める。1本の乱れでは止めない", () => {
    const c = abortCriteria("cv", 190);
    expect(c.maxConsecutiveOver).toBe(2);
    expect(c.toleranceSec).toBeCloseTo(2.9, 1);
    expect(evaluateReps([190, 194], 190, 4, c).verdict).toBe("continue");
    expect(evaluateReps([190, 194, 195], 190, 4, c).verdict).toBe("stop");
  });

  it("超過が途切れたら連続はリセットされる", () => {
    const c = abortCriteria("cv", 190);
    expect(evaluateReps([194, 190, 194], 190, 5, c).verdict).toBe("continue");
  });

  it("予定本数まで終われば done", () => {
    const c = abortCriteria("cv", 190);
    expect(evaluateReps([190, 190, 190, 190], 190, 4, c).verdict).toBe("done");
  });

  it("垂れ幅を出す", () => {
    const c = abortCriteria("cv", 190);
    const e = evaluateReps([188, 189, 191], 190, 5, c);
    expect(e.fadeSec).toBeCloseTo(3, 5);
  });
});
