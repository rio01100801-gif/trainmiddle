/**
 * レース配分シミュレータ（改修指示書v3 フェーズI）
 *
 * 800mは前後半の配分だけでタイムが1秒近く動く。
 * 一般論の「前半を1〜2秒速く」は本人には当てはまらないことが多いので、
 * **本人の過去レースの実測落ち幅**を基準に候補を出す。
 *
 * 重要: 過去レースのラップが2本未満のときは案を出さない。
 * 根拠のない配分を提示すると、それを信じてレースを壊すことになる。
 */

export interface RaceSplit {
  /** 前半400m */
  firstSec: number;
  /** 後半400m */
  secondSec: number;
  /** 後半 − 前半。800mでは通常プラス（後半が遅い） */
  fadeSec: number;
  totalSec: number;
}

export interface RaceLapSample {
  date: string;
  distanceM: number;
  lapsSec: number[];
  split?: RaceSplit;
}

export interface RacePlanOption {
  label: string;
  firstSec: number;
  secondSec: number;
  fadeSec: number;
  /** 200mごとの通過目安 */
  passing200: number[];
  note: string;
}

export interface RacePlanResult {
  targetSec: number;
  /** 本人の実測から得た平均落ち幅 */
  measuredFadeSec?: number;
  samples: RaceLapSample[];
  options: RacePlanOption[];
  /** 案を出せない場合の理由と、何をすれば出せるか */
  blockedReason?: string;
}

/** 案を出すのに必要な過去レースの本数 */
export const MIN_RACE_SAMPLES = 2;

/**
 * 区間ラップから前半400/後半400を作る。
 * 200m×4 と 400m×2 のどちらでも受ける。
 */
export function toSplit(lapsSec: number[], distanceM: number): RaceSplit | undefined {
  if (distanceM !== 800) return undefined;
  if (lapsSec.length === 2) {
    const [a, b] = lapsSec;
    return { firstSec: a, secondSec: b, fadeSec: b - a, totalSec: a + b };
  }
  if (lapsSec.length === 4) {
    const first = lapsSec[0] + lapsSec[1];
    const second = lapsSec[2] + lapsSec[3];
    return { firstSec: first, secondSec: second, fadeSec: second - first, totalSec: first + second };
  }
  return undefined;
}

function passing200From(firstSec: number, secondSec: number): number[] {
  // 前半は 200m 通過を 400m の 48.5% で見積もる（800mでは最初の200mがやや速い）
  const p1 = Math.round(firstSec * 0.485 * 10) / 10;
  const p2 = Math.round(firstSec * 10) / 10;
  // 後半は 600m 通過を後半400の 49.5% で見積もる
  const p3 = Math.round((firstSec + secondSec * 0.495) * 10) / 10;
  const p4 = Math.round((firstSec + secondSec) * 10) / 10;
  return [p1, p2, p3, p4];
}

/**
 * 目標タイムと本人の過去レースから配分案を作る。
 *
 * 案は3つ。
 *  A) 本人の実測落ち幅どおり（いちばん再現性が高い）
 *  B) 落ち幅を0.5秒詰める（後半維持に賭ける・前半をわずかに抑える）
 *  C) 落ち幅を0.5秒広げる（前半で位置を取りに行く・展開勝負向け）
 */
export function planRaceSplits(
  targetSec: number,
  samples: RaceLapSample[]
): RacePlanResult {
  const withSplit = samples
    .map((s) => ({ ...s, split: toSplit(s.lapsSec, s.distanceM) }))
    .filter((s) => s.split !== undefined);

  if (withSplit.length < MIN_RACE_SAMPLES) {
    return {
      targetSec,
      samples: withSplit,
      options: [],
      blockedReason:
        `配分案を出すには800mレースの区間ラップが${MIN_RACE_SAMPLES}本必要です（現在${withSplit.length}本）。` +
        "「過去データ」でレースを登録するとき、区間ラップ欄に 52.8 56.7 のように入れてください。" +
        "一般論の配分をこちらで作ることはしません。本人の落ち幅が分からないまま出しても意味がないためです。",
    };
  }

  const fades = withSplit.map((s) => s.split!.fadeSec);
  const measuredFade = fades.reduce((a, b) => a + b, 0) / fades.length;

  const build = (fade: number, label: string, note: string): RacePlanOption => {
    // first + second = target, second - first = fade
    const first = (targetSec - fade) / 2;
    const second = targetSec - first;
    return {
      label,
      firstSec: Math.round(first * 10) / 10,
      secondSec: Math.round(second * 10) / 10,
      fadeSec: Math.round(fade * 10) / 10,
      passing200: passing200From(first, second),
      note,
    };
  };

  return {
    targetSec,
    measuredFadeSec: Math.round(measuredFade * 10) / 10,
    samples: withSplit,
    options: [
      build(
        measuredFade,
        "実測どおり",
        `過去${withSplit.length}本の平均落ち幅 ${measuredFade.toFixed(1)}秒 をそのまま当てはめた配分です。いちばん再現性が高い案です。`
      ),
      build(
        measuredFade - 0.5,
        "後半維持に賭ける",
        "前半をわずかに抑え、落ち幅を0.5秒詰める案です。後半維持が課題の場合はこちら。前半で置いていかれるリスクがあります。"
      ),
      build(
        measuredFade + 0.5,
        "前半で位置を取る",
        "前半をやや速く入り、落ち幅が0.5秒広がる前提の案です。予選の通過狙いや、外に持ち出されたくない展開向け。"
      ),
    ],
  };
}
