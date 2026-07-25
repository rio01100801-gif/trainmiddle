/**
 * M-7 制限因子 / M-8 600m通過 / M-10 接地時間 / M-11 週次レビュー / M-12 書き出し
 */
import { describe, it, expect } from "vitest";
import { assessLimiter, categoryWeights } from "@/lib/core/limiter";
import { from800Laps, splitReference, splitTrend, MIN_SPLIT_SAMPLES } from "@/lib/core/split600";
import { assessContactTime, parseContactCsv } from "@/lib/core/contactTime";
import { buildWeeklyReview } from "@/lib/core/weeklyReview";
import { shouldRemindBackup, mergeById } from "@/lib/core/backup";
import { diffDays } from "@/lib/core/dates";
import { makeSession, testAthlete } from "./helpers";
import type { SessionResult } from "@/lib/core/types";

describe("M-7 制限因子", () => {
  it("400m 49.0 / 1500m 3:56 / 800m 1:49.51 は後半の維持が制限", () => {
    const a = assessLimiter(testAthlete());
    expect(a.limiter).toBe("endurance");
    expect(a.from400!.fastSec).toBeCloseTo(107, 1);
    expect(a.narrative).toContain("後半の維持");
  });

  it("400mが遅い選手はスピードが制限", () => {
    // 800m 1:49.5 に対して 400m 52.0（換算差5.5秒＝スピード資源が乏しい）
    const a = assessLimiter(testAthlete({ pb400mSec: 52.0, pb1500mSec: 226 }));
    expect(a.limiter).toBe("speed");
    expect(a.narrative).toContain("絶対スピード");
  });

  it("PBが無ければ判定しない", () => {
    const a = assessLimiter(testAthlete({ pb400mSec: undefined, pb1500mSec: undefined }));
    expect(a.limiter).toBe("unknown");
  });

  it("維持が制限ならCVを削って経済走を増やす", () => {
    const w = categoryWeights("endurance");
    expect(w.find((x) => x.category === "race_economy")!.weight).toBeGreaterThan(1);
    expect(w.find((x) => x.category === "cv")!.weight).toBeLessThan(1);
  });

  it("バランス型なら配分を変えない", () => {
    expect(categoryWeights("balanced")).toHaveLength(0);
  });
});

describe("M-8 600m通過", () => {
  it("1:48.90の基準線", () => {
    const r = splitReference(108.9);
    expect(r.pass400Sec).toBeCloseTo(54.5, 1);
    expect(r.pass600Sec).toBeCloseTo(81.5, 1);
    expect(r.last200Sec).toBeCloseTo(27.4, 1);
  });

  it("200m刻みのラップからは推定せずに出す", () => {
    const s = from800Laps("2026-07-13", [26.5, 28.0, 28.5, 30.0])!;
    expect(s.estimated).toBe(false);
    expect(s.pass600Sec).toBeCloseTo(83.0, 2);
    expect(s.last200Sec).toBeCloseTo(30.0, 2);
  });

  it("400+400しかなければ推定と明示する", () => {
    const s = from800Laps("2026-07-13", [56.0, 60.0])!;
    expect(s.estimated).toBe(true);
    expect(s.pass600Sec).toBeCloseTo(56 + 60 * 0.48, 2);
  });

  it("材料が2本未満なら指標を出さない", () => {
    const t = splitTrend([from800Laps("2026-07-13", [56.0, 60.0])!], 108.9);
    expect(t.enough).toBe(false);
    expect(t.narrative).toContain(`${MIN_SPLIT_SAMPLES}本`);
  });

  it("2本あれば基準線との差と変化を出す", () => {
    const t = splitTrend(
      [
        from800Laps("2026-06-13", [56.0, 60.0])!,
        from800Laps("2026-07-13", [55.0, 58.0])!,
      ],
      108.9
    );
    expect(t.enough).toBe(true);
    expect(t.pass600GapSec).toBeDefined();
    expect(t.last200TrendSec).toBeLessThan(0); // 残り200mが速くなっている
    expect(t.narrative).toContain("基準線");
  });
});

