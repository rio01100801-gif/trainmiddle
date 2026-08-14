/**
 * N日周期の配置。
 *
 * ここで見張るのは1つだけ:
 * **周期を繰り返したときに、暦の1週間で数えるルール（RULE-04）に触れないこと。**
 *
 * 周期の中で等間隔に置いても、10日と7日は噛み合わないので
 * 「周期では均等なのに、暦の第2週だけ高負荷が3日」という並びが普通に出る。
 * 目で見て気づける不具合ではないので、全部の窓を数えて確かめる。
 */
import { describe, expect, it } from "vitest";
import {
  MAX_CYCLE_DAYS,
  MIN_CYCLE_DAYS,
  MIN_POINT_GAP_DAYS,
  type CycleShape,
  clampCycleLength,
  cycleNumberOf,
  cyclePositionOf,
  nextDateAtPosition,
  planCycleShape,
  pointCategoryAt,
} from "@/lib/core/cycleTemplate";
import {
  hasDeepGlycolyticCostCategory,
  isHighLoadCategory,
  isSpecificCategory,
} from "@/lib/core/trainingClassification";

/** Specific期の実測（週テンプレートを数えた値）。ポイントは全部きつい方 */
const SPECIFIC = {
  pointsPerWeek: 2,
  neuralPerWeek: 1,
  longRunPerWeek: 1,
  demandingStream: ["high_lactate", "race_economy"] as const,
  aerobicHighStream: ["cv"] as const,
  demandingRate: 1,
};

/** Base期の実測。ポイント1.5本/週、うちきつい方は1/3 */
const BASE = {
  pointsPerWeek: 1.5,
  neuralPerWeek: 1.5,
  longRunPerWeek: 1,
  demandingStream: ["high_lactate"] as const,
  aerobicHighStream: ["threshold"] as const,
  demandingRate: 1 / 3,
};

function shapeFor(preset: typeof SPECIFIC | typeof BASE, lengthDays: number): CycleShape {
  return planCycleShape({
    lengthDays,
    pointsPerWeek: preset.pointsPerWeek,
    neuralPerWeek: preset.neuralPerWeek,
    longRunPerWeek: preset.longRunPerWeek,
    demandingStream: [...preset.demandingStream],
    aerobicHighStream: [...preset.aerobicHighStream],
    demandingRate: preset.demandingRate,
  });
}

/** 周期を繰り返して日付順に並べ、その日のポイントの内容を返す */
function laidOut(shape: CycleShape, cycles: number): (string | undefined)[] {
  const days: (string | undefined)[] = new Array(cycles * shape.lengthDays).fill(undefined);
  for (let c = 0; c < cycles; c++) {
    shape.pointPositions.forEach((p, i) => {
      days[c * shape.lengthDays + p] = pointCategoryAt(shape, c * shape.pointsPerCycle + i);
    });
  }
  return days;
}

describe("周期の長さ", () => {
  it("範囲の外は丸める", () => {
    expect(clampCycleLength(1)).toBe(MIN_CYCLE_DAYS);
    expect(clampCycleLength(30)).toBe(MAX_CYCLE_DAYS);
    expect(clampCycleLength(10)).toBe(10);
  });
});

describe("日付から周期の位置を出す", () => {
  it("起点が1日目（0）", () => {
    expect(cyclePositionOf("2026-08-15", "2026-08-15", 10)).toBe(0);
    expect(cyclePositionOf("2026-08-15", "2026-08-24", 10)).toBe(9);
    expect(cyclePositionOf("2026-08-15", "2026-08-25", 10)).toBe(0);
  });

  it("起点より前でも折り返す（負にしない）", () => {
    expect(cyclePositionOf("2026-08-15", "2026-08-14", 10)).toBe(9);
    expect(cyclePositionOf("2026-08-15", "2026-08-05", 10)).toBe(0);
    expect(cycleNumberOf("2026-08-15", "2026-08-14", 10)).toBe(-1);
  });

  it("その位置が次に来る日を出す", () => {
    expect(nextDateAtPosition("2026-08-15", "2026-08-16", 10, 5)).toBe("2026-08-20");
    // 今日がその位置なら今日
    expect(nextDateAtPosition("2026-08-15", "2026-08-20", 10, 5)).toBe("2026-08-20");
  });
});

describe("ポイントの配置", () => {
  it("間隔は必ず中2日以上あく", () => {
    for (let n = MIN_CYCLE_DAYS; n <= MAX_CYCLE_DAYS; n++) {
      for (const preset of [SPECIFIC, BASE]) {
        const shape = shapeFor(preset, n);
        const p = shape.pointPositions;
        for (let i = 0; i < p.length; i++) {
          const next = p[(i + 1) % p.length];
          const gap = i === p.length - 1 ? n - p[i] + next : next - p[i];
          expect(gap, `${n}日周期 ${p.join(",")}`).toBeGreaterThanOrEqual(MIN_POINT_GAP_DAYS);
        }
      }
    }
  });

  it("1日目はポイントにする（起点をずらせば動かせる）", () => {
    expect(shapeFor(SPECIFIC, 10).pointPositions[0]).toBe(0);
  });

  it("周期が長いほど本数は増える", () => {
    const short = shapeFor(SPECIFIC, 5).pointsPerCycle;
    const long = shapeFor(SPECIFIC, 14).pointsPerCycle;
    expect(long).toBeGreaterThan(short);
  });
});

