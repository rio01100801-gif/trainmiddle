/**
 * R-1 心拍を推定と判断に効かせる
 *
 * 心拍は**あれば精度が上がる補助**であって、必須項目ではない。
 * ここにあるものは全部 undefined を返せる。心拍が無い状態で
 * 何かが止まったり、心拍が無いことを理由に値を推測したりしない。
 *
 * 心拍でできること・できないことを分けておく:
 *   できる   … 同じ設定・同じペースでの比較（相対値）
 *   できない … 1本が短い練習の強度判定（心拍が定常に達しないので低く出る）
 */
import type {
  Athlete,
  FitnessMarker,
  Session,
  SessionCategory,
  SessionResult,
} from "./types";

// ---------------------------------------------------------------------------
// 最大心拍の基準
// ---------------------------------------------------------------------------

export interface HrMaxReference {
  bpm: number;
  /** profile = 本人が入れた実測値 / observed = 記録の中で最も高かった値 */
  source: "profile" | "observed";
  note: string;
}

/**
 * 相対強度の基準にする最大心拍。
 *
 * **年齢からの推定式（220−年齢など）は使わない。** 個人差が±10〜12拍あり、
 * 推定値を基準にすると「強度が足りている／足りていない」の判定がその誤差ぶん動く。
 * 本人が入れた実測値が無ければ、記録の中の最高値を使い、
 * それが実測の最高値であることを明示する（本当の最大とは限らないため）。
 * どちらも無ければ基準を持たない＝相対強度は出さない。
 */
export function hrMaxReference(
  athlete: Athlete | undefined,
  results: SessionResult[],
  markers: FitnessMarker[]
): HrMaxReference | undefined {
  if (athlete?.maxHrBpm && athlete.maxHrBpm > 0) {
    return {
      bpm: athlete.maxHrBpm,
      source: "profile",
      note: `最大心拍 ${athlete.maxHrBpm}bpm（プロフィールの実測値）`,
    };
  }
  const seen: number[] = [];
  for (const r of results) {
    if (r.continuous?.maxHr) seen.push(r.continuous.maxHr);
    for (const rep of r.interval?.results ?? []) {
      if (rep.avgHr) seen.push(rep.avgHr);
    }
  }
  for (const m of markers) if (m.maxHr) seen.push(m.maxHr);
  const observed = seen.length > 0 ? Math.max(...seen) : undefined;
  if (observed === undefined) return undefined;
  return {
    bpm: observed,
    source: "observed",
    note: `最大心拍 ${observed}bpm（記録の中の最高値。実際の最大はこれより高い可能性があります）`,
  };
}

// ---------------------------------------------------------------------------
// 相対強度
// ---------------------------------------------------------------------------

/**
 * 1本がこれより短い練習では、心拍から強度を判定しない。
 *
 * 心拍が定常に達するまで1.5〜2分かかる。300mを42秒で走る練習の平均心拍は
 * 実際の負荷よりはっきり低く出るので、「強度が足りていない」と読める値になる。
 * 短い練習の心拍は、**同じ設定どうしの比較**（qualityHrTrend）にだけ使う。
 */
export const HR_STEADY_MIN_SEC = 120;

/**
 * カテゴリごとの期待強度帯（%HRmax）。
 *
 * 800mのトレーニングで一般に使われる帯をそのまま置いている。
 * 上限を100%にしないのは、平均心拍が最大に達することは持続走では起きないため。
 * ここは「狙った強度で走れていたか」の目安であって、合否ではない。
 */
export const INTENSITY_BANDS: Partial<Record<SessionCategory, { min: number; max: number }>> = {
  race_economy: { min: 90, max: 97 },
  cv: { min: 86, max: 93 },
  threshold: { min: 80, max: 88 },
  aerobic: { min: 65, max: 78 },
};

export type IntensityVerdict = "in_band" | "below" | "above" | "not_applicable" | "no_data";

export interface RelativeIntensity {
  pct?: number;
  band?: { min: number; max: number };
  verdict: IntensityVerdict;
  note: string;
}

/** その結果の代表的な平均心拍と、1本あたりの長さ */
function hrAndDuration(
  result: SessionResult
): { hr?: number; repSec?: number } {
  if (result.continuous?.avgHr) {
    return { hr: result.continuous.avgHr, repSec: (result.continuous.durationMin ?? 0) * 60 };
  }
  const hrs = (result.interval?.results ?? [])
    .map((x) => x.avgHr)
    .filter((v): v is number => typeof v === "number" && v > 0);
  const secs = (result.interval?.results ?? [])
    .map((x) => x.actualSec)
    .filter((v) => typeof v === "number" && v > 0);
  return {
    hr: hrs.length > 0 ? hrs.reduce((a, b) => a + b, 0) / hrs.length : undefined,
    repSec: secs.length > 0 ? secs.reduce((a, b) => a + b, 0) / secs.length : undefined,
  };
}

/**
 * 狙ったカテゴリの強度で実際に走れていたかを、最大心拍比で見る。
 *
 * 判定できない条件（基準が無い・心拍が無い・1本が短い）では
 * 判定できないと返す。埋めない。
 */
