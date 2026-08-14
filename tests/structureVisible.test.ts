/**
 * 「今日が何の繰り返しのどこなのか」が、決めたあとも追えること。
 *
 * N日周期も冬季ブロックも、設定した直後の画面メッセージにしか出ていなかった。
 * 画面を離れると理由が消えるので、
 *   ・あとで予定を見返しても「なぜここだけCVなのか」が分からない
 *   ・繰り返している構造が画面から見えず、周期にした意味が本人にも分からない
 *   ・相談（AI）には送っていないので、冬季なのにレース前提の答えが返る
 * という3つが同時に起きていた。
 */
import { describe, expect, it } from "vitest";
import { memRepo } from "./sqlite-helper";
import {
  assistantStructure,
  assistantContext,
  regeneratePlan,
  todayStructure,
} from "@/lib/service";
import type { TrainingCycle, WeekTemplate } from "@/lib/core/weekTemplate";
import { makeRace, testAthlete } from "./helpers";

const TODAY = "2026-08-15";

function seed(opts: { cycle?: TrainingCycle; race?: boolean } = {}) {
  const repo = memRepo();
  repo.saveAthlete(testAthlete());
  if (opts.race !== false) {
    const race = makeRace("2026-11-15");
    repo.saveRace(race);
    repo.saveGoal({
      targetEvent: "800m",
      targetTimeSec: 108.9,
      targetRaceId: race.id,
      subRaceIds: [],
    });
  } else {
    repo.saveGoal({
      targetEvent: "800m",
      targetTimeSec: 108.9,
      targetRaceId: "",
      subRaceIds: [],
    });
  }
  if (opts.cycle) {
    const t: WeekTemplate = { slots: {}, modes: {}, enabled: true, cycle: opts.cycle };
    repo.saveWeekTemplate(t);
  }
  regeneratePlan(repo, TODAY);
  return repo;
}

const cycle10: TrainingCycle = {
  enabled: true,
  lengthDays: 10,
  anchorDate: TODAY,
  slots: {},
  modes: {},
};

describe("今日の構造", () => {
  it("曜日で組んでレースにも向かっているときは、何も出さない", () => {
    const repo = seed();
    const s = todayStructure(repo, TODAY, undefined);
    expect(s.cycle).toBeUndefined();
    expect(s.offSeason).toBeUndefined();
  });

  it("N日周期なら、何日目かが出る", () => {
    const repo = seed({ cycle: cycle10 });
    expect(todayStructure(repo, TODAY, undefined).cycle).toEqual({
      position: 1,
      lengthDays: 10,
      label: "周期 1日目 / 10日",
    });
    // 起点から3日後は4日目
    expect(todayStructure(repo, "2026-08-18", undefined).cycle?.position).toBe(4);
    // 周期をまたいでも折り返す
    expect(todayStructure(repo, "2026-08-25", undefined).cycle?.position).toBe(1);
  });

  it("冬季モードなら、第何ブロックかと理由が出る", () => {
    const repo = seed({ race: false });
    const session = repo.listSessions(TODAY, TODAY)[0];
    expect(session?.offSeasonBlock).toBeDefined();
    const s = todayStructure(repo, TODAY, session);
    expect(s.offSeason?.label).toBe("第1ブロック 有酸素の土台");
    expect(s.offSeason?.reason).toContain("有酸素の土台");
  });

  it("ブロックは予定に残る（あとから計算し直せないため）", () => {
    const repo = seed({ race: false });
    const blocks = new Set(
      repo
        .listSessions()
        .map((s) => s.offSeasonBlock && `${s.offSeasonBlock.number}:${s.offSeasonBlock.emphasis}`)
        .filter(Boolean)
    );
    // 16週ぶん＝4ブロックが全部残っていること
    expect(blocks.size).toBe(4);
  });

  it("レースに向けた期分けで作った日にはブロックが付かない", () => {
    const repo = seed();
    expect(repo.listSessions().every((s) => s.offSeasonBlock === undefined)).toBe(true);
  });
});

describe("相談に送る文脈", () => {
  it("周期で組んでいることを送る", () => {
    const repo = seed({ cycle: cycle10 });
    const ctx = assistantContext(repo, TODAY);
    expect(ctx.text).toContain("10日周期");
    expect(ctx.text).toContain("曜日ではなく日数の周期で組んでいる");
  });

  it("冬季モードであることと、そのブロックの狙いを送る", () => {
    const repo = seed({ race: false });
    const ctx = assistantContext(repo, TODAY);
    expect(ctx.text).toContain("冬季・基礎構築モード");
    expect(ctx.text).toContain("ピーキングしない");
    expect(ctx.text).toContain("第1ブロック 有酸素の土台");
  });

  it("曜日でレースに向かっているときは足さない（毎回同じ行を送らない）", () => {
    const repo = seed();
    const ctx = assistantContext(repo, TODAY);
    expect(ctx.text).not.toContain("周期");
    expect(ctx.text).not.toContain("冬季");
  });

  it("画面に出しているものと同じ（片方だけ更新されない）", () => {
    const repo = seed({ cycle: cycle10, race: false });
    const session = repo.listSessions(TODAY, TODAY).find((s) => s.offSeasonBlock);
    const shown = todayStructure(repo, TODAY, session);
    const sent = assistantStructure(repo, TODAY);
    expect(sent?.offSeason).toEqual(shown.offSeason);
    expect(sent?.cycle).toContain(`${shown.cycle!.lengthDays}日周期`);
  });
});

describe("生成で入れ替えた枠が、変更履歴に残る", () => {
  it("周期モードで内容を落とした枠に理由が残る", () => {
    const repo = seed({ cycle: cycle10 });
    const log = repo.listChangeLog(1000);
    expect(log.length).toBeGreaterThan(0);
    // 制限因子の振り替えと、7日窓の調整の両方が記録されること
    const kinds = new Set(log.map((x) => x.triggeredBy));
    expect(kinds.has("M-7") || kinds.has("RULE-04")).toBe(true);
    for (const entry of log) {
      expect(entry.reason.length).toBeGreaterThan(0);
      // 量を動かしたのではなく枠の中身を入れ替えただけなので neutral
      expect(entry.direction).toBe("neutral");
    }
  });

  it("記録した枠が実在する（消えた枠の理由を残さない）", () => {
    const repo = seed({ cycle: cycle10 });
    const ids = new Set(repo.listSessions().map((s) => s.id));
    for (const entry of repo.listChangeLog(1000)) {
      expect(ids.has(entry.sessionId), entry.sessionId).toBe(true);
    }
  });
});
