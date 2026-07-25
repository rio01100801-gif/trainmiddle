/**
 * 実サービス層から実データのAPIレスポンス(fixtures)を生成する。
 * ブラウザ側の fetch スタブがこれを返すことで、実コンポーネントを実データで描画検証する。
 */
import { Database } from "bun:sqlite";
import type { DbDriver } from "../src/lib/db/driver";
import { Repo } from "../src/lib/db/repo";
import {
  dashboard,
  processDailyCheck,
  processResult,
  regeneratePlan,
} from "../src/lib/service";
import { judgeEconomyTrend } from "../src/lib/core/propagation";
import { acwr, dailyLoads, highLactate28dAvgPerWeek } from "../src/lib/core/load";
import { restingHrTrend } from "../src/lib/core/signal";
import { addDays, weekStart } from "../src/lib/core/dates";
import { weeklySummary, runRuleEngine } from "../src/lib/core/rules";
import { buildRuleContext } from "../src/lib/service";
import { buildAerobicProfile } from "../src/lib/core/pace";
import {
  assessHeatBlock,
  HEAT_BLOCK_CONTENT,
  heatBlockTimingCheck,
  planHeatBlock,
  raceDayHeatChecklist,
} from "../src/lib/core/heat";

const db = new Database(":memory:");
const driver: DbDriver = {
  exec: (sql) => db.exec(sql),
  prepare: (sql) => {
    const stmt = db.query(sql);
    return {
      run: (...p: unknown[]) => stmt.run(...(p as never[])),
      get: (...p: unknown[]) => stmt.get(...(p as never[])),
      all: (...p: unknown[]) => stmt.all(...(p as never[])),
    };
  },
  close: () => db.close(),
};
const repo = new Repo(driver);
const today = new Date().toISOString().slice(0, 10);

// --- セットアップ（伊藤選手のプロフィール相当） ---
repo.saveAthlete({
  id: "athlete-1",
  name: "伊藤 吏央",
  heightCm: 171,
  weightKg: 64.5,
  skeletalMuscleKg: 32.5,
  pb400mSec: 49.0,
  pb800mSec: 109.51,
  pb1500mSec: 236.0,
  heatTolerance: "low",
  recoveryProfile: "normal",
  injuryHistory: [],
});
const race = {
  id: "race-target",
  name: "秋季選手権",
  dateStart: "2026-09-25",
  priority: "A" as const,
  rounds: [
    { type: "heat" as const, datetime: "2026-09-25T10:00:00" },
    { type: "final" as const, datetime: "2026-09-27T15:00:00" },
  ],
  peakTargetRound: "final" as const,
  advancementRule: "place" as const,
};
repo.saveRace(race);
repo.saveGoal({
  targetEvent: "800m",
  targetTimeSec: 108.9,
  targetRaceId: race.id,
  subRaceIds: [],
});
repo.saveMarker({
  id: "fm-1",
  date: addDays(today, -10),
  type: "workout",
  description: "8kmペース走",
  resultLapsSec: [1840],
  lapDistancesM: [8000],
  avgHr: 186,
});
regeneratePlan(repo, addDays(weekStart(today), -28));

// 日次チェック（黄シグナルが出る状態を作る）
for (let i = 14; i >= 2; i--) {
  processDailyCheck(repo, { date: addDays(today, -i), restingHr: 48, sleepQuality: 4 });
}
processDailyCheck(repo, { date: addDays(today, -1), restingHr: 53, sleepQuality: 3 });
processDailyCheck(repo, {
  date: today,
  restingHr: 53,
  sleepQuality: 3,
  muscleTightness: 3,
  overallFatigue: 3,
});

// 過去の質練習に結果を入れて CFE 履歴・変更ログを作る
const done = repo
  .listSessions()
  .filter(
    (s) =>
      s.date < today &&
      ["high_lactate", "race_economy", "threshold"].includes(s.category)
  )
  .slice(0, 5);
