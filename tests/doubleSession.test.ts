/**
 * 2部練習（午前・午後）。
 *
 * 土台（timeOfDay・同日2本の警告・負荷の合算・カレンダー表示）は元からあったが、
 * 曜日設定・生成器・ホームが1日1本前提だった。ここで見張るのは
 *   ・指定した曜日だけ2本になること（黙って量を増やさない）
 *   ・危ない組み合わせを**生成前**に言うこと
 *   ・ホームからもう1本が消えないこと
 */
import { describe, expect, it } from "vitest";
import { memRepo } from "./sqlite-helper";
import { dashboard, regeneratePlan } from "@/lib/service";
import { applyStaleness } from "@/lib/core/cfe";
import { makeRace, testAthlete } from "./helpers";
import {
  amSlotOf,
  isDoubleDay,
  isPointSlot,
  normalizeWeekTemplate,
  validateWeekTemplate,
  type WeekTemplate,
} from "@/lib/core/weekTemplate";

const TODAY = "2026-08-13";

function setup(template?: Partial<WeekTemplate>) {
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
  if (template) {
    repo.saveWeekTemplate({
      enabled: true,
      slots: {},
      modes: {},
      ...template,
    } as WeekTemplate);
  }
  regeneratePlan(repo, TODAY);
  return repo;
}

/** その日の予定を timeOfDay 順に返す */
function dayOf(repo: ReturnType<typeof memRepo>, date: string) {
  return repo
    .listSessions(date, date)
    .sort((a, b) => (a.timeOfDay ?? "pm").localeCompare(b.timeOfDay ?? "pm"));
}

describe("午前枠の読み方", () => {
  it("未設定・auto はどちらも「午前なし」", () => {
    const t: WeekTemplate = { enabled: true, slots: {}, amSlots: { 2: "auto" } };
    expect(amSlotOf(t, 2)).toBeUndefined();
    expect(amSlotOf(t, 3)).toBeUndefined();
  });

  it("テンプレートが無効なら午前も無効", () => {
    const t: WeekTemplate = { enabled: false, slots: {}, amSlots: { 2: "aerobic" } };
    expect(amSlotOf(t, 2)).toBeUndefined();
  });

  it("午後が休養の日は2部とみなさない", () => {
    const t: WeekTemplate = {
      enabled: true,
      slots: { 4: "off" },
      modes: { 4: "fixed" },
      amSlots: { 4: "aerobic" },
    };
    expect(isDoubleDay(t, 4)).toBe(false);
  });

  it("正規化で午前枠が保たれる（保存して読み直しても消えない）", () => {
    const t = normalizeWeekTemplate({
      enabled: true,
      slots: { 2: "point" },
      modes: { 2: "fixed" },
      amSlots: { 2: "aerobic", 3: "auto" },
    });
    expect(t.amSlots?.[2]).toBe("aerobic");
    expect(t.amSlots?.[3]).toBeUndefined();
  });
});

describe("危ない組み合わせは生成前に言う", () => {
  it("午前・午後とも高負荷ならERROR", () => {
    const v = validateWeekTemplate({
      enabled: true,
      slots: { 2: "high_lactate" },
      modes: { 2: "fixed" },
      amSlots: { 2: "point" },
    });
    const hit = v.find((x) => x.rule === "RULE-03" && x.message.includes("午前・午後とも高負荷"));
    expect(hit).toBeDefined();
    expect(hit!.level).toBe("ERROR");
  });

  it("午前ジョグ＋午後ポイントは通す（普通の2部）", () => {
    const v = validateWeekTemplate({
      enabled: true,
      slots: { 2: "point" },
      modes: { 2: "fixed" },
      amSlots: { 2: "aerobic" },
    });
    expect(v.some((x) => x.message.includes("午前・午後とも高負荷"))).toBe(false);
  });

  it("午後が休養なのに午前枠があればWARN", () => {
    const v = validateWeekTemplate({
      enabled: true,
      slots: { 4: "off" },
      modes: { 4: "fixed" },
      amSlots: { 4: "aerobic" },
    });
    expect(v.some((x) => x.message.includes("午後が休養なのに"))).toBe(true);
  });
});