export function relativeIntensity(
  session: Session,
  result: SessionResult,
  hrMax: HrMaxReference | undefined
): RelativeIntensity {
  const band = INTENSITY_BANDS[session.category];
  if (!band) {
    return {
      verdict: "not_applicable",
      note: `${session.category} は心拍から強度を判定しません（1本が短く、心拍が実際の負荷より低く出るため）`,
    };
  }
  if (!hrMax) {
    return {
      verdict: "no_data",
      note: "最大心拍の基準がありません（プロフィールに入れるか、最大心拍つきの記録が1件必要です）",
    };
  }
  const { hr, repSec } = hrAndDuration(result);
  if (hr === undefined) {
    return { verdict: "no_data", note: "この練習には心拍が入っていません" };
  }
  if (repSec !== undefined && repSec > 0 && repSec < HR_STEADY_MIN_SEC) {
    return {
      verdict: "not_applicable",
      note: `1本が${Math.round(repSec)}秒と短く、心拍が定常に達しないため強度の判定には使いません`,
    };
  }

  const pct = Math.round((hr / hrMax.bpm) * 1000) / 10;
  const verdict: IntensityVerdict =
    pct < band.min ? "below" : pct > band.max ? "above" : "in_band";
  const head = `平均心拍 ${Math.round(hr)}bpm は最大の ${pct.toFixed(0)}%（狙いは ${band.min}〜${band.max}%）`;
  return {
    pct,
    band,
    verdict,
    note:
      verdict === "in_band"
        ? `${head}。狙った強度で走れています`
        : verdict === "below"
        ? `${head}。強度が上がりきっていません。設定が緩いか、途中で切れている可能性があります`
        : `${head}。狙いより強く走っています。カテゴリの意図から外れていないか確認してください`,
  };
}

// ---------------------------------------------------------------------------
// 暑熱の影響の切り分け
// ---------------------------------------------------------------------------

/** 同じ設定でこれ以上心拍が高ければ、環境要因の裏づけとして扱う */
export const HEAT_HR_EVIDENCE_BPM = 5;

export interface HeatHrEvidence {
  /** 心拍が環境要因の説明を裏づけているか */
  supported: boolean;
  deltaBpm?: number;
  deltaSec?: number;
  baselineCount: number;
  note: string;
}

/**
 * 暑熱フラグの付いた日について、心拍が環境要因の裏づけになっているかを見る。
 *
 * 同じカテゴリ・同じ距離の、暑熱フラグが付いていない日と比べる。
 * **ペースが同じか遅いのに心拍が高い**なら、実力が落ちたのではなく
 * その日の環境で同じ仕事のコストが上がった、という説明がつく。
 * 逆に心拍が変わらなければ、暑さのせいだと言い切る材料は無い（そう書く）。
 */
export function heatHrEvidence(
  sessions: Session[],
  results: SessionResult[],
  target: SessionResult
): HeatHrEvidence {
  const byId = new Map(sessions.map((s) => [s.id, s]));
  const targetSession = byId.get(target.sessionId);
  const t = hrAndDuration(target);
  const targetDist = target.interval?.distanceM;
  if (!targetSession || t.hr === undefined) {
    return {
      supported: false,
      baselineCount: 0,
      note: "この日の心拍が入っていないため、暑さの影響かどうかは心拍からは判断できません",
    };
  }

  const baseline = results
    .filter((r) => {
      if (r.id === target.id || r.heatFlagged) return false;
      const s = byId.get(r.sessionId);
      if (s?.category !== targetSession.category) return false;
      if (targetDist !== undefined && r.interval?.distanceM !== targetDist) return false;
      return hrAndDuration(r).hr !== undefined;
    })
    .map((r) => hrAndDuration(r));

  if (baseline.length === 0) {
    return {
      supported: false,
      baselineCount: 0,
      note: "同じ設定で暑熱フラグの付いていない記録がまだありません。比較できるようになると、暑さの影響かどうかを心拍から確かめられます",
    };
  }

  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const baseHr = mean(baseline.map((x) => x.hr!));
  const deltaBpm = t.hr - baseHr;
  const baseSec = baseline.map((x) => x.repSec).filter((v): v is number => v !== undefined);
  const deltaSec =
    t.repSec !== undefined && baseSec.length > 0 ? t.repSec - mean(baseSec) : undefined;

  // 速く走ったから心拍が高い、を除く。同じか遅いのに高いことが裏づけになる
  const notFaster = deltaSec === undefined || deltaSec >= 0;
  const supported = deltaBpm >= HEAT_HR_EVIDENCE_BPM && notFaster;

  const body =
    `同じ設定の平常時 ${baseHr.toFixed(0)}bpm に対して ${t.hr.toFixed(0)}bpm（${deltaBpm >= 0 ? "+" : ""}${deltaBpm.toFixed(0)}bpm）` +
    (deltaSec !== undefined ? `、タイムは ${deltaSec >= 0 ? "+" : ""}${deltaSec.toFixed(1)}秒/本` : "");

  return {
    supported,
    deltaBpm,
    deltaSec,
    baselineCount: baseline.length,
    note: supported
      ? `${body}。同じ仕事に対する負担が上がっており、環境要因として説明がつきます（能力が落ちたわけではありません）`
      : deltaBpm < HEAT_HR_EVIDENCE_BPM
      ? `${body}。心拍は平常と変わらないので、暑さのせいだと言い切る材料はありません`
      : `${body}。速く走ったぶんの上昇なので、暑さの裏づけにはしません`,
  };
}
