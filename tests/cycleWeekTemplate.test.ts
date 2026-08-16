/**
 * 周期モードの枠設定（`weekTemplate.ts` の cycle まわり）。
 *
 * N日周期は v87 で足したが、**枠の検証だけテストが無かった**。
 * 配置ロジック（`cycleTemplate.ts`）と生成（`periodization.ts`）は
 * それぞれテストがあるのに、その手前の「本人が組んだ枠が成立しているか」は
 * 素通りしていた（カバレッジで分岐の3割が空白と出た）。
 *
 * ここが素通りすると、**成立しない枠のまま生成に入る**。
 * 連日ポイントや高乳酸の間隔違反が、生成後に初めて分かることになる。
 */
import { describe, expect, it } from "vitest";
import {
  cycleAmSlotOf,
  cycleModeOf,
  cycleOf,
  cyclePositionFor,
  cycleSlotOf,
  cycleWeekdayDrift,
  emptyCycle,
  isCycleMode,
  normalizeCycle,
  validateCycle,
  type TrainingCycle,
  type WeekTemplate,
} from "@/lib/core/weekTemplate";
import { MAX_CYCLE_DAYS, MIN_CYCLE_DAYS } from "@/lib/core/cycleTemplate";

function cycle(over: Partial<TrainingCycle> = {}): TrainingCycle {
  return { ...emptyCycle("2026-08-16"), enabled: true, ...over };
}

const rules = (c: TrainingCycle) => validateCycle(c).map((v) => `${v.level}:${v.rule}`);
/** 周期は枠の中に入っている。位置を出す関数は枠ごと受け取る */
const tpl = (c: TrainingCycle): WeekTemplate => ({ slots: {}, modes: {}, enabled: true, cycle: c });

describe("周期モードかどうか", () => {
  it("枠が有効で、周期も有効で、起点があるときだけ", () => {
    const base: WeekTemplate = { slots: {}, modes: {}, enabled: true, cycle: cycle() };
    expect(isCycleMode(base)).toBe(true);
    expect(isCycleMode({ ...base, enabled: false })).toBe(false);
    expect(isCycleMode({ ...base, cycle: cycle({ enabled: false }) })).toBe(false);
    expect(isCycleMode({ ...base, cycle: cycle({ anchorDate: "" }) })).toBe(false);
    expect(isCycleMode(undefined)).toBe(false);
  });

  it("周期を取り出す", () => {
    expect(cycleOf(undefined)).toBeUndefined();
    const c = cycle({ lengthDays: 99 });
    const got = cycleOf({ slots: {}, modes: {}, enabled: true, cycle: c });
    // 複製を返す。長さはここで丸まる（呼ぶ側が毎回丸めなくて済むように）
    expect(got?.lengthDays).toBe(MAX_CYCLE_DAYS);
    expect(got).not.toBe(c);
  });
});

describe("位置ごとの枠", () => {
  it("指定が無ければ auto", () => {
    expect(cycleSlotOf(cycle(), 0)).toBe("auto");
    expect(cycleSlotOf(undefined, 0)).toBe("auto");
  });

  it("指定があればそれを返す", () => {
    expect(cycleSlotOf(cycle({ slots: { 2: "point" } }), 2)).toBe("point");
  });

  it("午前枠は指定が無ければ undefined（2部練習にしない）", () => {
    expect(cycleAmSlotOf(cycle(), 0)).toBeUndefined();
    expect(cycleAmSlotOf(cycle({ amSlots: { 1: "jog" } }), 1)).toBe("jog");
  });

  it("扱いは既定で none（本人が決めていない位置を固定枠にしない）", () => {
    expect(cycleModeOf(cycle(), 0)).toBe("none");
    // 枠が auto のままなら、modes に何が入っていても none
    expect(cycleModeOf(cycle({ modes: { 0: "preferred" } }), 0)).toBe("none");
    // 枠を決めたら既定は fixed（周期は最初から modes を持つ）
    expect(cycleModeOf(cycle({ slots: { 0: "point" } }), 0)).toBe("fixed");
    expect(cycleModeOf(cycle({ slots: { 0: "point" }, modes: { 0: "preferred" } }), 0)).toBe("preferred");
  });
});

describe("整える", () => {
  it("長さを4〜14日に丸める", () => {
    expect(normalizeCycle(cycle({ lengthDays: 1 })).lengthDays).toBe(MIN_CYCLE_DAYS);
    expect(normalizeCycle(cycle({ lengthDays: 99 })).lengthDays).toBe(MAX_CYCLE_DAYS);
    expect(normalizeCycle(cycle({ lengthDays: 10 })).lengthDays).toBe(10);
  });

  it("周期の外に出た指定は落とす", () => {
    // 10日周期から6日周期へ縮めたら、7日目以降の指定は消える
    const c = normalizeCycle(
      cycle({ lengthDays: 6, slots: { 1: "point", 8: "point" }, modes: { 1: "fixed", 8: "fixed" } })
    );
    expect(c.slots?.[1]).toBe("point");
    expect(c.slots?.[8]).toBeUndefined();
  });

  it("auto や none の位置は持たない（空の指定を溜めない）", () => {
    const c = normalizeCycle(
      cycle({ slots: { 0: "auto", 1: "point" }, modes: { 0: "fixed", 1: "fixed" } })
    );
    expect(c.slots?.[0]).toBeUndefined();
    expect(c.slots?.[1]).toBe("point");
  });

  it("周期が短くなって位置が消えたら、ロングランの指定も落とす", () => {
    expect(normalizeCycle(cycle({ lengthDays: 6, longRunIndex: 8 })).longRunIndex).toBeUndefined();
    expect(normalizeCycle(cycle({ lengthDays: 10, longRunIndex: 8 })).longRunIndex).toBe(8);
  });
});

