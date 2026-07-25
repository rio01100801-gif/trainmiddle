/**
 * M-1 練習結果の上書き保存。
 *
 * 記録を直して入れ直したときに、新しい行が積まれてはいけない。
 * 二重に残ると負荷も達成度も二重に数えられ、CFEも同じ練習で2回動く。
 * 1回の更新は±1.5秒までというガードレールがあるので、
 * 修正のたびに実質±3秒動かせてしまい、ガードレールが意味を失う。
 */
import { describe, it, expect } from "vitest";
import { memRepo } from "./sqlite-helper";
import { processResult, regeneratePlan } from "@/lib/service";
import { revertCfeForSession } from "@/lib/core/cfe";
import { makeRace, testAthlete } from "./helpers";
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

describe("記録の上書き", () => {
  it("同じセッションに2回保存しても記録は1件のまま", () => {
    const repo = setup();
    const s = hlSession(repo);
    processResult(repo, resultFor(s.id, s.date, [41.5, 41.6, 41.4], 7));
    processResult(repo, resultFor(s.id, s.date, [42.5, 42.6, 42.4], 8));

    const rows = repo.listResults().filter((r) => r.sessionId === s.id);
    expect(rows).toHaveLength(1);
    // 後から入れた値が残る
    expect(rows[0].actualLapsSec[0]).toBe(42.5);
  });

  it("CFEが同じ練習で二重に動かない", () => {
    const repo = setup();
    const s = hlSession(repo);
    const first = processResult(repo, resultFor(s.id, s.date, [43.5, 43.9, 44.2], 9));
    const afterFirst = first.cfeAfter;

    // 同じ内容をもう一度保存する（打ち間違いを直したつもりで再保存した状況）
    const second = processResult(repo, resultFor(s.id, s.date, [43.5, 43.9, 44.2], 9));

    expect(second.cfeBefore).toBeCloseTo(first.cfeBefore, 3);
    expect(second.cfeAfter).toBeCloseTo(afterFirst, 3);
  });

  it("内容を直すと、直したあとの値だけがCFEに効く", () => {
    const repo = setup();
    const s = hlSession(repo);
    // 大きく未達で登録 → その後「実は達成していた」に直す
    processResult(repo, resultFor(s.id, s.date, [45.0, 45.5, 46.0], 9));
    const corrected = processResult(repo, resultFor(s.id, s.date, [41.0, 41.2, 41.1], 6));

    // 未達ぶんが残っていれば cfeBefore が悪化したままになる
    expect(corrected.cfeBefore).toBeLessThan(corrected.cfeAfter + 2.0);
    const history = repo.getCfe()!.history.filter((h) => h.sessionId === s.id);
    expect(history).toHaveLength(1);
  });
});

describe("revertCfeForSession", () => {
  it("後続の更新の差分は保ったまま、指定セッションぶんだけ戻す", () => {
    const cfe = {
      estimated800mSec: 112,
      confidence: 0.5,
      lastUpdated: "2026-07-20",
      history: [
        { date: "2026-07-01", before: 115, after: 115, source: "初期化" },
        { date: "2026-07-10", before: 115, after: 114, source: "A", sessionId: "sA" },
        { date: "2026-07-20", before: 114, after: 112, source: "B", sessionId: "sB" },
      ],
    };
    const out = revertCfeForSession(cfe, "sA");
    // sA の −1秒だけが消え、sB の −2秒は残る
    expect(out.estimated800mSec).toBe(113);
    expect(out.history).toHaveLength(2);
    expect(out.history[1]).toMatchObject({ before: 115, after: 113, sessionId: "sB" });
  });

  it("該当が無ければ何もしない", () => {
    const cfe = {
      estimated800mSec: 110,
      confidence: 1,
      lastUpdated: "2026-07-20",
      history: [{ date: "2026-07-01", before: 110, after: 110, source: "初期化" }],
    };
    expect(revertCfeForSession(cfe, "none")).toEqual(cfe);
  });
});
