/**
 * 4-1. 選手タイプ判定
 * PBから選手のタイプと不足能力を自動診断する。
 */
import type { Athlete, AthleteType, Diagnosis, PrimaryGap } from "./types";
import { fmtTime } from "./dates";

/** 指標A: 速度予備率 = (800mPB秒 ÷ 2) ÷ 400mPB秒 × 100 */
export function speedReservePct(pb800: number, pb400: number): number {
  return (pb800 / 2 / pb400) * 100;
}

/** 指標B: 換算差 = 800mPB秒 − (400mPB秒 × 2) */
export function conversionDiffSec(pb800: number, pb400: number): number {
  return pb800 - pb400 * 2;
}

/** 指標C: 差 = 1500mPB秒 − (800mPB秒 × 2) */
export function diff8001500Sec(pb800: number, pb1500: number): number {
  return pb1500 - pb800 * 2;
}

function judgeA(v: number): { label: string; score: number } {
  if (v < 107) return { label: "持久型（400mが相対的に遅い／スピード不足）", score: 0 };
  if (v < 110) return { label: "バランス型", score: 1 };
  if (v < 113)
    return { label: "スピード資源を活かしきれていない（持久・経済性に課題）", score: 2 };
  return { label: "明確な速度型（800m特異的持久力が大幅不足）", score: 3 };
}

function judgeB(v: number): { label: string; score: number } {
  if (v < 9) return { label: "持久型（400mの割に800mが優秀）", score: 0 };
  if (v < 12) return { label: "標準", score: 1 };
  if (v < 15) return { label: "800m特異的持久力に課題", score: 2 };
  return { label: "純スプリンター型。持久側に大きな伸びしろ", score: 3 };
}

function judgeC(v: number): { label: string; score: number } {
  if (v < 15) return { label: "持久寄り", score: 0 };
  if (v <= 20) return { label: "バランス型", score: 1.5 };
  return { label: "速度型", score: 3 };
}

function scoreToType(avg: number): AthleteType {
  if (avg < 0.75) return "endurance";
  if (avg < 1.5) return "balanced";
  if (avg < 2.5) return "lactate_tolerant";
  return "speed";
}

/**
 * 目標タイムに対する必要速度予備率の逆算（仕様書 4-1）
 * 例: 目標1:48.0, 400mPB49.0 → (108.0/2)/49.0 = 110.2%
 */
export function requiredSpeedReservePct(targetSec: number, pb400: number): number {
  return (targetSec / 2 / pb400) * 100;
}

export function diagnose(athlete: Athlete, targetTimeSec?: number): Diagnosis {
  const { pb400mSec, pb800mSec, pb1500mSec } = athlete;

  let a: { label: string; score: number } | undefined;
  let b: { label: string; score: number } | undefined;
  let c: { label: string; score: number } | undefined;
  let srp: number | undefined;
  let cds: number | undefined;
  let d15: number | undefined;

  if (pb400mSec) {
    srp = speedReservePct(pb800mSec, pb400mSec);
    cds = conversionDiffSec(pb800mSec, pb400mSec);
    a = judgeA(srp);
    b = judgeB(cds);
  }
  if (pb1500mSec) {
    d15 = diff8001500Sec(pb800mSec, pb1500mSec);
    c = judgeC(d15);
  }

  const scores = [a?.score, b?.score, c?.score].filter(
    (s): s is number => s !== undefined
  );
  const avg = scores.length > 0 ? scores.reduce((x, y) => x + y, 0) / scores.length : 1;
  const athleteType = scoreToType(avg);

  // 最大の伸びしろの判定
  let primaryGap: PrimaryGap;
  if (athleteType === "speed") {
    primaryGap = "後半維持";
  } else if (athleteType === "endurance") {
    primaryGap = "絶対スピード";
  } else if (athleteType === "lactate_tolerant") {
    // スピード資源はあるが活かしきれていない → 前半の経済性か後半維持
    primaryGap = b && b.score >= 2 ? "後半維持" : "前半経済性";
  } else {
    // balanced: 個別指標の中で最も外れているものに従う
    if (c && c.score === 0 && a && a.score <= 1) primaryGap = "絶対スピード";
    else if (b && b.score >= 2) primaryGap = "後半維持";
    else if (c && c.score === 3) primaryGap = "有酸素土台";
    else primaryGap = "前半経済性";
  }

  let reqSrp: number | undefined;
  const lines: string[] = [];
  if (srp !== undefined) lines.push(`速度予備率 ${srp.toFixed(1)}%: ${a!.label}`);
  if (cds !== undefined) lines.push(`400m→800m換算差 ${cds.toFixed(1)}秒: ${b!.label}`);
  if (d15 !== undefined) lines.push(`800m→1500m差 ${d15.toFixed(1)}秒: ${c!.label}`);

  if (targetTimeSec && pb400mSec) {
    reqSrp = requiredSpeedReservePct(targetTimeSec, pb400mSec);
    if (srp !== undefined && reqSrp < srp) {
      lines.push(
        `目標${fmtTime(targetTimeSec)}に必要な速度予備率は${reqSrp.toFixed(1)}%（現状${srp.toFixed(1)}%）。` +
          `400mを速くするのではなく、同じスピード資源でより長く維持する能力（経済性・特異的持久力）が必要。`
      );
    } else if (srp !== undefined) {
      lines.push(
        `目標${fmtTime(targetTimeSec)}に必要な速度予備率は${reqSrp.toFixed(1)}%（現状${srp.toFixed(1)}%）。` +
          `現在のスピード資源では目標維持が困難な水準にあり、絶対スピードの向上も併せて必要。`
      );
    }
  }

  return {
    speedReservePct: srp,
    speedReserveJudgement: a?.label,
    conversionDiffSec: cds,
    conversionDiffJudgement: b?.label,
    diff8001500Sec: d15,
    diff8001500Judgement: c?.label,
    athleteType,
    primaryGap,
    requiredSpeedReservePct: reqSrp,
    narrative: lines.join("\n"),
  };
}
