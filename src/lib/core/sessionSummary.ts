/**
 * 1セッションの振り返り（記録サマリー画面）。
 *
 * リファレンス（reference-ui/crops/session-summary.jpeg）の
 * 「TOTAL TIME / AVG / BEST ＋ 本ごとのタイム」を組み立てる。
 *
 * 新しいデータは足していない。既存の `SessionResult` から機械的に導くだけで、
 * 記録の解釈（処方文の読み取り）もしない——本数・距離は `result.interval` に
 * 構造化済みなので、そこから取る。
 *
 * ラベルについて: リファレンスは3枚目を "AVG PACE" としているが、
 * インターバルで平均するのは「1本のタイム」であってペースではない。
 * 数字の意味と表示名がずれると、あとで何を見ていたのか分からなくなるので、
 * 種別に応じて呼び分ける（`avgLabel`）。
 */
import type { Session, SessionResult } from "./types";
import { equivalentRepSec } from "./workoutLog";

export interface SummaryRep {
  index: number;
  sec: number;
  distanceM?: number;
  plannedDistanceM?: number;
  /** その日の最速か */
  isBest: boolean;
  /**
   * バーの長さ（0〜1）。最速を1として、遅いほど短くする。
   * 差が小さいので、絶対値ではなく「その日の中での相対」で見せる。
   */
  ratio: number;
  /**
   * その本の中の通過タイム（2つ以上あるときだけ）。
   * 1000mを400/400/200と刻んだFITから入る。前半突っ込んだのか
   * 最後だけ落ちたのかは、合計だけでは分からない。
   */
  splitsSec?: number[];
}

export interface SessionSummaryView {
  date: string;
  /** "600m × 3" のような見出し。処方文からではなく構造化データから作る */
  headline: string;
  prescription: string;
  /** 疾走の合計（秒）。持続走なら所要時間 */
  totalSec?: number;
  /** 平均（秒）。インターバルは1本平均、持続走は1kmあたり */
  avgSec?: number;
  avgLabel: "AVG LAP" | "AVG PACE";
  /** 最速の1本（秒）。インターバルのみ */
  bestSec?: number;
  reps: SummaryRep[];
  note?: string;
  rpe?: number;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

export function buildSessionSummary(
  session: Session,
  result: SessionResult
): SessionSummaryView {
  const iv = result.interval;
  const done = (iv?.results ?? []).filter(
    (r) => typeof r.actualSec === "number" && r.actualSec > 0
  );
  const times = done.map((r) => r.actualSec);

  if (iv && times.length > 0) {
    const comparisonTimes = iv.targetSec !== undefined
      ? done.map((rep) => equivalentRepSec(rep, iv.distanceM))
      : times;
    const best = Math.min(...comparisonTimes);
    const total = times.reduce((a, b) => a + b, 0);
    const showRepDistances =
      done.some((rep) => rep.plannedDistanceM !== undefined) ||
      new Set(done.map((rep) => rep.distanceM)).size > 1;
    const reps: SummaryRep[] = times.map((sec, i) => ({
      index: i + 1,
      sec,
      distanceM: showRepDistances ? done[i].distanceM : undefined,
      plannedDistanceM: showRepDistances ? done[i].plannedDistanceM : undefined,
      isBest: comparisonTimes[i] === best,
      splitsSec: done[i].splitsSec,
      /*
       * 最速を1、遅い本ほど短くする。0起点だと差が誇張されすぎ、
       * 1起点だと差が見えないので、0.55を下駄にしている。
       * 丸めを小数1桁にすると本どうしの差（数%）が潰れて全部同じ長さになるため、
       * 表示幅として意味のある桁まで残す。
       */
      ratio: Math.min(
        1,
        Math.round((0.55 + 0.45 * (best / comparisonTimes[i])) * 1000) / 1000
      ),
    }));
    const shortened = done.filter(
      (rep) => rep.plannedDistanceM !== undefined && rep.distanceM < rep.plannedDistanceM
    );
    const completedCount = done.length - shortened.length;
    return {
      date: result.date,
      headline: shortened.length > 0
        ? `${iv.distanceM}m × ${completedCount} + ${shortened.map((rep) => `${rep.distanceM}m`).join(" + ")}（中断）`
        : `${iv.distanceM}m × ${times.length}`,
      prescription: session.prescription,
      totalSec: round1(total),
      avgSec: round1(comparisonTimes.reduce((a, b) => a + b, 0) / comparisonTimes.length),
      avgLabel: "AVG LAP",
      bestSec: round1(best),
      reps,
      note: result.note,
      rpe: result.rpe,
    };
  }

  const cont = result.continuous;
  return {
    date: result.date,
    headline: cont
      ? `${cont.distanceKm}km ${Math.round(cont.durationMin)}分`
      : session.name,
    prescription: session.prescription,
    totalSec: cont ? Math.round(cont.durationMin * 60) : undefined,
    avgSec: cont?.avgPaceSecPerKm ? round1(cont.avgPaceSecPerKm) : undefined,
    avgLabel: "AVG PACE",
    bestSec: undefined,
    reps: [],
    note: result.note,
    rpe: result.rpe,
  };
}

/** m:ss.s。1分未満は秒だけ出す（1本のタイムは秒で読むほうが速い） */
export function fmtLap(sec: number): string {
  if (sec < 60) return sec.toFixed(1);
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}

/** m:ss。合計時間や1kmあたりの表示に使う */
export function fmtClock(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec - m * 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
