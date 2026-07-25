/**
 * M-8 600m通過を主指標にする
 *
 * 800m特異的に見るべきなのは
 * 「600mまでをレースペースで通過した状態から、残り200mをどれだけ残せるか」。
 * 1本の平均タイムより早く変化が出る。
 *
 * 目標1:48.90の内訳を基準線として置く:
 *   400m通過 54.5 ／ 600m通過 1:21.5 ／ 残り200m 27.4
 *
 * 材料:
 *   ・800mレースの区間ラップ（400+400 なら600m通過は推定になる）
 *   ・600m単発（走り切ったあとの残り200mは取れないので通過タイムのみ）
 *   ・300+500 / 500+300 のような分割走（600m通過相当を作ってからの200mが取れる）
 *
 * 材料が2本未満のときは指標を出さない。
 * 1本しか無いものを線にすると、たまたまの1本が現在地に見える。
 */
import type { PastEntry } from "./backfill";
import type { FitnessMarker } from "./types";

/** 目標タイムからの基準線 */
export interface SplitReference {
  targetSec: number;
  pass400Sec: number;
  pass600Sec: number;
  last200Sec: number;
}

/**
 * 800mの基準配分。
 *
 * 目標1:48.90に対して 400m通過 54.5 ／ 600m通過 1:21.5 ／ 残り200m 27.4。
 * ほぼイーブンで、3本目の200m（27.0）から最後の200mで0.4秒落ちるだけ、という配分。
 *
 * 前半を突っ込む配分にしていないのは、耐乳酸型が1本目を速く入りやすく、
 * それで後半が崩れるのが典型的な失敗の形だから。
 * 「前半をもっと速く」ではなく「この通過から残り200mを27秒台で戻せるか」を見る。
 */
export const PASS_400_RATIO = 54.5 / 108.9;
export const PASS_600_RATIO = 81.5 / 108.9;

