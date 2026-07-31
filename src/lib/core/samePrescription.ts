/**
 * 同一処方の経時比較（改修指示書v3 フェーズG）
 *
 * なぜこれを見るか:
 * 800mの後半維持が改善しているかを最も直接的に映すのは、
 * 「同じ処方での平均タイム」と「1本目→最終本の落ち幅（垂れ幅）」である。
 *
 * 平均タイムだけを見ると、全体が速くなったのか、1本目だけ突っ込んだのかが
 * 区別できない。耐乳酸型の選手は1本目を速く入りやすいので、
 * 平均が改善していても垂れ幅が広がっていれば後半維持は悪化している。
 * したがって2つを必ず別々に判定する。
 */
import type { NextDayLegs, Session, SessionCategory, SessionResult } from "./types";

export interface PrescriptionKey {
  category: SessionCategory;
  distanceM: number;
  reps: number;
}

export interface PrescriptionOccurrence {
  date: string;
  sessionId: string;
  /** 各本のタイム（秒） */
  timesSec: number[];
  avgSec: number;
  firstSec: number;
  lastSec: number;
  /** 垂れ幅 = 最終本 − 1本目。正なら垂れている */
  fadeSec: number;
  /** Q-1: その日の1本あたり平均心拍。入っている本だけの平均。無ければ undefined */
  avgHr?: number;
  restNote?: string;
  tempC?: number;
  rpe?: number;
  heatFlagged?: boolean;
  /** 分析画面用に追加。翌日の脚の重さ（打ち込まれていれば）。回復の質を判断する材料 */
  nextDayLegs?: NextDayLegs;
}

export interface PrescriptionGroup {
  key: PrescriptionKey;
  label: string;
  occurrences: PrescriptionOccurrence[];
  /** 平均タイムの傾向 */
  avgTrend: TrendJudgement;
  /** 垂れ幅の傾向 */
  fadeTrend: TrendJudgement;
  /**
   * Q-1: 平均心拍の傾向。心拍が入っている回が2回以上あるときだけ判定する。
   * タイムが横ばいでも心拍が下がっていれば、同じ練習が楽になっている＝改善。
   */
  hrTrend?: TrendJudgement;
}

export interface TrendJudgement {
  judgement: "improving" | "flat" | "worsening" | "insufficient_data";
  /** 初回と最新の差（秒）。負なら改善 */
  deltaSec?: number;
  message: string;
}

/** 同一処方とみなす鍵。レストは含めない（含めると比較対象がほぼ無くなる） */
export function prescriptionKeyOf(
  session: Session,
  result: SessionResult
): PrescriptionKey | undefined {
  const d = result.interval?.distanceM;
  const reps = result.interval?.results?.length ?? result.interval?.reps;
  if (!d || !reps || reps < 2) return undefined;
  return { category: session.category, distanceM: d, reps };
}

export function keyId(k: PrescriptionKey): string {
  return `${k.category}|${k.distanceM}|${k.reps}`;
}

const CATEGORY_LABEL: Record<string, string> = {
  high_lactate: "高乳酸",
  race_economy: "経済走",
  modeling: "モデリング",
  neural: "神経系",
  cv: "CV",
  threshold: "閾値",
  aerobic: "有酸素",
  off: "休養",
};

/** 傾向の判定にこれ以上の差が要る（計測誤差と区別するため） */
export const TREND_THRESHOLD_SEC = 0.3;
/**
 * 心拍側のしきい値（bpm）。
 * 装着位置・気温・その日の水分で数bpmは平気で動くので、
 * 3bpm 未満は横ばいとして扱う。M-2 の疲労判定（4bpm）より緩いのは、
 * こちらは「傾向の表示」で、設定を動かす判断には使わないため。
 */
export const TREND_THRESHOLD_BPM = 3;

