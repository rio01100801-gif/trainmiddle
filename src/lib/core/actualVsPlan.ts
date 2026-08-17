/**
 * 不具合2対応: 予定と違う練習をして結果を記録したとき、カレンダーに
 * 予定のメニューではなく実際にやった内容を表示するための判定・要約。
 *
 * session.category から予定していた種別（continuous/interval）を推測し、
 * 実際に記録された結果（result.interval / result.continuous、どちらか排他）
 * と食い違うかどうかだけを見る。予定データ（session.prescription等）は
 * 一切書き換えない——表示だけを補う（黙って数値を書き換えない原則）。
 */
import type { Session, SessionResult } from "./types";
import { abortCauseLabel } from "./abortCause";

/**
 * 途中でやめた記録に付ける短い印。やめていなければ undefined。
 *
 * これまでカレンダーは**種目の食い違いしか見ていなかった**ので、
 * 「4本の予定を2本で止めた」は画面のどこにも出ていなかった。
 * 予定どおりに終えた日と見分けが付かず、あとから週を眺めても
 * どこで切ったのかが分からない。
 *
 * 理由が入っていればそれも出す。**扱いが違うものを同じ顔で並べない**
 * （天候で止めた日と、設定が高すぎて止めた日は意味が違う）。
 */
export function describeAbort(result: SessionResult | undefined): string | undefined {
  if (!result?.aborted) return undefined;
  const done = result.completedReps;
  const planned = result.prescribedReps;
  const count = done !== undefined && planned !== undefined ? `${done}/${planned}本` : undefined;
  const cause = abortCauseLabel(result.abortCause);
  const detail = [count, cause].filter(Boolean).join("・");
  return detail ? `中止 ${detail}` : "中止";
}

export function describeActualResult(result: SessionResult | undefined): string | undefined {
  if (result?.interval) {
    const iv = result.interval;
    return `${iv.reps}本 ${iv.distanceM}m` + (iv.targetSec ? ` @${iv.targetSec}秒` : "");
  }
  if (result?.continuous) {
    const c = result.continuous;
    return `${c.distanceKm}km ${c.durationMin}分`;
  }
  return undefined;
}

/**
 * 「予定と違う」と言ってよい差の大きさ。
 *
 * 30分の予定を50分やったら**一目で分かってほしい**。
 * 一方で 40分 → 42分 のような揺れまで印を付けると、
 * 印が付いていること自体が情報でなくなる。
 *
 * 割合と絶対値の**両方**を満たしたときだけ違うと言う。
 * 割合だけだと 10分 → 12分（20%）が引っかかり、
 * 絶対値だけだと 90分 → 95分 が引っかかる。どちらも普通の揺れ。
 */
const DIFF_RATIO = 0.15;
const DIFF_MIN_MINUTES = 5;
const DIFF_MIN_KM = 1;

function meaningfullyDifferent(planned: number, actual: number, floor: number): boolean {
  if (planned <= 0) return false;
  const gap = Math.abs(actual - planned);
  return gap >= floor && gap / planned >= DIFF_RATIO;
}

/**
 * 予定と違うことをやったか。
 *
 * 見るのは2つ。
 *   1. **種目の食い違い**（ジョグの予定でインターバルをやった、など）
 *   2. **量の食い違い**（30分の予定を50分やった）
 *
 * 2を足したのは、種目が同じだと画面に何も出ず、
 * カレンダーを見ても予定どおりに見えていたため（実際に指摘された）。
 *
 * **予定データは書き換えない。** 表示を補うだけ
 * （黙って数値を書き換えない原則。予定は予定として残す）。
 */
export function actualDiffersFromPlan(
  session: Session,
  result: SessionResult | undefined
): boolean {
  if (!result) return false;
  const plannedContinuous = session.category === "aerobic";

  // 1. 種目の食い違い
  if (plannedContinuous && result.interval) return true;
  if (!plannedContinuous && result.continuous) return true;

  // 2. 量の食い違い
  if (result.continuous) {
    const min = result.continuous.durationMin;
    if (
      min !== undefined &&
      session.durationMin !== undefined &&
      meaningfullyDifferent(session.durationMin, min, DIFF_MIN_MINUTES)
    ) {
      return true;
    }
    const km = result.continuous.distanceKm;
    if (
      km !== undefined &&
      session.distanceKm !== undefined &&
      meaningfullyDifferent(session.distanceKm, km, DIFF_MIN_KM)
    ) {
      return true;
    }
  }

  /*
   * インターバルの本数は**打ち切りの印（中止 2/4本）で既に出している**ので、
   * ここでは数えない。同じことを2つの印で言うと、どちらを見ればいいのか分からなくなる。
   * 距離を変えた場合（300m予定を400mでやった）だけを見る。
   */
  if (result.interval && !plannedContinuous) {
    const plannedM = session.targetPaces?.[0]?.distanceM;
    const actualM = result.interval.distanceM;
    if (
      plannedM !== undefined &&
      actualM !== undefined &&
      plannedM > 0 &&
      actualM !== plannedM
    ) {
      return true;
    }
  }

  return false;
}
