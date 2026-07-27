import { describe, it, expect } from "vitest";
import { judgeSignal, effectiveSignal, restingHrTrend } from "@/lib/core/signal";
import { dailyLoads, acwr, sessionLoad, strengthLoad, plyoContactIncrease } from "@/lib/core/load";
import { analyzeRace } from "@/lib/core/raceAnalysis";
import { planHeatBlock, assessHeatBlock, raceDayHeatChecklist, heatBlockTimingCheck } from "@/lib/core/heat";
import { checkAchillesCare } from "@/lib/core/strength";
import { makeSession, makeStrength, makeRace, makeResult, testAthlete } from "./helpers";
import type { DailyCheck, SessionResult } from "@/lib/core/types";

describe("4-5-8 信号機モデル", () => {
  it("緑: 平常", () => {
    const r = judgeSignal({ date: "2026-04-01", restingHr: 48, sleepQuality: 4 }, 48);
    expect(r.signal).toBe("green");
  });

  it("黄: 安静HR+5 → 強度維持・量30%減", () => {
    const r = judgeSignal({ date: "2026-04-01", restingHr: 53 }, 48);
    expect(r.signal).toBe("yellow");
    expect(r.action).toContain("30%");
  });

  it("赤: 安静HR+10 → 完全休養・SKIP-02", () => {
    const r = judgeSignal({ date: "2026-04-01", restingHr: 58 }, 48);
    expect(r.signal).toBe("red");
    expect(r.action).toContain("SKIP-02");
  });

  it("黄3日連続で赤に準じた扱い", () => {
    const history: DailyCheck[] = [
      { date: "2026-04-01", signal: "yellow" },
      { date: "2026-04-02", signal: "yellow" },
      { date: "2026-04-03", signal: "yellow" },
    ];
    const r = effectiveSignal(history);
    expect(r.signal).toBe("red");
    expect(r.escalated).toBe(true);
  });

  it("黄2日なら黄のまま", () => {
    const history: DailyCheck[] = [
      { date: "2026-04-01", signal: "green" },
      { date: "2026-04-02", signal: "yellow" },
      { date: "2026-04-03", signal: "yellow" },
    ];
    expect(effectiveSignal(history).signal).toBe("yellow");
  });

  it("安静HRの上昇トレンドを検出する", () => {
    const checks: DailyCheck[] = Array.from({ length: 14 }, (_, i) => ({
      date: `2026-04-${String(i + 1).padStart(2, "0")}`,
      restingHr: 48 + i * 0.8,
    }));
    expect(restingHrTrend(checks).trend).toBe("rising");
  });
});

describe("4-9 累積負荷とACWR", () => {
  it("セッション負荷 = RPE × 実施時間", () => {
    const s = makeSession("2026-04-01", "high_lactate", { durationMin: 60 });
    const r = makeResult(s, { rpe: 8, durationMin: 60 });
    expect(sessionLoad(s, r)).toBe(480);
  });

  it("補強の負荷換算: heavy→RPE7相当", () => {
    const st = makeStrength("2026-04-01", { loadLevel: "heavy", durationMin: 40 });
    expect(strengthLoad(st)).toBe(280);
  });

  it("ACWR: データ不足時は insufficient_data", () => {
    const loads = new Map([["2026-04-01", 300]]);
    expect(acwr(loads, "2026-04-01").rating).toBe("insufficient_data");
  });

  it("ACWR: 均等な負荷なら1.0前後で optimal", () => {
    const loads = new Map<string, number>();
    for (let i = 0; i < 28; i++) {
      const d = new Date(Date.UTC(2026, 3, 1 + i));
      loads.set(d.toISOString().slice(0, 10), 300);
    }
    const r = acwr(loads, "2026-04-28");
    expect(r.acwr).toBeCloseTo(1.0, 1);
    expect(r.rating).toBe("optimal");
  });

  it("ACWR: 直近7日に負荷が跳ねると high_risk", () => {
    const loads = new Map<string, number>();
    for (let i = 0; i < 28; i++) {
      const d = new Date(Date.UTC(2026, 3, 1 + i));
      loads.set(d.toISOString().slice(0, 10), i >= 21 ? 600 : 200);
    }
    const r = acwr(loads, "2026-04-28");
    expect(r.acwr).toBeGreaterThan(1.5);
    expect(r.rating).toBe("high_risk");
  });

  it("日次負荷は実施済みだけを数え、未実施予定・skippedを除外する", () => {
    const s1 = makeSession("2026-04-01", "high_lactate", {
      durationMin: 60,
      status: "completed",
    });
    const s2 = makeSession("2026-04-01", "aerobic", { status: "skipped" });
    const planned = makeSession("2026-04-02", "high_lactate", { durationMin: 60 });
    const loads = dailyLoads({
      sessions: [s1, s2, planned],
      resultsBySessionId: new Map<string, SessionResult>(),
      strengthSessions: [],
    });
    expect(loads.get("2026-04-01")).toBe(8 * 60); // 期待RPE8 × 60分
    expect(loads.has("2026-04-02")).toBe(false);
  });

  it("ACWRは記録日数と信頼度を返す", () => {
    const loads = new Map<string, number>();
    for (let i = 0; i < 21; i++) {
      const d = new Date(Date.UTC(2026, 3, 8 + i));
      loads.set(d.toISOString().slice(0, 10), 200);
    }
    const result = acwr(loads, "2026-04-28");
    expect(result.recordedDays).toBe(21);
    expect(result.confidence).toBe("high");
    expect(result.coveragePct).toBeCloseTo(0.75, 2);
  });

  it("プライオ接地回数の週間増加率10%超でWARN", () => {
    const sts = [
      makeStrength("2026-04-06", { type: "plyometrics", contactCount: 100 }),
      makeStrength("2026-04-13", { type: "plyometrics", contactCount: 120 }),
    ];
    const r = plyoContactIncrease(sts, "2026-04-13");
    expect(r.increasePct).toBeCloseTo(20, 0);
    expect(r.warn).toBe(true);
  });
});