/**
 * 本丸。周期の長さを全部試して、暦の7日窓を1つずつ数える。
 *
 * RULE-04 は「高負荷が4日以上」「高乳酸・中距離特異的が3日以上」でERRORを出す。
 * ここが通らない配置を出すと、生成した直後に自分でERRORを出すプランができあがる。
 */
describe("暦の1週間で数えてもルールに触れない", () => {
  for (let n = MIN_CYCLE_DAYS; n <= MAX_CYCLE_DAYS; n++) {
    for (const [name, preset] of [
      ["Specific相当", SPECIFIC],
      ["Base相当", BASE],
    ] as const) {
      it(`${n}日周期（${name}）`, () => {
        const shape = shapeFor(preset, n);
        const days = laidOut(shape, 12);
        // 端は前後が欠けて数え落とすので真ん中だけ見る
        for (let s = n; s + 7 <= days.length - n; s++) {
          let high = 0;
          let demanding = 0;
          for (let d = s; d < s + 7; d++) {
            const cat = days[d];
            if (!cat) continue;
            if (isHighLoadCategory(cat as never)) high++;
            if (isSpecificCategory(cat as never)) demanding++;
          }
          expect(high, `${s}日目からの7日間: ${days.slice(s, s + 7).join("/")}`).toBeLessThanOrEqual(3);
          expect(demanding, `${s}日目からの7日間: ${days.slice(s, s + 7).join("/")}`).toBeLessThanOrEqual(2);
        }
      });
    }
  }

  it("高乳酸・モデリングは5日以上あく（RULE-01）", () => {
    for (let n = MIN_CYCLE_DAYS; n <= MAX_CYCLE_DAYS; n++) {
      for (const preset of [SPECIFIC, BASE]) {
        const shape = shapeFor(preset, n);
        const days = laidOut(shape, 12);
        let last: number | undefined;
        for (let d = 0; d < days.length; d++) {
          const cat = days[d];
          if (!cat || !hasDeepGlycolyticCostCategory(cat as never)) continue;
          if (last !== undefined) {
            expect(d - last, `${n}日周期`).toBeGreaterThanOrEqual(5);
          }
          last = d;
        }
      }
    }
  });
});

describe("減らしたことは理由とセットで返す", () => {
  it("10日周期のSpecificでは、きつい方の割合を落とすか本数を減らす", () => {
    const shape = shapeFor(SPECIFIC, 10);
    // 週2本 → 10日で3本にすると暦の1週間に3日入るので、必ずどちらかで調整が入る
    expect(shape.adjustments.length).toBeGreaterThan(0);
    expect(shape.adjustments.join("")).toMatch(/理由|ため/);
  });

  it("調整が要らないときは何も足さない", () => {
    const shape = shapeFor(SPECIFIC, 7);
    expect(shape.adjustments).toEqual([]);
    expect(shape.pointsPerCycle).toBe(2);
  });
});

describe("役割の並び", () => {
  it("ポイントの翌日は回復ジョグ", () => {
    const shape = shapeFor(SPECIFIC, 10);
    for (const p of shape.pointPositions) {
      const after = (p + 1) % shape.lengthDays;
      // 次の日が別のポイントになることは無い（中2日あくので）
      expect(shape.roles[after]).toBe("recovery_jog");
    }
  });

  it("ロングランはポイントの隣に置かない", () => {
    const shape = shapeFor(SPECIFIC, 10);
    const lr = shape.roles.indexOf("long_run");
    expect(lr).toBeGreaterThanOrEqual(0);
    for (const p of shape.pointPositions) {
      const raw = Math.abs(lr - p);
      expect(Math.min(raw, shape.lengthDays - raw)).toBeGreaterThanOrEqual(2);
    }
  });

  it("全部の日に役割が付く（空白を残さない）", () => {
    for (let n = MIN_CYCLE_DAYS; n <= MAX_CYCLE_DAYS; n++) {
      const shape = shapeFor(SPECIFIC, n);
      expect(shape.roles).toHaveLength(n);
      expect(shape.roles.every((r) => r !== undefined)).toBe(true);
    }
  });
});

describe("内容の並びは通し番号だけで決まる", () => {
  it("同じ通し番号なら必ず同じ内容（再生成しても変わらない）", () => {
    const shape = shapeFor(SPECIFIC, 10);
    for (let g = -5; g < 30; g++) {
      expect(pointCategoryAt(shape, g)).toBe(pointCategoryAt(shape, g));
    }
  });

  it("起点より前（負の通し番号）でも内容が決まる", () => {
    const shape = shapeFor(SPECIFIC, 10);
    expect(typeof pointCategoryAt(shape, -3)).toBe("string");
  });
});
