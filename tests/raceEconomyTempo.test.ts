import { describe, it, expect } from "vitest";
import { buildSessionSpec, sessionTemplateCandidates } from "@/lib/core/progression";
import { generatePlan } from "@/lib/core/periodization";
import { buildAerobicProfile, grpSecPerM } from "@/lib/core/pace";
import { runRuleEngine } from "@/lib/core/rules";
import { ctx, makeRace, testAthlete } from "./helpers";
import { isSpecificCategory } from "@/lib/core/trainingClassification";
import { diffDays } from "@/lib/core/dates";
import { addDays } from "@/lib/core/dates";
import type { Goal, TemplateHistoryEntry } from "@/lib/core/types";

/*
 * 設定ペースの帯に 101〜103% の空白があった（BACKLOG F-1）。
 * 高乳酸95〜97%、モデリング99〜100%（分割走）、経済走104〜106%。
 * 制限因子が「後半の維持＝レースペース経済性」なのに、
 * その帯を**連続走で**走る枠が無かった。
 */

const TARGET = 108.9; // 1:48.90
const GRP = grpSecPerM(TARGET);

/** 目標1:48.90 での600mの帯 */
const BAND = {
  economy: { fast: 600 * GRP * 1.04, slow: 600 * GRP * 1.06 }, // 84.9〜86.6
  tempo: { fast: 600 * GRP * 1.01, slow: 600 * GRP * 1.03 }, // 82.5〜84.2
  modeling: { fast: 600 * GRP * 0.99, slow: 600 * GRP * 1.0 }, // 80.9〜81.7
};

/** 104〜106% を2回きちんと実施した履歴 */
function stableEconomyHistory(): TemplateHistoryEntry[] {
  return ["2026-06-10", "2026-06-17"].map((date) => ({
    date,
    category: "race_economy" as const,
    templateId: "race-economy-600-specific",
    variationGroup: "race-economy-long",
    progressionStage: 1,
    achievement: "achieved" as const,
    rpe: 7,
  }));
}

describe("101〜103%帯が処方される", () => {
  it("帯の境界（目標1:48.90・600m）", () => {
    expect(BAND.economy.fast).toBeCloseTo(84.9, 1);
    expect(BAND.tempo.fast).toBeCloseTo(82.5, 1);
    expect(BAND.tempo.slow).toBeCloseTo(84.1, 1);
    expect(BAND.modeling.slow).toBeCloseTo(81.7, 1);
  });

  it("Specific期で 600m を 82〜84秒台に処方する回がある", () => {
    const spec = buildSessionSpec({
      category: "race_economy",
      phase: "Specific",
      weekIndex: 0,
      cfeSec: TARGET,
      templateHistory: stableEconomyHistory(),
      onDate: "2026-06-24",
    })!;
    expect(spec.blocks[0].distanceM).toBe(600);
    const p = spec.targetPaces[0];
    expect(p.targetSecFast).toBeGreaterThanOrEqual(82);
    expect(p.targetSecFast).toBeLessThan(84);
    expect(p.targetSecSlow).toBeGreaterThan(82);
    expect(p.targetSecSlow).toBeLessThanOrEqual(85);
    // 既存の104〜106%とは別の帯であること
    expect(p.targetSecFast).toBeLessThan(BAND.economy.fast);
    // モデリング（99〜100%）より遅いこと。置き換えではなく間を埋める
    expect(p.targetSecFast).toBeGreaterThan(BAND.modeling.slow);
  });

  it("同じ入力からは必ず同じ結果が出る", () => {
    const build = () =>
      buildSessionSpec({
        category: "race_economy",
        phase: "Specific",
        weekIndex: 0,
        cfeSec: TARGET,
        templateHistory: stableEconomyHistory(),
        onDate: "2026-06-24",
      })!;
    expect(build().prescription).toBe(build().prescription);
  });

  it("実施できていないうちは濃い帯に進まない（カレンダーで勝手に進まない）", () => {
    const first = buildSessionSpec({
      category: "race_economy",
      phase: "Specific",
      weekIndex: 0,
      cfeSec: TARGET,
    })!;
    /*
     * 履歴が無ければ既存の104〜106%。
     * **距離は決め打ちしない**（選手タイプで400/500/600のどれが選ばれるかが変わる）。
     * 見たいのは帯であって形式ではないので、選ばれた距離から比率を出して確かめる。
     */
    const pace = first.targetPaces[0];
    const ratio = pace.targetSecFast / (pace.distanceM * GRP);
    expect(ratio).toBeGreaterThanOrEqual(1.04 - 0.001);
  });

  it("濃い帯は既存の経済走より上の段にある（2回きちんと実施してから進む）", () => {
    /*
     * これが「置換であって追加でない」の担保。
     * `desiredStage` は前回実施した段から始まり、安定2回で+1、
     * 崩れたら−1になる。段を既存と同じにすると**実施できていなくても
     * 選ばれうる**ので、段の関係そのものを固定する。
     * （振る舞いだけを見る検査は、たまたま別の理由で選ばれないと空振りする）
     */
    for (const phase of ["Specific", "Modeling"] as const) {
      const cs = sessionTemplateCandidates("race_economy", phase);
      const tempo = cs.find((c) => c.id.includes("tempo"));
      expect(tempo, `${phase}に濃い帯が無い`).toBeDefined();
      for (const other of cs.filter((c) => !c.id.includes("tempo"))) {
        expect(
          tempo!.progressionStage,
          `${phase}: ${other.id} より上の段であること`
        ).toBeGreaterThan(other.progressionStage);
      }
    }
  });

  it("既存の104〜106%の処方が消えていない", () => {
    const ids = sessionTemplateCandidates("race_economy", "Specific").map((c) => c.id);
    expect(ids).toContain("race-economy-600-specific");
    expect(ids).toContain("race-economy-500-specific");
    expect(ids).toContain("race-economy-400-specific");
    expect(ids).toContain("race-economy-tempo-600-specific");
  });
});

