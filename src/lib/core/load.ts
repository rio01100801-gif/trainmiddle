/**
 * 4-9. 累積負荷指標（ACWR等）
 * 回数ベースのルールでは検出できない「総負荷の跳ね」を連続量で捕捉する。
 */
import type { Session, SessionResult, StrengthSession } from "./types";
import { addDays, diffDays } from "./dates";
import { sessionLoadEstimate } from "./rules";

/** 補強の負荷換算: light→RPE3 / moderate→RPE5 / heavy→RPE7 相当 */
const STRENGTH_RPE: Record<string, number> = { light: 3, moderate: 5, heavy: 7 };

/** セッション負荷 = RPE × 実施時間（分） */
export function sessionLoad(
  session: Session,
  result?: SessionResult
): number {
  if (result) {
    const dur = result.durationMin ?? session.durationMin ?? 45;
    return result.rpe * dur;
  }
  return sessionLoadEstimate(session);
}

export function strengthLoad(st: StrengthSession): number {
  return STRENGTH_RPE[st.loadLevel] * (st.durationMin ?? 40);
}

export interface DailyLoadInput {
  sessions: Session[];
  resultsBySessionId: Map<string, SessionResult>;
  strengthSessions: StrengthSession[];
}

/** 日次負荷 = その日の全セッション負荷の合計 */
export function dailyLoads(input: DailyLoadInput): Map<string, number> {
  const map = new Map<string, number>();
  const add = (date: string, v: number) => map.set(date, (map.get(date) ?? 0) + v);
  for (const s of input.sessions) {
    if (s.status === "skipped" || s.category === "off") continue;
    add(s.date, sessionLoad(s, input.resultsBySessionId.get(s.id)));
  }
  for (const st of input.strengthSessions) {
    if (st.status === "skipped") continue;
    add(st.date, strengthLoad(st));
  }
  return map;
}

export interface AcwrResult {
  acwr: number | undefined;
  acuteLoad: number;
  chronicLoad: number;
  rating: "insufficient_data" | "low" | "optimal" | "caution" | "high_risk";
  note: string;
}

/**
 * ACWR = 直近7日負荷合計 ÷ (直近28日負荷合計 ÷ 4)
 * 注意: 単独で判断根拠にしない（4-9-4）。
 */
export function acwr(loads: Map<string, number>, onDate: string): AcwrResult {
  let acute = 0;
  let chronic = 0;
  let daysWithData = 0;
  for (let i = 0; i < 28; i++) {
    const d = addDays(onDate, -i);
    const v = loads.get(d) ?? 0;
    if (loads.has(d)) daysWithData++;
    chronic += v;
    if (i < 7) acute += v;
  }
  if (daysWithData < 14 || chronic === 0) {
    return {
      acwr: undefined,
      acuteLoad: acute,
      chronicLoad: chronic / 4,
      rating: "insufficient_data",
      note: "28日間のデータが不足しています。2週間以上の記録が貯まると有効になります。",
    };
  }
  const ratio = acute / (chronic / 4);
  let rating: AcwrResult["rating"];
  let note: string;
  if (ratio < 0.8) {
    rating = "low";
    note = "負荷不足。刺激が足りていない可能性があります。";
  } else if (ratio <= 1.3) {
    rating = "optimal";
    note = "適正範囲です。";
  } else if (ratio <= 1.5) {
    rating = "caution";
    note = "やや高い。注意してください。";
  } else {
    rating = "high_risk";
    note = "急性負荷の増大。故障・オーバーリーチのリスクがあります。単独指標では判断せず、信号機・CFE推移・主観と併せて確認してください。";
  }
  return { acwr: ratio, acuteLoad: acute, chronicLoad: chronic / 4, rating, note };
}

/** 週間の high_lactate 回数の28日移動平均（4-9-3） */
export function highLactate28dAvgPerWeek(
  sessions: Session[],
  onDate: string
): number {
  const count = sessions.filter(
    (s) =>
      s.category === "high_lactate" &&
      s.status !== "skipped" &&
      diffDays(s.date, onDate) >= 0 &&
      diffDays(s.date, onDate) < 28
  ).length;
  return count / 4;
}

/**
 * 4-8-4. プライオメトリクスの接地回数: 週あたり増加率は10%以内
 */
export function plyoContactIncrease(
  strengthSessions: StrengthSession[],
  weekStartDate: string
): { thisWeek: number; lastWeek: number; increasePct?: number; warn: boolean } {
  const sum = (from: string, to: string) =>
    strengthSessions
      .filter(
        (st) =>
          st.type === "plyometrics" &&
          st.status !== "skipped" &&
          st.date >= from &&
          st.date <= to
      )
      .reduce((a, st) => a + (st.contactCount ?? 0), 0);
  const thisWeek = sum(weekStartDate, addDays(weekStartDate, 6));
  const lastWeek = sum(addDays(weekStartDate, -7), addDays(weekStartDate, -1));
  if (lastWeek === 0) {
    return { thisWeek, lastWeek, warn: thisWeek > 0 && thisWeek > 60 };
  }
  const inc = ((thisWeek - lastWeek) / lastWeek) * 100;
  return { thisWeek, lastWeek, increasePct: inc, warn: inc > 10 };
}