describe("生成", () => {
  it("指定した曜日だけ2本になる", () => {
    // 火曜(2)を 午前ジョグ / 午後ポイント
    const repo = setup({
      slots: { 2: "point" },
      modes: { 2: "fixed" },
      amSlots: { 2: "aerobic" },
    });
    const tue = dayOf(repo, "2026-08-18"); // 火
    expect(tue.map((s) => s.timeOfDay)).toEqual(["am", "pm"]);
    expect(tue[0].category).toBe("aerobic");

    // 指定していない水曜は1本のまま
    const wed = dayOf(repo, "2026-08-19");
    expect(wed).toHaveLength(1);
  });

  it("午前を指定しなければ、これまでどおり増えない", () => {
    const repo = setup({ slots: { 2: "point" }, modes: { 2: "fixed" } });
    const tue = dayOf(repo, "2026-08-18");
    expect(tue).toHaveLength(1);
    expect(tue[0].timeOfDay).toBe("pm");
  });

  it("午後が休養の日には午前を置かない（休養日が半日つぶれない）", () => {
    const repo = setup({
      slots: { 4: "off" },
      modes: { 4: "fixed" },
      amSlots: { 4: "aerobic" },
    });
    // 休養日そのものの枠（off）は残る。足してはいけないのは午前の練習のほう
    const thu = dayOf(repo, "2026-08-20"); // 木
    expect(thu.every((s) => s.category === "off")).toBe(true);
    expect(thu.some((s) => s.timeOfDay === "am")).toBe(false);
  });

  it("2本が同じ時間帯にならない（idが衝突して片方消えない）", () => {
    const repo = setup({
      slots: { 2: "point", 5: "point" },
      modes: { 2: "fixed", 5: "fixed" },
      amSlots: { 2: "aerobic", 5: "neural" },
    });
    for (const d of ["2026-08-18", "2026-08-21"]) {
      const list = dayOf(repo, d);
      expect(new Set(list.map((s) => s.timeOfDay)).size).toBe(list.length);
    }
  });
});

describe("ホーム", () => {
  it("2部の日はもう1本がホームに出る", () => {
    const repo = setup({
      slots: { 2: "point" },
      modes: { 2: "fixed" },
      amSlots: { 2: "aerobic" },
    });
    const d = dashboard(repo, "2026-08-18");
    expect(d.todaySession).toBeDefined();
    expect(d.todayOtherSessions).toHaveLength(1);
    expect(d.todayOtherSessions![0].id).not.toBe(d.todaySession!.id);
  });

  it("1部の日は余計なものを出さない", () => {
    const repo = setup({ slots: { 2: "point" }, modes: { 2: "fixed" } });
    expect(dashboard(repo, "2026-08-19").todayOtherSessions).toHaveLength(0);
  });
});

describe("午前の量が状況に合わせて動く", () => {
  /** 指定日の午前セッション */
  const amOf = (repo: ReturnType<typeof memRepo>, date: string) =>
    repo.listSessions(date, date).find((s) => s.timeOfDay === "am");

  it("午後が高負荷の日は午前を短くする（脚を残す）", () => {
    const repo = setup({
      slots: { 2: "high_lactate", 3: "aerobic" },
      modes: { 2: "fixed", 3: "fixed" },
      amSlots: { 2: "aerobic", 3: "aerobic" },
    });
    const hardDay = amOf(repo, "2026-08-18"); // 火＝午後 高乳酸
    const easyDay = amOf(repo, "2026-08-19"); // 水＝午後 ジョグ
    expect(hardDay).toBeDefined();
    expect(easyDay).toBeDefined();
    expect(hardDay!.durationMin!).toBeLessThan(easyDay!.durationMin!);
  });

  it("量で伸ばす種目ではないので、上には振れない", () => {
    const repo = setup({
      slots: { 3: "aerobic" },
      modes: { 3: "fixed" },
      amSlots: { 3: "aerobic" },
    });
    expect(amOf(repo, "2026-08-19")!.durationMin!).toBeLessThanOrEqual(40);
  });
});

