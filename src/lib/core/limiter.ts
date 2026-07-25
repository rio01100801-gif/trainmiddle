/**
 * M-7 制限因子の自動判定
 *
 * 400mPBと1500mPBは、800mの現在地を両側から挟む数字として使える。
 *
 *   400m側から見た妥当域 … 400mPB×2 + 換算差
 *     よく訓練された中距離選手の換算差は9〜12秒。
 *     これより800mが遅ければ、スピードを使い切れていない（＝維持が課題）。
 *   1500m側から見た妥当域 … 1500mPB ÷ 2 − 差
 *     800m→1500mの差は15〜20秒が標準。
 *     これより800mが遅ければ、有酸素側に対してスピードが足りない。
 *
 * 両側の妥当域と実際の800mPBを比べれば、どちらの能力が制限しているかが出る。
 *
 * 伊藤選手の例（400m 49.0 / 1500m 3:56 / 800m 1:49.51）:
 *   400m側 … 98.0 + 9〜12 = 1:47.0〜1:50.0（中央 1:48.5）→ 現状は中央より1.0秒遅い
 *   1500m側 … (236 − 20)÷2 〜 (236 − 15)÷2 = 1:48.0〜1:50.5（中央 1:49.25）
 *             → 現状は中央より0.26秒遅い
 *   どちらも妥当域の内側だが、400m側の遅れのほうが大きい。
 *   つまりスピード資源のほうが余っている＝制限しているのは後半の維持。
 *
 * 判定結果は表示するだけでなく、次の4週の配分に反映する。
 * ただし何をどれだけ動かしたかを必ず出す。黙って配分を変えない。
 */
import type { Athlete, SessionCategory } from "./types";
import { fmtTime } from "./dates";

export type Limiter = "speed" | "endurance" | "balanced" | "unknown";

export const LIMITER_LABELS: Record<Limiter, string> = {
  speed: "絶対スピード",
  endurance: "後半の維持（特異的持久力）",
  balanced: "どちらも大きくは外れていない",
  unknown: "判定に必要なPBが足りない",
};

/** 400m→800mの換算差（秒）。よく訓練された中距離選手の範囲 */
export const CONV_400_MIN = 9;
export const CONV_400_MAX = 12;
/** 800m→1500mの差（秒）。標準的な範囲 */
export const CONV_1500_MIN = 15;
export const CONV_1500_MAX = 20;
/** どちらの側が制限しているかを分ける差（秒） */
export const LIMITER_DIFF_THRESHOLD_SEC = 0.5;

export interface Range {
  fastSec: number;
  slowSec: number;
}

export interface LimiterAssessment {
  limiter: Limiter;
  from400?: Range;
  from1500?: Range;
  pb800Sec: number;
  /** 400m側の妥当域より遅い秒数（正 = 遅い＝スピードを使い切れていない） */
  gapFrom400Sec?: number;
  /** 1500m側の妥当域より遅い秒数（正 = 遅い＝有酸素を使い切れていない） */
  gapFrom1500Sec?: number;
  narrative: string;
}

function mid(r: Range): number {
  return (r.fastSec + r.slowSec) / 2;
}

