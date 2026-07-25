/**
 * 改修指示書（フェーズ1・2）に対応する機能のテスト
 */
import { describe, it, expect } from "vitest";
import {
  avgPaceSecPerKm,
  buildContinuous,
  buildRepResults,
  describeInterval,
  inferAchievement,
  lapTrend,
  summarizeResult,
} from "@/lib/core/workoutLog";
import {
  estimateWbgt,
  evaluateEnvironment,
  environmentNote,
  wbgtLevel,
} from "@/lib/core/environment";
import { buildAerobicProfile, estimateLtFromMarkers, ltNeedsRefresh } from "@/lib/core/pace";
import { judgeSignal } from "@/lib/core/signal";
import type { FitnessMarker, IntervalDetail, SessionResult } from "@/lib/core/types";

// ---------------------------------------------------------------------------
// 1-1. ジョグ・持続走
// ---------------------------------------------------------------------------

describe("1-1 ジョグ・持続走の記録", () => {
  it("距離と時間から平均ペースが自動計算される（50分/11.2km → 4:28/km）", () => {
    const pace = avgPaceSecPerKm(11.2, 50);
    expect(pace).toBeCloseTo(267.86, 1);
    const m = Math.floor(pace / 60);
    const s = Math.round(pace - m * 60);
    expect(`${m}:${String(s).padStart(2, "0")}`).toBe("4:28");
  });

  it("平均ペースを手入力で上書きでき、上書きフラグが立つ", () => {
    const c = buildContinuous({
      distanceKm: 11.2,
      durationMin: 50,
      paceOverrideSecPerKm: 275,
      avgHr: 145,
    });
    expect(c.avgPaceSecPerKm).toBe(275);
    expect(c.paceOverridden).toBe(true);
    expect(c.avgHr).toBe(145);
  });

  it("上書きしなければ自動計算値が入り、フラグは立たない", () => {
    const c = buildContinuous({ distanceKm: 10, durationMin: 45 });
    expect(c.avgPaceSecPerKm).toBe(270);
    expect(c.paceOverridden).toBeUndefined();
  });

  it("一覧表示用のサマリーがジョグ形式で出る", () => {
    const r = {
      id: "r1",
      sessionId: "s1",
      date: "2026-07-24",
      actualLapsSec: [],
      continuous: buildContinuous({ distanceKm: 11.2, durationMin: 50, avgHr: 145 }),
      achievement: "achieved",
      rpe: 3,
      subjective: "easy",
    } as SessionResult;
    const summary = summarizeResult(r);
    expect(summary).toContain("11.2km");
    expect(summary).toContain("50分");
    expect(summary).toContain("4:28/km");
    expect(summary).toContain("145bpm");
  });
});

// ---------------------------------------------------------------------------
// 1-2. インターバル・レペ
// ---------------------------------------------------------------------------

describe("1-2 インターバル・レペの構造化記録", () => {
  it("時間レストの表記: 1000m×5 r2' jog", () => {
    const d: IntervalDetail = {
      reps: 5,
      distanceM: 1000,
      restType: "jog",
      restSec: 120,
      results: [],
    };
    expect(describeInterval(d)).toContain("1000m×5");
    expect(describeInterval(d)).toContain("r2' jog");
  });

  it("距離レストの表記: 300m×8 r100m walk", () => {
    const d: IntervalDetail = {
      reps: 8,
      distanceM: 300,
      restType: "walk",
      restDistanceM: 100,
      results: [],
    };
    expect(describeInterval(d)).toContain("300m×8");
    expect(describeInterval(d)).toContain("r100m walk");
  });

  it("本数ごとの実施タイムが個別に保存される", () => {
    const reps = buildRepResults(300, [39.2, 39.6, 40.1, 40.8], 39.5);
    expect(reps.length).toBe(4);
    expect(reps[0]).toMatchObject({ index: 1, distanceM: 300, actualSec: 39.2, targetSec: 39.5 });
    expect(reps[3].actualSec).toBe(40.8);
  });

  it("ラップの推移（垂れ幅・達成本数）が算出される", () => {
    const d: IntervalDetail = {
      reps: 4,
      distanceM: 300,
      targetSec: 39.5,
      restType: "jog",
      restSec: 300,
      results: buildRepResults(300, [39.2, 39.6, 40.1, 40.8], 39.5),
    };
    const t = lapTrend(d)!;
    expect(t.fastest).toBe(39.2);
    expect(t.slowest).toBe(40.8);
    expect(t.dropoffSec).toBeCloseTo(1.6, 1);
    expect(t.achievedReps).toBe(1); // 39.2のみ設定以内
    expect(t.summary).toContain("垂れ +1.6秒");
  });

  it("ビルドアップ（後半が速い）も検出される", () => {
    const d: IntervalDetail = {
      reps: 3,
      distanceM: 300,
      restType: "jog",
      results: buildRepResults(300, [40.5, 40.0, 39.4]),
    };
    expect(lapTrend(d)!.summary).toContain("ビルドアップ");
  });

  it("達成度を実測から自動判定できる（4-1クローズドループ用）", () => {
    const allHit: IntervalDetail = {
      reps: 5,
      distanceM: 300,
      targetSec: 40.0,
      restType: "jog",
      results: buildRepResults(300, [39.2, 39.4, 39.6, 39.8, 39.9], 40.0),
    };
    expect(inferAchievement(allHit)).toBe("achieved");

    const interrupted: IntervalDetail = {
      reps: 5,
      distanceM: 300,
      targetSec: 40.0,
      restType: "jog",
      results: buildRepResults(300, [39.5, 39.8, 41.5], 40.0),
    };
    expect(inferAchievement(interrupted)).toBe("failed"); // 本数7割未満

    const mixed: IntervalDetail = {
      reps: 5,
      distanceM: 300,
      targetSec: 40.0,
      restType: "jog",
      results: buildRepResults(300, [39.5, 39.8, 40.4, 40.9, 41.2], 40.0),
    };
    expect(inferAchievement(mixed)).toBe("partial");
  });
});

