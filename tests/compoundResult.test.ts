/**
 * 複合セットの結果入力が、そのまま保存されているか。
 *
 * 実機の入力（1000m×4＋200m×3、レストが本ごとに違う）を再現して、
 * 本数・タイム・1本ごとの距離・1本ごとのレストが欠けずに残ることを見る。
 * 「入れたのに消えている」が起きても画面には出ないので、ここで見張る。
 */
import { describe, expect, it } from "vitest";
import { memRepo } from "./sqlite-helper";
import { processResult, regeneratePlan } from "@/lib/service";
import { makeRace, testAthlete } from "./helpers";
import type { SessionResult } from "@/lib/core/types";

const TODAY = "2026-08-12";

/** 画面が組み立てるのと同じ形（app/results/page.tsx の payload） */
function buildPayload(sessionId: string) {
  const laps = [190, 192, 190, 189, 30, 30, 30];
  const dists = [1000, 1000, 1000, 1000, 200, 200, 200];
  // 1〜3本目 3分 / 4本目 5分 / 5〜6本目 200mジョグ / 7本目（最後）は無し
  const restSec = [180, 180, 180, 300, undefined, undefined, undefined];
  const restDistanceM = [undefined, undefined, undefined, undefined, 200, 200, undefined];
  return {
    id: "res-compound",
    sessionId,
    date: TODAY,
    actualLapsSec: laps,
    lapDistancesM: dists,
    achievement: "achieved",
    rpe: 6,
    subjective: "moderate",
    interval: {
      reps: 7,
      distanceM: 1000,
      restType: "jog",
      results: laps.map((t, i) => ({
        index: i + 1,
        distanceM: dists[i],
        actualSec: t,
        restSec: restSec[i],
        restDistanceM: restDistanceM[i],
      })),
    },
  } as unknown as SessionResult;
}

function setup() {
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
  regeneratePlan(repo, TODAY);
  const session = repo.listSessions().find((s) => s.date >= TODAY && !s.isFixed)!;
  return { repo, session };
}

describe("複合セットの結果が欠けずに残る", () => {
  it("7本ぶんのタイムがそのまま保存される", () => {
    const { repo, session } = setup();
    processResult(repo, buildPayload(session.id));
    const saved = repo.listResults().find((r) => r.id === "res-compound")!;
    expect(saved.actualLapsSec).toEqual([190, 192, 190, 189, 30, 30, 30]);
  });

  it("1本ごとの距離が残る（1000mと200mが区別できる）", () => {
    const { repo, session } = setup();
    processResult(repo, buildPayload(session.id));
    const saved = repo.listResults().find((r) => r.id === "res-compound")!;
    expect(saved.lapDistancesM).toEqual([1000, 1000, 1000, 1000, 200, 200, 200]);
    expect(saved.interval!.results.map((x) => x.distanceM)).toEqual([
      1000, 1000, 1000, 1000, 200, 200, 200,
    ]);
  });

  it("1本ごとのレストが残る（時間と距離が混ざっていても）", () => {
    const { repo, session } = setup();
    processResult(repo, buildPayload(session.id));
    const saved = repo.listResults().find((r) => r.id === "res-compound")!;
    const rests = saved.interval!.results.map((x) => x.restSec ?? x.restDistanceM);
    // 3分×3 → 5分 → 200mジョグ×2 → 最後は無し
    expect(rests).toEqual([180, 180, 180, 300, 200, 200, undefined]);
  });

  it("本数が減っていない（黙って落とさない）", () => {
    const { repo, session } = setup();
    processResult(repo, buildPayload(session.id));
    const saved = repo.listResults().find((r) => r.id === "res-compound")!;
    expect(saved.interval!.results).toHaveLength(7);
  });
});
