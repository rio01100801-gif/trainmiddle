import type { Session } from "./types";

/**
 * その予定の**中身**を変えてよいか。
 *
 * `isFixed` は2つの意味を兼ねてしまっていた。
 *
 *   1. チーム練習など、本人が登録した「動かせない予定」（RULE-15）
 *   2. 曜日設定・周期設定で「この曜日はポイント」と決めた枠
 *
 * 2は**日付を固定しただけ**で、中身まで決めたわけではない。
 * ところが同じ `isFixed` を見ていたので、火・土をポイントに固定すると
 * その2日が設定ペースの調整（M-2）からも進め方の2案（S-9）からも外れ、
 * **調整できるポイント練習が1本も無い週**ができていた。
 * 本人が固定したのは曜日であって、中身ではない。
 *
 * ここで分けるのは**中身の話だけ**。日付を動かせるかどうかは
 * これまでどおり `isFixed` を見る（RULE-15・繰り延べ・テーパー）。
 * 曜日を固定した枠は、日付は動かせないままでよい。
 */
export function isContentLocked(
  session: Pick<Session, "isFixed" | "origin" | "fixedSource">
): boolean {
  if (session.isFixed !== true) return false;
  return !isSlotFixed(session);
}

/**
 * 曜日・周期の設定で置いた枠かどうか。
 *
 * `fixedSource` は**生成器が自分で書いた文字列**で、形は2つしかない
 * （`periodization.ts` を参照）。
 *
 *   `火曜の固定設定` / `周期3日目の固定設定`
 *
 * 本人が登録したチーム練習等は別の文言が入る。
 * 生成でないものは、文言に関わらず本人のものとして扱う。
 */
export function isSlotFixed(
  session: Pick<Session, "origin" | "fixedSource">
): boolean {
  if (session.origin !== "generated") return false;
  return /の固定設定$/.test(session.fixedSource ?? "");
}
