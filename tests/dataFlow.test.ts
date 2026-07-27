import { describe, expect, it } from "vitest";
import {
  addSession,
  dashboard,
  editSession,
  exportBackup,
  importBackup,
  racesForGoal,
  regeneratePlan,
  saveGoalAndRaces,
} from "@/lib/service";
import type { Goal, Race } from "@/lib/core/types";
import { memRepo } from "./sqlite-helper";
import { makeRace, testAthlete } from "./helpers";

const TODAY = "2026-07-27";

function goalFor(targetRaceId: string, subRaceIds: string[] = []): Goal {
  return {
    targetEvent: "800m",
    targetTimeSec: 108.9,
    targetRaceId,
    subRaceIds,
  };
}

describe("目標・レースの保存→再読込", () => {
  it("着順とタイムの両ボーダーを保存し、通過点レースを同じIDで再取得する", () => {
    const repo = memRepo();
    const target: Race = makeRace("2026-09-25", {
      id: "race-target-stable",
      advancementRule: "place_and_time",
      advancementDetail: "各組上位2着＋タイム 1:51",
      borderPlace: 2,
      borderTimeSec: 111,
      rounds: [
        { type: "heat", datetime: "2026-09-25T10:00:00" },
        { type: "final", datetime: "2026-09-27T15:00:00" },
      ],
    });
    const checkpoint = makeRace("2026-08-16", {
      id: "race-checkpoint-stable",
      priority: "B",
    });
    const goal = goalFor(target.id, [checkpoint.id]);

    const saved = saveGoalAndRaces(repo, goal, [target, checkpoint]);
    expect(saved.goal).toEqual(goal);
    expect(saved.races.map((race) => race.id)).toEqual([target.id, checkpoint.id]);

    const reloaded = racesForGoal(repo);
    expect(reloaded[0].borderPlace).toBe(2);
    expect(reloaded[0].borderTimeSec).toBe(111);
    expect(reloaded[0].rounds.find((round) => round.type === "heat")?.expectedPaceSec)
      .toBeCloseTo(110.5, 1);
    expect(reloaded[1]).toMatchObject({
      id: "race-checkpoint-stable",
      dateStart: "2026-08-16",
      priority: "B",
    });

    const restored = memRepo();
    importBackup(restored, exportBackup(repo, "2026-07-27T12:00:00.000Z"), "replace");
    expect(racesForGoal(restored)[0]).toMatchObject({
      borderPlace: 2,
      borderTimeSec: 111,
    });
    expect(racesForGoal(restored)[1].id).toBe("race-checkpoint-stable");
  });

  it("目標から外した過去レースは削除せず、カレンダー対象からだけ外す", () => {
    const repo = memRepo();
    const target = makeRace("2026-09-25", { id: "target" });
    const oldCheckpoint = makeRace("2026-08-01", { id: "old-sub", priority: "B" });
    saveGoalAndRaces(repo, goalFor(target.id, [oldCheckpoint.id]), [target, oldCheckpoint]);

    saveGoalAndRaces(repo, goalFor(target.id), [target]);

    expect(repo.listRaces().some((race) => race.id === oldCheckpoint.id)).toBe(true);
    expect(racesForGoal(repo).map((race) => race.id)).toEqual([target.id]);
  });

  it("ダッシュボードが本命と通過点レースの両方をカレンダーへ渡す", () => {
    const repo = memRepo();
    repo.saveAthlete(testAthlete());
    const target = makeRace("2026-09-25", { id: "target" });
    const checkpoint = makeRace("2026-08-16", { id: "checkpoint", priority: "C" });
    saveGoalAndRaces(repo, goalFor(target.id, [checkpoint.id]), [target, checkpoint]);

    const data = dashboard(repo, TODAY);

    expect(data.races.map((race) => race.id)).toEqual(["target", "checkpoint"]);
    expect(data.targetRace?.id).toBe("target");
  });
});

describe("プラン再生成の識別と置換", () => {
  function setup() {
    const repo = memRepo();
    repo.saveAthlete(testAthlete());
    const race = makeRace("2026-09-25", { id: "target" });
    saveGoalAndRaces(repo, goalFor(race.id), [race]);
    return repo;
  }

  it("複数回実行しても自動生成予定が重複しない", () => {
    const repo = setup();
    regeneratePlan(repo, TODAY);
    const first = repo.listSessions();
    expect(first.some((session) => session.origin === "generated")).toBe(true);

    regeneratePlan(repo, TODAY);
    regeneratePlan(repo, TODAY);
    const after = repo.listSessions();

    expect(after).toHaveLength(first.length);
    expect(new Set(after.map((session) => session.id)).size).toBe(after.length);
    expect(new Set(after.map((session) => `${session.date}|${session.timeOfDay}`)).size)
      .toBe(after.length);
  });

  it("手動追加・完了済み・本人編集を残し、同じ枠へ自動予定を足さない", () => {
    const repo = setup();
    regeneratePlan(repo, TODAY);
    const generated = repo
      .listSessions()
      .filter((session) => session.origin === "generated");
    const completed = generated[0];
    const edited = generated[1];
    repo.saveSession({ ...completed, status: "completed" });
    const edit = editSession(
      repo,
      edited.id,
      { prescription: `${edited.prescription}（本人編集）` },
      TODAY,
      { force: true }
    );
    expect(edit.applied).toBe(true);
    const manual = addSession(
      repo,
      {
        id: "s-user-keep",
        date: generated[2].date,
        timeOfDay: "am",
        category: "aerobic",
        name: "手動ジョグ",
        prescription: "30分",
      },
      TODAY
    ).session!;

    regeneratePlan(repo, TODAY);
    regeneratePlan(repo, TODAY);

    expect(repo.getSession(completed.id)?.status).toBe("completed");
    expect(repo.getSession(edited.id)).toMatchObject({
      userEdited: true,
      prescription: `${edited.prescription}（本人編集）`,
    });
    expect(repo.getSession(manual.id)).toMatchObject({
      origin: "manual",
      name: "手動ジョグ",
    });
    const slots = repo
      .listSessions()
      .filter((session) => session.status !== "skipped")
      .map((session) => `${session.date}|${session.timeOfDay}`);
    expect(new Set(slots).size).toBe(slots.length);
  });

  it("旧形式の手動IDは残し、旧形式のplanned自動予定だけを置き換える", () => {
    const repo = setup();
    const base = {
      date: "2026-08-01",
      category: "aerobic" as const,
      name: "旧予定",
      prescription: "30分",
      targetPaces: [],
      transfer800m: 3,
      transfer1500m: 3,
      riskLevel: "low" as const,
      phase: "Build" as const,
      status: "planned" as const,
      isFixed: false,
      timeOfDay: "am" as const,
    };
    repo.saveSession({ ...base, id: "s-user-legacy", name: "旧手動予定" });
    repo.saveSession({ ...base, id: "s-old-random", timeOfDay: "pm" });

    regeneratePlan(repo, TODAY);

    expect(repo.getSession("s-user-legacy")?.name).toBe("旧手動予定");
    expect(repo.getSession("s-old-random")).toBeUndefined();
  });
});