// ---------------------------------------------------------------------------
// 2-1. 環境条件とWBGT
// ---------------------------------------------------------------------------

describe("2-1 環境条件とWBGT", () => {
  it("WBGTを気温・湿度から推定する", () => {
    expect(estimateWbgt(30, 70)).toBeCloseTo(26.7, 1); // 警戒域
    expect(wbgtLevel(estimateWbgt(30, 70))).toBe("warning");
    expect(wbgtLevel(estimateWbgt(33, 75))).toBe("severe"); // 30.2
    expect(wbgtLevel(estimateWbgt(35, 80))).toBe("danger"); // 32.8
    expect(wbgtLevel(estimateWbgt(15, 50))).toBe("safe");
  });

  it("涼しい条件では暑熱フラグが立たない", () => {
    const r = evaluateEnvironment({ tempC: 15, humidityPct: 50 })!;
    expect(r.isHeatFlagged).toBe(false);
    expect(r.level).toBe("safe");
  });

  it("WBGT25以上で暑熱条件フラグが立つ", () => {
    const r = evaluateEnvironment({ tempC: 30, humidityPct: 70 })!;
    expect(r.isHeatFlagged).toBe(true);
    expect(r.note).toContain("除外");
  });

  it("WBGTが警戒域に届かなくても気温28℃以上ならフラグが立つ（RULE-10と矛盾させない）", () => {
    // 28℃/60% は推定WBGT 23.7 で警戒域未満だが、気温基準で暑熱扱いにする
    const r = evaluateEnvironment({ tempC: 28, humidityPct: 60 })!;
    expect(r.wbgt).toBeCloseTo(23.7, 1);
    expect(r.isHeatFlagged).toBe(true);
    expect(r.note).toContain("日射を含まない");
  });

  it("湿度の有無で判定が食い違わない", () => {
    expect(evaluateEnvironment({ tempC: 29, humidityPct: 55 })!.isHeatFlagged).toBe(
      evaluateEnvironment({ tempC: 29 })!.isHeatFlagged
    );
  });

  it("湿度が無い場合は気温28℃をフォールバック基準にする", () => {
    expect(evaluateEnvironment({ tempC: 30 })!.isHeatFlagged).toBe(true);
    expect(evaluateEnvironment({ tempC: 22 })!.isHeatFlagged).toBe(false);
    expect(evaluateEnvironment({ tempC: 30 })!.note).toContain("湿度未入力");
  });

  it("気温が無ければ判定しない", () => {
    expect(evaluateEnvironment({ humidityPct: 60 })).toBeUndefined();
  });

  it("強風・雨は達成度の解釈材料として注意書きが出る", () => {
    const notes = environmentNote({ tempC: 18, humidityPct: 50, wind: "strong", rain: true });
    expect(notes.join()).toContain("強風");
    expect(notes.join()).toContain("雨");
  });
});

// ---------------------------------------------------------------------------
// 2-4 / 2-5. 有酸素能力推定の改善
// ---------------------------------------------------------------------------

function marker(date: string, km: number, totalSec: number, over: Partial<FitnessMarker> = {}): FitnessMarker {
  return {
    id: `m-${date}`,
    date,
    type: "workout",
    description: `${km}km走`,
    resultLapsSec: [totalSec],
    lapDistancesM: [km * 1000],
    ...over,
  };
}

