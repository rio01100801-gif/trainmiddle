/**
 * 天候・路面のタグと、シューズの使用距離。
 *
 * 狙いは1つ——**「設定は同じなのにRPEが上がった」の理由を見分けられるようにする**。
 * 記録が無いと全部「調子が悪かった」に丸められ、設定を下げる判断に紛れ込む。
 *
 * **判定には使わない。** 暑熱条件フラグ（能力推定から外すかどうか）は
 * 今までどおり気温と湿度のWBGTだけで決める。タグを判定に混ぜると、
 * 付け忘れが能力の変化として現れる。
 */
import { describe, expect, it } from "vitest";
import {
  CONDITION_TAGS,
  MIN_SPLIT_SAMPLES,
  conditionLabel,
  conditionSplits,
  describeConditions,
  normalizeConditions,
} from "@/lib/core/conditions";
import {
  distanceOfResult,
  shoeChoices,
  shoeUsage,
  type Shoe,
} from "@/lib/core/shoes";
import { evaluateEnvironment } from "@/lib/core/environment";
import type { SessionResult } from "@/lib/core/types";

function result(over: Partial<SessionResult> = {}): SessionResult {
  return {
    id: `r-${Math.random()}`,
    sessionId: `s-${Math.random()}`,
    date: "2026-08-15",
    actualLapsSec: [42],
    achievement: "achieved",
    rpe: 7,
    subjective: "moderate",
    ...over,
  };
}

