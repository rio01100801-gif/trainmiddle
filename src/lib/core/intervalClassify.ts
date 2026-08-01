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
 * 疾走群と休息群を分ける「速さの隔たり」の最小比。
 *
 * 1.20 = 遅い側が速い側より20%以上遅い。800m系のインターバルは
 * メインがリカバリーより明確に（体感でも数値でも20%以上）速いので、
 * ここを下回る差しかないものはインターバル構成と見なさない
 * （ビルドアップ走やペース走を誤ってメイン扱いしないため）。
 *
 * かつて中央値×0.93で切っていたが、これは実運用で壊れた。
 * 時計で「本」と「休み」だけラップを押すとW-up/C-downのlapが無く、
 * 疾走と休息がほぼ半々になる。すると全lapの中央値が「最も遅い疾走」に乗り、
 * 1本目しか閾値を通らず残りの本がクールダウンに落ちて、
 * 300m×4が「300m×1」として記録されていた。
 * 中央値は2つの母集団が混ざった列では境目の指標にならない。
 * ソートしたペース列の最大の隔たりで切れば、混合比に左右されない。
 *
 * 「最初に閾値を超えた隔たり」ではなく「最大の隔たり」で切っているのは、
 * 本の中に1本だけ極端に速いものがあったとき（突っ込んで垂れた場合）に
 * そこで切れて、残りの本を取りこぼす方が起こりやすいため。
 * 逆の弱点として、休息側の内部のばらつきが疾走と休息の差を上回ると
 * 休息を本と数えてしまう（例: リカバリー6:00/kmに対しクールダウンが歩き）。
 * ただし歩きは距離0のlapになることが多く上のレスト判定で除かれるため、
 * こちらの方が起きにくいと判断した。どちらに転んでも取込画面の
 * プルダウンで本人が直せる。
 */
const MIN_GROUP_SEPARATION = 1.2;

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

  /*
   * ソートしたペース列で最も大きな「隔たり」を探し、そこで疾走群と休息群に分ける。
   * 中央値ではなく隔たりで切るのは、両群の件数比に左右されないため（上の定数の説明を参照）。
   */
  const sortedPaces = valid.map((v) => v.pace).sort((a, b) => a - b);
  let splitAt = -1;
  let widestGap = 1;
  for (let i = 0; i < sortedPaces.length - 1; i++) {
    const gap = sortedPaces[i + 1] / sortedPaces[i];
    if (gap > widestGap) {
      widestGap = gap;
      splitAt = i;
    }
  }
  // 隔たりが小さい＝速い群と遅い群に分かれていない（ほぼ一定ペースの走行）
  const fastMax = widestGap >= MIN_GROUP_SEPARATION ? sortedPaces[splitAt] : -1;

  const isFast = valid.map((v) => v.pace <= fastMax);
  const fastPositions = isFast.map((f, p) => (f ? p : -1)).filter((p) => p >= 0);

  /*
   * 信頼度の基準。かつては中央値との比だったが、中央値を使わなくなったので
   * 「遅い群の最も速いもの」＝休息側の下限を基準にする。
   * 疾走がこれよりどれだけ速いかで、判定の確からしさを表す。
   */
  const slowRef = splitAt >= 0 && splitAt + 1 < sortedPaces.length
    ? sortedPaces[splitAt + 1]
    : sortedPaces[sortedPaces.length - 1];

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
    const ratio = v.pace / slowRef;
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
