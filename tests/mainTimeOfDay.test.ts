/**
 * 主練習をどちらの時間帯に置くか。
 *
 * これまで午後で固定だった。授業やグラウンドの都合で午前にポイント練習を
 * やる日があるので、曜日（周期なら位置）ごとに選べるようにした。
 *
 * ここで守らせたいのは3つ。
 *   ・**既定は午後**（設定していない曜日の予定が黙って動かない）
 *   ・枠の中身は動かさない。振り替えるのは時間帯だけ
 *   ・補助枠は**主練習の反対側**に入る（同じ時間帯に2本入れて片方を消さない）
 */
import { describe, expect, it } from "vitest";
import { memRepo } from "./sqlite-helper";
import { makeRace, testAthlete } from "./helpers";
import { regeneratePlan } from "@/lib/service";
import {
  mainTimeOfDayOf,
  normalizeWeekTemplate,
  subTimeOfDayOf,
  validateWeekTemplate,
  type Dow,
  type WeekTemplate,
} from "@/lib/core/weekTemplate";
import type { Goal } from "@/lib/core/types";

const TODAY = "2026-07-26";

function template(over: Partial<WeekTemplate> = {}): WeekTemplate {
  return { slots: {}, modes: {}, enabled: true, ...over };
}

describe("主練習の時間帯", () => {
  it("設定していなければ午後（これまでと同じ）", () => {
    expect(mainTimeOfDayOf(template(), 2)).toBe("pm");
    expect(subTimeOfDayOf(template(), 2)).toBe("am");
  });

  it("午前にすると、補助は午後になる", () => {
    const t = template({ mainTimeOfDay: { 2: "am" } });
    expect(mainTimeOfDayOf(t, 2)).toBe("am");
    expect(subTimeOfDayOf(t, 2)).toBe("pm");
  });

  it("曜日ごとに別に決められる", () => {
    const t = template({ mainTimeOfDay: { 2: "am" } });
    expect(mainTimeOfDayOf(t, 2)).toBe("am");
    expect(mainTimeOfDayOf(t, 6)).toBe("pm");
  });

  it("保存すると午前だけが残る（既定は書き込まない）", () => {
    const t = normalizeWeekTemplate(
      template({
        slots: { 2: "point", 6: "point" },
        modes: { 2: "fixed", 6: "fixed" },
        mainTimeOfDay: { 2: "am", 6: "pm" },
      })
    );
    expect(t.mainTimeOfDay).toEqual({ 2: "am" });
  });

  it("保存しても枠の中身は動かない", () => {
    const t = normalizeWeekTemplate(
      template({
        slots: { 2: "high_lactate" },
        modes: { 2: "fixed" },
        amSlots: { 2: "aerobic" },
        mainTimeOfDay: { 2: "am" },
      })
    );
    // 主練習は high_lactate のまま、補助は aerobic のまま
    expect(t.slots[2]).toBe("high_lactate");
    expect(t.amSlots?.[2]).toBe("aerobic");
  });
});

describe("検証の文", () => {
  it("午前に主練習を置いた日も、時間帯が逆さまにならない", () => {
    const t = template({
      slots: { 2: "high_lactate" },
      modes: { 2: "fixed" },
      amSlots: { 2: "cv" },
      mainTimeOfDay: { 2: "am" },
    });
    const msg = validateWeekTemplate(t)
      .map((v) => v.message)
      .join(" ");
    // 同じ日に高負荷2本なので警告は出る
    expect(msg).toContain("高負荷");
  });

  it("主練習が休養なのに補助が入っていたら、主/補助の言い方で警告する", () => {
    const t = template({
      slots: { 4: "off" },
      modes: { 4: "fixed" },
      amSlots: { 4: "aerobic" },
      mainTimeOfDay: { 4: "am" },
    });
    const v = validateWeekTemplate(t).find((x) => x.rule === "RULE-04");
    expect(v?.message).toContain("主練習が休養");
    expect(v?.message).toContain("補助枠");
  });
});