export function assessLimiter(athlete: Athlete, targetSec?: number): LimiterAssessment {
  const pb800 = athlete.pb800mSec;
  const from400: Range | undefined = athlete.pb400mSec
    ? {
        fastSec: athlete.pb400mSec * 2 + CONV_400_MIN,
        slowSec: athlete.pb400mSec * 2 + CONV_400_MAX,
      }
    : undefined;
  const from1500: Range | undefined = athlete.pb1500mSec
    ? {
        fastSec: (athlete.pb1500mSec - CONV_1500_MAX) / 2,
        slowSec: (athlete.pb1500mSec - CONV_1500_MIN) / 2,
      }
    : undefined;

  if (!from400 && !from1500) {
    return {
      limiter: "unknown",
      pb800Sec: pb800,
      narrative: "400mか1500mのPBを入れると、どちらの能力が制限しているかを判定できます",
    };
  }

  const gapFrom400 = from400 ? pb800 - mid(from400) : undefined;
  const gapFrom1500 = from1500 ? pb800 - mid(from1500) : undefined;

  let limiter: Limiter;
  if (gapFrom400 !== undefined && gapFrom1500 !== undefined) {
    /*
     * 遅れが大きい側が「使い切れていない資源」。
     * 400m側の遅れが大きい＝スピードはあるのに800mが遅い＝維持が制限。
     *
     * 閾値0.5秒は、換算差の幅（9〜12秒 / 15〜20秒）から来る
     * 中央値のブレより大きいところに置いている。
     * これを1秒にすると、両側とも1秒以内に収まる選手が
     * 全員「バランス」に分類されて判定が働かない。
     */
    const diff = gapFrom400 - gapFrom1500;
    if (diff > LIMITER_DIFF_THRESHOLD_SEC) limiter = "endurance";
    else if (diff < -LIMITER_DIFF_THRESHOLD_SEC) limiter = "speed";
    else limiter = "balanced";
  } else if (gapFrom400 !== undefined) {
    limiter = gapFrom400 > LIMITER_DIFF_THRESHOLD_SEC ? "endurance" : "balanced";
  } else {
    limiter = (gapFrom1500 ?? 0) > LIMITER_DIFF_THRESHOLD_SEC ? "speed" : "balanced";
  }

  const lines: string[] = [];
  if (from400) {
    lines.push(
      `400mPB ${athlete.pb400mSec!.toFixed(1)}秒から見た800mの妥当域は ${fmtTime(from400.fastSec)}〜${fmtTime(from400.slowSec)}`
    );
  }
  if (from1500) {
    lines.push(
      `1500mPB ${fmtTime(athlete.pb1500mSec!)}から見た800mの妥当域は ${fmtTime(from1500.fastSec)}〜${fmtTime(from1500.slowSec)}`
    );
  }
  lines.push(`現在の800mPBは ${fmtTime(pb800)}`);
  if (limiter === "endurance") {
    lines.push(
      "スピード資源に対して800mが遅い側にあります。制限しているのは後半の維持で、" +
        "400mを速くすることではなく、同じスピードをより長く保つ能力が必要です"
    );
  } else if (limiter === "speed") {
    lines.push(
      "有酸素側に対して800mが遅い側にあります。持久力は足りていて、絶対スピードが制限しています"
    );
  } else {
    lines.push("どちらの側から見ても妥当域から大きくは外れていません");
  }

  /*
   * 目標に対する必要換算差。
   * 「今の400mのままで目標に届くのか」は、制限因子の判定より実務的に重要。
   * 必要換算差が標準の範囲（9〜12秒）に収まっているなら、
   * 400mを速くする必要はなく、同じスピードを保つ能力を作る話になる。
   */
  if (targetSec !== undefined && athlete.pb400mSec) {
    const need = targetSec - athlete.pb400mSec * 2;
    lines.push(
      `目標${fmtTime(targetSec)}に必要な400m→800mの換算差は${need.toFixed(1)}秒` +
        (need >= CONV_400_MIN
          ? `で、標準の${CONV_400_MIN}〜${CONV_400_MAX}秒の範囲内。今の400m（${athlete.pb400mSec.toFixed(1)}秒）のままで届く計算です`
          : `で、標準の${CONV_400_MIN}秒より小さい。今の400mのままでは届かず、絶対スピードの向上が要ります`)
    );
  }

  return {
    limiter,
    from400,
    from1500,
    pb800Sec: pb800,
    gapFrom400Sec: gapFrom400,
    gapFrom1500Sec: gapFrom1500,
    narrative: lines.join("。") + "。",
  };
}

// ---------------------------------------------------------------------------
// 配分への反映
// ---------------------------------------------------------------------------

export interface CategoryWeight {
  category: SessionCategory;
  /** 1.0 = 変えない。1.2 = 2割増やす */
  weight: number;
  note: string;
}

/**
 * 制限因子から、今後4週のカテゴリ配分の重みを出す。
 *
 * 距離とカテゴリだけで機械的に配分すると、
 * 足りていない側と足りている側に同じだけ時間を使うことになる。
 */
export function categoryWeights(limiter: Limiter): CategoryWeight[] {
  if (limiter === "endurance") {
    return [
      { category: "race_economy", weight: 1.3, note: "レースペースを保つ時間を増やす" },
      { category: "modeling", weight: 1.2, note: "レース再現の頻度を上げる" },
      { category: "high_lactate", weight: 1.0, note: "本数は据え置き（既に足りている）" },
      { category: "cv", weight: 0.8, note: "CVを削って特異的な時間に回す" },
      { category: "neural", weight: 1.0, note: "維持のため据え置き" },
    ];
  }
  if (limiter === "speed") {
    return [
      { category: "neural", weight: 1.3, note: "神経系（レペ・流し）を増やす" },
      { category: "high_lactate", weight: 1.2, note: "レースペースより速い刺激を増やす" },
      { category: "race_economy", weight: 0.9, note: "経済走を少し減らす" },
      { category: "threshold", weight: 0.8, note: "閾値を削ってスピード側に回す" },
    ];
  }
  return [];
}