describe("M-10 接地時間", () => {
  const mk = (date: string, ms: number, pace = 300) => ({ date, contactMs: ms, paceSecPerKm: pace });

  it("データが無ければ何も出さない", () => {
    const a = assessContactTime([], "2026-07-25");
    expect(a.fatigued).toBe(false);
    expect(a.narrative).toContain("ありません");
  });

  it("同じペース帯で伸び続けたら疲労として出す", () => {
    const a = assessContactTime(
      [
        mk("2026-06-20", 155),
        mk("2026-06-24", 154),
        mk("2026-06-28", 156),
        mk("2026-07-02", 155),
        mk("2026-07-20", 166),
        mk("2026-07-22", 167),
        mk("2026-07-24", 168),
      ],
      "2026-07-25"
    );
    expect(a.fatigued).toBe(true);
    expect(a.deltaPct).toBeGreaterThan(0.05);
    expect(a.narrative).toContain("故障の予兆");
  });

  it("範囲内なら知らせない", () => {
    const a = assessContactTime(
      [
        mk("2026-06-20", 155),
        mk("2026-06-24", 154),
        mk("2026-06-28", 156),
        mk("2026-07-02", 155),
        mk("2026-07-20", 156),
        mk("2026-07-22", 155),
        mk("2026-07-24", 157),
      ],
      "2026-07-25"
    );
    expect(a.fatigued).toBe(false);
  });

  it("CSVを列の位置で読む", () => {
    const rows = parseContactCsv("2026-07-20,158,4:45\n2026-07-21,160,285\nheader,x,y");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ date: "2026-07-20", contactMs: 158, paceSecPerKm: 285 });
  });
});

describe("M-11 週次レビュー", () => {
  it("実測を引用した文章を出す", () => {
    const s = makeSession("2026-07-21", "high_lactate", { name: "300m×4" });
    const r: SessionResult = {
      id: "r1",
      sessionId: s.id,
      date: "2026-07-21",
      actualLapsSec: [41.5, 41.8, 42.2, 42.5],
      interval: {
        reps: 4,
        distanceM: 300,
        targetSec: 41.5,
        restType: "jog",
        results: [41.5, 41.8, 42.2, 42.5].map((t, i) => ({
          index: i + 1,
          distanceM: 300,
          targetSec: 41.5,
          actualSec: t,
        })),
      },
      achievement: "partial",
      rpe: 8,
      subjective: "hard",
    };
    const rev = buildWeeklyReview({
      weekStart: "2026-07-20",
      sessions: [s],
      results: [r],
      checks: [{ date: "2026-07-21", restingHr: 48, overallFatigue: 3 }],
      violations: [],
      acwr: 1.1,
    });
    expect(rev.text).toContain("設定41.5秒に対して平均42.0秒");
    expect(rev.text).toContain("垂れ幅");
    expect(rev.text).not.toContain("調子が良");
    expect(rev.qualityCount).toBe(1);
  });

  it("打ち切りは失敗ではないと書く", () => {
    const s = makeSession("2026-07-21", "high_lactate", { name: "300m×4" });
    const r: SessionResult = {
      id: "r1",
      sessionId: s.id,
      date: "2026-07-21",
      actualLapsSec: [41.5, 44.8],
      interval: {
        reps: 4,
        distanceM: 300,
        targetSec: 41.5,
        restType: "jog",
        results: [41.5, 44.8].map((t, i) => ({
          index: i + 1,
          distanceM: 300,
          targetSec: 41.5,
          actualSec: t,
        })),
      },
      completedReps: 2,
      prescribedReps: 4,
      aborted: true,
      achievement: "partial",
      rpe: 9,
      subjective: "very_hard",
    };
    const rev = buildWeeklyReview({
      weekStart: "2026-07-20",
      sessions: [s],
      results: [r],
      checks: [],
      violations: [],
    });
    expect(rev.text).toContain("打ち切り");
    expect(rev.text).toContain("失敗ではありません");
  });
});

describe("M-12 書き出しの催促", () => {
  it("一度も書き出していなければ促す", () => {
    const r = shouldRemindBackup(undefined, "2026-07-25", diffDays);
    expect(r.remind).toBe(true);
  });

  it("14日たったら促す", () => {
    expect(shouldRemindBackup("2026-07-10", "2026-07-25", diffDays).remind).toBe(true);
    expect(shouldRemindBackup("2026-07-20", "2026-07-25", diffDays).remind).toBe(false);
  });

  it("統合は同じidを重複させない", () => {
    const { merged, added, updated } = mergeById(
      [{ id: "a", v: 1 } as any, { id: "b", v: 2 } as any],
      [{ id: "b", v: 3 } as any, { id: "c", v: 4 } as any]
    );
    expect(merged).toHaveLength(3);
    expect(added).toBe(1);
    expect(updated).toBe(1);
    expect(merged.find((x: any) => x.id === "b")).toMatchObject({ v: 3 });
  });
});
