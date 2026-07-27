import { describe, expect, it } from "vitest";
import { applySessionVariant, regeneratePlan } from "@/lib/service";
import { memRepo } from "./sqlite-helper";
import { makeRace, testAthlete } from "./helpers";

describe("量を増やす: 保存経路", () => {
  it("選択結果を将来のカレンダーセッションへ保存し、再読込後も維持する", () => {
    const repo = memRepo();
    repo.saveAthlete(testAthlete());
    const race = makeRace("2026-10-25");
    repo.saveRace(race);
    repo.saveGoal({
      targetEvent: "800m",
      targetTimeSec: 108.9,
      targetRaceId: race.id,
      subRaceIds: [],
    });
    regeneratePlan(repo, "2026-07-06");
    const anchor = repo
      .listSessions()
      .find(
        (session) =>
          session.date >= "2026-07-06" &&
          session.category === "high_lactate" &&
          session.phase !== "Taper"
      )!;
    const before = new Map(repo.listSessions().map((session) => [session.id, session]));

    const out = applySessionVariant(repo, anchor.id, "volume", "2026-07-06");

    expect(out.ok).toBe(true);
    expect(out.volumeWindowDays).toBe(14);
    expect(out.volumeChanges?.length).toBeGreaterThan(0);
    for (const change of out.volumeChanges ?? []) {
      const saved = repo.getSession(change.sessionId)!;
      expect(saved.status).toBe("modified");
      expect(saved.durationMin).toBeGreaterThan(before.get(change.sessionId)?.durationMin ?? 0);
    }
    expect(repo.getSession(anchor.id)!.prescription).toBe(before.get(anchor.id)!.prescription);
  });
});
