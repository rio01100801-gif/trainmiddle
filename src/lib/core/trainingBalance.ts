import { addDays, diffDays, weekStart } from "./dates";
import { sessionLoadEstimate } from "./rules";
import {
  isGlycolyticSession,
  isHighLoadSession,
  isLongRun,
  isMiddleDistanceSpecificSession,
  isRecoverySession,
  trainingLoadClass,
  type TrainingLoadClass,
} from "./trainingClassification";
import type { Phase, Session, SessionResult, StrengthSession } from "./types";

export interface BalanceCategoryCount {
  planned: number;
  completed: number;
}

export interface BalanceWeek {
  weekStart: string;
  weekEnd: string;
  plannedSessions: number;
  completedSessions: number;
  skippedSessions: number;
  modifiedSessions: number;
  unmetSessions: number;
  overdueSessions: number;
  plannedDistanceKm: number;
  completedDistanceKm: number;
  plannedLoad: number;
  completedLoad: number;
  highLoadDays: number;
  glycolyticSessions: number;
  middleDistanceSpecificSessions: number;
  aerobicHighSessions: number;
  longRuns: number;
  recoveryDays: number;
  adherencePct?: number;
  categories: Record<TrainingLoadClass, BalanceCategoryCount>;
}

export interface BalanceSignal {
  code:
    | "insufficient_data"
    | "load_surge"
    | "high_load_streak"
    | "glycolytic_cluster"
    | "recovery_shortage"
    | "adherence_drop"
    | "aerobic_high_absent";
  level: "info" | "warn";
  message: string;
  action: string;
  dates: string[];
}

export interface FourWeekBalance {
  from: string;
  to: string;
  weeks: BalanceWeek[];
  totalPlannedDistanceKm: number;
  totalCompletedDistanceKm: number;
  totalHighLoadDays: number;
  totalGlycolytic: number;
  totalMiddleDistanceSpecific: number;
  totalAerobicHigh: number;
  totalLongRuns: number;
  totalRecoveryDays: number;
  adherencePct?: number;
  signals: BalanceSignal[];
  raceProgress?: {
    raceDate: string;
    daysToRace: number;
    phase: Phase;
  };
}

const LOAD_CLASSES: TrainingLoadClass[] = [
  "glycolytic",
  "middle_distance_specific",
  "aerobic_high",
  "neuromuscular",
  "aerobic_low",
  "recovery",
  "strength",
];

function emptyCategoryCounts(): Record<TrainingLoadClass, BalanceCategoryCount> {
  return Object.fromEntries(
    LOAD_CLASSES.map((kind) => [kind, { planned: 0, completed: 0 }])
  ) as Record<TrainingLoadClass, BalanceCategoryCount>;
}

function actualDistance(session: Session, result: SessionResult | undefined): number {
  return result?.continuous?.distanceKm ?? (result ? session.distanceKm ?? 0 : 0);
}

function actualLoad(session: Session, result: SessionResult | undefined): number {
  if (!result) return session.status === "completed" ? sessionLoadEstimate(session) : 0;
  return result.rpe * (result.durationMin ?? session.durationMin ?? 45);
}

/**
 * 月曜始まりの現在週と直前3週を集計する。
 * planned と completed は別々に持ち、未実施予定を実績へ混ぜない。
 */
