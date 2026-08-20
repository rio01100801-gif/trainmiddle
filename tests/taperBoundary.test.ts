import { describe, it, expect } from "vitest";
import { generatePlan, phaseForDaysToRace } from "@/lib/core/periodization";
import { buildAerobicProfile } from "@/lib/core/pace";
import { planTaper, taperStage } from "@/lib/core/taper";
import { makeRace, testAthlete } from "./helpers";
import { diffDays } from "@/lib/core/dates";
import { isSpecificCategory } from "@/lib/core/trainingClassification";
import type { Goal, WeekTemplate } from "@/lib/core/types";

/*
 * テーパーは2か所で決まる。
 *   生成（`periodization`）    予定を作るときの形
 *   差分（`taper.planTaper`）  既存の予定をテーパーの形へ寄せる案
 *
 * 別々に境界を持っているので、**同じ日に2つの答えが出ていないか**を見る。
 * 表を作って確かめた結果、4つ食い違っていた（BACKLOG E-6）。
 */

const START = "2026-08-01";
const CFE = 111.0;

function planFor(raceDate: string) {
  const race = makeRace(raceDate);
  const goal: Goal = {
    targetEvent: "800m",
    targetTimeSec: 108.9,
    targetRaceId: race.id,
    subRaceIds: [],
  };
  return generatePlan({
    athlete: testAthlete(),
    goal,
    races: [race],
    cfeSec: CFE,
    aerobicProfile: buildAerobicProfile([], START, CFE),
    startDate: START,
  });
}

describe("テーパーの境界が2か所で食い違わない", () => {
  it("14日前から始まる（フェーズも段階も同じ日）", () => {
    expect(phaseForDaysToRace(15)).toBe("Modeling");
    expect(phaseForDaysToRace(14)).toBe("Taper");
    expect(taperStage("2026-10-16", "2026-10-30")).toBe("t14"); // 残14日
    expect(taperStage("2026-10-15", "2026-10-30")).toBe("none"); // 残15日
  });

  it("レース当日は段階を持たない（「レース前日」と出さない）", () => {
    expect(taperStage("2026-10-30", "2026-10-30")).toBe("none");
    expect(taperStage("2026-10-29", "2026-10-30")).toBe("eve"); // 残1日
  });

  it("7日前以降は高負荷を置かない（7日前を含む）", () => {
    // レースの曜日を変えて、残7日がどの曜日に来ても置かれないこと
    for (const raceDate of ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"]) {
      const plan = planFor(raceDate);
      const within7 = plan.sessions.filter((s) => {
        const d = diffDays(s.date, raceDate);
        return d >= 1 && d <= 7;
      });
      const demanding = within7.filter((s) => isSpecificCategory(s.category));
      expect(demanding.map((s) => `${s.date}:${s.category}`), `レース${raceDate}`).toEqual([]);
    }
  });

  it("曜日に経済走を指定していても、7日前には置かない", () => {
    /*
     * 通常の生成ではテーパー期の週テンプレートが流し・ジョグ・休養しか置かないので、
     * 7日前に高負荷は来ない。**それだと保険が効いているか確かめられない。**
     * 曜日にカテゴリを直接指定した場合は到達するので、その経路で見る。
     *
     * 高乳酸ではなく**経済走**を使う。高乳酸は8日前の最終高乳酸との
     * 最短5日間隔の規則が先に効いて回復ジョグへ落ちるので、
     * 7日前の保険が働いたのかどうかを区別できない（実際に空振りした）。
     */
    const RACE = "2026-10-30"; // 金曜
    const race = makeRace(RACE);
    const goal: Goal = {
      targetEvent: "800m",
      targetTimeSec: 108.9,
      targetRaceId: race.id,
      subRaceIds: [],
    };
    // 残7日は 2026-10-23（金）。その曜日に高乳酸を固定する
    const weekTemplate = {
      slots: { 5: "race_economy" },
      modes: { 5: "fixed" },
      amSlots: {},
      mainTimeOfDay: {},
      enabled: true,
    } as unknown as WeekTemplate;
    const plan = generatePlan({
      athlete: testAthlete(),
      goal,
      races: [race],
      cfeSec: CFE,
      aerobicProfile: buildAerobicProfile([], START, CFE),
      startDate: START,
      weekTemplate,
    });
    // 指定が効いていること（効いていなければ検査が空振りする）
    const anyRe = plan.sessions.filter((s) => s.category === "race_economy");
    expect(anyRe.length, "曜日指定が効いていない").toBeGreaterThan(0);

    const atSeven = plan.sessions.filter((s) => diffDays(s.date, RACE) === 7);
    expect(atSeven.length, "残7日の枠が無い").toBeGreaterThan(0);
    expect(
      atSeven.map((s) => `${s.date}:${s.category}`).filter((x) => /race_economy|high_lactate|modeling/.test(x))
    ).toEqual([]);
    expect(atSeven.some((s) => isSpecificCategory(s.category))).toBe(false);
  });

  it("8日前の最終高乳酸は残す（7日前と混同していない）", () => {
    const plan = planFor("2026-10-30");
    const last = plan.sessions.filter(
      (s) => diffDays(s.date, "2026-10-30") === 8 && s.category === "high_lactate"
    );
    expect(last.length).toBe(1);
  });
});

describe("同じ日に2回削らない", () => {
  const RACE = "2026-10-30";

  it("生成器が日ごとに決めている3日前以降は、差分案を重ねない", () => {
    const plan = planFor(RACE);
    const adj = planTaper(plan.sessions, RACE, START);
    const late = adj.filter((a) => {
      const d = diffDays(a.date, RACE);
      return d >= 0 && d <= 3 && a.kind === "reduce_volume";
    });
    expect(late.map((a) => `${a.date}:${a.before}→${a.after}`)).toEqual([]);
  });

  it("14〜7日前の量の削減は残す（消しすぎていない）", () => {
    const plan = planFor(RACE);
    const adj = planTaper(plan.sessions, RACE, START);
    const mid = adj.filter((a) => {
      const d = diffDays(a.date, RACE);
      return d >= 4 && d <= 14 && a.kind === "reduce_volume";
    });
    expect(mid.length).toBeGreaterThan(0);
  });

  it("本人が編集した予定は3日前以降でも案を出す（生成物だけを除く）", () => {
    const plan = planFor(RACE);
    const target = plan.sessions.find(
      (s) => diffDays(s.date, RACE) === 3 && s.category === "aerobic"
    );
    expect(target).toBeDefined();
    const edited = { ...target!, origin: "manual" as const, durationMin: 60 };
    const adj = planTaper([edited], RACE, START);
    expect(adj.some((a) => a.kind === "reduce_volume")).toBe(true);
  });
});
