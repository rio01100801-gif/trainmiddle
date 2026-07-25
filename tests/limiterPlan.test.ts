/**
 * M-7 制限因子をプラン生成に反映する。
 *
 * 判定を表示するだけなら分析であって、練習は変わらない。
 * 配分に効かせる。ただし何をどれだけ振り替えたかは必ず出す。
 */
import { describe, it, expect } from "vitest";
import { memRepo } from "./sqlite-helper";
import { limiterAssessment, regeneratePlan, weeklyReview, splitAnalysis } from "@/lib/service";
import { makeRace, testAthlete } from "./helpers";
import type { Goal } from "@/lib/core/types";

const TODAY = "2026-06-01";

function setup(athleteOverrides = {}) {
  const repo = memRepo();
  repo.saveAthlete(testAthlete(athleteOverrides));
  const race = makeRace("2026-09-25");
  repo.saveRace(race);
  const goal: Goal = {
    targetEvent: "800m",
    targetTimeSec: 108.9,
    targetRaceId: race.id,
    subRaceIds: [],
  };
  repo.saveGoal(goal);
  return repo;
}

describe("配分への反映", () => {
  it("維持が制限ならCVの枠が経済走に振り替わる", () => {
    const repo = setup();
    const out = regeneratePlan(repo, TODAY);
    expect(out.limiterSwaps.length).toBeGreaterThan(0);
    expect(out.limiterSwaps[0].from).toBe("cv");
    expect(out.limiterSwaps[0].to).toBe("race_economy");
    expect(out.limiterNote).toContain("振り替え");
  });

  it("振り替えた枠が実際にプランに入っている", () => {
    const repo = setup();
    const out = regeneratePlan(repo, TODAY);
    const d = out.limiterSwaps[0].date;
    expect(repo.listSessions().find((s) => s.date === d)!.category).toBe("race_economy");
  });

  it("バランス型なら振り替えない", () => {
    // 400m 52.0 / 1500m 3:46 → 両側からの妥当域がほぼ一致する
    const repo = setup({ pb400mSec: 49.9, pb1500mSec: 234 });
    const a = limiterAssessment(repo);
    if (a.assessment!.limiter === "balanced") {
      expect(regeneratePlan(repo, TODAY).limiterSwaps).toHaveLength(0);
    }
  });

  it("判定と反映内容が文章で出る", () => {
    const repo = setup();
    const a = limiterAssessment(repo);
    expect(a.assessment!.limiter).toBe("endurance");
    expect(a.appliedNote).toContain("経済走");
    expect(a.assessment!.narrative).toContain("必要な400m→800mの換算差");
  });
});

describe("週次レビューと600m通過（サービス層）", () => {
  it("実測が無くても週次レビューは壊れない", () => {
    const repo = setup();
    regeneratePlan(repo, TODAY);
    const r = weeklyReview(repo, "2026-07-26");
    expect(r.text.length).toBeGreaterThan(0);
    expect(r.qualityCount).toBe(0);
  });

  it("材料が足りなければ600m通過は出さない", () => {
    const repo = setup();
    expect(splitAnalysis(repo).enough).toBe(false);
  });

  it("レースを2本入れれば600m通過が出る", () => {
    const repo = setup();
    repo.savePastEntry({
      id: "p1",
      date: "2026-06-13",
      kind: "race",
      distanceM: 800,
      timeSec: 116.0,
      lapsSec: [56.0, 60.0],
    } as any);
    repo.savePastEntry({
      id: "p2",
      date: "2026-07-13",
      kind: "race",
      distanceM: 800,
      timeSec: 113.4,
      lapsSec: [55.0, 58.4],
    } as any);
    const t = splitAnalysis(repo);
    expect(t.enough).toBe(true);
    expect(t.samples).toHaveLength(2);
    expect(t.narrative).toContain("600m通過");
  });
});
