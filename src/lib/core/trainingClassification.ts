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

export const HIGH_LOAD_CATEGORIES: readonly SessionCategory[] = [
  "high_lactate",
  "race_economy",
  "modeling",
  "cv",
  "threshold",
];

export function trainingLoadClass(category: SessionCategory): TrainingLoadClass {
  return CATEGORY_LOAD_CLASS[category];
}

export function isHighLoadCategory(category: SessionCategory): boolean {
  const kind = trainingLoadClass(category);
  return kind === "glycolytic" || kind === "middle_distance_specific" || kind === "aerobic_high";
}

export function isSpecificCategory(category: SessionCategory): boolean {
  const kind = trainingLoadClass(category);
  return kind === "glycolytic" || kind === "middle_distance_specific";
}

export function hasDeepGlycolyticCostCategory(category: SessionCategory): boolean {
  return category === "high_lactate" || category === "modeling";
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

export interface NeuromuscularDose {
  repDistanceM?: number;
  reps?: number;
  fastVolumeM?: number;
  maxRepSeconds?: number;
  fullRecovery: boolean;
  demanding: boolean;
  reason?: string;
}

function firstNumber(text: string): number | undefined {
  const value = Number(text);
  return Number.isFinite(value) ? value : undefined;
}

/**
 * neural のうち、短時間・低容量・完全回復という前提から外れるものだけを拾う。
 *
 * 200m・10本・合計1200mは安全な上限の断定ではなく、保存カテゴリの取り違えを
 * 検出するための境界。現在の自動生成（8〜10秒の坂、100〜150mの流し）を
 * 高乳酸反復と同じ扱いにしない一方、300m反復や100m×20のような内容を
 * neural の名前だけで無条件に軽負荷へ落とさないために使う。
 */
export function neuromuscularDose(session: Session): NeuromuscularDose {
  const text = `${session.name} ${session.prescription}`.replace(/\s+/g, " ");
  const repeated = /(\d{2,4})\s*m\s*[×xX]\s*(\d{1,2})(?:\s*[〜~-]\s*(\d{1,2}))?/i.exec(text);
  const repDistanceM = repeated ? firstNumber(repeated[1]) : undefined;
  const reps = repeated ? firstNumber(repeated[3] ?? repeated[2]) : undefined;
  const fastVolumeM = repDistanceM !== undefined && reps !== undefined ? repDistanceM * reps : undefined;
  const seconds = /(\d{1,2})(?:\s*[〜~-]\s*(\d{1,2}))?\s*秒/.exec(text);
  const maxRepSeconds = seconds ? firstNumber(seconds[2] ?? seconds[1]) : undefined;
  const fullRecovery = /完全休息|完全回復|歩行で戻る|walk\s*back/i.test(text);

  if (session.category !== "neural") {
    return { repDistanceM, reps, fastVolumeM, maxRepSeconds, fullRecovery, demanding: false };
  }
  if (repDistanceM !== undefined && repDistanceM > 200) {
    return {
      repDistanceM,
      reps,
      fastVolumeM,
      maxRepSeconds,
      fullRecovery,
      demanding: true,
      reason: `1本${repDistanceM}mで、短い神経刺激の範囲を超えています`,
    };
  }
  if (fastVolumeM !== undefined && fastVolumeM > 1200) {
    return {
      repDistanceM,
      reps,
      fastVolumeM,
      maxRepSeconds,
      fullRecovery,
      demanding: true,
      reason: `高速区間の合計が約${fastVolumeM}mあります`,
    };
  }
  if (maxRepSeconds !== undefined && maxRepSeconds > 10) {
    return {
      repDistanceM,
      reps,
      fastVolumeM,
      maxRepSeconds,
      fullRecovery,
      demanding: true,
      reason: `1本あたり最大${maxRepSeconds}秒で、短い神経刺激の範囲を超えています`,
    };
  }
  if (reps !== undefined && reps > 10 && !fullRecovery) {
    return {
      repDistanceM,
      reps,
      fastVolumeM,
      maxRepSeconds,
      fullRecovery,
      demanding: true,
      reason: `${reps}本かつ完全回復の記載がありません`,
    };
  }
  return { repDistanceM, reps, fastVolumeM, maxRepSeconds, fullRecovery, demanding: false };
}

export function isDemandingNeuromuscularSession(session: Session): boolean {
  return neuromuscularDose(session).demanding;
}

export interface GlycolyticDose {
  fastVolumeM?: number;
  repDistanceM?: number;
  reps?: number;
  restSec?: number;
  fullRecovery: boolean;
  lowVolumeReviewCandidate: boolean;
  reason: string;
}

/**
 * 高乳酸/モデリングの「4日間隔を個別検討できる低容量か」を構造化する。
 *
 * 900mは安全を保証する理想値ではない。現行の標準高乳酸（300m×5=1500m）の
 * 60%以下を「低容量候補」として拾う運用境界で、実際の4日化には前回の完遂・
 * RPE・翌日の脚・日次疲労をRULE-01側で追加確認する。
 */
export function glycolyticDose(session: Session): GlycolyticDose {
  const text = `${session.name} ${session.prescription}`.replace(/\s+/g, " ");
  const repeated = /(\d{2,4})\s*m\s*[×xX]\s*(\d{1,2})/i.exec(text);
  const repDistanceM = repeated ? firstNumber(repeated[1]) : undefined;
  const reps = repeated ? firstNumber(repeated[2]) : undefined;
  let fastVolumeM =
    repDistanceM !== undefined && reps !== undefined ? repDistanceM * reps : undefined;
  if (fastVolumeM === undefined && /\+/.test(text)) {
    const distances = [...text.matchAll(/(\d{2,4})\s*m/gi)]
      .map((match) => firstNumber(match[1]))
      .filter((value): value is number => value !== undefined);
    if (distances.length >= 2) fastVolumeM = distances.reduce((sum, value) => sum + value, 0);
  }
  const restMinutes = /(?:r|rest|レスト)\s*(\d+(?:\.\d+)?)\s*分/i.exec(text);
  const restSeconds = /(?:r|rest|レスト)\s*(\d+)\s*秒/i.exec(text);
  const restSec = restMinutes
    ? Number(restMinutes[1]) * 60
    : restSeconds
      ? Number(restSeconds[1])
      : undefined;
  const fullRecovery = /完全休息|完全回復/i.test(text) || (restSec !== undefined && restSec >= 300);
  const lowVolumeReviewCandidate =
    (session.category === "high_lactate" || session.category === "modeling") &&
    fastVolumeM !== undefined &&
    fastVolumeM <= 900 &&
    fullRecovery &&
    session.riskLevel !== "high";
  return {
    fastVolumeM,
    repDistanceM,
    reps,
    restSec,
    fullRecovery,
    lowVolumeReviewCandidate,
    reason:
      fastVolumeM === undefined
        ? "高速区間の総量を本文から確認できません"
        : !fullRecovery
          ? `高速区間${fastVolumeM}mですが完全回復を確認できません`
          : lowVolumeReviewCandidate
            ? `高速区間${fastVolumeM}m・完全回復の低容量候補`
            : `高速区間${fastVolumeM}mで標準5日間隔を維持します`,
  };
}

/**
 * 日程間隔を必ず確保する主負荷。
 * 短い neural は除外するが、明示的に長い反復・大容量なら名前だけで軽負荷にしない。
 */
export function isHighLoadSession(session: Session): boolean {
  return isHighLoadCategory(session.category) || isDemandingNeuromuscularSession(session);
}

/** 高乳酸に近い回復コストを持つもの。RULE-01/07 の互換判定に使う。 */
export function hasDeepGlycolyticCost(session: Session): boolean {
  return hasDeepGlycolyticCostCategory(session.category);
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
      (session.aerobicPurpose === "recovery" ||
        ((session.durationMin ?? 0) <= 35 || /回復|リカバリー|調整/.test(session.name))))
  );
}

export function isStrongStrengthSession(session: StrengthSession): boolean {
  return session.loadLevel === "heavy";
}