describe("生成", () => {
  function setup(t: WeekTemplate) {
    const repo = memRepo();
    repo.saveAthlete(testAthlete());
    const race = makeRace("2026-09-25");
    repo.saveRace(race);
    repo.saveGoal({
      targetEvent: "800m",
      targetTimeSec: 108.9,
      targetRaceId: race.id,
      subRaceIds: [],
    } as Goal);
    repo.saveWeekTemplate(t);
    regeneratePlan(repo, TODAY);
    return repo;
  }

  /** その曜日に生成された、休養でないセッション */
  function sessionsOnDow(repo: ReturnType<typeof memRepo>, dow: Dow) {
    return repo
      .listSessions()
      .filter((s) => new Date(`${s.date}T00:00:00Z`).getUTCDay() === dow)
      .filter((s) => s.category !== "off");
  }

  it("既定では主練習が午後に入る", () => {
    const repo = setup(template({ slots: { 2: "high_lactate" }, modes: { 2: "fixed" } }));
    const main = sessionsOnDow(repo, 2).filter((s) => s.category === "high_lactate");
    expect(main.length).toBeGreaterThan(0);
    expect(main.every((s) => s.timeOfDay === "pm")).toBe(true);
  });

  it("午前を選ぶと主練習が午前に入る", () => {
    const repo = setup(
      template({
        slots: { 2: "high_lactate" },
        modes: { 2: "fixed" },
        mainTimeOfDay: { 2: "am" },
      })
    );
    const main = sessionsOnDow(repo, 2).filter((s) => s.category === "high_lactate");
    expect(main.length).toBeGreaterThan(0);
    expect(main.every((s) => s.timeOfDay === "am")).toBe(true);
  });

  it("2部の日は、補助が主練習の反対側に入る（同じ時間帯に2本入れない）", () => {
    const repo = setup(
      template({
        slots: { 2: "high_lactate" },
        modes: { 2: "fixed" },
        amSlots: { 2: "aerobic" },
        mainTimeOfDay: { 2: "am" },
      })
    );
    /*
     * **枠が効いた日だけを見る。**
     * 全部の火曜を見ると、テーパー週のようにレース日から逆算して
     * 枠が上書きされる日まで混ざり、判定が「たまたま」で決まる。
     */
    const day = sessionsOnDow(repo, 2);
    const dates = [...new Set(day.filter((s) => s.category === "high_lactate").map((s) => s.date))];
    expect(dates.length).toBeGreaterThan(0);
    for (const date of dates) {
      const onDate = day.filter((s) => s.date === date);
      // 主練習は午前
      expect(onDate.filter((s) => s.category === "high_lactate").every((s) => s.timeOfDay === "am")).toBe(
        true
      );
      // 補助は午後（同じ時間帯に2本入っていない）
      const jog = onDate.filter((s) => s.category === "aerobic");
      expect(jog.length).toBeGreaterThan(0);
      expect(jog.every((s) => s.timeOfDay === "pm")).toBe(true);
    }
  });

  it("2部にしても、その日のセッションが片方消えない", () => {
    const repo = setup(
      template({
        slots: { 2: "high_lactate" },
        modes: { 2: "fixed" },
        amSlots: { 2: "aerobic" },
        mainTimeOfDay: { 2: "am" },
      })
    );
    // 枠が効いた日は2本そろっていること（idが衝突すると1本になる）
    const day = sessionsOnDow(repo, 2);
    const dates = [...new Set(day.filter((s) => s.category === "high_lactate").map((s) => s.date))];
    expect(dates.length).toBeGreaterThan(0);
    for (const date of dates) {
      expect(day.filter((s) => s.date === date).length).toBe(2);
    }
  });

  it("午後を選んだ日はこれまでと同じ並び（主=午後・補助=午前）", () => {
    const repo = setup(
      template({
        slots: { 2: "high_lactate" },
        modes: { 2: "fixed" },
        amSlots: { 2: "aerobic" },
      })
    );
    const day = sessionsOnDow(repo, 2);
    const dates = [...new Set(day.filter((s) => s.category === "high_lactate").map((s) => s.date))];
    expect(dates.length).toBeGreaterThan(0);
    for (const date of dates) {
      const onDate = day.filter((s) => s.date === date);
      expect(onDate.filter((s) => s.category === "high_lactate").every((s) => s.timeOfDay === "pm")).toBe(
        true
      );
      const jog = onDate.filter((s) => s.category === "aerobic");
      expect(jog.length).toBeGreaterThan(0);
      expect(jog.every((s) => s.timeOfDay === "am")).toBe(true);
    }
  });
});