describe("CFEの鈍化は「練習の記録が無い」ときだけ", () => {
  it("CFEを更新できないカテゴリでも、記録があれば鈍化しない", () => {
    const cfe = {
      estimated800mSec: 111.0,
      confidence: 0.6,
      lastUpdated: "2026-06-01",
      history: [],
    };
    // CFEは2か月動いていないが、3日前に練習の記録がある
    const kept = applyStaleness(cfe, "2026-08-03", "2026-07-31");
    expect(kept.estimated800mSec).toBe(111.0);
  });

  it("本当に記録が無ければ従来どおり鈍化する", () => {
    const cfe = {
      estimated800mSec: 111.0,
      confidence: 0.6,
      lastUpdated: "2026-06-01",
      history: [],
    };
    const stale = applyStaleness(cfe, "2026-08-03");
    expect(stale.estimated800mSec).toBeGreaterThan(111.0);
    expect(stale.history.at(-1)!.source).toContain("練習の記録が無い");
  });

  it("記録が古ければ、その記録の日から数える", () => {
    const cfe = {
      estimated800mSec: 111.0,
      confidence: 0.6,
      lastUpdated: "2026-06-01",
      history: [],
    };
    const fromResult = applyStaleness(cfe, "2026-08-03", "2026-07-01");
    const fromCfe = applyStaleness(cfe, "2026-08-03");
    // 記録のほうが新しいぶん、鈍化は小さくなる
    expect(fromResult.estimated800mSec).toBeLessThan(fromCfe.estimated800mSec);
    expect(fromResult.estimated800mSec).toBeGreaterThan(111.0);
  });
});

/**
 * 神経系の中身を選び分ける。
 *
 * 坂ダッシュ（`hillSprints`）は実装があるのに曜日設定から選べず、
 * neural を選ぶと必ず流しになっていた。
 * ラベルも「神経系（ジョグ込み）」で、何をやるのか伝わらなかった。
 */
describe("ジョグ＋坂ダッシュ / ジョグ＋流し を選び分ける", () => {
  const nameOn = (repo: ReturnType<typeof memRepo>, date: string) =>
    repo.listSessions(date, date).map((s) => s.name);

  it("坂ダッシュを指定すると坂ダッシュが出る", () => {
    const repo = setup({ slots: { 3: "hill" }, modes: { 3: "fixed" } });
    expect(nameOn(repo, "2026-08-19").join()).toContain("坂ダッシュ");
  });

  it("流しを指定すると流しが出る", () => {
    const repo = setup({ slots: { 3: "neural" }, modes: { 3: "fixed" } });
    expect(nameOn(repo, "2026-08-19").join()).toContain("流し");
  });

  it("どちらもジョグが別枠で付く（ジョグ＋◯◯になっている）", () => {
    for (const slot of ["hill", "neural"] as const) {
      const repo = setup({ slots: { 3: slot }, modes: { 3: "fixed" } });
      const list = repo.listSessions("2026-08-19", "2026-08-19");
      expect(list.some((s) => s.category === "aerobic")).toBe(true);
      expect(list.some((s) => s.category === "neural")).toBe(true);
    }
  });

  it("坂ダッシュはポイント練習に数えない（低負荷）", () => {
    expect(isPointSlot("hill")).toBe(false);
    // 高負荷2本の判定にも引っかからない
    const v = validateWeekTemplate({
      enabled: true,
      slots: { 2: "hill" },
      modes: { 2: "fixed" },
      amSlots: { 2: "hill" },
    });
    expect(v.some((x) => x.message.includes("午前・午後とも高負荷"))).toBe(false);
  });

  it("午前枠にも坂ダッシュを置ける", () => {
    const repo = setup({
      slots: { 2: "point" },
      modes: { 2: "fixed" },
      amSlots: { 2: "hill" },
    });
    const am = repo.listSessions("2026-08-18", "2026-08-18").find((s) => s.timeOfDay === "am");
    expect(am?.name).toContain("坂ダッシュ");
  });
});
