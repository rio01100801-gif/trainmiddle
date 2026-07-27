/**
 * 3-1 固定曜日設定 / 3-2 自作メニュー登録
 */
import { describe, it, expect } from "vitest";
import {
  emptyWeekTemplate,
  isPointSlot,
  modeOf,
  normalizeWeekTemplate,
  pickCustomMenu,
  slotOf,
  validateWeekTemplate,
  type CustomMenu,
  type WeekTemplate,
} from "@/lib/core/weekTemplate";
import { generatePlan } from "@/lib/core/periodization";
import { buildAerobicProfile } from "@/lib/core/pace";
import { runRuleEngine } from "@/lib/core/rules";
import { ctx, makeRace, testAthlete } from "./helpers";
import type { Goal } from "@/lib/core/types";

const T = (slots: WeekTemplate["slots"], extra: Partial<WeekTemplate> = {}): WeekTemplate => ({
  slots,
  enabled: true,
  ...extra,
});

// ---------------------------------------------------------------------------
// 3-1. 固定曜日設定
// ---------------------------------------------------------------------------

describe("3-1 固定曜日設定の基本", () => {
  it("無効なら常に自動扱い", () => {
    const t = { ...T({ 2: "point" }), enabled: false };
    expect(slotOf(t, 2)).toBe("auto");
    expect(slotOf(emptyWeekTemplate(), 2)).toBe("auto");
  });

  it("設定した曜日の枠を返す", () => {
    const t = T({ 2: "point", 4: "off", 0: "aerobic" });
    expect(slotOf(t, 2)).toBe("point");
    expect(slotOf(t, 4)).toBe("off");
    expect(slotOf(t, 0)).toBe("aerobic");
    expect(slotOf(t, 1)).toBe("auto"); // 未設定
  });

  it("旧データの指定枠は固定として読み、新形式では優先と区別する", () => {
    const legacy = T({ 2: "point" });
    expect(modeOf(legacy, 2)).toBe("fixed");
    const preferred = normalizeWeekTemplate({
      ...T({ 2: "point" }),
      modes: { 2: "preferred" },
    });
    expect(modeOf(preferred, 2)).toBe("preferred");
    expect(modeOf(preferred, 1)).toBe("none");
  });

  it("ポイント練習の枠を判定できる", () => {
    expect(isPointSlot("point")).toBe(true);
    expect(isPointSlot("high_lactate")).toBe(true);
    expect(isPointSlot("threshold")).toBe(true);
    expect(isPointSlot("aerobic")).toBe(false);
    expect(isPointSlot("neural")).toBe(false);
    expect(isPointSlot("off")).toBe(false);
    expect(isPointSlot("auto")).toBe(false);
  });
});

