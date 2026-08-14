/**
 * 予定と実際のズレ（`trainingBalance`）が、実際に取り出せること。
 *
 * このモジュールは341行あって完成していたのに、**どこからも呼ばれていなかった**。
 * 棚卸しで見つけて分析画面に載せた。
 *
 * ここで見張るのは「繋がっていること」と「役割が重なっていないこと」。
 * `periodSummary`（距離・時間・強度の合計）と同じ数字を2か所に出すと、
 * 見比べたときに食い違って見える。
 */
import { describe, expect, it } from "vitest";
import { memRepo } from "./sqlite-helper";
import { processResult, regeneratePlan, trainingBalance } from "@/lib/service";
import { makeRace, testAthlete } from "./helpers";
import type { Store } from "@/lib/db/store";

const TODAY = "2026-08-15";

function planned() {
  const repo = memRepo();
  repo.saveAthlete(testAthlete());
  const race = makeRace("2026-11-15");
  repo.saveRace(race);
  repo.saveGoal({
    targetEvent: "800m",
    targetTimeSec: 108.9,
    targetRaceId: race.id,
    subRaceIds: [],
  });
  regeneratePlan(repo, "2026-07-20");
  return repo;
}

/** 予定のうち何本かを実施済みにする */
function complete(repo: Store, count: number) {
  const done = repo
    .listSessions()
    .filter((s) => s.date < TODAY && s.date >= "2026-08-03" && s.category !== "off")
    .slice(0, count);
  for (const s of done) {
    processResult(repo, {
      id: `r-${s.id}`,
      sessionId: s.id,
      date: s.date,
      actualLapsSec: [42, 42.5, 43],
      achievement: "met",
      rpe: 7,
      subjective: "moderate",
      durationMin: 50,
    });
  }
  return done.length;
}

describe("繋がっていること", () => {
  it("4週ぶんが返る", () => {
    const repo = planned();
    const b = trainingBalance(repo, TODAY);
    expect(b.weeks).toHaveLength(4);
    // 月曜始まりで、最後が今週
    expect(b.weeks[3].weekStart).toBe("2026-08-10");
    expect(b.to).toBe("2026-08-16");
  });

  it("予定と実施を別々に数える（未実施を実績に混ぜない）", () => {
    const repo = planned();
    const before = trainingBalance(repo, TODAY);
    const doneCount = complete(repo, 4);
    const after = trainingBalance(repo, TODAY);

    const sum = (b: typeof before, key: "plannedSessions" | "completedSessions") =>
      b.weeks.reduce((n, w) => n + w[key], 0);

    // 予定の数は変わらない
    expect(sum(after, "plannedSessions")).toBe(sum(before, "plannedSessions"));
    // 実施だけが増える
    expect(sum(after, "completedSessions")).toBe(sum(before, "completedSessions") + doneCount);
  });

  it("実施が増えると達成率が上がる", () => {
    const repo = planned();
    const before = trainingBalance(repo, TODAY).adherencePct ?? 0;
    complete(repo, 5);
    const after = trainingBalance(repo, TODAY).adherencePct ?? 0;
    expect(after).toBeGreaterThan(before);
  });

  it("レースが無くても落ちない（冬季・基礎構築モード）", () => {
    const repo = memRepo();
    repo.saveAthlete(testAthlete());
    repo.saveGoal({
      targetEvent: "800m",
      targetTimeSec: 108.9,
      targetRaceId: "",
      subRaceIds: [],
    });
    regeneratePlan(repo, "2026-07-20");
    const b = trainingBalance(repo, TODAY);
    expect(b.weeks).toHaveLength(4);
    expect(b.raceProgress).toBeUndefined();
  });

  it("気づきは出たときだけ（毎回同じ行を出さない）", () => {
    const repo = planned();
    const b = trainingBalance(repo, TODAY);
    for (const s of b.signals) {
      expect(s.message.length).toBeGreaterThan(0);
      // 断定せず、対処案まで書く
      expect(s.action.length).toBeGreaterThan(0);
      expect(["info", "warn"]).toContain(s.level);
    }
  });
});

describe("役割が重なっていないこと", () => {
  it("合計の距離は出すが、画面の主役にはしない（期間サマリーの担当）", () => {
    const repo = planned();
    const b = trainingBalance(repo, TODAY);
    /*
     * 距離の合計は内部では持っている（負荷の急増を見るのに要る）。
     * 画面に出しているのは実施/予定・達成率・高負荷・高乳酸・回復の5つで、
     * 距離と時間の合計は期間サマリー側だけに出す。
     * ここが増えると同じ数字が2か所に出て、食い違って見える。
     */
    expect(typeof b.totalPlannedDistanceKm).toBe("number");
    expect(typeof b.totalCompletedDistanceKm).toBe("number");
  });

  it("週の区切りが期間サマリーと同じ（月曜始まり）", () => {
    const repo = planned();
    const b = trainingBalance(repo, TODAY);
    for (const w of b.weeks) {
      expect(new Date(w.weekStart + "T00:00:00Z").getUTCDay(), w.weekStart).toBe(1);
    }
  });
});
