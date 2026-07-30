/**
 * FIT取込 Phase 3: ラップ列を区間（ウォームアップ／メイン疾走／リカバリー／
 * レスト／クールダウン）に分類する。ルールベースのみ（LLM不使用）。
 * 同じlap列からは必ず同じ結果になる。
 *
 * 保存はまだしない（3層データモデルはPhase 4）。ここでは「自動判定した結果を
 * 信頼度つきで見せ、本人が判断・修正できる」ところまで。
 *
 * 判定に使う信号はペース（elapsedSec / distanceKm）と列内の位置だけ。
 * 心拍は個人差・当日のコンディションで変動が大きく、閾値を機種・体調に
 * 依存させないためここでは使わない。
 */
import type { FitParseLap } from "./fitParse";

export type IntervalKind =
  | "warmup"
  | "main"
  | "recovery"
  | "rest"
  | "cooldown"
  | "unknown";

export interface ClassifiedLap {
  index: number;
  kind: IntervalKind;
  /** 0〜1。低いほど自動判定への確信が薄く、本人による確認を促すべき値 */
  confidence: number;
  paceSecPerKm?: number;
  /** なぜその種別になったかの短い説明。黙って判定しない（本人が却下できるように） */
  note: string;
}

export interface IntervalClassifyWarning {
  code: string;
  message: string;
}

export interface IntervalClassifyResult {
  laps: ClassifiedLap[];
  warnings: IntervalClassifyWarning[];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * 中央値よりこの倍率以上速ければ「速い区間（メイン疾走の候補）」とみなす。
 * 0.93 = 中央値より7%速い。800m系のインターバルはメインがリカバリーより
 * 明確に（体感10%以上）速いことが多く、7%を境目にすることで複数本のメインの
 * 多少のばらつきは拾いつつ、ほぼ一定ペースの走行（インターバルではない）を
 * 誤ってメインと判定しないマージンを持たせている。
 */
const FAST_RATIO = 0.93;

/** 距離0のlap（一時停止・手動lap）に与える固定信頼度。機器が明示的に記録した値のため高めに固定 */
const REST_CONFIDENCE = 0.85;

export function classifyLaps(laps: FitParseLap[]): IntervalClassifyResult {
  const warnings: IntervalClassifyWarning[] = [];
  const result: ClassifiedLap[] = new Array(laps.length);

  const valid: Array<{ arrayIndex: number; pace: number }> = [];

  laps.forEach((lap, arrayIndex) => {
    if (lap.distanceKm === 0) {
      result[arrayIndex] = {
        index: lap.index,
        kind: "rest",
        confidence: REST_CONFIDENCE,
        paceSecPerKm: undefined,
        note: "距離0のためレスト（一時停止）と判定",
      };
      return;
    }
    if (lap.distanceKm === undefined || lap.elapsedSec === undefined || lap.elapsedSec === 0) {
      result[arrayIndex] = {
        index: lap.index,
        kind: "unknown",
        confidence: 0.15,
        paceSecPerKm: undefined,
        note: "距離または時間の情報が不十分で判定できません",
      };
      return;
    }
    valid.push({ arrayIndex, pace: lap.elapsedSec / lap.distanceKm });
  });

  if (valid.length === 0) {
    return { laps: result, warnings };
  }

  if (valid.length === 1) {
    const only = valid[0];
    result[only.arrayIndex] = {
      index: laps[only.arrayIndex].index,
      kind: "unknown",
      confidence: 0.2,
      paceSecPerKm: only.pace,
      note: "lapが1件のみで他と比較できないため判定できません",
    };
    warnings.push({
      code: "single_valid_lap",
      message: "比較対象となるlapが1件しかなく、区間の分類ができません。",
    });
    return { laps: result, warnings };
  }

  const sortedPaces = valid.map((v) => v.pace).sort((a, b) => a - b);
  const mid = Math.floor(sortedPaces.length / 2);
  const median =
    sortedPaces.length % 2 === 0
      ? (sortedPaces[mid - 1] + sortedPaces[mid]) / 2
      : sortedPaces[mid];

  const isFast = valid.map((v) => v.pace <= median * FAST_RATIO);
  const fastPositions = isFast.map((f, p) => (f ? p : -1)).filter((p) => p >= 0);

  if (fastPositions.length === 0) {
    valid.forEach((v) => {
      result[v.arrayIndex] = {
        index: laps[v.arrayIndex].index,
        kind: "unknown",
        confidence: 0.3,
        paceSecPerKm: v.pace,
        note: "他のlapとの速さの明確な差が無く、インターバル構成を判定できません",
      };
    });
    warnings.push({
      code: "no_interval_structure",
      message: "速い区間とそれ以外の明確な差が見つからず、区間の分類ができませんでした。",
    });
    return { laps: result, warnings };
  }

  const firstFastPos = fastPositions[0];
  const lastFastPos = fastPositions[fastPositions.length - 1];

  valid.forEach((v, p) => {
    const ratio = v.pace / median;
    const lap = laps[v.arrayIndex];
    if (isFast[p]) {
      result[v.arrayIndex] = {
        index: lap.index,
        kind: "main",
        confidence: clamp(0.5 + (1 - ratio) * 3, 0.5, 0.95),
        paceSecPerKm: v.pace,
        note: "他の区間より明確に速いためメイン疾走と判定",
      };
    } else if (p < firstFastPos) {
      result[v.arrayIndex] = {
        index: lap.index,
        kind: "warmup",
        confidence: clamp(0.4 + (ratio - 1) * 2, 0.4, 0.9),
        paceSecPerKm: v.pace,
        note: "メイン疾走より遅く先頭付近のためウォームアップと判定",
      };
    } else if (p > lastFastPos) {
      result[v.arrayIndex] = {
        index: lap.index,
        kind: "cooldown",
        confidence: clamp(0.4 + (ratio - 1) * 2, 0.4, 0.9),
        paceSecPerKm: v.pace,
        note: "メイン疾走より遅く末尾付近のためクールダウンと判定",
      };
    } else {
      result[v.arrayIndex] = {
        index: lap.index,
        kind: "recovery",
        confidence: clamp(0.45 + (ratio - 1) * 2, 0.45, 0.9),
        paceSecPerKm: v.pace,
        note: "メイン疾走に挟まれた遅い区間のためリカバリーと判定",
      };
    }
  });

  return { laps: result, warnings };
}
