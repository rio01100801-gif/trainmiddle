import { describe, it, expect } from "vitest";
import { generatePlan } from "@/lib/core/periodization";
import { buildAerobicProfile, grpSecPerM } from "@/lib/core/pace";
import { runRuleEngine } from "@/lib/core/rules";
import { ctx, makeRace, testAthlete } from "./helpers";
import { diffDays } from "@/lib/core/dates";
import { isSpecificCategory } from "@/lib/core/trainingClassification";
import type { Goal } from "@/lib/core/types";

/*
 * `taper.ts` の t14 は「総量は維持したまま**質を上げる**」と定義しているのに、
 * 生成側は D-14〜D-9 にジョグ・流し・休養しか置いていなかった。
 * 前の質から D-8 の最終高乳酸まで10日以上、レースペースに触れない期間ができていた。
 *
 * レースの曜日を変えて測ると、7曜日中6曜日で質が0本だった
 * （金曜だけ週境界のずれで D-14 に経済走が入る＝偶然）。
 */

const TARGET = 108.9;
const START = "2026-08-01";
/** 月〜日を1周する。曜日で結果が変わる検査は、1つの曜日だけ見ても意味がない */
const RACES = [
  "2026-10-26", // 月
  "2026-10-27", // 火
  "2026-10-28", // 水
  "2026-10-29", // 木
  "2026-10-30", // 金
  "2026-10-31", // 土
  "2026-11-01", // 日
];

function planFor(raceDate: string) {
  const race = makeRace(raceDate);
  const goal: Goal = {
    targetEvent: "800m",
    targetTimeSec: TARGET,
    targetRaceId: race.id,
    subRaceIds: [],
  };
  return generatePlan({
    athlete: testAthlete(),
    goal,
    races: [race],
    cfeSec: TARGET,
    aerobicProfile: buildAerobicProfile([], START, TARGET),
    startDate: START,
  });
}

describe("テーパー前半に質が1本入る", () => {
  for (const raceDate of RACES) {
    it(`${raceDate}: D-14〜D-9 にレースペース近傍が1本ある`, () => {
      const plan = planFor(raceDate);
      const quality = plan.sessions.filter((s) => {
        const d = diffDays(s.date, raceDate);
        return d >= 9 && d <= 14 && isSpecificCategory(s.category);
      });
      expect(quality.length, `D-14〜D-9: ${quality.map((s) => s.category).join(",")}`).toBe(1);
    });

    it(`${raceDate}: 質を増やしすぎない（D-14〜D-9 は1本まで）`, () => {
      const plan = planFor(raceDate);
      const quality = plan.sessions.filter((s) => {
        const d = diffDays(s.date, raceDate);
        return d >= 9 && d <= 14 && isSpecificCategory(s.category);
      });
      expect(quality.length).toBeLessThanOrEqual(1);
    });

    it(`${raceDate}: RULE違反が無い（07・08・09を含む）`, () => {
      const plan = planFor(raceDate);
      const violations = runRuleEngine(ctx(plan.sessions, testAthlete(), START));
      const errors = violations.filter((v) => v.level === "ERROR");
      expect(errors.map((v) => `${v.rule}: ${v.message}`)).toEqual([]);
    });

    it(`${raceDate}: D-8 の最終高乳酸は残っている`, () => {
      const plan = planFor(raceDate);
      const last = plan.sessions.filter(
        (s) => diffDays(s.date, raceDate) === 8 && s.category === "high_lactate"
      );
      expect(last.length).toBe(1);
    });
  }

  it("入れた質は経済走の濃い帯（GRP 103〜105%）で、総量は800m", () => {
    // 週境界のずれない曜日で中身を見る
    const plan = planFor("2026-10-26");
    const s = plan.sessions.find(
      (x) => diffDays(x.date, "2026-10-26") === 11 && isSpecificCategory(x.category)
    );
    expect(s).toBeDefined();
    expect(s!.category).toBe("race_economy"); // high_lactate だと RULE-07 が D-8 と合わせて2回と数える
    const p = s!.targetPaces[0];
    expect(p.distanceM).toBe(400);
    /*
     * 設定の基準は `guardedBaseTime` を通るので目標タイムそのものではない
     * （処方の土台をPBより速くしない等の保護が入る）。
     * **帯の幅は基準に依らない**ので、速い側と遅い側の比で確かめる。
     */
    expect(p.targetSecSlow / p.targetSecFast).toBeCloseTo(1.05 / 1.03, 4);
    // レースペース近傍であること（絶対値の妥当性）
    const grp = grpSecPerM(TARGET);
    expect(p.targetSecFast / (400 * grp)).toBeGreaterThan(1.02);
    expect(p.targetSecSlow / (400 * grp)).toBeLessThan(1.07);
    // 400m×2＝800m。D-8の最終高乳酸（300m×3＝900m）を上回らない
    expect(s!.prescription).toContain("400m × 2");
  });
});
