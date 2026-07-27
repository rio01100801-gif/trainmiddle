import type { Session, SessionCategory, StrengthSession } from "./types";

export type TrainingLoadClass =
  | "glycolytic"
  | "middle_distance_specific"
  | "aerobic_high"
  | "neuromuscular"
  | "aerobic_low"
  | "recovery"
  | "strength";

export const TRAINING_LOAD_LABELS: Record<TrainingLoadClass, string> = {
  glycolytic: "高乳酸・解糖系",
  middle_distance_specific: "中距離特異的",
  aerobic_high: "有酸素高強度",
  neuromuscular: "神経・スプリント",
  aerobic_low: "低〜中強度有酸素",
  recovery: "完全休養・回復",
  strength: "筋力・補強",
};

/**
 * 既存カテゴリは保存互換性のため変えず、警告・集計用の主負荷へ写像する。
 * modeling は代謝的には高乳酸を伴い得るが、主目的はレース再現なので特異的へ置く。
 */
export const CATEGORY_LOAD_CLASS: Record<SessionCategory, TrainingLoadClass> = {
  high_lactate: "glycolytic",
  race_economy: "middle_distance_specific",
  modeling: "middle_distance_specific",
  cv: "aerobic_high",
  threshold: "aerobic_high",
  neural: "neuromuscular",
  aerobic: "aerobic_low",
  off: "recovery",
};

export function trainingLoadClass(category: SessionCategory): TrainingLoadClass {
  return CATEGORY_LOAD_CLASS[category];
}

export function isGlycolyticSession(session: Session): boolean {
  return trainingLoadClass(session.category) === "glycolytic";
}

export function isMiddleDistanceSpecificSession(session: Session): boolean {
  return trainingLoadClass(session.category) === "middle_distance_specific";
}

export function isAerobicHighSession(session: Session): boolean {
  return trainingLoadClass(session.category) === "aerobic_high";
}

/**
 * 日程間隔を必ず確保する主負荷。
 * 短い neural は完全回復・低容量が前提なのでここへ含めない。
 */
export function isHighLoadSession(session: Session): boolean {
  const kind = trainingLoadClass(session.category);
  return kind === "glycolytic" || kind === "middle_distance_specific" || kind === "aerobic_high";
}

/** 高乳酸に近い回復コストを持つもの。RULE-01/07 の互換判定に使う。 */
export function hasDeepGlycolyticCost(session: Session): boolean {
  return session.category === "high_lactate" || session.category === "modeling";
}

export function isLongRun(session: Session): boolean {
  return (
    session.category === "aerobic" &&
    ((session.durationMin ?? 0) >= 60 || (session.distanceKm ?? 0) >= 12)
  );
}

export function isRecoverySession(session: Session): boolean {
  return (
    session.category === "off" ||
    (session.category === "aerobic" &&
      ((session.durationMin ?? 0) <= 35 || /回復|リカバリー/.test(session.name)))
  );
}

export function isStrongStrengthSession(session: StrengthSession): boolean {
  return session.loadLevel === "heavy";
}