export function buildFourWeekBalance(input: {
  sessions: Session[];
  results: SessionResult[];
  strengths?: StrengthSession[];
  today: string;
  raceDate?: string;
  phase?: Phase;
}): FourWeekBalance {
  const currentWeek = weekStart(input.today);
  const starts = [3, 2, 1, 0].map((n) => addDays(currentWeek, -7 * n));
  const from = starts[0];
  const to = addDays(currentWeek, 6);
  const resultBySession = new Map(input.results.map((result) => [result.sessionId, result]));

  const weeks = starts.map((start): BalanceWeek => {
    const end = addDays(start, 6);
    const sessions = input.sessions.filter((session) => session.date >= start && session.date <= end);
    const categories = emptyCategoryCounts();
    const completed = sessions.filter(
      (session) => session.status === "completed" || resultBySession.has(session.id)
    );
    for (const session of sessions) {
      const kind = trainingLoadClass(session.category);
      categories[kind].planned++;
      if (completed.includes(session)) categories[kind].completed++;
    }
    for (const strength of input.strengths ?? []) {
      if (strength.date < start || strength.date > end) continue;
      categories.strength.planned++;
      if (strength.status === "completed") categories.strength.completed++;
    }

    const eligible = sessions.filter(
      (session) => session.category !== "off" && session.date <= input.today
    );
    const doneEligible = eligible.filter(
      (session) => session.status === "completed" || resultBySession.has(session.id)
    );
    const overdue = eligible.filter(
      (session) =>
        session.date < input.today &&
        session.status !== "completed" &&
        session.status !== "skipped" &&
        !resultBySession.has(session.id)
    );

    return {
      weekStart: start,
      weekEnd: end,
      plannedSessions: sessions.filter((session) => session.category !== "off").length,
      completedSessions: completed.filter((session) => session.category !== "off").length,
      skippedSessions: sessions.filter((session) => session.status === "skipped").length,
      modifiedSessions: sessions.filter((session) => session.status === "modified").length,
      unmetSessions: completed.filter((session) => {
        const result = resultBySession.get(session.id);
        return !!result && (result.achievement !== "achieved" || result.aborted === true);
      }).length,
      overdueSessions: overdue.length,
      plannedDistanceKm: sessions.reduce(
        (sum, session) => sum + (session.category === "off" ? 0 : session.distanceKm ?? 0),
        0
      ),
      completedDistanceKm: completed.reduce(
        (sum, session) => sum + actualDistance(session, resultBySession.get(session.id)),
        0
      ),
      plannedLoad: sessions.reduce(
        (sum, session) =>
          sum +
          (session.category === "off" || session.status === "skipped"
            ? 0
            : sessionLoadEstimate(session)),
        0
      ),
      completedLoad: completed.reduce(
        (sum, session) => sum + actualLoad(session, resultBySession.get(session.id)),
        0
      ),
      highLoadDays: new Set(completed.filter(isHighLoadSession).map((session) => session.date)).size,
      glycolyticSessions: completed.filter(isGlycolyticSession).length,
      middleDistanceSpecificSessions: completed.filter(isMiddleDistanceSpecificSession).length,
      aerobicHighSessions: completed.filter(
        (session) => trainingLoadClass(session.category) === "aerobic_high"
      ).length,
      longRuns: completed.filter(isLongRun).length,
      recoveryDays: new Set(sessions.filter(isRecoverySession).map((session) => session.date)).size,
      adherencePct:
        eligible.length > 0 ? Math.round((doneEligible.length / eligible.length) * 100) : undefined,
      categories,
    };
  });

  const allCompleted = input.sessions.filter(
    (session) =>
      session.date >= from &&
      session.date <= input.today &&
      (session.status === "completed" || resultBySession.has(session.id))
  );
  const signals: BalanceSignal[] = [];
  if (allCompleted.length < 4) {
    signals.push({
      code: "insufficient_data",
      level: "info",
      message: `実施記録が${allCompleted.length}件のため、4週間の傾向はまだ断定しません。`,
      action: "予定どおり記録を続け、4件以上たまってから推移を確認してください。",
      dates: [],
    });
  } else {
    const completeWeeks = weeks.filter((week) => week.weekEnd < input.today);
    const previous = completeWeeks.at(-2);
    const latest = completeWeeks.at(-1);
    if (
      previous &&
      latest &&
      previous.completedLoad > 0 &&
      previous.completedSessions >= 2 &&
      latest.completedSessions >= 2
    ) {
      const increase = (latest.completedLoad - previous.completedLoad) / previous.completedLoad;
      // RULE-17の15%注意域と合わせ、4週画面でも同じ境界から「確認」を促す。
      if (increase > 0.15) {
        signals.push({
          code: "load_surge",
          level: "warn",
          message: `実施負荷が前週比${Math.round(increase * 100)}%増えています（${Math.round(previous.completedLoad)} → ${Math.round(latest.completedLoad)}）。`,
          action: "今週は量を追加せず、回復状況と高負荷日の間隔を確認してください。",
          dates: [previous.weekStart, latest.weekStart],
        });
      }
    }

    const streak = weeks.slice(0, 3).every((week) => week.highLoadDays >= 3);
    if (streak) {
      signals.push({
        code: "high_load_streak",
        level: "warn",
        message: "完了した高負荷日が3週連続で週3日以上あります。",
        action: "次週は有酸素高強度か特異的練習の1日を低強度有酸素へ替える案があります。",
        dates: weeks.slice(0, 3).map((week) => week.weekStart),
      });
    }

    const recentTen = allCompleted.filter(
      (session) => diffDays(session.date, input.today) >= 0 && diffDays(session.date, input.today) < 10
    );
    const glycolytic = recentTen.filter(isGlycolyticSession);
    if (glycolytic.length >= 2) {
      signals.push({
        code: "glycolytic_cluster",
        level: "warn",
        message: `直近10日に高乳酸・解糖系が${glycolytic.length}回集中しています。`,
        action: "次の高乳酸は間隔を空け、中距離特異的または有酸素系への変更を検討してください。",
        dates: glycolytic.map((session) => session.date),
      });
    }

    const noRecovery = weeks.find(
      (week) => week.weekEnd < input.today && week.plannedSessions >= 5 && week.recoveryDays === 0
    );
    if (noRecovery) {
      signals.push({
        code: "recovery_shortage",
        level: "warn",
        message: `${noRecovery.weekStart}の週は5日以上の予定に対し、完全休養・回復日がありません。`,
        action: "低優先の1日を完全休養か30分以内の回復ジョグへ変更してください。",
        dates: [noRecovery.weekStart],
      });
    }

    const comparable = weeks.filter(
      (week) => week.weekEnd < input.today && week.adherencePct !== undefined && week.plannedSessions >= 3
    );
    const prior = comparable.at(-2);
    const current = comparable.at(-1);
    if (
      prior?.adherencePct !== undefined &&
      current?.adherencePct !== undefined &&
      prior.adherencePct - current.adherencePct >= 20
    ) {
      signals.push({
        code: "adherence_drop",
        level: "warn",
        message: `実施率が${prior.adherencePct}%から${current.adherencePct}%へ低下しています。`,
        action: "不足分を追加せず、中止・未達の理由に合わせて次週の予定量を調整してください。",
        dates: [prior.weekStart, current.weekStart],
      });
    }

    if (
      allCompleted.length >= 8 &&
      allCompleted.every((session) => trainingLoadClass(session.category) !== "aerobic_high")
    ) {
      signals.push({
        code: "aerobic_high_absent",
        level: "info",
        message: `直近4週の実施${allCompleted.length}件に、有酸素高強度（CV・閾値）がありません。`,
        action: "フェーズとレース日程を確認し、必要なら次の自動生成で有酸素高強度の枠を確保してください。",
        dates: [],
      });
    }
  }

  const eligible = input.sessions.filter(
    (session) => session.date >= from && session.date <= input.today && session.category !== "off"
  );
  const done = eligible.filter(
    (session) => session.status === "completed" || resultBySession.has(session.id)
  );
  return {
    from,
    to,
    weeks,
    totalPlannedDistanceKm: weeks.reduce((sum, week) => sum + week.plannedDistanceKm, 0),
    totalCompletedDistanceKm: weeks.reduce((sum, week) => sum + week.completedDistanceKm, 0),
    totalHighLoadDays: weeks.reduce((sum, week) => sum + week.highLoadDays, 0),
    totalGlycolytic: weeks.reduce((sum, week) => sum + week.glycolyticSessions, 0),
    totalMiddleDistanceSpecific: weeks.reduce(
      (sum, week) => sum + week.middleDistanceSpecificSessions,
      0
    ),
    totalAerobicHigh: weeks.reduce((sum, week) => sum + week.aerobicHighSessions, 0),
    totalLongRuns: weeks.reduce((sum, week) => sum + week.longRuns, 0),
    totalRecoveryDays: weeks.reduce((sum, week) => sum + week.recoveryDays, 0),
    adherencePct: eligible.length > 0 ? Math.round((done.length / eligible.length) * 100) : undefined,
    signals,
    raceProgress:
      input.raceDate && input.phase
        ? {
            raceDate: input.raceDate,
            daysToRace: diffDays(input.today, input.raceDate),
            phase: input.phase,
          }
        : undefined,
  };
}