describe("4-5-7 レース分析", () => {
  const base = {
    targetTimeSec: 108.9,
    athlete: testAthlete(),
    cfeAfterRaceSec: 110.5,
    weeksToTargetRace: 10,
  };

  it("d > 4.0秒 → 後半維持に課題、high_lactate/modeling比率を上げる", () => {
    const r = analyzeRace({ ...base, front400Sec: 53.0, back400Sec: 58.0 });
    expect(r.splitDiffSec).toBeCloseTo(5.0, 1);
    expect(r.primaryIssue).toContain("後半維持");
    expect(
      r.adjustments.filter((a) => a.change === "increase").map((a) => a.category)
    ).toEqual(expect.arrayContaining(["high_lactate", "modeling"]));
  });

  it("1.0 ≦ d ≦ 4.0 → 標準的な減速。配分変更なし", () => {
    const r = analyzeRace({ ...base, front400Sec: 54.0, back400Sec: 56.5 });
    expect(r.primaryIssue).toContain("標準");
  });

  it("d < 1.0 かつ目標未達 → race_economy/neural比率を上げる", () => {
    const r = analyzeRace({ ...base, front400Sec: 55.5, back400Sec: 55.8 });
    expect(
      r.adjustments.filter((a) => a.change === "increase").map((a) => a.category)
    ).toEqual(expect.arrayContaining(["race_economy", "neural"]));
  });

  it("前半が設定より1.5秒以上遅い → modeling追加を提案", () => {
    const r = analyzeRace({
      ...base,
      front400Sec: 55.6,
      back400Sec: 57.0,
      plannedFront400Sec: 54.0,
    });
    expect(r.extraActions.join()).toContain("modeling");
  });

  it("後半設定比3秒遅+RPE10 → Specific期延長を提案", () => {
    const r = analyzeRace({
      ...base,
      front400Sec: 54.0,
      back400Sec: 59.5,
      plannedBack400Sec: 55.5,
      rpe: 10,
    });
    expect(r.extraActions.join()).toContain("Specific期の延長");
  });

  it("目標の現実性を再評価する", () => {
    const r = analyzeRace({ ...base, cfeAfterRaceSec: 113.0, weeksToTargetRace: 4, front400Sec: 55, back400Sec: 58 });
    expect(r.feasibility.warn).toBe(true);
  });
});

describe("4-10 暑熱順化ブロック", () => {
  it("ブロックはレース4〜6週前・10〜14日間で設計される", () => {
    const race = makeRace("2026-08-30");
    const b = planHeatBlock(race);
    expect(b.startDate).toBe("2026-07-26"); // 5週前
    expect(b.endDate).toBe("2026-08-06"); // 12日間
  });

  it("体重3%超の減少で脱水ERROR・中断指示", () => {
    const a = assessHeatBlock(
      [
        {
          date: "2026-07-26",
          tempC: 32,
          weightBeforeKg: 64.5,
          weightAfterKg: 62.2, // -3.6%
        },
      ],
      64.5
    );
    expect(a.dehydrationErrors.length).toBe(1);
    expect(a.message).toContain("中断");
  });

  it("同一ペースでHR5拍以上低下 → 順化成立", () => {
    const a = assessHeatBlock(
      [
        { date: "2026-07-26", tempC: 32, avgHr: 155, paceSecPerKm: 300 },
        { date: "2026-08-05", tempC: 32, avgHr: 148, paceSecPerKm: 302 },
      ],
      64.5
    );
    expect(a.acclimatized).toBe(true);
    expect(a.hrDrop).toBe(7);
  });

  it("heat_tolerance=low かつ28℃以上でレース当日チェックリストを出す", () => {
    const list = raceDayHeatChecklist(testAthlete(), 30);
    expect(list).toBeDefined();
    expect(list!.join()).toContain("プレクーリング");
    expect(raceDayHeatChecklist(testAthlete({ heatTolerance: "normal" }), 30)).toBeUndefined();
  });

  it("ブロック終了からレースまで2週間超で減衰警告", () => {
    const race = makeRace("2026-08-30");
    const warning = heatBlockTimingCheck(
      { id: "hb", startDate: "2026-07-01", endDate: "2026-07-31", targetRaceId: race.id },
      race
    );
    expect(warning).toContain("減衰");
  });
});

describe("4-8-3 アキレス腱ケア警告", () => {
  it("アキレス腱×静的ストレッチで警告+代替案", () => {
    const r = checkAchillesCare("アキレス腱の静的ストレッチを毎晩実施");
    expect(r.warn).toBe(true);
    expect(r.recommendations!.join()).toContain("カーフレイズ");
  });

  it("カーフレイズは警告なし", () => {
    expect(checkAchillesCare("カーフレイズ 3×15").warn).toBe(false);
  });
});