describe("3-1 テンプレート自体の検証（生成前に警告する）", () => {
  it("指示書の例（火・土ポイント / 木休養 / 日ロングラン）は違反なし", () => {
    const t = T({ 2: "point", 4: "off", 6: "point", 0: "aerobic" });
    expect(validateWeekTemplate(t).filter((v) => v.level === "ERROR")).toEqual([]);
  });

  it("内容未定のポイント練習を週3回固定するとWARN", () => {
    const t = T({ 2: "point", 4: "point", 6: "point" });
    const v = validateWeekTemplate(t);
    expect(v.some((x) => x.rule === "RULE-04" && x.level === "WARN")).toBe(true);
    expect(v.some((x) => x.rule === "RULE-04" && x.level === "ERROR")).toBe(false);
  });

  it("高乳酸・中距離特異的を週3回固定するとERROR", () => {
    const t = T({ 1: "high_lactate", 3: "race_economy", 6: "modeling" });
    const v = validateWeekTemplate(t);
    expect(v.some((x) => x.rule === "RULE-04" && x.level === "ERROR")).toBe(true);
  });

  it("高負荷を週4回固定すると種類にかかわらずERROR", () => {
    const t = T({ 1: "cv", 3: "threshold", 5: "cv", 0: "threshold" });
    const v = validateWeekTemplate(t);
    expect(v.some((x) => x.rule === "RULE-04" && x.level === "ERROR")).toBe(true);
  });

  it("ポイント練習が連日ならERROR", () => {
    const t = T({ 2: "point", 3: "point" });
    const v = validateWeekTemplate(t).filter((x) => x.rule === "RULE-03");
    expect(v[0].level).toBe("ERROR");
    expect(v[0].message).toContain("連日");
  });

  it("週をまたぐ間隔も見る（土と翌週日曜は連日）", () => {
    const t = T({ 6: "point", 0: "point" });
    const v = validateWeekTemplate(t).filter((x) => x.rule === "RULE-03");
    expect(v.length).toBeGreaterThan(0);
    expect(v[0].level).toBe("ERROR");
  });

  it("中1日はWARN（許容だが間の日の指定つき）", () => {
    const t = T({ 2: "point", 4: "point" });
    const v = validateWeekTemplate(t).filter((x) => x.rule === "RULE-03");
    expect(v[0].level).toBe("WARN");
    expect(v[0].suggestion).toContain("中2日");
  });

  it("高乳酸を週2回固定するとERROR", () => {
    const t = T({ 2: "high_lactate", 5: "high_lactate" });
    expect(
      validateWeekTemplate(t).some((x) => x.rule === "RULE-01" && x.level === "ERROR")
    ).toBe(true);
  });

  it("全曜日を固定して休養日ゼロならWARN", () => {
    const t = T({
      0: "aerobic",
      1: "aerobic",
      2: "point",
      3: "aerobic",
      4: "neural",
      5: "aerobic",
      6: "point",
    });
    expect(validateWeekTemplate(t).some((x) => x.rule === "TEMPLATE")).toBe(true);
  });

  it("無効なテンプレートは検証しない", () => {
    const t = { ...T({ 2: "point", 3: "point" }), enabled: false };
    expect(validateWeekTemplate(t)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 3-1. プラン生成への反映
// ---------------------------------------------------------------------------

describe("3-1 プラン生成が固定曜日を尊重する", () => {
  const athlete = testAthlete();
  const race = makeRace("2026-09-25");
  const goal: Goal = {
    targetEvent: "800m",
    targetTimeSec: 108.9,
    targetRaceId: race.id,
    subRaceIds: [],
  };
  const aerobic = buildAerobicProfile([], "2026-06-08", 111.0);

  const gen = (weekTemplate?: WeekTemplate) =>
    generatePlan({
      athlete,
      goal,
      races: [race],
      cfeSec: 111.0,
      aerobicProfile: aerobic,
      startDate: "2026-06-08",
      weekTemplate,
    });

  it("木曜を休養に固定すると、テーパー期以外の木曜がすべて休養になる", () => {
    const plan = gen(T({ 4: "off" }));
    const thursdays = plan.sessions.filter(
      (s) => new Date(s.date + "T00:00:00Z").getUTCDay() === 4 && s.date < "2026-09-11"
    );
    expect(thursdays.length).toBeGreaterThan(5);
    expect(thursdays.every((s) => s.category === "off")).toBe(true);
    expect(thursdays.every((s) => s.isFixed && s.fixedSource?.includes("木曜"))).toBe(true);
  });

  it("レース直前は固定曜日よりテーパー設計が優先される（安全側が勝つ）", () => {
    const plan = gen(T({ 4: "off" }));
    // レース(9/25 金)の前日 9/24 は木曜。休養固定でも刺激入れが入る
    const dayBefore = plan.sessions.find((s) => s.date === "2026-09-24");
    expect(dayBefore).toBeDefined();
    expect(dayBefore!.category).not.toBe("off");
    expect(dayBefore!.category).toBe("neural");
    expect(dayBefore!.isFixed).toBe(false);
  });

  it("日曜をジョグ枠＋ロングラン指定にするとロングランになる", () => {
    const plan = gen(T({ 0: "aerobic" }, { longRunDow: 0 }));
    const sundays = plan.sessions.filter(
      (s) => new Date(s.date + "T00:00:00Z").getUTCDay() === 0
    );
    expect(sundays.every((s) => s.category === "aerobic")).toBe(true);
    expect(sundays.some((s) => s.name === "ロングラン")).toBe(true);
  });

  it("火・土をポイント練習に固定すると、その曜日が質練習になる", () => {
    const plan = gen(T({ 2: "point", 6: "point", 4: "off" }));
    const quality = ["high_lactate", "race_economy", "modeling", "cv", "threshold"];
    const tuesdays = plan.sessions.filter(
      (s) => new Date(s.date + "T00:00:00Z").getUTCDay() === 2 && s.phase !== "Taper"
    );
    // テーパー期は質を置けないので除外して判定する
    expect(tuesdays.filter((s) => quality.includes(s.category)).length).toBeGreaterThan(3);
  });

  it("優先曜日へ週の回数を増やさずポイント練習を移す", () => {
    const plain = gen();
    const preferred = gen(
      T({ 3: "point" }, { modes: { 3: "preferred" } })
    );
    const quality = ["high_lactate", "race_economy", "modeling", "cv", "threshold"];
    const count = (sessions: typeof plain.sessions) =>
      sessions.filter((session) => session.phase === "Specific" && quality.includes(session.category)).length;
    const preferredWednesdays = preferred.sessions.filter(
      (session) =>
        session.phase === "Specific" &&
        new Date(session.date + "T00:00:00Z").getUTCDay() === 3 &&
        quality.includes(session.category)
    );
    expect(preferredWednesdays.length).toBeGreaterThan(0);
    expect(preferredWednesdays.every((session) => !session.isFixed)).toBe(true);
    expect(count(preferred.sessions)).toBe(count(plain.sessions));
  });

  it("優先設定で高負荷が連日になる場合は自動配置を残す", () => {
    const plan = gen(
      T({ 4: "point" }, { modes: { 4: "preferred" } })
    );
    const violations = runRuleEngine(
      ctx({
        sessions: plan.sessions,
        strengthSessions: plan.strengthSessions,
        races: [race],
        goal,
        evaluationDate: "2026-06-08",
      })
    );
    expect(violations.filter((violation) => violation.rule === "RULE-03")).toEqual([]);
  });

  it("固定曜日を使ってもERROR級のルール違反は出ない", () => {
    const plan = gen(T({ 2: "point", 4: "off", 6: "point", 0: "aerobic" }, { longRunDow: 0 }));
    const violations = runRuleEngine(
      ctx({
        sessions: plan.sessions,
        strengthSessions: plan.strengthSessions,
        races: [race],
        goal,
        evaluationDate: "2026-06-08",
      })
    );
    expect(violations.filter((v) => v.level === "ERROR")).toEqual([]);
  });

  it("ポイント枠を2つ固定しても高乳酸が生成される（800mの中核が消えない）", () => {
    const plan = gen(T({ 2: "point", 6: "point", 4: "off" }));
    const hl = plan.sessions.filter((s) => s.category === "high_lactate");
    expect(hl.length).toBeGreaterThan(0);
    // Specific期には週1で高乳酸が入る
    const specificHl = plan.sessions.filter(
      (s) => s.phase === "Specific" && s.category === "high_lactate"
    );
    expect(specificHl.length).toBeGreaterThan(0);
  });

  it("週2枠のポイントは1本目と2本目で内容が変わる", () => {
    const plan = gen(T({ 2: "point", 6: "point", 4: "off" }));
    const specific = plan.sessions.filter((s) => s.phase === "Specific");
    const tue = specific.filter((s) => new Date(s.date + "T00:00:00Z").getUTCDay() === 2);
    const sat = specific.filter((s) => new Date(s.date + "T00:00:00Z").getUTCDay() === 6);
    expect(tue.every((s) => s.category === "high_lactate")).toBe(true);
    expect(sat.every((s) => s.category === "race_economy")).toBe(true);
  });

  it("テンプレート未指定なら従来どおりの生成になる", () => {
    const a = gen();
    const b = gen(emptyWeekTemplate());
    expect(a.sessions.map((s) => s.category)).toEqual(b.sessions.map((s) => s.category));
  });

  it("レース7日前以降は固定曜日より優先してテーパーを守る", () => {
    const plan = gen(T({ 2: "high_lactate", 4: "off" }));
    const quality = ["high_lactate", "race_economy", "modeling", "cv", "threshold"];
    const nearRace = plan.sessions.filter(
      (s) => s.date > "2026-09-18" && quality.includes(s.category)
    );
    expect(nearRace).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 3-2. 自作メニュー
// ---------------------------------------------------------------------------

const menu = (over: Partial<CustomMenu>): CustomMenu => ({
  id: over.id ?? "m1",
  name: "自作",
  category: "high_lactate",
  source: "self",
  prescription: "300m×5 r5分",
  ...over,
});

describe("3-2 自作メニューの選択", () => {
  it("「過去にうまくいった」を最優先する", () => {
    const picked = pickCustomMenu(
      [
        menu({ id: "a", source: "self", name: "自分" }),
        menu({ id: "b", source: "past_success", name: "成功" }),
        menu({ id: "c", source: "coach", name: "コーチ" }),
      ],
      "high_lactate",
      "2026-07-01"
    );
    expect(picked!.name).toBe("成功");
  });

  it("次にコーチ指示を優先する", () => {
    const picked = pickCustomMenu(
      [menu({ id: "a", source: "self" }), menu({ id: "c", source: "coach", name: "コーチ" })],
      "high_lactate",
      "2026-07-01"
    );
    expect(picked!.name).toBe("コーチ");
  });

  it("同順位なら直近で使っていない方を選ぶ（連続を避ける）", () => {
    const picked = pickCustomMenu(
      [
        menu({ id: "a", name: "最近使った", lastUsedDate: "2026-06-30" }),
        menu({ id: "b", name: "しばらく使ってない", lastUsedDate: "2026-05-01" }),
      ],
      "high_lactate",
      "2026-07-01"
    );
    expect(picked!.name).toBe("しばらく使ってない");
  });

  it("カテゴリが違うメニューは選ばれない", () => {
    expect(
      pickCustomMenu([menu({ category: "threshold" })], "high_lactate", "2026-07-01")
    ).toBeUndefined();
  });

  it("active=false のメニューは候補から外れる", () => {
    expect(
      pickCustomMenu([menu({ active: false })], "high_lactate", "2026-07-01")
    ).toBeUndefined();
  });
});

describe("3-2 プラン生成が自作メニューを使う", () => {
  const athlete = testAthlete();
  const race = makeRace("2026-09-25");
  const goal: Goal = {
    targetEvent: "800m",
    targetTimeSec: 108.9,
    targetRaceId: race.id,
    subRaceIds: [],
  };
  const aerobic = buildAerobicProfile([], "2026-06-08", 111.0);

  it("登録した高乳酸メニューが生成結果に使われる", () => {
    const plan = generatePlan({
      athlete,
      goal,
      races: [race],
      cfeSec: 111.0,
      aerobicProfile: aerobic,
      startDate: "2026-06-08",
      customMenus: [
        menu({
          id: "hl-1",
          name: "コーチ指定 300m×6",
          category: "high_lactate",
          source: "coach",
          prescription: "300m×6 r4分 (チーム設定)",
          distanceM: 300,
        }),
      ],
    });
    const hl = plan.sessions.filter((s) => s.category === "high_lactate");
    expect(hl.length).toBeGreaterThan(0);
    expect(hl.every((s) => s.name === "コーチ指定 300m×6")).toBe(true);
    expect(hl[0].prescription).toContain("300m×6");
    expect(plan.usedCustomMenus.length).toBe(hl.length);
  });

  it("distanceMを入れると設定ペースが基準タイムから計算される", () => {
    const plan = generatePlan({
      athlete,
      goal,
      races: [race],
      cfeSec: 111.0,
      aerobicProfile: aerobic,
      startDate: "2026-06-08",
      customMenus: [menu({ id: "hl-1", category: "high_lactate", distanceM: 300 })],
    });
    const hl = plan.sessions.find((s) => s.category === "high_lactate")!;
    expect(hl.targetPaces[0].distanceM).toBe(300);
    expect(hl.targetPaces[0].targetSecFast).toBeGreaterThan(30);
    expect(hl.targetPaces[0].targetSecFast).toBeLessThan(50);
  });

  it("自作メニューが無いカテゴリは自動生成のまま", () => {
    const plan = generatePlan({
      athlete,
      goal,
      races: [race],
      cfeSec: 111.0,
      aerobicProfile: aerobic,
      startDate: "2026-06-08",
      customMenus: [menu({ id: "hl-1", category: "high_lactate" })],
    });
    const eco = plan.sessions.find((s) => s.category === "race_economy")!;
    expect(eco.name).toMatch(/^レースペース経済走/);
    expect(eco.generation?.templateId).toBeTruthy();
  });

  it("自作メニューを使ってもERROR級のルール違反は出ない", () => {
    const plan = generatePlan({
      athlete,
      goal,
      races: [race],
      cfeSec: 111.0,
      aerobicProfile: aerobic,
      startDate: "2026-06-08",
      customMenus: [
        menu({ id: "hl-1", category: "high_lactate", distanceM: 300 }),
        menu({ id: "re-1", category: "race_economy", name: "600×4", distanceM: 600 }),
      ],
      weekTemplate: T({ 2: "point", 4: "off", 6: "point" }),
    });
    const violations = runRuleEngine(
      ctx({
        sessions: plan.sessions,
        strengthSessions: plan.strengthSessions,
        races: [race],
        goal,
        evaluationDate: "2026-06-08",
      })
    );
    expect(violations.filter((v) => v.level === "ERROR")).toEqual([]);
  });
});
