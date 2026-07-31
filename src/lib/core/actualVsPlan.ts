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
