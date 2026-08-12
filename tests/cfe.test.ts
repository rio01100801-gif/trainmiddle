import { describe, it, expect } from "vitest";
import {
  initCfe,
  updateCfeFromResult,
  applyStaleness,
  goalFeasibility,
  baseTime,
  guardedBaseTime,
  PHASE_GOAL_WEIGHT,
} from "@/lib/core/cfe";
import { makeSession, makeResult } from "./helpers";
import { GRP_RATIOS } from "@/lib/core/pace";
import type { TargetPace } from "@/lib/core/types";

const tp600: TargetPace = { distanceM: 600, targetSecFast: 85.0, targetSecSlow: 85.0 };

/*
 * 実測タイム基準に変えたので、期待値は「カテゴリ比率どおりに走ったら何秒か」から作る。
 * 数字を直書きすると、比率表を動かしたときにテストだけ辻褄が合わなくなる。
 *
 *   implied800m = 実測平均 ÷ 距離 ÷ 比率 × 800
 * なので、implied が狙った値になる1本のタイムは
 *   タイム = 目標800m × 比率 × 距離 ÷ 800
 */
const CFE0 = 111.01; // initCfe(109.51) の値
function repTimeFor(implied800Sec: number, cat: "high_lactate" | "race_economy", distanceM: number) {
  const r = GRP_RATIOS[cat]!;
  return (implied800Sec * ((r.fast + r.slow) / 2) * distanceM) / 800;
}
/** レスト補正が乗らない条件（標準レスト・完全休息でない）で結果を作る */
function measured(
  session: Parameters<typeof makeResult>[0],
  laps: number[],
  distanceM: number,
  overrides: Partial<Parameters<typeof makeResult>[1]> = {}
) {
  return makeResult(session, {
    actualLapsSec: laps,
    lapDistancesM: laps.map(() => distanceM),
    interval: {
      reps: laps.length,
      distanceM,
      targetSec: laps[0],
      restType: "jog",
      restSec: 240,
      results: laps.map((t, i) => ({ index: i + 1, distanceM, targetSec: laps[0], actualSec: t })),
    },
    ...overrides,
  } as any);
}