export function splitReference(targetSec: number): SplitReference {
  const pass400 = targetSec * PASS_400_RATIO;
  const pass600 = targetSec * PASS_600_RATIO;
  return {
    targetSec,
    pass400Sec: round2(pass400),
    pass600Sec: round2(pass600),
    last200Sec: round2(targetSec - pass600),
  };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export interface SplitSample {
  date: string;
  source: string;
  /** 600m通過（秒） */
  pass600Sec: number;
  /** 残り200m（秒）。600m単発など取れない場合は undefined */
  last200Sec?: number;
  totalSec?: number;
  /** 600m通過が推定（400+400のラップから按分）かどうか */
  estimated: boolean;
}

export const MIN_SPLIT_SAMPLES = 2;

/** 800mのラップから600m通過を出す。400+400しか無ければ按分して推定にする */
export function from800Laps(
  date: string,
  laps: number[],
  lapDistancesM?: number[]
): SplitSample | undefined {
  const total = laps.reduce((a, b) => a + b, 0);
  const dists = lapDistancesM ?? inferDistances(laps.length);
  if (!dists || dists.reduce((a, b) => a + b, 0) !== 800) return undefined;

  // 200m刻みで取れているなら通過はそのまま足せる
  let cum = 0;
  let dist = 0;
  for (let i = 0; i < laps.length; i++) {
    cum += laps[i];
    dist += dists[i];
    if (dist === 600) {
      return {
        date,
        source: "800mレース（区間ラップ）",
        pass600Sec: round2(cum),
        last200Sec: round2(total - cum),
        totalSec: round2(total),
        estimated: false,
      };
    }
  }
  // 400+400 のときは後半400の前半分を按分する。
  // 後半は前半より落ちるので単純な半分では速く出る。実測の後半400の48%を使う。
  if (laps.length === 2 && dists[0] === 400) {
    const pass600 = laps[0] + laps[1] * 0.48;
    return {
      date,
      source: "800mレース（400+400から推定）",
      pass600Sec: round2(pass600),
      last200Sec: round2(total - pass600),
      totalSec: round2(total),
      estimated: true,
    };
  }
  return undefined;
}

function inferDistances(n: number): number[] | undefined {
  if (n === 2) return [400, 400];
  if (n === 4) return [200, 200, 200, 200];
  if (n === 8) return Array(8).fill(100);
  return undefined;
}

/** 過去データ（レース・TT）から材料を集める */
export function splitSamplesFromPast(entries: PastEntry[]): SplitSample[] {
  const out: SplitSample[] = [];
  for (const e of entries) {
    if ((e.kind !== "race" && e.kind !== "timetrial") || e.distanceM !== 800) continue;
    if (!e.lapsSec || e.lapsSec.length < 2) continue;
    const s = from800Laps(e.date, e.lapsSec, e.lapDistanceM ? e.lapsSec.map(() => e.lapDistanceM!) : undefined);
    if (s) out.push(s);
  }
  return out;
}

/** 実測マーカー（レース）からも拾う */
export function splitSamplesFromMarkers(markers: FitnessMarker[]): SplitSample[] {
  const out: SplitSample[] = [];
  for (const m of markers) {
    const total = m.resultLapsSec.reduce((a, b) => a + b, 0);
    const dists = m.lapDistancesM ?? inferDistances(m.resultLapsSec.length);
    if (!dists || dists.reduce((a, b) => a + b, 0) !== 800) continue;
    if (total <= 0) continue;
    const s = from800Laps(m.date, m.resultLapsSec, dists);
    if (s) out.push({ ...s, source: `${m.description || "実測"}（${m.type}）` });
  }
  return out;
}

export interface SplitTrend {
  samples: SplitSample[];
  reference: SplitReference;
  /** 直近の1本 */
  latest?: SplitSample;
  /** 基準線との差（正 = 遅い） */
  pass600GapSec?: number;
  last200GapSec?: number;
  /** 古い順に見た残り200mの変化。負 = 改善 */
  last200TrendSec?: number;
  enough: boolean;
  narrative: string;
}

export function splitTrend(samples: SplitSample[], targetSec: number): SplitTrend {
  const reference = splitReference(targetSec);
  const sorted = [...samples].sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length < MIN_SPLIT_SAMPLES) {
    return {
      samples: sorted,
      reference,
      enough: false,
      narrative:
        `600m通過からの残り200mを見るには材料が${MIN_SPLIT_SAMPLES}本必要です（現在${sorted.length}本）。` +
        "800mレースの区間ラップ、600m単発、300+500のような分割走が材料になります",
    };
  }
  const latest = sorted[sorted.length - 1];
  const withLast = sorted.filter((s) => s.last200Sec !== undefined);
  const last200TrendSec =
    withLast.length >= 2
      ? round2(withLast[withLast.length - 1].last200Sec! - withLast[0].last200Sec!)
      : undefined;

  const pass600Gap = round2(latest.pass600Sec - reference.pass600Sec);
  const last200Gap =
    latest.last200Sec !== undefined
      ? round2(latest.last200Sec - reference.last200Sec)
      : undefined;

  const lines: string[] = [];
  lines.push(
    `目標${fmt(targetSec)}の基準線は 600m通過 ${fmt(reference.pass600Sec)} → 残り200m ${reference.last200Sec.toFixed(1)}秒`
  );
  lines.push(
    `直近（${latest.date}）は 600m通過 ${fmt(latest.pass600Sec)}（基準比 ${sign(pass600Gap)}秒）` +
      (last200Gap !== undefined
        ? ` → 残り200m ${latest.last200Sec!.toFixed(1)}秒（基準比 ${sign(last200Gap)}秒）`
        : "")
  );
  if (last200TrendSec !== undefined) {
    lines.push(
      last200TrendSec < 0
        ? `残り200mは ${Math.abs(last200TrendSec).toFixed(1)}秒 速くなっています`
        : `残り200mは ${last200TrendSec.toFixed(1)}秒 遅くなっています`
    );
  }
  if (latest.estimated) {
    lines.push("直近の600m通過は400+400のラップからの推定です。200m刻みで取ると精度が上がります");
  }

  return {
    samples: sorted,
    reference,
    latest,
    pass600GapSec: pass600Gap,
    last200GapSec: last200Gap,
    last200TrendSec,
    enough: true,
    narrative: lines.join("。") + "。",
  };
}

function sign(v: number): string {
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}`;
}

function fmt(sec: number): string {
  if (sec < 60) return `${sec.toFixed(1)}秒`;
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}
