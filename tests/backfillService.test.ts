/**
 * 過去データ入力のサービス層統合テスト。
 *
 * ここで守りたい最重要の性質:
 * 過去データを何件入れてもCFEは動かない。動くのは本人が承認したときだけ。
 * これが崩れると、±1.5秒のガードレールが件数ぶん適用されて
 * CFEがいくらでも動く（＝ガードレールが無意味になる）。
 */
import { describe, it, expect } from "vitest";
import { Repo } from "@/lib/db/repo";
import { memRepo } from "./sqlite-helper";
import {
  regeneratePlan,
  addPastEntry,
  assessFitness,
  applyAssessedCfe,
  deletePastEntry,
  buildRuleContext,
  dashboard,
} from "@/lib/service";
import { acwr, dailyLoads } from "@/lib/core/load";
import { makeRace, testAthlete } from "./helpers";
import type { Goal } from "@/lib/core/types";
import type { PastEntry } from "@/lib/core/backfill";

const TODAY = "2026-07-25";

function setup(): Repo {
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
  regeneratePlan(repo, TODAY);
  return repo;
}

let n = 0;
function pe(over: Partial<PastEntry> & Pick<PastEntry, "kind">): PastEntry {
  n++;
  return { id: `pe-${n}`, date: TODAY, ...over } as PastEntry;
}

describe("過去データ入力", () => {
  it("何件入れてもCFEは動かない（承認するまで反映しない）", () => {
    const repo = setup();
    const before = repo.getCfe()!.estimated800mSec;
    for (let i = 0; i < 12; i++) {
      addPastEntry(
        repo,
        pe({
          kind: "interval",
          date: `2026-07-${String(2 + i).padStart(2, "0")}`,
          category: "high_lactate",
          repDistanceM: 300,
          repTimesSec: [46, 46.5, 47, 47.5],
          rpe: 9,
          tempC: 20,
        })
      );
    }
    expect(repo.getCfe()!.estimated800mSec).toBe(before);
    expect(repo.getCfe()!.history).toHaveLength(1);
  });

  it("承認すると1回で置き換わり、履歴に根拠が残る", () => {
    const repo = setup();
    const before = repo.getCfe()!.estimated800mSec; // PB+1.5 = 111.01
    addPastEntry(
      repo,
      pe({ kind: "race", date: "2026-07-18", distanceM: 800, timeSec: 114.2, tempC: 19 })
    );
    const out = applyAssessedCfe(repo, TODAY);
    expect(out.before).toBeCloseTo(before, 2);
    expect(out.after).toBeCloseTo(114.2, 1);
    // 逐次更新のガードレール（±1.5秒）を通していないこと
    expect(Math.abs(out.after - out.before!)).toBeGreaterThan(1.5);
    const h = repo.getCfe()!.history.at(-1)!;
    expect(h.source).toContain("過去データ");
    expect(h.source).toContain("2026-07-18");
  });

  it("CFEを更新すると未実施セッションの設定ペースが再計算される", () => {
    const repo = setup();
    addPastEntry(
      repo,
      pe({ kind: "race", date: "2026-07-18", distanceM: 800, timeSec: 114.2, tempC: 19 })
    );
    const out = applyAssessedCfe(repo, TODAY);
    expect(out.changes.length).toBeGreaterThan(0);
  });

  it("過去データがACWRの下地になる（2週間の空白が埋まる）", () => {
    const repo = setup();
    const loadsBefore = dailyLoads({
      sessions: repo.listSessions(),
      resultsBySessionId: new Map(repo.listResults().map((r) => [r.sessionId, r])),
      strengthSessions: repo.listStrengths(),
    });
    expect(acwr(loadsBefore, TODAY).rating).toBe("insufficient_data");

    // 直近4週間、週5日ぶんのジョグを入れる
    for (let d = 1; d <= 28; d++) {
      if (d % 7 === 0) continue;
      const date = new Date(Date.UTC(2026, 5, 27 + d)).toISOString().slice(0, 10);
      addPastEntry(
        repo,
        pe({ kind: "continuous", date, distanceKm: 12, durationMin: 55 })
      );
    }
    const loadsAfter = dailyLoads({
      sessions: repo.listSessions(),
      resultsBySessionId: new Map(repo.listResults().map((r) => [r.sessionId, r])),
      strengthSessions: repo.listStrengths(),
    });
    const a = acwr(loadsAfter, TODAY);
    expect(a.rating).not.toBe("insufficient_data");
    expect(a.acwr).toBeGreaterThan(0);
  });

  it("過去データはプランのルール違反として出さない", () => {
    const repo = setup();
    // わざと連日で高乳酸を入れる（本来 RULE-01 / RULE-03 に触れる並び）
    for (const date of ["2026-07-20", "2026-07-21", "2026-07-22"]) {
      addPastEntry(
        repo,
        pe({
          kind: "interval",
          date,
          category: "high_lactate",
          repDistanceM: 300,
          repTimesSec: [44, 44, 44, 44],
          rpe: 9,
        })
      );
    }
    const ctx = buildRuleContext(repo, TODAY);
    expect(ctx.sessions.every((s) => !s.backfilled)).toBe(true);
  });

  it("過去の練習構成そのものは別枠で診断する（高乳酸の連発を見逃さない）", () => {
    const repo = setup();
    for (const date of ["2026-07-20", "2026-07-21", "2026-07-22"]) {
      addPastEntry(
        repo,
        pe({
          kind: "interval",
          date,
          category: "high_lactate",
          repDistanceM: 300,
          repTimesSec: [44, 44, 44, 44],
          rpe: 9,
        })
      );
    }
    const a = assessFitness(repo, TODAY);
    expect(a.pastStructureIssues.length).toBeGreaterThan(0);
    expect(a.pastStructureIssues.some((v) => v.rule === "RULE-01")).toBe(true);
  });

  it("削除すると推定からも負荷からも消える", () => {
    const repo = setup();
    const e = pe({ kind: "race", date: "2026-07-18", distanceM: 800, timeSec: 114.2, tempC: 19 });
    addPastEntry(repo, e);
    expect(assessFitness(repo, TODAY).estimated800mSec).toBeCloseTo(114.2, 1);
    deletePastEntry(repo, e.id);
    expect(assessFitness(repo, TODAY).estimated800mSec).toBeUndefined();
    expect(repo.getSession(`past-s-${e.id}`)).toBeUndefined();
  });

  it("実測が無い状態で承認しようとしても壊れない", () => {
    const repo = setup();
    expect(() => applyAssessedCfe(repo, TODAY)).toThrow();
  });
});

describe("過去データがダッシュボードの数値に届いているか", () => {
  it("過去データを入れるとダッシュボードのACWRが算出可能になる", () => {
    const repo = setup();
    expect(dashboard(repo, TODAY).acwr.rating).toBe("insufficient_data");
    for (let d = 1; d <= 28; d++) {
      if (d % 7 === 0) continue;
      const date = new Date(Date.UTC(2026, 5, 27 + d)).toISOString().slice(0, 10);
      addPastEntry(repo, pe({ kind: "continuous", date, distanceKm: 12, durationMin: 55 }));
    }
    const d2 = dashboard(repo, TODAY);
    expect(d2.acwr.rating).not.toBe("insufficient_data");
    expect(d2.acwr.acwr).toBeGreaterThan(0);
  });
});
