import { NextRequest, NextResponse } from "next/server";
import { openRepo } from "@/lib/db/node";
import { judgeEconomyTrend } from "@/lib/core/propagation";
import { acwr, dailyLoads, highLactate28dAvgPerWeek } from "@/lib/core/load";
import { restingHrTrend } from "@/lib/core/signal";
import { addDays, weekStart, localToday } from "@/lib/core/dates";
import { weeklySummary } from "@/lib/core/rules";
import { buildTimeline } from "@/lib/core/timeline";
import { buildRuleContext, samePrescriptionGroups } from "@/lib/service";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const repo = openRepo();
  const today =
    req.nextUrl.searchParams.get("date") ?? localToday();

  // 経済走のRPE推移（4-5-6）
  const results = repo.listResults();
  const sessions = repo.listSessions();
  const sessionById = new Map(sessions.map((s) => [s.id, s]));
  const economyPoints = results
    .filter((r) => sessionById.get(r.sessionId)?.category === "race_economy")
    .map((r) => ({
      date: r.date,
      rpe: r.rpe,
      prescription: sessionById.get(r.sessionId)?.prescription ?? "",
    }));
  const economyTrend = judgeEconomyTrend(economyPoints);

  // 負荷推移とACWR
  const loads = dailyLoads({
    sessions,
    resultsBySessionId: new Map(results.map((r) => [r.sessionId, r])),
    strengthSessions: repo.listStrengths(),
  });
  const loadSeries: { date: string; load: number; acwr?: number }[] = [];
  for (let i = 55; i >= 0; i--) {
    const d = addDays(today, -i);
    loadSeries.push({
      date: d,
      load: loads.get(d) ?? 0,
      acwr: acwr(loads, d).acwr,
    });
  }

  // 週次サマリー（転移度バランス）
  let ctx;
  try {
    ctx = buildRuleContext(repo, today);
  } catch {
    ctx = undefined;
  }
  const weeks: ReturnType<typeof weeklySummary>[] = [];
  if (ctx) {
    for (let i = 3; i >= 0; i--) {
      weeks.push(weeklySummary(ctx, addDays(weekStart(today), -7 * i)));
    }
  }

  const timeline = buildTimeline({
    today,
    days: 28,
    loadSeries,
    dailyChecks: repo.listDailyChecks(),
    sessions,
    raceDates: repo
      .listMarkers()
      .filter((m) => m.type === "race")
      .map((m) => m.date),
  });

  return NextResponse.json({
    samePrescription: samePrescriptionGroups(repo),
    economyPoints,
    economyTrend,
    loadSeries,
    acwrNow: acwr(loads, today),
    hlPerWeek28d: highLactate28dAvgPerWeek(sessions, today),
    cfeHistory: repo.getCfe()?.history ?? [],
    restingHrTrend: restingHrTrend(repo.listDailyChecks()),
    timeline,
    weeks,
    changeLog: repo.listChangeLog(50),
  });
}
