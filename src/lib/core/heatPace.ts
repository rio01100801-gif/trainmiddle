/**
 * M-9 WBGTから設定を自動で緩める
 *
 * 暑熱下では同じ出力でも心拍・体温が上がり、同じペースを維持できない。
 * これは能力の問題ではなく環境の問題なので、
 *   ・その日の設定は緩める（走れない設定を出しても意味が無い）
 *   ・実測をCFEに戻すときは補正ぶんを差し引く（暑さを能力低下として記録しない）
 * の両方をやる必要がある。片方だけだと、夏を越えるたびにCFEが悪化し続ける。
 *
 * 補正量はWBGTの区分に対応させる。日本スポーツ協会の運動指針の区分
 * （21/25/28/31）をそのまま境界に使い、区分が上がるごとに緩める。
 * 暑熱耐性が低い選手（heat_tolerance = low）は係数を1.5倍にする。
 * 本人は東京の猛暑下で高強度が壊れた経験があり、平均的な反応より大きく出る。
 *
 * 数値の根拠:
 * 中距離〜長距離のレースタイムは WBGT が 10℃ 上がるごとにおよそ 2〜4% 落ちる。
 * ここでは区分ごとに 0 / 1 / 2 / 3.5 / 5% を割り当てている。
 * 800mの高強度セッションでは体温上昇の影響が出るまでの時間が短いので、
 * 長距離の実測ほど大きくは取らない。
 */
import type { HeatTolerance, SessionCategory } from "./types";
import { estimateWbgt, wbgtLevel, type WbgtLevel } from "./environment";

export interface HeatPaceAdjustment {
  /** 設定に掛ける倍率。1.02 = 2%緩める */
  factor: number;
  pct: number;
  wbgt?: number;
  level?: WbgtLevel;
  /** 補正の根拠。画面にそのまま出す */
  note: string;
  /** 補正を掛けたかどうか。false なら推測で埋めていない */
  applied: boolean;
}

/** WBGT区分ごとの基礎補正（割合） */
export const HEAT_PCT_BY_LEVEL: Record<WbgtLevel, number> = {
  safe: 0,
  caution: 0.01,
  warning: 0.02,
  severe: 0.035,
  danger: 0.05,
};

/** 暑熱耐性が低い選手の係数 */
export const LOW_TOLERANCE_MULTIPLIER = 1.5;
export const HIGH_TOLERANCE_MULTIPLIER = 0.7;

/**
 * 有酸素系は設定ペース自体をCFEから作っていないので補正の対象外。
 * ジョグが遅くなるのは当然で、そこに補正を掛けても意味が無い。
 */
const ADJUSTABLE: SessionCategory[] = [
  "high_lactate",
  "modeling",
  "race_economy",
  "cv",
  "threshold",
];

export function isHeatAdjustable(c: SessionCategory): boolean {
  return ADJUSTABLE.includes(c);
}

export interface HeatPaceInput {
  /** 実測WBGT。あればこれを最優先で使う */
  wbgt?: number;
  tempC?: number;
  humidityPct?: number;
  heatTolerance?: HeatTolerance;
  category?: SessionCategory;
}

/**
 * その日の設定に掛ける倍率を出す。
 * WBGTも気温も無ければ補正しない。推測で埋めない。
 */
export function heatPaceAdjustment(input: HeatPaceInput): HeatPaceAdjustment {
  const { wbgt, tempC, humidityPct, heatTolerance = "normal", category } = input;

  if (category && !isHeatAdjustable(category)) {
    return {
      factor: 1,
      pct: 0,
      applied: false,
      note: "有酸素系の設定はCFEから作っていないため、暑熱補正の対象外です",
    };
  }

  let w = wbgt;
  let source = "実測WBGT";
  if (w === undefined && tempC !== undefined && humidityPct !== undefined) {
    w = estimateWbgt(tempC, humidityPct);
    source = `気温${tempC}℃・湿度${humidityPct}%からの推定WBGT`;
  }
  if (w === undefined) {
    return {
      factor: 1,
      pct: 0,
      applied: false,
      note:
        tempC !== undefined
          ? `気温${tempC}℃のみでは湿度が分からず、WBGTを出せません。補正はしていません`
          : "WBGT・気温・湿度のいずれも未入力のため、補正はしていません",
    };
  }

  const level = wbgtLevel(w);
  const base = HEAT_PCT_BY_LEVEL[level];
  const mult =
    heatTolerance === "low"
      ? LOW_TOLERANCE_MULTIPLIER
      : heatTolerance === "high"
      ? HIGH_TOLERANCE_MULTIPLIER
      : 1;
  const pct = Math.round(base * mult * 1000) / 1000;

  if (pct === 0) {
    return {
      factor: 1,
      pct: 0,
      wbgt: w,
      level,
      applied: false,
      note: `${source} ${w.toFixed(1)}。補正の必要はありません`,
    };
  }

  return {
    factor: 1 + pct,
    pct,
    wbgt: w,
    level,
    applied: true,
    note:
      `${source} ${w.toFixed(1)} のため設定を ${(pct * 100).toFixed(1)}% 緩めています` +
      (heatTolerance === "low" ? "（暑熱耐性が低い設定のため補正を1.5倍）" : "") +
      "。この補正は表示上の設定にだけ掛かり、実測をCFEに戻すときは差し引きます",
  };
}

/**
 * 暑熱補正を掛けた設定で走った実測を、涼しい条件相当に戻す。
 *
 * これをやらないと、夏場の実測がすべて「能力低下」としてCFEに入る。
 * 補正して出した設定で走らせておいて、その結果を補正なしで評価するのは筋が通らない。
 */
export function normalizeForHeat(actualSec: number, adj: HeatPaceAdjustment): number {
  if (!adj.applied) return actualSec;
  return actualSec / adj.factor;
}
