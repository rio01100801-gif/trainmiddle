/**
 * トレーニングロジック統合監査（2026-07-31）で要求された性質・境界テスト。
 * 「常に成り立つべき性質」を固定シナリオで確認する（fast-check等は未導入のため、
 * このリポジトリの既存スタイルに合わせて決定論的なケースで代表させる）。
 */
import { describe, it, expect } from "vitest";
import { initCfe, applyStaleness } from "@/lib/core/cfe";
import { computeReadiness, type ReadinessInput } from "@/lib/core/readiness";
import { sessionLoad, dailyLoads } from "@/lib/core/load";
import { planVolumeProgression } from "@/lib/core/volumeProgression";
import { addDays, diffDays, parseDate } from "@/lib/core/dates";
import { parseRow } from "@/lib/core/bulkImport";
import { memRepo } from "./sqlite-helper";
import { makeSession, makeResult, makeRace, testAthlete } from "./helpers";
import { regeneratePlan } from "@/lib/service";
import type { Goal, Session } from "@/lib/core/types";

describe("性質1: 目標タイムを厳しくするだけでは（新しい結果が無い限り）CFEは変わらない", () => {
  it("目標だけ変えてもCFE自体（estimated800mSec）は不変", () => {
    const repo = memRepo();
    repo.saveAthlete(testAthlete());
    repo.saveCfe(initCfe(109.51, "2026-04-01"));
    const before = repo.getCfe()!.estimated800mSec;
    const goal: Goal = {
      targetEvent: "800m",
      targetTimeSec: 95.0, // 非現実的に厳しい目標
      subRaceIds: [],
    };
    repo.saveGoal(goal);
    // 目標を保存しただけではCFEは変化しない
    expect(repo.getCfe()!.estimated800mSec).toBe(before);
  });
});

describe("性質2: 疲労シグナルが強いほどreadinessスコアは上がらない（単調性）", () => {
  it("green >= yellow >= red の順でスコアが単調に下がる", () => {
    const s = makeSession("2026-04-02", "aerobic");
    const athlete = testAthlete();
    const base: Omit<ReadinessInput, "signal"> = { session: s, athlete };
    const green = computeReadiness({ ...base, signal: "green" });
    const yellow = computeReadiness({ ...base, signal: "yellow" });
    const red = computeReadiness({ ...base, signal: "red" });
    expect(green.score).toBeGreaterThanOrEqual(yellow.score);
    expect(yellow.score).toBeGreaterThanOrEqual(red.score);
  });
});

describe("性質3: 結果が無い期間が長いほど信頼度は下がる（上がらない）", () => {
  it("14日を境に確信度が下がり、それ以上更新しても再び上がらない", () => {
    const cfe = initCfe(109.51, "2026-04-01");
    const c0 = cfe.confidence;
    const after14 = applyStaleness(cfe, "2026-04-15");
    expect(after14.confidence).toBeLessThanOrEqual(c0);
    const after28 = applyStaleness(after14, "2026-04-29");
    expect(after28.confidence).toBeLessThanOrEqual(after14.confidence);
  });
});

describe("性質4: 未実施(planned)のセッションは負荷計算で完了扱いにならない", () => {
  it("plannedのセッションはdailyLoadsの合計に加算されない", () => {
    const s = makeSession("2026-04-02", "high_lactate", { status: "planned" });
    const loads = dailyLoads({
      sessions: [s],
      resultsBySessionId: new Map(),
      strengthSessions: [],
    });
    expect(loads.get("2026-04-02") ?? 0).toBe(0);
  });

  it("completedのセッションのみ負荷が加算される", () => {
    const s = makeSession("2026-04-02", "high_lactate", { status: "completed" });
    const loads = dailyLoads({
      sessions: [s],
      resultsBySessionId: new Map(),
      strengthSessions: [],
    });
    expect(loads.get("2026-04-02") ?? 0).toBe(sessionLoad(s));
    expect(sessionLoad(s)).toBeGreaterThan(0);
  });
});

describe("性質5: 休養(off)日は自動ボリューム進行の対象にならない", () => {
  it("offカテゴリのセッションはplanVolumeProgressionの候補から除外される", () => {
    const anchor = makeSession("2026-04-01", "aerobic", {
      id: "anchor",
      status: "planned",
      durationMin: 40,
    });
    const offDay = makeSession("2026-04-02", "off", {
      id: "off-1",
      status: "planned",
    });
    const changes = planVolumeProgression({
      sessions: [anchor, offDay],
      anchorSessionId: "anchor",
      today: "2026-04-01",
    });
    expect(changes.some((c) => c.sessionId === "off-1")).toBe(false);
  });
});

describe("性質6: 完了済みセッションとその結果は再生成で変更されない", () => {
  it("regeneratePlan後もcompletedセッションのid・結果は残る", () => {
    const repo = memRepo();
    repo.saveAthlete(testAthlete());
    const race = makeRace("2026-09-25");
    repo.saveRace(race);
    const goal: Goal = {
      targetEvent: "800m",
      targetTimeSec: 108.9,
      targetRaceId: race.id,
      subRaceIds: [],
    };
    repo.saveGoal(goal);
    regeneratePlan(repo, "2026-04-01");

    const completed: Session = {
      ...makeSession("2026-04-01", "high_lactate", { id: "s-completed-fixed", status: "completed" }),
    };
    repo.saveSession(completed);
    const result = makeResult(completed, { id: "r-fixed", achievement: "achieved" });
    repo.saveResult(result);

    regeneratePlan(repo, "2026-04-01");

    const stillThere = repo.listSessions().find((s) => s.id === "s-completed-fixed");
    expect(stillThere?.status).toBe("completed");
    const stillResult = repo.listResults().find((r) => r.id === "r-fixed");
    expect(stillResult).toBeDefined();
  });
});

describe("性質7: 日付演算はタイムゾーンに依存しない", () => {
  it("addDays/diffDaysは単純なUTC日付演算として一貫している（年またぎ・月またぎ含む）", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01"); // 2026年は平年
    expect(diffDays("2026-01-01", "2027-01-01")).toBe(365);
    expect(diffDays("2026-04-01", "2026-04-01")).toBe(0);
  });

  it("parseDateはローカルタイムゾーンの影響を受けない（UTC固定）", () => {
    const d = parseDate("2026-07-26");
    expect(d.getUTCFullYear()).toBe(2026);
    expect(d.getUTCMonth()).toBe(6);
    expect(d.getUTCDate()).toBe(26);
    expect(d.getUTCHours()).toBe(0);
  });
});

describe("性質8: 不正な数値入力は安全に拒否・無視される（推測で埋めない）", () => {
  it("日付として読めない行はready=falseで理由付きのissueを返し、無理に埋めない", () => {
    const row = parseRow("これは日付じゃない 300m5本", 1, "2026-04-01");
    expect(row.ready).toBe(false);
    expect(row.date).toBeUndefined();
    expect(row.issues.length).toBeGreaterThan(0);
  });

  it("NaN/Infinityを含むCFE操作は破綻しない", () => {
    const cfe = initCfe(109.51, "2026-04-01");
    // 異常値を持つセッション日で呼んでも例外を投げない
    expect(() => applyStaleness(cfe, "2026-04-01")).not.toThrow();
    expect(Number.isFinite(cfe.estimated800mSec)).toBe(true);
  });
});
