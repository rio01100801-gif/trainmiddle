import { describe, expect, it } from "vitest";
import type { CurrentFitnessEstimate, Goal, Session, SessionResult } from "@/lib/core/types";
import { processResult, regeneratePlan, saveGoalAndRaces } from "@/lib/service";
import { MemoryStore } from "../pwa/memory-store";
import { makeRace, makeResult, testAthlete } from "./helpers";

class FailingMemoryStore extends MemoryStore {
  failAfterSaveSessions = false;
  failAfterSaveCfe = false;

  override saveSessions(list: Session[]): void {
    super.saveSessions(list);
    if (this.failAfterSaveSessions) throw new Error("save sessions failed");
  }

  override saveCfe(cfe: CurrentFitnessEstimate): void {
    super.saveCfe(cfe);
    if (this.failAfterSaveCfe) throw new Error("save cfe failed");
  }
}

function setup(repo = new FailingMemoryStore()): FailingMemoryStore {
  repo.saveAthlete(testAthlete());
  const race = makeRace("2026-09-25", { id: "atomic-race" });
  const goal: Goal = {
    targetEvent: "800m",
    targetTimeSec: 108.9,
    targetRaceId: race.id,
    subRaceIds: [],
  };
  saveGoalAndRaces(repo, goal, [race]);
  regeneratePlan(repo, "2026-07-27");
  return repo;
}

describe("サービス操作の原子性", () => {
  it("再生成の保存途中で失敗しても既存予定を削除した状態にしない", () => {
    const repo = setup();
    const before = structuredClone(repo.getState());
    repo.failAfterSaveSessions = true;

    expect(() => regeneratePlan(repo, "2026-07-27")).toThrow("save sessions failed");
    expect(repo.getState()).toEqual(before);
  });

  it("結果処理の途中で失敗しても結果・完了状態・CFEを一部保存しない", () => {
    const repo = setup();
    const session = repo.listSessions().find((item) => item.status === "planned")!;
    const result: SessionResult = makeResult(session, {
      actualLapsSec: [60],
      rpe: 7,
    });
    const before = structuredClone(repo.getState());
    repo.failAfterSaveCfe = true;

    expect(() => processResult(repo, result)).toThrow("save cfe failed");
    expect(repo.getState()).toEqual(before);
  });
});
