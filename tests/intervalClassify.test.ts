/**
 * FIT取込 Phase 3: ラップ→区間分類（ルールベース、LLM不使用）。
 * 同じlap列からは必ず同じ結果になることが前提のため、境目付近の数値を
 * 意図的に選んで検証する。
 */
import { describe, expect, it } from "vitest";
import { classifyLaps } from "@/lib/core/intervalClassify";
import type { FitParseLap } from "@/lib/core/fitParse";

function lap(overrides: Partial<FitParseLap> & { index: number }): FitParseLap {
  return { index: overrides.index, ...overrides };
}

describe("classifyLaps", () => {
  it("ウォームアップ→メイン×4（間にレストと明確なリカバリー）→クールダウンを分類する", () => {
    const laps: FitParseLap[] = [
      lap({ index: 0, distanceKm: 1, elapsedSec: 360 }), // warmup, pace 360
      lap({ index: 1, distanceKm: 0.3, elapsedSec: 50 }), // main, pace 166.67
      lap({ index: 2, distanceKm: 0.2, elapsedSec: 80 }), // recovery, pace 400
      lap({ index: 3, distanceKm: 0.3, elapsedSec: 51 }), // main, pace 170
      lap({ index: 4, distanceKm: 0.2, elapsedSec: 80 }), // recovery, pace 400
      lap({ index: 5, distanceKm: 0.3, elapsedSec: 50 }), // main, pace 166.67
      lap({ index: 6, distanceKm: 0.2, elapsedSec: 80 }), // recovery, pace 400
      lap({ index: 7, distanceKm: 0.3, elapsedSec: 52 }), // main, pace 173.3
      lap({ index: 8, distanceKm: 0 }), // rest（手動lap・一時停止）
      lap({ index: 9, distanceKm: 1, elapsedSec: 420 }), // cooldown, pace 420
    ];

    const { laps: result, warnings } = classifyLaps(laps);

    expect(warnings).toHaveLength(0);
    expect(result.map((r) => r.kind)).toEqual([
      "warmup",
      "main",
      "recovery",
      "main",
      "recovery",
      "main",
      "recovery",
      "main",
      "rest",
      "cooldown",
    ]);
    // 信頼度は0〜1の範囲に収まる
    for (const r of result) {
      expect(r.confidence).toBeGreaterThanOrEqual(0);
      expect(r.confidence).toBeLessThanOrEqual(1);
    }
    // レストは固定信頼度
    expect(result[8].confidence).toBeCloseTo(0.85, 5);
  });

  it("速さの差が小さい（7%未満）場合はインターバル構成と判定せずunknownにする", () => {
    const laps: FitParseLap[] = [
      lap({ index: 0, distanceKm: 1, elapsedSec: 300 }),
      lap({ index: 1, distanceKm: 1, elapsedSec: 305 }),
      lap({ index: 2, distanceKm: 1, elapsedSec: 298 }),
      lap({ index: 3, distanceKm: 1, elapsedSec: 302 }),
    ];

    const { laps: result, warnings } = classifyLaps(laps);

    expect(result.every((r) => r.kind === "unknown")).toBe(true);
    expect(warnings).toEqual([
      {
        code: "no_interval_structure",
        message: "速い区間とそれ以外の明確な差が見つからず、区間の分類ができませんでした。",
      },
    ]);
  });

  it("距離0のlapはレストとして固定信頼度で判定する", () => {
    const laps: FitParseLap[] = [
      lap({ index: 0, distanceKm: 0.3, elapsedSec: 50 }),
      lap({ index: 1, distanceKm: 0 }),
      lap({ index: 2, distanceKm: 0.3, elapsedSec: 50 }),
    ];

    const { laps: result } = classifyLaps(laps);
    expect(result[1]).toMatchObject({ kind: "rest", confidence: 0.85 });
  });

  it("距離や時間が欠けているlapは推測せずunknown・低信頼度にする", () => {
    const laps: FitParseLap[] = [
      lap({ index: 0, elapsedSec: 50 }), // distanceKm欠落
      lap({ index: 1, distanceKm: 0.3 }), // elapsedSec欠落
      lap({ index: 2, distanceKm: 0.3, elapsedSec: 0 }), // 時間0（距離>0なのに矛盾）
    ];

    const { laps: result } = classifyLaps(laps);
    for (const r of result) {
      expect(r.kind).toBe("unknown");
      expect(r.confidence).toBeLessThan(0.3);
      expect(r.paceSecPerKm).toBeUndefined();
    }
  });

  it("比較対象が1件しかない場合は分類できない旨を警告とともに返す", () => {
    const laps: FitParseLap[] = [lap({ index: 0, distanceKm: 0.3, elapsedSec: 50 })];

    const { laps: result, warnings } = classifyLaps(laps);
    expect(result[0].kind).toBe("unknown");
    expect(warnings.map((w) => w.code)).toEqual(["single_valid_lap"]);
  });

  it("lapが0件なら空の結果を返す", () => {
    const { laps: result, warnings } = classifyLaps([]);
    expect(result).toEqual([]);
    expect(warnings).toEqual([]);
  });
});
