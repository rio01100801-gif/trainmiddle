/**
 * 不具合4: 誤って記録した練習結果を削除する機能。
 *
 * 削除時にCFEへの寄与を取り消し、セッションを適切な状態へ戻す
 * （通常の予定セッションは"planned"に戻す、backfilled由来なら枠ごと消す）。
 */
import { describe, it, expect } from "vitest";
import { memRepo } from "./sqlite-helper";
import { deleteResult, processResult, regeneratePlan } from "@/lib/service";
import { makeSession, makeResult, makeRace, testAthlete } from "./helpers";
import type { Goal, SessionResult } from "@/lib/core/types";

const TODAY = "2026-07-26";

function setup() {
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

function hlSession(repo: ReturnType<typeof memRepo>) {
  const s = repo.listSessions().find((x) => x.category === "high_lactate");
  if (!s) throw new Error("高乳酸セッションが生成されていない");
  return s;
}

function resultFor(sessionId: string, date: string, times: number[], rpe: number): SessionResult {
  return {
    id: `res-${Math.round(times[0] * 1000)}`,
    sessionId,
    date,
    actualLapsSec: times,
    lapDistancesM: times.map(() => 300),
    interval: {
      reps: times.length,
      distanceM: 300,
      targetSec: 41.5,
      restType: "jog",
      restSec: 300,
      results: times.map((t, i) => ({ index: i + 1, distanceM: 300, targetSec: 41.5, actualSec: t })),
    },
    achievement: "achieved",
    rpe,
    subjective: "hard",
  };
}

describe("deleteResult", () => {
  it("結果を削除するとlistResultsから消える", () => {
    const repo = setup();
    const s = hlSession(repo);
    processResult(repo, resultFor(s.id, s.date, [41.5, 41.6, 41.4], 7));
    expect(repo.listResults().filter((r) => r.sessionId === s.id)).toHaveLength(1);

    const saved = repo.resultForSession(s.id)!;
    deleteResult(repo, saved.id);

    expect(repo.listResults().filter((r) => r.sessionId === s.id)).toHaveLength(0);
  });

  it("削除するとCFEへの寄与も取り消される（削除前後で同じ値に戻る）", () => {
    const repo = setup();
    const s = hlSession(repo);
    const before = repo.getCfe()!.estimated800mSec;
    processResult(repo, resultFor(s.id, s.date, [45.0, 45.5, 46.0], 9)); // 大きく未達→CFE悪化のはず
    expect(repo.getCfe()!.estimated800mSec).not.toBeCloseTo(before, 3);

    const saved = repo.resultForSession(s.id)!;
    deleteResult(repo, saved.id);

    expect(repo.getCfe()!.estimated800mSec).toBeCloseTo(before, 6);
    expect(repo.getCfe()!.history.filter((h) => h.sessionId === s.id)).toHaveLength(0);
  });

  it("通常の予定セッションは削除後、planned状態に戻る（枠自体は消えない）", () => {
    const repo = setup();
    const s = hlSession(repo);
    processResult(repo, resultFor(s.id, s.date, [41.5, 41.6, 41.4], 7));
    expect(repo.getSession(s.id)!.status).toBe("completed");

    const saved = repo.resultForSession(s.id)!;
    deleteResult(repo, saved.id);

    const after = repo.getSession(s.id);
    expect(after).toBeDefined();
    expect(after!.status).toBe("planned");
  });

  it("backfilled由来のセッションは、結果を削除すると枠ごと消える", () => {
    const repo = setup();
    const backfilled = makeSession("2026-04-02", "aerobic", {
      id: "s-backfilled-1",
      status: "completed",
      backfilled: true,
    });
    repo.saveSession(backfilled);
    const result = makeResult(backfilled, { id: "res-backfilled-1", achievement: "achieved" });
    repo.saveResult(result);

    deleteResult(repo, result.id);

    expect(repo.getSession("s-backfilled-1")).toBeUndefined();
    expect(repo.listResults().find((r) => r.id === result.id)).toBeUndefined();
  });

  it("存在しないidを渡すとエラーになる（黙って何もしない、ではない）", () => {
    const repo = setup();
    expect(() => deleteResult(repo, "does-not-exist")).toThrow();
  });
});