describe("2-4 有酸素能力推定（複数参照・外れ値除外・重み付け）", () => {
  const today = "2026-07-24";

  it("複数の実測を参照し、直近ほど重い重み付け平均になる", () => {
    const est = estimateLtFromMarkers(
      [
        marker("2026-06-26", 8, 8 * 240), // 4:00/km・4週前
        marker("2026-07-22", 8, 8 * 230), // 3:50/km・2日前
      ],
      today
    )!;
    expect(est.samples.length).toBe(2);
    // 単純平均なら235。直近重視なので230寄りになる
    expect(est.ltPaceSecPerKm).toBeLessThan(235);
    expect(est.ltPaceSecPerKm).toBeGreaterThan(230);
    expect(est.source).toContain("2本");
  });

  it("暑熱条件フラグ付きの実測は除外される", () => {
    const est = estimateLtFromMarkers(
      [marker("2026-07-20", 8, 8 * 250), marker("2026-07-22", 8, 8 * 230)],
      today,
      new Set(["2026-07-20"])
    )!;
    expect(est.samples.length).toBe(1);
    expect(est.ltPaceSecPerKm).toBeCloseTo(230, 0);
    expect(est.excluded[0].excluded).toContain("暑熱");
  });

  it("極端な外れ値は除外される（3本以上あるとき）", () => {
    const est = estimateLtFromMarkers(
      [
        marker("2026-07-10", 8, 8 * 230),
        marker("2026-07-15", 8, 8 * 232),
        marker("2026-07-20", 8, 8 * 300), // 大幅に遅い外れ値
      ],
      today
    )!;
    expect(est.samples.length).toBe(2);
    expect(est.excluded.some((e) => e.excluded?.includes("外れ値"))).toBe(true);
    expect(est.ltPaceSecPerKm).toBeLessThan(240);
  });

  it("サンプルが2本以下なら外れ値除外は行わない（推定不能を避ける）", () => {
    const est = estimateLtFromMarkers(
      [marker("2026-07-15", 8, 8 * 230), marker("2026-07-20", 8, 8 * 300)],
      today
    )!;
    expect(est.samples.length).toBe(2);
  });

  it("8週より古い実測は参照しない", () => {
    expect(estimateLtFromMarkers([marker("2026-04-01", 8, 8 * 230)], today)).toBeUndefined();
  });

  it("レースは LT より速いので遅い側へ補正される", () => {
    const est = estimateLtFromMarkers(
      [marker("2026-07-20", 5, 5 * 200, { type: "race", description: "5000m" })],
      today
    )!;
    expect(est.ltPaceSecPerKm).toBeCloseTo(212, 0); // 200 + 12
  });

  it("3km未満の記録は持続走とみなさず参照しない", () => {
    expect(estimateLtFromMarkers([marker("2026-07-20", 2, 2 * 230)], today)).toBeUndefined();
  });

  it("有酸素プロファイルに採用/除外の内訳が含まれる（監査可能）", () => {
    const p = buildAerobicProfile(
      [marker("2026-07-20", 8, 8 * 230), marker("2026-07-22", 8, 8 * 232)],
      today
    );
    expect(p.isEstimated).toBe(false);
    expect(p.estimate!.samples.length).toBe(2);
    expect(p.sourceDescription).toContain("重み付け平均");
  });
});

describe("2-5 実測更新の催促", () => {
  it("実測が無ければ入力を促す", () => {
    expect(ltNeedsRefresh(undefined)).toContain("実測データがありません");
  });

  it("28日以上経過したら更新を促す", () => {
    const est = estimateLtFromMarkers([marker("2026-06-20", 8, 8 * 230)], "2026-07-24")!;
    expect(est.daysSinceLatest).toBe(34);
    expect(ltNeedsRefresh(est)).toContain("3〜4週ごとの更新");
  });

  it("直近の実測があれば催促しない", () => {
    const est = estimateLtFromMarkers([marker("2026-07-20", 8, 8 * 230)], "2026-07-24")!;
    expect(ltNeedsRefresh(est)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 2-2. 疲労度4項目
// ---------------------------------------------------------------------------

describe("2-2 疲労度4項目の信号判定", () => {
  it("脚の疲労が最大(5)なら赤", () => {
    const r = judgeSignal({ date: "2026-07-24", legFatigue: 5 });
    expect(r.signal).toBe("red");
    expect(r.reasons.join()).toContain("脚の疲労");
  });

  it("脚の疲労が強い(4)なら黄", () => {
    const r = judgeSignal({ date: "2026-07-24", legFatigue: 4 });
    expect(r.signal).toBe("yellow");
  });

  it("モチベーション低下は単独では黄にしない（過剰反応を避ける）", () => {
    const r = judgeSignal({ date: "2026-07-24", motivation: 1 });
    expect(r.signal).toBe("green");
  });

  it("他の指標と重なったときはモチベーション低下も理由に併記される", () => {
    const r = judgeSignal({ date: "2026-07-24", muscleTightness: 4, motivation: 1 });
    expect(r.signal).toBe("yellow");
    expect(r.reasons.join()).toContain("モチベーション");
  });

  it("従来の3項目だけでも従来どおり判定される（後方互換）", () => {
    expect(judgeSignal({ date: "2026-07-24", restingHr: 58 }, 48).signal).toBe("red");
    expect(judgeSignal({ date: "2026-07-24", restingHr: 48 }, 48).signal).toBe("green");
  });
});