function judgeTrend(
  values: number[],
  kind: "avg" | "fade" | "hr"
): TrendJudgement {
  if (values.length < 2) {
    return {
      judgement: "insufficient_data",
      message:
        kind === "avg"
          ? "同じ処方を2回以上こなすと、平均タイムの推移が出ます。"
          : kind === "fade"
          ? "同じ処方を2回以上こなすと、垂れ幅の推移が出ます。"
          : "同じ処方で心拍を2回以上入れると、心拍の推移が出ます。",
    };
  }
  const delta = values[values.length - 1] - values[0];
  // 心拍は秒ではないので、誤差とみなす幅も別に持つ
  const threshold = kind === "hr" ? TREND_THRESHOLD_BPM : TREND_THRESHOLD_SEC;
  if (Math.abs(delta) < threshold) {
    return {
      judgement: "flat",
      deltaSec: delta,
      message:
        kind === "avg"
          ? "平均タイムはほぼ横ばいです。"
          : kind === "fade"
          ? "垂れ幅はほぼ横ばいです。"
          : "平均心拍はほぼ横ばいです。",
    };
  }
  if (delta < 0) {
    return {
      judgement: "improving",
      deltaSec: delta,
      message:
        kind === "avg"
          ? `平均タイムが${Math.abs(delta).toFixed(1)}秒 速くなっています。`
          : kind === "fade"
          ? `垂れ幅が${Math.abs(delta).toFixed(
              1
            )}秒 縮んでいます。後半を保てるようになっており、800mへの転移が大きい変化です。`
          : `平均心拍が${Math.abs(delta).toFixed(0)}bpm 下がっています。同じ練習が楽になっています。`,
    };
  }
  return {
    judgement: "worsening",
    deltaSec: delta,
    message:
      kind === "avg"
        ? `平均タイムが${delta.toFixed(1)}秒 落ちています。`
        : kind === "fade"
        ? `垂れ幅が${delta.toFixed(
            1
          )}秒 広がっています。1本目の入りが速すぎるか、疲労が抜けていない可能性があります。`
        : `平均心拍が${delta.toFixed(0)}bpm 上がっています。タイムが変わっていなければ、疲労が抜けていない可能性があります。`,
  };
}

/**
 * 同じ処方でまとめ、平均タイムと垂れ幅の推移をそれぞれ判定する。
 * 2回以上こなした処方だけを返す（1回では推移にならない）。
 */
export function groupBySamePrescription(
  sessions: Session[],
  results: SessionResult[]
): PrescriptionGroup[] {
  const sessionById = new Map(sessions.map((s) => [s.id, s]));
  const buckets = new Map<string, { key: PrescriptionKey; list: PrescriptionOccurrence[] }>();

  for (const r of results) {
    const s = sessionById.get(r.sessionId);
    if (!s) continue;
    const key = prescriptionKeyOf(s, r);
    if (!key) continue;
    const times = (r.interval!.results ?? [])
      .map((x) => x.actualSec)
      .filter((x) => typeof x === "number" && x > 0);
    if (times.length < 2) continue;

    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    // Q-1: 心拍は入っている本だけの平均。1本も無ければ持たせない
    const hrs = (r.interval!.results ?? [])
      .map((x) => x.avgHr)
      .filter((v): v is number => typeof v === "number" && v > 0);
    const occ: PrescriptionOccurrence = {
      date: r.date,
      sessionId: s.id,
      timesSec: times,
      avgSec: Math.round(avg * 100) / 100,
      firstSec: times[0],
      lastSec: times[times.length - 1],
      fadeSec: Math.round((times[times.length - 1] - times[0]) * 100) / 100,
      avgHr:
        hrs.length > 0
          ? Math.round((hrs.reduce((a, b) => a + b, 0) / hrs.length) * 10) / 10
          : undefined,
      restNote:
        r.interval!.restSec !== undefined
          ? `r${r.interval!.restSec}秒`
          : r.interval!.restDistanceM !== undefined
          ? `r${r.interval!.restDistanceM}m`
          : undefined,
      tempC: r.weatherTempC,
      rpe: r.rpe,
      heatFlagged: r.heatFlagged,
      nextDayLegs: r.nextDayLegs,
    };
    const id = keyId(key);
    if (!buckets.has(id)) buckets.set(id, { key, list: [] });
    buckets.get(id)!.list.push(occ);
  }

  const out: PrescriptionGroup[] = [];
  for (const { key, list } of buckets.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => a.date.localeCompare(b.date));
    out.push({
      key,
      label: `${CATEGORY_LABEL[key.category] ?? key.category} ${key.distanceM}m×${key.reps}`,
      occurrences: list,
      avgTrend: judgeTrend(
        list.map((o) => o.avgSec),
        "avg"
      ),
      fadeTrend: judgeTrend(
        list.map((o) => o.fadeSec),
        "fade"
      ),
      // 心拍は任意項目。入っている回だけで比べる（入れ忘れた回で欠測にしない）
      hrTrend: judgeTrend(
        list.map((o) => o.avgHr).filter((v): v is number => v !== undefined),
        "hr"
      ),
    });
  }
  // 実施回数が多い処方を先に出す（比較の価値が高い）
  out.sort((a, b) => b.occurrences.length - a.occurrences.length);
  return out;
}
