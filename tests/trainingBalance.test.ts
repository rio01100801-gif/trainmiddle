import { describe, expect, it } from "vitest";
import { buildFourWeekBalance } from "@/lib/core/trainingBalance";
import { makeResult, makeSession } from "./helpers";

describe("4週間バランス", () => {
  it("予定と実施を分け、未実施・変更・中止を区別する", () => {
    const completed = makeSession("2026-07-06", "threshold", {
      status: "completed",
      distanceKm: 10,
      durationMin: 55,
    });
    const modified = makeSession("2026-07-07", "aerobic", {
      status: "modified",
      distanceKm: 7,
      durationMin: 40,
    });
    const skipped = makeSession("2026-07-08", "high_lactate", { status: "skipped" });
    const balance = buildFourWeekBalance({
      sessions: [completed, modified, skipped],
      results: [makeResult(completed, { durationMin: 52, rpe: 6, achievement: "partial" })],
      today: "2026-07-12",
    });
    const week = balance.weeks.at(-1)!;
    expect(week.plannedSessions).toBe(3);
    expect(week.completedSessions).toBe(1);
    expect(week.modifiedSessions).toBe(1);
    expect(week.skippedSessions).toBe(1);
    expect(week.unmetSessions).toBe(1);
    expect(week.categories.aerobic_high).toEqual({ planned: 1, completed: 1 });
  });

  it("月曜始まりで週をまたぐ日付を別週に集計する", () => {
    const sunday = makeSession("2026-07-05", "aerobic", { status: "completed" });
    const monday = makeSession("2026-07-06", "aerobic", { status: "completed" });
    const balance = buildFourWeekBalance({
      sessions: [sunday, monday],
      results: [makeResult(sunday), makeResult(monday)],
      today: "2026-07-12",
    });
    expect(balance.weeks.at(-2)!.completedSessions).toBe(1);
    expect(balance.weeks.at(-1)!.completedSessions).toBe(1);
  });

  it("前週比の急増を実施負荷から検出する", () => {
    const priorA = makeSession("2026-06-22", "aerobic", { status: "completed", durationMin: 40 });
    const priorB = makeSession("2026-06-24", "aerobic", { status: "completed", durationMin: 40 });
    const latestA = makeSession("2026-06-29", "threshold", { status: "completed", durationMin: 60 });
    const latestB = makeSession("2026-07-01", "race_economy", { status: "completed", durationMin: 60 });
    const sessions = [priorA, priorB, latestA, latestB];
    const results = [
      makeResult(priorA, { rpe: 3, durationMin: 40 }),
      makeResult(priorB, { rpe: 3, durationMin: 40 }),
      makeResult(latestA, { rpe: 7, durationMin: 60 }),
      makeResult(latestB, { rpe: 8, durationMin: 60 }),
    ];
    const balance = buildFourWeekBalance({ sessions, results, today: "2026-07-06" });
    expect(balance.signals.some((signal) => signal.code === "load_surge")).toBe(true);
  });

  it("データが少ない場合は不足を断定しない", () => {
    const session = makeSession("2026-07-05", "aerobic", { status: "completed" });
    const balance = buildFourWeekBalance({
      sessions: [session],
      results: [makeResult(session)],
      today: "2026-07-06",
    });
    expect(balance.signals).toHaveLength(1);
    expect(balance.signals[0].code).toBe("insufficient_data");
  });

  it("高乳酸・解糖系が直近10日に集中したことを対象日つきで検出する", () => {
    const sessions = [
      makeSession("2026-07-01", "aerobic", { status: "completed" }),
      makeSession("2026-07-03", "threshold", { status: "completed" }),
      makeSession("2026-07-05", "high_lactate", { status: "completed" }),
      makeSession("2026-07-10", "high_lactate", { status: "completed" }),
    ];
    const balance = buildFourWeekBalance({
      sessions,
      results: sessions.map((session) => makeResult(session)),
      today: "2026-07-12",
    });
    const signal = balance.signals.find((item) => item.code === "glycolytic_cluster");
    expect(signal?.message).toContain("2回");
    expect(signal?.dates).toEqual(["2026-07-05", "2026-07-10"]);
  });

  it("短い神経刺激と高容量のスピード持久を高負荷日で区別する", () => {
    const short = makeSession("2026-07-07", "neural", {
      status: "completed",
      prescription: "100m × 4本（完全休息）",
    });
    const demanding = makeSession("2026-07-09", "neural", {
      status: "completed",
      prescription: "300m × 5本 r5分",
    });
    const balance = buildFourWeekBalance({
      sessions: [short, demanding],
      results: [makeResult(short), makeResult(demanding)],
      today: "2026-07-12",
    });
    expect(balance.weeks.at(-1)!.highLoadDays).toBe(1);
    expect(balance.weeks.at(-1)!.categories.neuromuscular.completed).toBe(2);
  });
});
