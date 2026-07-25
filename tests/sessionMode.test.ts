/**
 * M-4 セッション中の入力。
 *
 * 走っている最中に使うので、
 *   ・入力途中が消えないこと
 *   ・次を続けるかどうかがその場で出ること
 *   ・終わったらそのまま記録になり、二度打ちにならないこと
 * の3つが要件。
 */
import { describe, it, expect } from "vitest";
import { memRepo } from "./sqlite-helper";
import {
  discardSessionProgress,
  finishSessionProgress,
  regeneratePlan,
  saveSessionProgress,
  sessionProgress,
} from "@/lib/service";
import { makeRace, testAthlete } from "./helpers";
import type { Goal } from "@/lib/core/types";

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
  const s = repo.listSessions().find((x) => x.category === "high_lactate")!;
  return { repo, s };
}

describe("入力途中の保持", () => {
  it("1本ずつ入れた内容が残る", () => {
    const { repo, s } = setup();
    saveSessionProgress(repo, s.id, [41.6], TODAY);
    saveSessionProgress(repo, s.id, [41.6, 41.9], TODAY);
    expect(sessionProgress(repo, s.id).progress.reps).toEqual([41.6, 41.9]);
  });

  it("捨てれば消える", () => {
    const { repo, s } = setup();
    saveSessionProgress(repo, s.id, [41.6], TODAY);
    discardSessionProgress(repo, s.id);
    expect(sessionProgress(repo, s.id).progress.reps).toEqual([]);
  });

  it("設定と本数は処方から取る", () => {
    const { repo, s } = setup();
    const v = sessionProgress(repo, s.id);
    expect(v.progress.targetSec).toBeGreaterThan(0);
    expect(v.progress.plannedReps).toBeGreaterThan(0);
    expect(v.criteria.text).toContain("打ち切る");
  });
});

describe("その場の判定", () => {
  it("設定どおりなら続行", () => {
    const { repo, s } = setup();
    const target = sessionProgress(repo, s.id).progress.targetSec;
    const v = saveSessionProgress(repo, s.id, [target], TODAY);
    expect(v.evaluation.verdict).toBe("continue");
  });

  it("高乳酸で1本大きく外れたら中止と出る", () => {
    const { repo, s } = setup();
    const target = sessionProgress(repo, s.id).progress.targetSec;
    const v = saveSessionProgress(repo, s.id, [target, target + 3], TODAY);
    expect(v.evaluation.verdict).toBe("stop");
    expect(v.evaluation.message).toContain("打ち切って");
  });
});

describe("終了して記録にする", () => {
  it("そのまま記録になり、入力途中は消える", () => {
    const { repo, s } = setup();
    const target = sessionProgress(repo, s.id).progress.targetSec;
    saveSessionProgress(repo, s.id, [target, target + 0.2, target + 0.4], TODAY);
    finishSessionProgress(repo, s.id, { rpe: 8, subjective: "hard" });

    const saved = repo.resultForSession(s.id);
    expect(saved?.actualLapsSec).toHaveLength(3);
    expect(sessionProgress(repo, s.id).progress.reps).toEqual([]);
    expect(repo.getSession(s.id)!.status).toBe("completed");
  });

  it("打ち切りは失敗ではなく、CFEの未達に数えない", () => {
    const { repo, s } = setup();
    const target = sessionProgress(repo, s.id).progress.targetSec;
    // 中止基準にしたがって2本で止めた
    saveSessionProgress(repo, s.id, [target, target + 3.0], TODAY);
    const out = finishSessionProgress(repo, s.id, { rpe: 9, subjective: "very_hard" });

    const saved = repo.resultForSession(s.id)!;
    expect(saved.aborted).toBe(true);
    expect(saved.completedReps).toBe(2);
    expect(out.guardrailNotes[0]).toContain("失敗ではありません");
  });

  it("同じセッションを入れ直しても記録は1件", () => {
    const { repo, s } = setup();
    const target = sessionProgress(repo, s.id).progress.targetSec;
    saveSessionProgress(repo, s.id, [target, target, target], TODAY);
    finishSessionProgress(repo, s.id, { rpe: 8, subjective: "hard" });
    saveSessionProgress(repo, s.id, [target, target, target, target], TODAY);
    finishSessionProgress(repo, s.id, { rpe: 8, subjective: "hard" });
    expect(repo.listResults().filter((r) => r.sessionId === s.id)).toHaveLength(1);
  });
});
