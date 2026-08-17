/**
 * 4-9. 累積負荷指標（ACWR等）
 * 回数ベースのルールでは検出できない「総負荷の跳ね」を連続量で捕捉する。
 */
import type { Session, SessionResult, StrengthSession } from "./types";
import { addDays, diffDays } from "./dates";
import { sessionLoadEstimate } from "./rules";
import { warmupLoad } from "./warmup";

/** 補強の負荷換算: light→RPE3 / moderate→RPE5 / heavy→RPE7 相当 */
const STRENGTH_RPE: Record<string, number> = { light: 3, moderate: 5, heavy: 7 };

/**
 * セッション負荷 = RPE × 実施時間（分）。
 *
 * アップを記録してあれば、そのぶんを足す（`warmupLoad`）。
 * **主練習のRPEでアップの時間を掛けない。** 掛けると、きつい主練習の日だけ
 * アップの負荷が跳ね上がり、「アップの内容が変わった」と区別が付かなくなる。
 *
 * ここに足すのは、ACWRが**実際にやった総量**を見る指標だから。
 * 週間の刺激回数やカテゴリ配分には足さない（あちらは回数を数えるもので、
 * アップを1回として数えるとポイント練習が増えたことになる）。
 */
export function sessionLoad(
  session: Session,
  result?: SessionResult
): number {
  if (result) {
    const dur = result.durationMin ?? session.durationMin ?? 45;
    return result.rpe * dur + warmupLoad(result.warmup);
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
    const result = input.resultsBySessionId.get(s.id);
    if (result) {
      add(s.date, sessionLoad(s, result));
      continue;
    }
    if (s.status === "skipped") continue;
    if (s.category === "off") {
      // 明示的に完了した休養日も「記録がある日」として0負荷で残す。
      if (s.status === "completed") add(s.date, 0);
      continue;
    }
    // ACWRは実施負荷の補助指標。未実施のplanned/modified予定を実績へ混ぜない。
    // 結果詳細が無い旧データだけ、completedならカテゴリ既定値で後方互換する。
    if (s.status === "completed") add(s.date, sessionLoad(s));
  }
  for (const st of input.strengthSessions) {
    if (st.status === "skipped") continue;
    // 旧StrengthSessionにはstatusが無いので、undefinedは実施記録として扱う。
    if (st.status === "planned" || st.status === "modified") continue;
    add(st.date, strengthLoad(st));
  }
  return map;
}

export interface AcwrResult {
  acwr: number | undefined;
  acuteLoad: number;
  chronicLoad: number;
  rating: "insufficient_data" | "low" | "optimal" | "caution" | "high_risk";
  label: string;
  note: string;
  recordedDays: number;
  coveragePct: number;
  confidence: "low" | "medium" | "high";
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
      label: "参考値なし",
      note: "28日中14日未満の実施・休養記録しかないため、負荷比は表示しません。",
      recordedDays: daysWithData,
      coveragePct: daysWithData / 28,
      confidence: "low",
    };
  }
  const ratio = acute / (chronic / 4);
  let rating: AcwrResult["rating"];
  let label: string;
  let note: string;
  if (ratio < 0.8) {
    rating = "low";
    label = "直近負荷は低め";
    note = "直近7日の実施負荷が28日平均より低い状態です。回復週・欠測でも下がるため、負荷不足とは断定しません。";
  } else if (ratio <= 1.3) {
    rating = "optimal";
    label = "過去平均に近い";
    note = "直近7日の実施負荷が28日平均に近い状態です。安全性を保証する範囲ではありません。";
  } else if (ratio <= 1.5) {
    rating = "caution";
    label = "増加側";
    note = "直近7日の実施負荷が28日平均より増えています。疲労・睡眠・未達と併せて確認してください。";
  } else {
    rating = "high_risk";
    label = "大きく増加";
    note = "直近7日の実施負荷が28日平均より大きく増えています。この比率だけで故障危険度や練習可否は決めません。";
  }
  return {
    acwr: ratio,
    acuteLoad: acute,
    chronicLoad: chronic / 4,
    rating,
    label,
    note,
    recordedDays: daysWithData,
    coveragePct: daysWithData / 28,
    confidence: daysWithData >= 21 ? "high" : "medium",
  };
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
