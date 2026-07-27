import { addDays, diffDays, weekStart } from "./dates";
import { isRecoverySession } from "./trainingClassification";
import type { Session } from "./types";

export const VOLUME_HORIZON_DAYS = 14;
export const MAX_VOLUME_CHANGES = 3;
export const WEEKLY_VOLUME_INCREASE_LIMIT = 0.1;

export interface VolumeProgressionChange {
  sessionId: string;
  date: string;
  kind: "jog_time" | "long_run_time" | "interval_reps";
  before: string;
  after: string;
  reason: string;
  next: Session;
}

function replaceMinutes(prescription: string, before: number, after: number): string {
  const token = `${before}分`;
  return prescription.includes(token)
    ? prescription.replace(token, `${after}分`)
    : `${prescription}（時間 ${before}分 → ${after}分）`;
}

function aerobicChange(session: Session): VolumeProgressionChange | undefined {
  const beforeMin = session.durationMin;
  if (!beforeMin || isRecoverySession(session)) return undefined;
  const long = beforeMin >= 60 || (session.distanceKm ?? 0) >= 12 || /ロング/.test(session.name);
  // 一度に増やすのは5分。ペースは変えず、週全体の10%上限を別途確認する。
  const afterMin = beforeMin + 5;
  const ratio = afterMin / beforeMin;
  const nextDistance =
    session.distanceKm === undefined
      ? undefined
      : Math.round(session.distanceKm * ratio * 10) / 10;
  const next = {
    ...session,
    durationMin: afterMin,
    distanceKm: nextDistance,
    prescription: replaceMinutes(session.prescription, beforeMin, afterMin),
    status: "modified" as const,
  };
  return {
    sessionId: session.id,
    date: session.date,
    kind: long ? "long_run_time" : "jog_time",
    before: `${beforeMin}分`,
    after: `${afterMin}分`,
    reason: `${long ? "ロング走" : "ジョグ"}のペースを変えず、時間だけ5分増やす`,
    next,
  };
}

function intervalChange(session: Session): VolumeProgressionChange | undefined {
  if (!["cv", "threshold", "neural"].includes(session.category)) return undefined;
  // 「4〜5本」のような幅指定は解釈を推測せず変更しない。
  const match = /([×xX]\s*)(\d+)\s*(本)?/.exec(session.prescription);
  if (!match) return undefined;
  if (session.prescription.slice(match.index + match[0].length).trimStart().startsWith("〜")) {
    return undefined;
  }
  const beforeReps = Number(match[2]);
  if (!Number.isFinite(beforeReps) || beforeReps < 2) return undefined;
  const afterReps = beforeReps + 1;
  const beforeToken = match[0];
  const afterToken = `${match[1]}${afterReps}${match[3] ?? ""}`;
  const ratio = afterReps / beforeReps;
  const next = {
    ...session,
    prescription:
      session.prescription.slice(0, match.index) +
      afterToken +
      session.prescription.slice(match.index + beforeToken.length),
    distanceKm:
      session.distanceKm === undefined
        ? undefined
        : Math.round(session.distanceKm * ratio * 10) / 10,
    durationMin:
      session.durationMin === undefined
        ? undefined
        : Math.round(session.durationMin * ratio),
    status: "modified" as const,
  };
  return {
    sessionId: session.id,
    date: session.date,
    kind: "interval_reps",
    before: `${beforeReps}本`,
    after: `${afterReps}本`,
    reason: "設定ペースとレストを変えず、本数だけ1本増やす",
    next,
  };
}

function withinWeeklyLimit(
  sessions: Session[],
  change: VolumeProgressionChange,
  accepted: VolumeProgressionChange[]
): boolean {
  const start = weekStart(change.date);
  const end = addDays(start, 6);
  const inWeek = sessions.filter(
    (session) =>
      session.date >= start &&
      session.date <= end &&
      session.status !== "skipped" &&
      session.category !== "off"
  );
  const baseDistance = inWeek.reduce((sum, session) => sum + (session.distanceKm ?? 0), 0);
  const acceptedDistance = accepted
    .filter((item) => item.date >= start && item.date <= end)
    .reduce(
      (sum, item) =>
        sum + ((item.next.distanceKm ?? 0) - (sessions.find((s) => s.id === item.sessionId)?.distanceKm ?? 0)),
      0
    );
  const distanceDelta =
    (change.next.distanceKm ?? 0) -
    (sessions.find((session) => session.id === change.sessionId)?.distanceKm ?? 0);
  if (baseDistance > 0 && acceptedDistance + distanceDelta > baseDistance * WEEKLY_VOLUME_INCREASE_LIMIT) {
    return false;
  }

  const baseMinutes = inWeek.reduce((sum, session) => sum + (session.durationMin ?? 0), 0);
  const acceptedMinutes = accepted
    .filter((item) => item.date >= start && item.date <= end)
    .reduce(
      (sum, item) =>
        sum + ((item.next.durationMin ?? 0) - (sessions.find((s) => s.id === item.sessionId)?.durationMin ?? 0)),
      0
    );
  const minutesDelta =
    (change.next.durationMin ?? 0) -
    (sessions.find((session) => session.id === change.sessionId)?.durationMin ?? 0);
  return baseMinutes === 0 || acceptedMinutes + minutesDelta <= baseMinutes * WEEKLY_VOLUME_INCREASE_LIMIT;
}

/**
 * 選択した日から14日間の、未実施・自動生成・非テーパーだけを対象にする。
 * 高乳酸/modeling/race_economy、休養、回復ジョグは変更しない。
 */
export function planVolumeProgression(input: {
  sessions: Session[];
  anchorSessionId: string;
  today: string;
  raceDate?: string;
}): VolumeProgressionChange[] {
  const anchor = input.sessions.find((session) => session.id === input.anchorSessionId);
  if (!anchor) return [];
  const from = anchor.date > input.today ? anchor.date : input.today;
  const to = addDays(from, VOLUME_HORIZON_DAYS - 1);
  const candidates = input.sessions
    .filter(
      (session) =>
        session.id !== anchor.id &&
        session.date >= from &&
        session.date <= to &&
        session.status === "planned" &&
        session.origin !== "manual" &&
        !session.id.startsWith("s-user-") &&
        !session.userEdited &&
        !session.isFixed &&
        session.phase !== "Taper" &&
        (!input.raceDate || diffDays(session.date, input.raceDate) > 14) &&
        !["off", "high_lactate", "modeling", "race_economy"].includes(session.category)
    )
    .sort((a, b) => a.date.localeCompare(b.date));

  const changes: VolumeProgressionChange[] = [];
  for (const session of candidates) {
    const change =
      session.category === "aerobic" ? aerobicChange(session) : intervalChange(session);
    if (!change || !withinWeeklyLimit(input.sessions, change, changes)) continue;
    changes.push(change);
    if (changes.length >= MAX_VOLUME_CHANGES) break;
  }
  return changes;
}
