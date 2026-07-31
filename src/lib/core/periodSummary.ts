/**
 * 期間ごとの積み上げ（分析画面の PERFORMANCE）。
 *
 * リファレンス（reference-ui/crops/analytics.jpeg）の
 * 「WEEK / MONTH / YEAR で総距離とその推移を見る」画面のための集計。
 *
 * 方針:
 * - 予定は数えない。実施したぶんだけを数える（`dailyLoads` と同じ扱い）。
 *   予定を含めると「まだやっていない練習」で総距離が増え、達成感の指標になってしまう。
 * - 強度は既存の負荷定義（RPE×分）をそのまま使う。画面用に別の強度を作らない
 *   （分析画面のACWRと数字が食い違うため）。
 * - 期間は「今日で終わる移動窓」。暦の月境界ではない——
 *   月初に前月の実績が全部消えて0kmになる画面にしないため。
 */
import type { Session, SessionResult } from "./types";
import { addDays, diffDays } from "./dates";
import { sessionLoad } from "./load";

export type PeriodKind = "week" | "month" | "year";

/** 各期間の日数。YEARは365日固定（うるう年で見た目が変わる意味がない） */
export const PERIOD_DAYS: Record<PeriodKind, number> = {
  week: 7,
  month: 30,
  year: 365,
};

export const PERIOD_LABELS: Record<PeriodKind, string> = {
  week: "WEEK",
  month: "MONTH",
  year: "YEAR",
};

export interface PeriodPoint {
  date: string;
  /** 期間の頭からの累積距離（km） */
  cumulativeKm: number;
}

export interface PeriodSummary {
  kind: PeriodKind;
  from: string;
  to: string;
  prevFrom: string;
  prevTo: string;
  totalDistanceKm: number;
  totalDurationMin: number;
  /** RPE×分の合計（既存の負荷定義） */
  totalLoad: number;
  /** 秒/km。距離か時間が0なら undefined（推測で埋めない） */
  avgPaceSecPerKm?: number;
  /**
   * 前の同じ長さの期間に対する増減（%）。
   * 前期が0のときは「何倍」が定義できないので undefined にする。
   */
  deltaPct?: number;
  /** 折れ線用。日ごとの累積。実施が無い日も点を落とさず横ばいで繋ぐ */
  points: PeriodPoint[];
}

interface DayTotals {
  distanceKm: number;
  durationMin: number;
  load: number;
}

/** 実施したセッションだけを日付ごとに合算する */
function totalsByDate(
  sessions: Session[],
  resultsBySessionId: Map<string, SessionResult>
): Map<string, DayTotals> {
  const map = new Map<string, DayTotals>();
  for (const s of sessions) {
    const r = resultsBySessionId.get(s.id);
    // 記録があるか、記録が無くても completed の旧データだけを数える
    if (!r && s.status !== "completed") continue;
    const cur = map.get(s.date) ?? { distanceKm: 0, durationMin: 0, load: 0 };
    cur.distanceKm += r?.continuous?.distanceKm ?? s.distanceKm ?? 0;
    cur.durationMin += r?.durationMin ?? s.durationMin ?? 0;
    cur.load += sessionLoad(s, r);
    map.set(s.date, cur);
  }
  return map;
}

function sumRange(
  byDate: Map<string, DayTotals>,
  from: string,
  to: string
): DayTotals {
  let distanceKm = 0;
  let durationMin = 0;
  let load = 0;
  for (const [date, t] of byDate) {
    if (date < from || date > to) continue;
    distanceKm += t.distanceKm;
    durationMin += t.durationMin;
    load += t.load;
  }
  return { distanceKm, durationMin, load };
}

export function periodSummary(input: {
  sessions: Session[];
  resultsBySessionId: Map<string, SessionResult>;
  today: string;
  kind: PeriodKind;
}): PeriodSummary {
  const { sessions, resultsBySessionId, today, kind } = input;
  const days = PERIOD_DAYS[kind];
  const from = addDays(today, -(days - 1));
  const to = today;
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -(days - 1));

  const byDate = totalsByDate(sessions, resultsBySessionId);
  const cur = sumRange(byDate, from, to);
  const prev = sumRange(byDate, prevFrom, prevTo);

  /*
   * 折れ線の点。YEARだと365点は多すぎて潰れるので、日数に応じて間引く。
   * 間引いても累積なので形は変わらない（累積は単調非減少）。
   */
  const step = days > 120 ? 7 : 1;
  const points: PeriodPoint[] = [];
  let running = 0;
  for (let i = 0; i < days; i++) {
    const date = addDays(from, i);
    running += byDate.get(date)?.distanceKm ?? 0;
    if (i % step === 0 || i === days - 1) {
      points.push({ date, cumulativeKm: Math.round(running * 10) / 10 });
    }
  }

  const avgPaceSecPerKm =
    cur.distanceKm > 0 && cur.durationMin > 0
      ? (cur.durationMin * 60) / cur.distanceKm
      : undefined;

  const deltaPct =
    prev.distanceKm > 0
      ? ((cur.distanceKm - prev.distanceKm) / prev.distanceKm) * 100
      : undefined;

  return {
    kind,
    from,
    to,
    prevFrom,
    prevTo,
    totalDistanceKm: Math.round(cur.distanceKm * 10) / 10,
    totalDurationMin: Math.round(cur.durationMin),
    totalLoad: Math.round(cur.load),
    avgPaceSecPerKm,
    deltaPct: deltaPct === undefined ? undefined : Math.round(deltaPct * 10) / 10,
    points,
  };
}

/** 期間の表示（リファレンスの "4/21 - 5/20"） */
export function formatPeriodRange(s: PeriodSummary): string {
  const short = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
  return `${short(s.from)} - ${short(s.to)}`;
}

/** 累積の総日数（テストと表示の両方で使う） */
export function periodLengthDays(kind: PeriodKind): number {
  return PERIOD_DAYS[kind];
}

/** diffDays を使う側の取り違えを防ぐための自己検査用 */
export function isWithin(date: string, from: string, to: string): boolean {
  return diffDays(from, date) >= 0 && diffDays(date, to) >= 0;
}