describe("4-5-1 CFE", () => {
  it("初期値: 直近12週以内のレース実績があればそれを使う", () => {
    const cfe = initCfe(109.51, "2026-04-01", { date: "2026-03-01", timeSec: 110.8 });
    expect(cfe.estimated800mSec).toBe(110.8);
    expect(cfe.confidence).toBe(1.0);
  });

  it("初期値: レース実績が無ければ PB + 1.5秒", () => {
    const cfe = initCfe(109.51, "2026-04-01");
    expect(cfe.estimated800mSec).toBeCloseTo(111.01, 2);
  });

  it("初期値: 12週より古いレースは使わない", () => {
    const cfe = initCfe(109.51, "2026-04-01", { date: "2025-12-01", timeSec: 108.0 });
    expect(cfe.estimated800mSec).toBeCloseTo(111.01, 2);
  });

  /*
   * ここから下は「実測タイク基準」に変えたあとの性質。
   * 以前は 現CFE + ΔRPE×0.4 + 未達幅 で、未達幅は遅い側だけを見ていた。
   * 速く走ってもCFEが動かず、続けるほど遅い側へ寄るのが本人の感覚とのズレの原因だった。
   */
  it("アンカー: カテゴリ比率どおりのタイムならCFEは動かない", () => {
    const cfe = initCfe(109.51, "2026-04-01"); // 111.01
    const s = makeSession("2026-04-02", "high_lactate", { targetPaces: [tp600] });
    const t = repTimeFor(CFE0, "high_lactate", 600);
    const u = updateCfeFromResult(cfe, s, measured(s, [t, t, t], 600, { rpe: 8 }));
    expect(u.impliedSec).toBeCloseTo(CFE0, 2);
    expect(u.deltaSec).toBeCloseTo(0, 3);
  });

  it("速く走ればCFEは改善する（旧実装では速い側が捨てられていた）", () => {
    const cfe = initCfe(109.51, "2026-04-01");
    const s = makeSession("2026-04-02", "high_lactate", { targetPaces: [tp600] });
    const t = repTimeFor(CFE0 - 3.0, "high_lactate", 600); // 800m換算で3秒速い
    const u = updateCfeFromResult(cfe, s, measured(s, [t, t, t], 600, { rpe: 8 }));
    expect(u.impliedSec).toBeCloseTo(CFE0 - 3.0, 2);
    expect(u.deltaSec).toBeLessThan(0);
  });

  it("同じ幅なら速い側と遅い側が対称に効く", () => {
    const cfe = initCfe(109.51, "2026-04-01");
    const s = makeSession("2026-04-02", "high_lactate", { targetPaces: [tp600] });
    const fast = repTimeFor(CFE0 - 2.0, "high_lactate", 600);
    const slow = repTimeFor(CFE0 + 2.0, "high_lactate", 600);
    const up = updateCfeFromResult(cfe, s, measured(s, [fast, fast, fast], 600, { rpe: 8 }));
    const down = updateCfeFromResult(cfe, s, measured(s, [slow, slow, slow], 600, { rpe: 8 }));
    expect(up.deltaSec).toBeCloseTo(-down.deltaSec, 3);
  });

  it("RPEは補助: 同じタイムならRPEが違っても符号は反転しない", () => {
    const cfe = initCfe(109.51, "2026-04-01");
    const s = makeSession("2026-04-02", "high_lactate", { targetPaces: [tp600] });
    const t = repTimeFor(CFE0 - 3.0, "high_lactate", 600);
    const easy = updateCfeFromResult(cfe, s, measured(s, [t, t, t], 600, { rpe: 6 }));
    const hard = updateCfeFromResult(cfe, s, measured(s, [t, t, t], 600, { rpe: 10 }));
    expect(easy.deltaSec).toBeLessThan(0);
    expect(hard.deltaSec).toBeLessThan(0); // 旧実装ではここが悪化に転んでいた
    expect(easy.deltaSec).toBeLessThan(hard.deltaSec); // 楽なほうが改善は大きい
  });

  it("RPEが低い（全力でない）実測は能力の推定に使わない", () => {
    const cfe = initCfe(109.51, "2026-04-01");
    const s = makeSession("2026-04-02", "high_lactate", { targetPaces: [tp600] });
    const t = repTimeFor(CFE0 - 5.0, "high_lactate", 600);
    const u = updateCfeFromResult(cfe, s, measured(s, [t, t, t], 600, { rpe: 4 }));
    expect(u.applied).toBe(false);
    expect(u.guardrailNotes.join()).toContain("全力に近くない");
  });

  it("設定ペースを見ない（同じ実測なら設定が何であってもCFEの動きは同じ）", () => {
    const cfe = initCfe(109.51, "2026-04-01");
    const t = repTimeFor(CFE0 - 2.0, "high_lactate", 600);
    const easyTarget = makeSession("2026-04-02", "high_lactate", {
      targetPaces: [{ distanceM: 600, targetSecFast: 95, targetSecSlow: 95 }],
    });
    const hardTarget = makeSession("2026-04-02", "high_lactate", {
      targetPaces: [{ distanceM: 600, targetSecFast: 75, targetSecSlow: 75 }],
    });
    const a = updateCfeFromResult(cfe, easyTarget, measured(easyTarget, [t, t, t], 600, { rpe: 8 }));
    const b = updateCfeFromResult(cfe, hardTarget, measured(hardTarget, [t, t, t], 600, { rpe: 8 }));
    expect(a.deltaSec).toBeCloseTo(b.deltaSec, 6);
  });

  it("ガードレール: 1回の更新は±1.5秒まで", () => {
    const cfe = initCfe(109.51, "2026-04-01");
    const s = makeSession("2026-04-02", "modeling", { targetPaces: [tp600] });
    const r = makeResult(s, {
      rpe: 10, // 期待9 → Δ+1
      achievement: "failed",
      actualLapsSec: [100, 100, 100], // 大幅未達
      lapDistancesM: [600, 600, 600],
    });
    const u = updateCfeFromResult(cfe, s, r);
    expect(u.deltaSec).toBeLessThanOrEqual(1.5);
    expect(u.guardrailNotes.join()).toContain("±1.5秒");
  });

  it("ガードレール: aerobic / neural ではCFEを更新しない", () => {
    const cfe = initCfe(109.51, "2026-04-01");
    for (const cat of ["aerobic", "neural"] as const) {
      const s = makeSession("2026-04-02", cat);
      const r = makeResult(s, { rpe: 9 });
      const u = updateCfeFromResult(cfe, s, r);
      expect(u.applied).toBe(false);
      expect(u.cfe.estimated800mSec).toBe(cfe.estimated800mSec);
    }
  });

  it("ガードレール: 気温28℃以上では改善・悪化どちらの方向も反映しない", () => {
    const cfe = initCfe(109.51, "2026-04-01");
    const s = makeSession("2026-08-01", "high_lactate", { targetPaces: [tp600] });
    const r = makeResult(s, { rpe: 5, achievement: "achieved" }); // Δ-3 → 改善方向
    const u = updateCfeFromResult(cfe, s, r, { tempC: 30 });
    expect(u.applied).toBe(false);
    // 統合監査で修正: 悪化方向（暑熱下の未達）も能力低下として反映しない
    const rBad = makeResult(s, { rpe: 10, achievement: "achieved" });
    const u2 = updateCfeFromResult(cfe, s, rBad, { tempC: 30 });
    expect(u2.applied).toBe(false);
    expect(u2.deltaSec).toBe(0);
  });

  it("ガードレール: 脚が重い2連続でも改善・悪化どちらの方向も反映しない", () => {
    const cfe = initCfe(109.51, "2026-04-01");
    const s = makeSession("2026-04-02", "high_lactate", { targetPaces: [tp600] });
    const r = makeResult(s, { rpe: 5, achievement: "achieved" });
    const u = updateCfeFromResult(cfe, s, r, { heavyLegsStreak: 2 });
    expect(u.applied).toBe(false);
    const rBad = makeResult(s, { rpe: 10, achievement: "achieved" });
    const u2 = updateCfeFromResult(cfe, s, rBad, { heavyLegsStreak: 2 });
    expect(u2.applied).toBe(false);
    expect(u2.deltaSec).toBe(0);
  });

  it("統合監査で修正: 目標タイムの混入により同じ実測でCFEの動きが変わらない", () => {
    // periodization.tsの生成と同じ手順（targetPaces = baseTime(CFE,目標,phase)由来）を
    // 再現する。目標が緩い場合と厳しい場合とでtargetPacesの値自体は異なるが、
    // goalTargetTimeSecを渡せば基準がCFEのみに正規化され、同じ実測に対して
    // 同じCFEの動きになるべき（=目標を厳しく設定しただけで能力が下がった扱いに
    // ならない）。
    const cfe = initCfe(109.51, "2026-04-01"); // 111.01
    const cur = cfe.estimated800mSec;
    const phase = "Specific";
    const distanceM = 600;
    const looseGoal = 111.0;
    const strictGoal = 95.0;
    const looseBlended = baseTime(cur, looseGoal, phase);
    const strictBlended = baseTime(cur, strictGoal, phase);
    const mkTp = (blended: number): TargetPace => {
      const sec = (blended / 800) * distanceM;
      return { distanceM, targetSecFast: sec, targetSecSlow: sec };
    };
    const sLoose = makeSession("2026-04-02", "high_lactate", {
      phase,
      targetPaces: [mkTp(looseBlended)],
    });
    const sStrict = makeSession("2026-04-02", "high_lactate", {
      phase,
      targetPaces: [mkTp(strictBlended)],
    });
    // 同じ実測: 600mを87秒×3（±1.5秒の上限にかからない程度の小さな未達に留める。
    // 未達幅が大きすぎるとどちらもガードレール上限に張り付いてしまい、
    // 混入除去の効果がテストで見えなくなるため）
    const rLoose = makeResult(sLoose, {
      rpe: 8,
      achievement: "partial",
      actualLapsSec: [87, 87, 87],
      lapDistancesM: [600, 600, 600],
    });
    const rStrict = makeResult(sStrict, {
      rpe: 8,
      achievement: "partial",
      actualLapsSec: [87, 87, 87],
      lapDistancesM: [600, 600, 600],
    });
    const loose = updateCfeFromResult(cfe, sLoose, rLoose, { goalTargetTimeSec: looseGoal });
    const strict = updateCfeFromResult(cfe, sStrict, rStrict, { goalTargetTimeSec: strictGoal });
    expect(strict.deltaSec).toBeCloseTo(loose.deltaSec, 6);
    expect(strict.cfe.estimated800mSec).toBeCloseTo(loose.cfe.estimated800mSec, 6);
  });

  it("レース結果: 信頼度1.0だが1回で3秒以上は動かさない", () => {
    const cfe = initCfe(109.51, "2026-04-01"); // 111.01
    const s = makeSession("2026-04-05", "modeling");
    const r = makeResult(s, { rpe: 9 });
    const u = updateCfeFromResult(cfe, s, r, { isRace: true, raceTimeSec: 105.0 });
    expect(u.deltaSec).toBeCloseTo(-3.0, 2);
    expect(u.cfe.estimated800mSec).toBeCloseTo(108.01, 2);
  });

  it("レース結果: 3秒以内ならそのまま反映", () => {
    const cfe = initCfe(109.51, "2026-04-01"); // 111.01
    const s = makeSession("2026-04-05", "modeling");
    const r = makeResult(s, { rpe: 9 });
    const u = updateCfeFromResult(cfe, s, r, { isRace: true, raceTimeSec: 109.8 });
    expect(u.cfe.estimated800mSec).toBeCloseTo(109.8, 2);
  });

  it("SKIP-06: 中断（本数減）は値を盛らず、その結果の信頼度を下げる", () => {
    const cfe = initCfe(109.51, "2026-04-01");
    const s = makeSession("2026-04-02", "high_lactate", { targetPaces: [tp600] });
    const t = repTimeFor(CFE0 + 2.0, "high_lactate", 600);
    const full = updateCfeFromResult(cfe, s, measured(s, [t, t, t], 600, { rpe: 8 }));
    const cut = updateCfeFromResult(
      cfe,
      s,
      measured(s, [t, t, t], 600, { rpe: 8, completedReps: 3, prescribedReps: 5 })
    );
    // 実測が同じなら推定値も同じ。違うのは反映の強さだけ
    expect(cut.impliedSec).toBeCloseTo(full.impliedSec!, 6);
    expect(cut.deltaSec).toBeCloseTo(full.deltaSec / 2, 3);
    expect(cut.guardrailNotes.join()).toContain("SKIP-06");
  });

  it("距離が混ざったら、本数の多い距離だけを能力推定に使う", () => {
    const cfe = initCfe(109.51, "2026-04-01");
    const s = makeSession("2026-04-02", "high_lactate", { targetPaces: [tp600] });
    const t = repTimeFor(CFE0, "high_lactate", 600);
    // 600mを4本と、200mを3本。全部を平均すると換算が壊れる
    const laps = [t, t, t, t, 30, 30, 30];
    const dists = [600, 600, 600, 600, 200, 200, 200];
    const r = makeResult(s, {
      rpe: 8,
      actualLapsSec: laps,
      lapDistancesM: dists,
      interval: {
        reps: 7,
        distanceM: 600,
        restType: "jog",
        restSec: 240,
        results: laps.map((x, i) => ({ index: i + 1, distanceM: dists[i], actualSec: x })),
      },
    } as any);
    const u = updateCfeFromResult(cfe, s, r);
    // 600mの4本だけを見るので、アンカー（CFEどおり）になる
    expect(u.impliedSec).toBeCloseTo(CFE0, 2);
    expect(u.guardrailNotes.join()).toContain("600m の4本だけ");
  });

  it("換算比率を持たないカテゴリ（CV・閾値）はCFEに使わず、理由を出す", () => {
    const cfe = initCfe(109.51, "2026-04-01");
    const s = makeSession("2026-04-02", "cv", {
      targetPaces: [{ distanceM: 1000, targetSecFast: 194, targetSecSlow: 196 }],
    });
    const laps = [190, 192, 190];
    const r = makeResult(s, {
      rpe: 7,
      actualLapsSec: laps,
      lapDistancesM: laps.map(() => 1000),
      interval: {
        reps: 3,
        distanceM: 1000,
        restType: "jog",
        restSec: 180,
        results: laps.map((x, i) => ({ index: i + 1, distanceM: 1000, actualSec: x })),
      },
    } as any);
    const u = updateCfeFromResult(cfe, s, r);
    expect(u.applied).toBe(false);
    expect(u.deltaSec).toBe(0);
    expect(u.guardrailNotes.join()).toContain("換算比率を持たない");
  });

  it("鈍化: 14日以上結果が無ければ +0.4秒/週", () => {
    const cfe = initCfe(109.51, "2026-01-01");
    const stale = applyStaleness(cfe, "2026-01-15"); // ちょうど14日
    expect(stale.estimated800mSec).toBeCloseTo(cfe.estimated800mSec + 0.4, 2);
    const fresh = applyStaleness(cfe, "2026-01-10");
    expect(fresh.estimated800mSec).toBe(cfe.estimated800mSec);
  });

  it("更新履歴が必ず保存される（監査用）", () => {
    const cfe = initCfe(109.51, "2026-04-01");
    const s = makeSession("2026-04-02", "high_lactate", { targetPaces: [tp600] });
    const t = repTimeFor(CFE0 - 2.0, "high_lactate", 600);
    const u = updateCfeFromResult(cfe, s, measured(s, [t, t, t], 600, { rpe: 8 }));
    expect(u.cfe.history.length).toBe(cfe.history.length + 1);
    const source = u.cfe.history.at(-1)!.source;
    expect(source).toContain("high_lactate");
    // 何から出した推定なのかが履歴だけで追えること（あとで数値を疑うときに要る）
    expect(source).toContain("本平均");
  });
});

