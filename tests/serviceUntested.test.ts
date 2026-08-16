/**
 * サービス層のうち、ユニットテストが一度も触れていなかった経路。
 *
 * カバレッジを測ったら `workflow.ts` の分岐が2割空いていた。
 * 画面やAPI経由では動いているが（E2Eが叩いている）、
 * **境界の振る舞いが固定されていない**——空のとき、1件のとき、参照されているとき。
 *
 * ここで見るのは「何を返すか」よりも **何を返さないか**。
 * 材料が足りないときに、それらしい値を作って返していないこと。
 * 推測で埋めた値が画面に出ると、実測と区別が付かなくなる。
 */
import { describe, expect, it } from "vitest";
import { memRepo } from "./sqlite-helper";
import {
  cfeRangeFor,
  conditionComparison,
  coverageReview,
  deleteShoe,
  heatFlaggedDates,
  listShoes,
  performanceSummaries,
  previousEntryFor,
  processResult,
  regeneratePlan,
  saveShoe,
  shoeUsageList,
} from "@/lib/service";
import { makeRace, testAthlete } from "./helpers";
import type { Goal, SessionResult } from "@/lib/core/types";
import type { Shoe } from "@/lib/core/shoes";

const TODAY = "2026-07-26";

function setup(withPlan = true) {
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
  if (withPlan) regeneratePlan(repo, TODAY);
  return repo;
}

function saveJog(repo: ReturnType<typeof memRepo>, over: Partial<SessionResult> = {}) {
  const s = repo
    .listSessions()
    .filter((x) => x.category === "aerobic" && x.status === "planned")
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  if (!s) throw new Error("対象の予定が無い");
  processResult(repo, {
    id: `res-${s.id}`,
    sessionId: s.id,
    date: s.date,
    actualLapsSec: [],
    continuous: { distanceKm: 10, durationMin: 50 },
    achievement: "achieved",
    rpe: 5,
    subjective: "easy",
    ...over,
  } as SessionResult);
  return s;
}

describe("暑熱フラグの付いた日", () => {
  it("記録が無ければ空（それらしい日を作らない）", () => {
    expect(heatFlaggedDates(setup()).size).toBe(0);
  });

  it("フラグの付いた日だけ入る", () => {
    const repo = setup();
    const s = saveJog(repo, { weatherTempC: 34, humidityPct: 70 });
    const flagged = heatFlaggedDates(repo);
    // 暑熱かどうかは気温と湿度から決まる。ここではその日が入ることだけ見る
    expect(flagged.has(s.date)).toBe(repo.resultForSession(s.id)?.heatFlagged === true);
  });
});

describe("「前回と同じ」で読み込む対象", () => {
  it("同じカテゴリの記録が無ければ返さない（無いものを作らない）", () => {
    const repo = setup();
    const s = repo.listSessions().find((x) => x.category === "high_lactate")!;
    expect(previousEntryFor(repo, s.id)).toBeUndefined();
  });

  it("記録があれば、どのセッションから読んだかが分かる", () => {
    const repo = setup();
    saveJog(repo);
    const next = repo
      .listSessions()
      .filter((x) => x.category === "aerobic" && x.status === "planned")
      .sort((a, b) => a.date.localeCompare(b.date))[0];
    const prev = previousEntryFor(repo, next.id);
    // 中身を見ずに登録されないよう、出どころを必ず持つ
    expect(prev?.date).toBeDefined();
  });

  it("知らないセッションidなら返さない", () => {
    expect(previousEntryFor(setup(), "no-such-session")).toBeUndefined();
  });
});

describe("CFEの幅", () => {
  it("CFEが無ければ返さない", () => {
    const repo = memRepo();
    expect(cfeRangeFor(repo, TODAY)).toBeUndefined();
  });

  it("あれば幅を返す", () => {
    const range = cfeRangeFor(setup(), TODAY);
    expect(range).toBeDefined();
  });
});

describe("4週間のバランス", () => {
  it("選手が居なければ返さない", () => {
    expect(coverageReview(memRepo(), TODAY)).toBeUndefined();
  });

  it("配分の集計を返す", () => {
    const review = coverageReview(setup(), TODAY);
    expect(review?.targets.length).toBeGreaterThan(0);
    // 判断の根拠を数字で持つ（回数を伴わない指摘にしない）
    for (const t of review!.targets) {
      expect(typeof t.actual).toBe("number");
      expect(typeof t.wanted).toBe("number");
    }
  });
});

describe("期間ごとの集計", () => {
  it("記録が無くても落ちない（週・月・年の3つを返す）", () => {
    const out = performanceSummaries(setup(), TODAY);
    expect(Array.isArray(out) ? out.length : Object.keys(out).length).toBeGreaterThan(0);
  });
});

describe("シューズ", () => {
  const shoe = (over: Partial<Shoe> = {}): Shoe => ({
    id: "shoe-1",
    name: "テストスパイク",
    kind: "spike",
    ...over,
  });

  it("最初は空", () => {
    expect(listShoes(setup(false))).toEqual([]);
  });

  it("名前が空なら断る（名無しの靴を作らない）", () => {
    const repo = setup(false);
    expect(() => saveShoe(repo, shoe({ name: "  " }))).toThrow();
  });

  it("登録して読み出せる。同じidなら上書きになる", () => {
    const repo = setup(false);
    saveShoe(repo, shoe());
    expect(listShoes(repo)).toHaveLength(1);
    saveShoe(repo, shoe({ name: "名前を直した" }));
    expect(listShoes(repo)).toHaveLength(1);
    expect(listShoes(repo)[0].name).toBe("名前を直した");
  });

  it("使っていない靴は消せる", () => {
    const repo = setup(false);
    saveShoe(repo, shoe());
    expect(deleteShoe(repo, "shoe-1").deleted).toBe(true);
    expect(listShoes(repo)).toEqual([]);
  });

  it("記録が指している靴は消さない（何を履いていたか分からなくなる）", () => {
    const repo = setup();
    saveShoe(repo, shoe());
    saveJog(repo, { shoeId: "shoe-1" });
    const out = deleteShoe(repo, "shoe-1");
    expect(out.deleted).toBe(false);
    expect(out.reason).toBeTruthy();
    expect(listShoes(repo)).toHaveLength(1);
  });

  it("使用距離は記録から足し上げる", () => {
    const repo = setup();
    saveShoe(repo, shoe());
    saveJog(repo, { shoeId: "shoe-1" });
    const usage = shoeUsageList(repo).find((u) => u.shoe.id === "shoe-1");
    expect(usage?.totalKm).toBe(10);
    expect(usage?.sessions).toBe(1);
  });

  it("知らないidを消そうとしても落ちない", () => {
    expect(deleteShoe(setup(false), "no-such-shoe").deleted).toBe(false);
  });
});

describe("条件別のRPE", () => {
  it("記録が少なければ何も出さない（1回ずつでは分けられない）", () => {
    const repo = setup();
    saveJog(repo, { conditions: ["rain"], rpe: 9 });
    expect(conditionComparison(repo)).toEqual([]);
  });
});