describe("タグの語彙", () => {
  it("IDが重複していない（過去の記録が指すため）", () => {
    const ids = CONDITION_TAGS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("天候と路面の両方がある", () => {
    expect(CONDITION_TAGS.some((t) => t.group === "weather")).toBe(true);
    expect(CONDITION_TAGS.some((t) => t.group === "surface")).toBe(true);
  });

  it("指示された語がそろっている", () => {
    for (const label of ["晴れ", "雨", "強風", "暑熱", "トラック濡れ", "滑りやすい", "ロード"]) {
      expect(CONDITION_TAGS.some((t) => t.label === label), label).toBe(true);
    }
  });
});

describe("値の正規化", () => {
  it("一覧に無いIDは捨てる（手書きJSONや旧データで壊れない）", () => {
    expect(normalizeConditions(["rain", "nonsense", "road"])).toEqual(["rain", "road"]);
  });

  it("重複を落とす", () => {
    expect(normalizeConditions(["rain", "rain"])).toEqual(["rain"]);
  });

  it("配列でなければ空", () => {
    for (const bad of [undefined, null, "rain", 3, {}]) {
      expect(normalizeConditions(bad)).toEqual([]);
    }
  });

  it("並びが一覧の順にそろう（入れた順で表示がばらつかない）", () => {
    const a = normalizeConditions(["road", "rain"]);
    const b = normalizeConditions(["rain", "road"]);
    expect(a).toEqual(b);
  });

  it("表示は中黒でつなぐ", () => {
    expect(describeConditions(["rain", "track_wet"])).toBe("雨・トラック濡れ");
    expect(describeConditions([])).toBe("");
    expect(conditionLabel("rain")).toBe("雨");
  });
});

describe("条件別のRPE", () => {
  const rainy = (rpe: number) => result({ rpe, conditions: ["rain"] });
  const dry = (rpe: number) => result({ rpe, conditions: ["sunny"] });

  it("両側が2回以上たまってから出す", () => {
    // 雨1回・晴れ3回では雨の側が足りない
    expect(conditionSplits([rainy(9), dry(7), dry(7), dry(7)]).some((s) => s.tag === "rain")).toBe(
      false
    );
    const enough = conditionSplits([rainy(9), rainy(9), dry(7), dry(7)]);
    expect(enough.some((s) => s.tag === "rain")).toBe(true);
  });

  it("差を出す（雨のほうがきつければ正）", () => {
    const splits = conditionSplits([rainy(9), rainy(9), dry(7), dry(7)]);
    const rain = splits.find((s) => s.tag === "rain")!;
    expect(rain.withRpe).toBe(9);
    expect(rain.withoutRpe).toBe(7);
    expect(rain.deltaRpe).toBe(2);
    expect(rain.withCount).toBe(2);
    expect(rain.withoutCount).toBe(2);
  });

  it("差の大きい順に並ぶ（0に近いものは見ても仕方がない）", () => {
    const splits = conditionSplits([
      result({ rpe: 9, conditions: ["rain", "track"] }),
      result({ rpe: 9, conditions: ["rain", "track"] }),
      result({ rpe: 7, conditions: ["sunny", "track"] }),
      result({ rpe: 7, conditions: ["sunny", "track"] }),
    ]);
    for (let i = 1; i < splits.length; i++) {
      expect(Math.abs(splits[i - 1].deltaRpe)).toBeGreaterThanOrEqual(Math.abs(splits[i].deltaRpe));
    }
  });

  it("記録が少なければ何も出さない（推測しない）", () => {
    expect(conditionSplits([rainy(9), dry(7)])).toEqual([]);
    expect(conditionSplits([])).toEqual([]);
    expect(MIN_SPLIT_SAMPLES).toBe(2);
  });
});

describe("判定には使わない", () => {
  it("条件タグをどう付けても暑熱条件フラグは変わらない", () => {
    /*
     * タグは記録であって判定材料ではない。
     * ここが崩れると、タグの付け忘れが能力の変化として現れる。
     */
    const base = evaluateEnvironment({ tempC: 26, humidityPct: 60 });
    expect(base?.isHeatFlagged).toBe(false);
    // 「暑熱」タグを付けても evaluateEnvironment の入力ではない
    const tagged = normalizeConditions(["hot", "rain"]);
    expect(tagged).toContain("hot");
    expect(evaluateEnvironment({ tempC: 26, humidityPct: 60 })?.isHeatFlagged).toBe(false);
  });
});

describe("シューズの使用距離", () => {
  const shoes: Shoe[] = [
    { id: "a", name: "スパイクA", kind: "spike" },
    { id: "b", name: "厚底B", kind: "thick" },
    { id: "c", name: "引退C", kind: "thin", retired: true },
  ];

  it("持続走は記録した距離を足す", () => {
    const usage = shoeUsage(shoes, [
      result({ shoeId: "b", continuous: { distanceKm: 12, durationMin: 60 } }),
      result({ shoeId: "b", continuous: { distanceKm: 8, durationMin: 40 } }),
    ]);
    expect(usage.find((u) => u.shoe.id === "b")!.totalKm).toBe(20);
    expect(usage.find((u) => u.shoe.id === "b")!.sessions).toBe(2);
  });

  it("インターバルは本数×距離", () => {
    const km = distanceOfResult(
      result({
        interval: {
          reps: 5,
          distanceM: 300,
          restType: "jog",
          results: [],
        } as never,
      })
    );
    expect(km).toBeCloseTo(1.5, 3);
  });

  it("靴を選んでいない記録は数えない", () => {
    const usage = shoeUsage(shoes, [result({ continuous: { distanceKm: 10, durationMin: 50 } })]);
    expect(usage.every((u) => u.totalKm === 0)).toBe(true);
  });

  it("距離が分からない記録は0にする（推測で埋めない）", () => {
    expect(distanceOfResult(result({ shoeId: "a" }))).toBe(0);
  });

  it("最後に使った日を持つ", () => {
    const usage = shoeUsage(shoes, [
      result({ shoeId: "a", date: "2026-08-01", continuous: { distanceKm: 5, durationMin: 25 } }),
      result({ shoeId: "a", date: "2026-08-10", continuous: { distanceKm: 5, durationMin: 25 } }),
    ]);
    expect(usage.find((u) => u.shoe.id === "a")!.lastUsed).toBe("2026-08-10");
  });

  it("合計は毎回足し上げる（記録を消せば減る）", () => {
    const all = [
      result({ shoeId: "b", continuous: { distanceKm: 12, durationMin: 60 } }),
      result({ shoeId: "b", continuous: { distanceKm: 8, durationMin: 40 } }),
    ];
    expect(shoeUsage(shoes, all).find((u) => u.shoe.id === "b")!.totalKm).toBe(20);
    // 1件消したら合計も減る（カウンタを持っていたらここがずれる）
    expect(shoeUsage(shoes, all.slice(0, 1)).find((u) => u.shoe.id === "b")!.totalKm).toBe(12);
  });
});

describe("シューズの並び", () => {
  const shoes: Shoe[] = [
    { id: "a", name: "A", kind: "spike" },
    { id: "b", name: "B", kind: "thick" },
    { id: "c", name: "C", kind: "thin", retired: true },
  ];

  it("最後に使ったものが先頭", () => {
    const usage = shoeUsage(shoes, [
      result({ shoeId: "a", date: "2026-08-01", continuous: { distanceKm: 5, durationMin: 25 } }),
      result({ shoeId: "b", date: "2026-08-12", continuous: { distanceKm: 5, durationMin: 25 } }),
    ]);
    expect(shoeChoices(usage).map((u) => u.shoe.id)).toEqual(["b", "a"]);
  });

  it("一度も使っていないものは後ろ", () => {
    const usage = shoeUsage(shoes, [
      result({ shoeId: "b", date: "2026-08-12", continuous: { distanceKm: 5, durationMin: 25 } }),
    ]);
    expect(shoeChoices(usage).map((u) => u.shoe.id)).toEqual(["b", "a"]);
  });

  it("引退したものは選択肢に出さない（記録は残る）", () => {
    const usage = shoeUsage(shoes, []);
    expect(shoeChoices(usage).some((u) => u.shoe.id === "c")).toBe(false);
    expect(usage.some((u) => u.shoe.id === "c")).toBe(true);
  });
});