describe("成立しない枠を止める", () => {
  it("起点が無ければ止める", () => {
    expect(rules(cycle({ anchorDate: "" }))).toContain("ERROR:TEMPLATE");
  });

  it("長さを丸めたら、丸めたことを言う", () => {
    const out = validateCycle(cycle({ lengthDays: 30 }));
    expect(out.some((v) => v.level === "WARN" && v.message.includes("丸めました"))).toBe(true);
  });

  it("同じ日に高負荷を2本置いたら止める", () => {
    const out = validateCycle(
      cycle({ slots: { 0: "point" }, amSlots: { 0: "point" }, modes: { 0: "fixed" } })
    );
    expect(out.some((v) => v.level === "ERROR" && v.rule === "RULE-03")).toBe(true);
  });

  it("休養日に午前枠を入れたら知らせる", () => {
    const out = validateCycle(
      cycle({ slots: { 0: "off" }, amSlots: { 0: "jog" }, modes: { 0: "fixed" } })
    );
    expect(out.some((v) => v.level === "WARN" && v.rule === "RULE-04")).toBe(true);
  });

  it("連日のポイント練習は止める（中1日が要る）", () => {
    const out = validateCycle(
      cycle({ slots: { 0: "point", 1: "point" }, modes: { 0: "fixed", 1: "fixed" } })
    );
    const err = out.find((v) => v.level === "ERROR" && v.rule === "RULE-03");
    expect(err?.message).toContain("連日");
  });

  it("中1日は通すが、知らせる", () => {
    const out = validateCycle(
      cycle({ slots: { 0: "point", 2: "point" }, modes: { 0: "fixed", 2: "fixed" } })
    );
    expect(out.some((v) => v.level === "ERROR" && v.rule === "RULE-03")).toBe(false);
    expect(out.some((v) => v.level === "WARN" && v.rule === "RULE-03")).toBe(true);
  });

  it("周期の終わりと次の周期の始まりも見る（切れ目でつながる）", () => {
    /*
     * 6日周期で1日目と6日目にポイントを置くと、繰り返したとき連日になる。
     * 1周期だけ見ていると気づけない。
     */
    const out = validateCycle(
      cycle({
        lengthDays: 6,
        slots: { 0: "point", 5: "point" },
        modes: { 0: "fixed", 5: "fixed" },
      })
    );
    expect(out.some((v) => v.rule === "RULE-03")).toBe(true);
  });

  it("高乳酸は5日あける", () => {
    const out = validateCycle(
      cycle({
        lengthDays: 10,
        slots: { 0: "high_lactate", 3: "high_lactate" },
        modes: { 0: "fixed", 3: "fixed" },
      })
    );
    const err = out.find((v) => v.level === "ERROR" && v.rule === "RULE-01");
    expect(err?.message).toContain("5日");
  });

  it("高負荷を詰め込みすぎたら止める", () => {
    const slots: Record<number, "point"> = {};
    const modes: Record<number, "fixed"> = {};
    for (let i = 0; i < 7; i++) {
      slots[i] = "point";
      modes[i] = "fixed";
    }
    expect(rules(cycle({ lengthDays: 7, slots, modes }))).toContain("ERROR:RULE-04");
  });

  it("休養日が1日も無ければ知らせる", () => {
    const slots: Record<number, "jog"> = {};
    const modes: Record<number, "fixed"> = {};
    for (let i = 0; i < 7; i++) {
      slots[i] = "jog";
      modes[i] = "fixed";
    }
    const out = validateCycle(cycle({ lengthDays: 7, slots, modes }));
    expect(out.some((v) => v.rule === "TEMPLATE" && v.message.includes("休養日"))).toBe(true);
  });

  it("何も決めていない周期は何も言わない（空の設定を責めない）", () => {
    expect(validateCycle(cycle())).toEqual([]);
  });
});

describe("曜日とのずれ", () => {
  it("7の倍数ならずれない", () => {
    expect(cycleWeekdayDrift(7)).toBeUndefined();
    expect(cycleWeekdayDrift(14)).toBeUndefined();
  });

  it("7で割り切れなければ、曜日が元に戻るまでの日数を返す", () => {
    // 10日周期なら70日でようやく同じ曜日に戻る（7との最小公倍数）
    expect(cycleWeekdayDrift(10)).toBe(70);
    expect(cycleWeekdayDrift(5)).toBe(35);
    expect(cycleWeekdayDrift(4)).toBe(28);
  });
});

describe("日付から位置を出す", () => {
  it("起点が1日目", () => {
    expect(cyclePositionFor(tpl(cycle()), "2026-08-16")).toBe(0);
    expect(cyclePositionFor(tpl(cycle()), "2026-08-17")).toBe(1);
  });

  it("周期を越えたら戻る", () => {
    expect(cyclePositionFor(tpl(cycle({ lengthDays: 10 })), "2026-08-26")).toBe(0);
  });

  it("起点より前でも負にならない", () => {
    // 遡って記録を見るときに位置が壊れないこと
    const pos = cyclePositionFor(tpl(cycle({ lengthDays: 10 })), "2026-08-15");
    expect(pos).toBeGreaterThanOrEqual(0);
    expect(pos).toBeLessThan(10);
  });

  it("周期が無ければ undefined", () => {
    expect(cyclePositionFor(undefined, "2026-08-16")).toBeUndefined();
  });
});