describe("4-5-1 目標の現実性検知", () => {
  it("必要改善速度 0.3秒/週超で WARN", () => {
    // CFE 111.0 → 目標108.0、残り8週 = 0.375秒/週
    const f = goalFeasibility(111.0, 108.0, 8);
    expect(f.warn).toBe(true);
    expect(f.requiredSecPerWeek).toBeCloseTo(0.375, 3);
  });

  it("0.3秒/週以内なら警告なし", () => {
    const f = goalFeasibility(111.0, 108.0, 12);
    expect(f.warn).toBe(false);
  });
});

describe("4-5-2 基準タイム", () => {
  it("フェーズごとの目標寄与率", () => {
    expect(PHASE_GOAL_WEIGHT.Base).toBe(0.0);
    expect(PHASE_GOAL_WEIGHT.Taper).toBe(1.0);
  });

  it("基準タイム = CFE×(1−w) + 目標×w", () => {
    expect(baseTime(112.0, 108.0, "Base")).toBeCloseTo(112.0, 2);
    expect(baseTime(112.0, 108.0, "Build")).toBeCloseTo(111.2, 2);
    expect(baseTime(112.0, 108.0, "Specific")).toBeCloseTo(110.0, 2);
    expect(baseTime(112.0, 108.0, "Modeling")).toBeCloseTo(108.8, 2);
    expect(baseTime(112.0, 108.0, "Taper")).toBeCloseTo(108.0, 2);
  });

  it("CFEが改善すれば基準タイムも連動して速くなる", () => {
    const before = baseTime(112.0, 108.0, "Specific");
    const after = baseTime(111.0, 108.0, "Specific");
    expect(after).toBeLessThan(before);
  });
});

describe("goal pace safety guard", () => {
  it("operational thresholdを超える速い目標は処方へ混ぜない", () => {
    const result = guardedBaseTime(111.0, 108.0, "Specific", 8);
    expect(result.guarded).toBe(true);
    expect(result.timeSec).toBe(111.0);
    expect(result.message).toContain("0.38秒/週");
  });

  it("十分な期間がある目標は従来のphase blendを維持する", () => {
    const result = guardedBaseTime(111.0, 108.0, "Specific", 12);
    expect(result.guarded).toBe(false);
    expect(result.timeSec).toBeCloseTo(baseTime(111.0, 108.0, "Specific"), 3);
  });

  it("現在能力より遅い目標は安全ガードの対象外", () => {
    const result = guardedBaseTime(108.0, 111.0, "Taper", 1);
    expect(result.guarded).toBe(false);
    expect(result.timeSec).toBeCloseTo(111.0, 3);
  });
});
