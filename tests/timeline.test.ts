import { describe, it, expect } from "vitest";
import { buildTimeline } from "@/lib/core/timeline";
import { makeSession } from "./helpers";
import type { DailyCheck } from "@/lib/core/types";

describe("分析画面: 28日間統合タイムライン", () => {
  it("既定で直近28日分を、古い順に並べて返す", () => {
    const t = buildTimeline({
      today: "2026-07-31",
      loadSeries: [],
      dailyChecks: [],
      sessions: [],
      raceDates: [],
    });
    expect(t).toHaveLength(28);
    expect(t[0].date).toBe("2026-07-04");
    expect(t[27].date).toBe("2026-07-31");
  });

  it("daysを指定すればその日数分になる", () => {
    const t = buildTimeline({
      today: "2026-07-31",
      days: 7,
      loadSeries: [],
      dailyChecks: [],
      sessions: [],
      raceDates: [],
    });
    expect(t).toHaveLength(7);
    expect(t[0].date).toBe("2026-07-25");
  });

  it("loadSeriesとDailyCheckを同じ日付キーで統合する", () => {
    const check: DailyCheck = {
      date: "2026-07-20",
      sleepQuality: 3,
      legFatigue: 4,
      muscleTightness: 2,
      restingHr: 48,
      signal: "yellow",
    };
    const t = buildTimeline({
      today: "2026-07-31",
      days: 28,
      loadSeries: [{ date: "2026-07-20", load: 350, acwr: 1.2 }],
      dailyChecks: [check],
      sessions: [],
      raceDates: [],
    });
    const day = t.find((d) => d.date === "2026-07-20")!;
    expect(day.load).toBe(350);
    expect(day.acwr).toBe(1.2);
    expect(day.sleepQuality).toBe(3);
    expect(day.legFatigue).toBe(4);
    expect(day.muscleTightness).toBe(2);
    expect(day.restingHr).toBe(48);
    expect(day.signal).toBe("yellow");
  });

  it("記録が無い日は負荷0・他はundefinedで埋める（推測で埋めない）", () => {
    const t = buildTimeline({
      today: "2026-07-31",
      days: 3,
      loadSeries: [],
      dailyChecks: [],
      sessions: [],
      raceDates: [],
    });
    for (const d of t) {
      expect(d.load).toBe(0);
      expect(d.acwr).toBeUndefined();
      expect(d.sleepQuality).toBeUndefined();
      expect(d.isRest).toBe(false);
      expect(d.isRace).toBe(false);
    }
  });

  it("category=offのセッションがある日はisRest", () => {
    const off = makeSession("2026-07-29", "off");
    const t = buildTimeline({
      today: "2026-07-31",
      days: 3,
      loadSeries: [],
      dailyChecks: [],
      sessions: [off],
      raceDates: [],
    });
    expect(t.find((d) => d.date === "2026-07-29")!.isRest).toBe(true);
    expect(t.find((d) => d.date === "2026-07-30")!.isRest).toBe(false);
  });

  it("raceDatesに含まれる日はisRace", () => {
    const t = buildTimeline({
      today: "2026-07-31",
      days: 3,
      loadSeries: [],
      dailyChecks: [],
      sessions: [],
      raceDates: ["2026-07-30"],
    });
    expect(t.find((d) => d.date === "2026-07-30")!.isRace).toBe(true);
    expect(t.find((d) => d.date === "2026-07-31")!.isRace).toBe(false);
  });
});