for (const [i, s] of done.entries()) {
  processResult(repo, {
    id: `res-${i}`,
    sessionId: s.id,
    date: s.date,
    actualLapsSec: [],
    achievement: i === 1 ? "partial" : "achieved",
    rpe: s.category === "race_economy" ? 6 - Math.min(i, 1) : 8,
    subjective: i === 1 ? "very_hard" : "moderate",
    nextDayLegs: "normal",
  });
}

// 暑熱順化ブロック
const block = planHeatBlock(race);
repo.saveHeatBlock(block);
repo.saveHeatEntry(block.id, {
  date: block.startDate,
  tempC: 32,
  humidityPct: 70,
  avgHr: 155,
  paceSecPerKm: 300,
  weightBeforeKg: 64.5,
  weightAfterKg: 63.9,
});
repo.saveHeatEntry(block.id, {
  date: addDays(block.startDate, 5),
  tempC: 33,
  humidityPct: 65,
  avgHr: 149,
  paceSecPerKm: 302,
  weightBeforeKg: 64.4,
  weightAfterKg: 63.9,
});

// --- APIレスポンス形のfixtures ---
const athlete = repo.getAthlete()!;
const sessions = repo.listSessions();
const results = repo.listResults();
const resultsMap = new Map(results.map((r) => [r.sessionId, r]));
const sessionById = new Map(sessions.map((s) => [s.id, s]));
const loads = dailyLoads({
  sessions,
  resultsBySessionId: resultsMap,
  strengthSessions: repo.listStrengths(),
});
const loadSeries: any[] = [];
for (let i = 55; i >= 0; i--) {
  const d = addDays(today, -i);
  loadSeries.push({ date: d, load: loads.get(d) ?? 0, acwr: acwr(loads, d).acwr });
}
const ctx = buildRuleContext(repo, today);
const weeks = [3, 2, 1, 0].map((i) => weeklySummary(ctx, addDays(weekStart(today), -7 * i)));
const economyPoints = results
  .filter((r) => sessionById.get(r.sessionId)?.category === "race_economy")
  .map((r) => ({
    date: r.date,
    rpe: r.rpe,
    prescription: sessionById.get(r.sessionId)?.prescription ?? "",
  }));

const fixtures = {
  "/api/dashboard": dashboard(repo, today),
  "/api/athlete": { athlete },
  "/api/goal": { goal: repo.getGoal(), races: repo.listRaces() },
  "/api/sessions": { sessions, strengthSessions: repo.listStrengths() },
  "/api/markers": {
    markers: repo.listMarkers(),
    aerobicProfile: buildAerobicProfile(repo.listMarkers(), today, repo.getCfe()?.estimated800mSec),
  },
  "/api/analysis": {
    economyPoints,
    economyTrend: judgeEconomyTrend(economyPoints),
    loadSeries,
    acwrNow: acwr(loads, today),
    hlPerWeek28d: highLactate28dAvgPerWeek(sessions, today),
    cfeHistory: repo.getCfe()?.history ?? [],
    restingHrTrend: restingHrTrend(repo.listDailyChecks()),
    weeks,
    changeLog: repo.listChangeLog(50),
  },
  "/api/daily": { checks: repo.listDailyChecks() },
  "/api/heat": {
    blocks: repo.listHeatBlocks().map((b) => ({
      block: b,
      entries: repo.listHeatEntries(b.id),
      assessment: assessHeatBlock(repo.listHeatEntries(b.id), athlete.weightKg!),
      timingWarning: heatBlockTimingCheck(b, race),
    })),
    content: HEAT_BLOCK_CONTENT,
    raceDayChecklist: raceDayHeatChecklist(athlete, 30),
  },
  "/api/changes": { changes: repo.listChangeLog(100) },
};

await Bun.write("harness/fixtures.json", JSON.stringify(fixtures));
console.log(
  "fixtures generated:",
  Object.keys(fixtures).join(", "),
  "| sessions:",
  sessions.length,
  "| violations:",
  runRuleEngine(ctx).length
);