describe("追加ではなく置換", () => {
  const race = makeRace("2026-09-25");
  const goal: Goal = {
    targetEvent: "800m",
    targetTimeSec: TARGET,
    targetRaceId: race.id,
    subRaceIds: [],
  };
  const plan = generatePlan({
    athlete: testAthlete(),
    goal,
    races: [race],
    cfeSec: TARGET,
    aerobicProfile: buildAerobicProfile([], "2026-06-01", TARGET),
    startDate: "2026-06-01",
    templateHistory: stableEconomyHistory(),
  });

  it("週の高負荷が3日にならない", () => {
    const days = [
      ...new Set(plan.sessions.filter((s) => isSpecificCategory(s.category)).map((s) => s.date)),
    ].sort();
    for (const d of days) {
      const inWindow = days.filter((x) => diffDays(x, d) >= 0 && diffDays(x, d) <= 6);
      expect(inWindow.length, `${d} を終端とする7日間`).toBeLessThanOrEqual(2);
    }
  });

  it("ルールエンジンがERRORを出さない（RULE-01・04・06を含む）", () => {
    const violations = runRuleEngine(ctx(plan.sessions, testAthlete(), "2026-06-01"));
    const errors = violations.filter((v) => v.level === "ERROR");
    expect(errors.map((v) => `${v.rule}: ${v.message}`)).toEqual([]);
  });
});

/*
 * 段は「到達したら留まる」。上がっては落ちるを繰り返さない。
 *
 * 以前は希望値が「前回**実施した**段」から始まっていた。上の段にレシピが1つしか
 * 無いと、14日以内に同じ形式を避ける規則で下の段が選ばれ、その次の希望値も
 * 下がる。結果、濃い帯が隔週でしか出なかった。
 */
describe("段は到達したら留まる", () => {
  /** 週1回ずつ、指定の結果で実施していったときの帯（GRP比）の並び */
  function ratios(count: number, opts: { fail?: (i: number) => boolean } = {}) {
    const history: TemplateHistoryEntry[] = [];
    const out: number[] = [];
    let date = "2026-06-02";
    for (let i = 0; i < count; i++) {
      const spec = buildSessionSpec({
        category: "race_economy",
        phase: "Specific",
        weekIndex: i,
        cfeSec: TARGET,
        athleteType: "lactate_tolerant",
        templateHistory: history,
        onDate: date,
      })!;
      const d = spec.blocks[0].distanceM;
      out.push(Number((spec.targetPaces[0].targetSecFast / (d * GRP)).toFixed(3)));
      const failed = opts.fail?.(i) ?? false;
      history.push({
        date,
        category: "race_economy",
        templateId: spec.templateId,
        variationGroup: spec.variationGroup,
        progressionStage: spec.progressionStage,
        achievement: failed ? "partial" : "achieved",
        rpe: failed ? 9 : 7,
      });
      date = addDays(date, 7);
    }
    return out;
  }

  it("きちんと実施し続ければ、濃い帯に上がってそこに留まる", () => {
    const r = ratios(10);
    // 2回こなしてから上がる
    expect(r.slice(0, 2)).toEqual([1.04, 1.04]);
    // 以降はずっと濃い帯。落ちない
    expect(r.slice(2)).toEqual(new Array(8).fill(1.01));
  });

  it("未達が続けば上がらない", () => {
    const r = ratios(10, { fail: () => true });
    expect(r.every((x) => x === 1.04)).toBe(true);
  });

  it("途中から崩れたら降りる", () => {
    const r = ratios(10, { fail: (i) => i >= 5 });
    expect(r[4]).toBe(1.01); // 崩れる前は濃い帯
    expect(r.at(-1)).toBe(1.04); // 崩れたあとは戻っている
  });
});
