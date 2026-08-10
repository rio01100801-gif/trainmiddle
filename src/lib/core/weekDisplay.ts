import type { Session } from "./types";
import { isLongRun } from "./trainingClassification";

const CATEGORY_LETTER: Record<Session["category"], string> = {
  high_lactate: "H",
  race_economy: "R",
  modeling: "M",
  neural: "N",
  cv: "C",
  threshold: "T",
  aerobic: "A",
  off: "—",
};

/**
 * TODAYの週ストリップで、その日の代表メニューを選ぶ。
 * 編集後の有酸素/ロングランを、同日に残っている休養枠より優先する。
 */
export function weekSessionForDisplay(list: Session[]): Session | undefined {
  const active = list.filter((session) => session.status !== "skipped");
  return (
    active.find(
      (session) => session.category !== "off" && session.category !== "aerobic"
    ) ??
    active.find((session) => session.category !== "off") ??
    active[0]
  );
}

export function weekSessionLetter(session: Session | undefined): string {
  if (!session) return "—";
  return isLongRun(session) ? "L" : CATEGORY_LETTER[session.category];
}
