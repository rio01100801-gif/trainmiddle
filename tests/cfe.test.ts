import { describe, it, expect } from "vitest";
import {
  initCfe,
  updateCfeFromResult,
  applyStaleness,
  goalFeasibility,
  baseTime,
  PHASE_GOAL_WEIGHT,
} from "@/lib/core/cfe";
import { makeSession, makeResult } from "./helpers";
import type { TargetPace } from "@/lib/core/types";

const tp600: TargetPace = { distanceM: 600, targetSecFast: 85.0, targetSecSlow: 85.0 };

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

  it("更新式: ΔRPE=+2, 達成 → 新CFE = CFE + 2×0.4×0.3×0.7 (high_lactate)", () => {
    const cfe = initCfe(109.51, "2026-04-01"); // 111.01
    const s = makeSession("2026-04-02", "high_lactate", { targetPaces: [tp600] });
    const r = makeResult(s, { rpe: 10, achievement: "achieved" }); // 期待RPE 8 → Δ+2
    const u = updateCfeFromResult(cfe, s, r);
    // implied = 111.01 + 0.8, delta = 0.8×0.3×0.7 = 0.168
    expect(u.applied).toBe(true);
    expect(u.deltaSec).toBeCloseTo(0.168, 3);
    expect(u.cfe.estimated800mSec).toBeCloseTo(111.178, 2);
  });

  it("未達幅: 実測ペースが設定より遅い分を800m換算で加算する", () => {
    const cfe = initCfe(109.51, "2026-04-01");
    const s = makeSession("2026-04-02", "race_economy", { targetPaces: [tp600] });
    // 設定85.0/600mに対し実測88.0 → (88-85)/600×800 = 4.0秒の未達
    const r = makeResult(s, {
      rpe: 6, // 期待通り
      achievement: "partial",
      actualLapsSec: [88, 88, 88],
      lapDistancesM: [600, 600, 600],
    });
    const u = updateCfeFromResult(cfe, s, r);
    // implied = CFE + 0 + 4.0, delta = 4.0×0.3×0.6 = 0.72
    expect(u.deltaSec).toBeCloseTo(0.72, 2);
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

  it("SKIP-06: 中断（本数減）は未達としてCFEに反映する", () => {
    const cfe = initCfe(109.51, "2026-04-01");
    const s = makeSession("2026-04-02", "high_lactate", { targetPaces: [tp600] });
    const r = makeResult(s, {
      rpe: 8,
      achievement: "partial",
      completedReps: 3,
      prescribedReps: 5,
    });
    const u = updateCfeFromResult(cfe, s, r);
    expect(u.applied).toBe(true);
    expect(u.deltaSec).toBeGreaterThan(0);
    expect(u.guardrailNotes.join()).toContain("SKIP-06");
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
    const r = makeResult(s, { rpe: 10 });
    const u = updateCfeFromResult(cfe, s, r);
    expect(u.cfe.history.length).toBe(cfe.history.length + 1);
    expect(u.cfe.history.at(-1)!.source).toContain("high_lactate");
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
