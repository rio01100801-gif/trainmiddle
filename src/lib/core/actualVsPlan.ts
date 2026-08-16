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

export function actualDiffersFromPlan(
  session: Session,
  result: SessionResult | undefined
): boolean {
  if (!result) return false;
  const plannedContinuous = session.category === "aerobic";
  if (plannedContinuous && result.interval) return true;
  if (!plannedContinuous && result.continuous) return true;
  return false;
}
