/**
 * 4-2. ペース自動計算
 * - 特異的セッション: 基準タイム（4-5-2）から逆算
 * - 有酸素系: 実測 FitnessMarker から算出。目標タイムから逆算してはならない
 */
import type {
  FitnessMarker,
  FitnessMarkerPurpose,
  SessionCategory,
  TargetPace,
} from "./types";
import { diffDays } from "./dates";

/** GRP（目標レースペース）= T/800 秒/m */
export function grpSecPerM(baseTime800Sec: number): number {
  return baseTime800Sec / 800;
}

/**
 * セッション種別ごとの GRP 比（仕様書 4-2 の表）
 * ratio < 1.0 = GRPより速い / ratio > 1.0 = GRPより遅い
 */
export const GRP_RATIOS: Partial<
  Record<SessionCategory, { fast: number; slow: number }>
> = {
  modeling: { fast: 0.99, slow: 1.0 }, // モデリング核（レース再現）100〜99%
  high_lactate: { fast: 0.95, slow: 0.97 }, // 高乳酸 97〜95%（速い）
  race_economy: { fast: 1.04, slow: 1.06 }, // 経済走 104〜106%（遅い）
  neural: { fast: 0.88, slow: 0.92 }, // レペティション/神経系 92〜88%
};

/**
 * 特異的セッションの設定タイムを算出する。
 * @param economyProgressWeek 経済走の導入週番号（0始まり）。導入期は106%から入り
 *   週ごとに段階的に104%へ寄せる（仕様書 4-2 注記）。
 */
export function specificPace(
  baseTime800Sec: number,
  category: SessionCategory,
  distanceM: number,
  economyProgressWeek?: number
): TargetPace {
  const ratios = GRP_RATIOS[category];
  if (!ratios) {
    throw new Error(`カテゴリ ${category} は特異的ペース計算の対象外`);
  }
  const grp = grpSecPerM(baseTime800Sec);

  let { fast, slow } = ratios;
  if (category === "race_economy" && economyProgressWeek !== undefined) {
    // 週0: 1.06 → 週ごとに 0.005 ずつ 1.04 へ
    const s = Math.max(1.04, 1.06 - economyProgressWeek * 0.005);
    slow = 1.06;
    fast = s;
  }

  return {
    distanceM,
    targetSecFast: distanceM * grp * fast,
    targetSecSlow: distanceM * grp * slow,
  };
}

// ---------------------------------------------------------------------------
// 神経系（400mPBから算出）
// ---------------------------------------------------------------------------

/**
 * 神経系の用途。同じ「神経系」でも、流しとレペでは狙う速度が違う。
 *
 * stride: 80〜150m。動きを作る。**全力ではない**
 * rep:    150〜300m。速度そのものを出す。完全休息で本数は少なく
 */
export type NeuralPurpose = "stride" | "rep";

/**
 * 用途ごとの、400mレースペースに対する比。
 * 1.0 より大きい = 400mペースより遅い。
 */
const NEURAL_RATIOS: Record<NeuralPurpose, { fast: number; slow: number }> = {
  // 流しは400mペースより 5〜12% 遅い。速すぎると「流し」ではなくなる
  stride: { fast: 1.05, slow: 1.12 },
  // レペは400mペース前後（2%速い〜5%遅い）。完全休息で1本ずつ出し切る
  rep: { fast: 0.98, slow: 1.05 },
};

/**
 * 神経系の設定タイム。
 *
 * **基準は400mPB。目標800mではない。**
 *
 * 以前は目標800m（GRP）の 0.88〜0.92 倍で出していた。これには2つの問題があった。
 *
 *   1. **流しが全力になっていた。**
 *      目標1:48.9 で 150m 18.0〜18.8秒。400mPB 49.0 の150m通過が18.4秒なので、
 *      400mレースペースそのものを「流し」として処方していた。
 *
 *   2. **目標を速くすると流しも速くなる**という逆転があった。
 *      流しは今の走力に紐づくもので、目標に紐づくものではない。
 *      目標を1:47に書き換えただけで流しが速くなるのは、根拠の無い変化。
 *
 * 400mPBが無いときだけ、これまでどおり目標800m基準へ落とす。
 * そのときは `isEstimated` を立てて、推定であることを画面に出す。
 */
export function neuralPace(
  distanceM: number,
  purpose: NeuralPurpose,
  opts: { pb400mSec?: number; fallbackBase800Sec: number }
): TargetPace {
  const pb = opts.pb400mSec;
  if (pb === undefined || pb <= 0) {
    // 400mPBが無い。これまでどおり目標800m基準（精度が出ないことを明示する）
    return { ...specificPace(opts.fallbackBase800Sec, "neural", distanceM), isEstimated: true };
  }
  const secPerM = pb / 400;
  const r = NEURAL_RATIOS[purpose];
  return {
    distanceM,
    targetSecFast: distanceM * secPerM * r.fast,
    targetSecSlow: distanceM * secPerM * r.slow,
  };
}

// ---------------------------------------------------------------------------
// 有酸素系（実測から算出）
// ---------------------------------------------------------------------------

export interface AerobicProfile {
  ltPaceSecPerKm: number; // 閾値ペース
  cvPaceSecPerKm: { fast: number; slow: number }; // LT + 6〜8秒/km 速い
  jogPaceSecPerKm: { fast: number; slow: number }; // LT + 60〜80秒/km 遅い
  longRunPaceSecPerKm: { fast: number; slow: number };
  isEstimated: boolean; // 実測データ不足時の推定フラグ
  sourceDescription: string;
  /** 2-4: 採用/除外したサンプルの内訳（監査用） */
  estimate?: LtEstimate;
  /** 2-5: 更新を促すメッセージ */
  refreshHint?: string;
  /** 実測の本数・用途・新しさから見た推定の信頼度 */
  confidence: "low" | "medium" | "high";
  /** CVをLT固定差、CV完遂実績、複数距離実測のどれから出したか */
  cvSourceDescription: string;
  cvEstimate?: CriticalVelocityEstimate;
}

/**
 * 2-4. FitnessMarker から LT ペースを推定する（改善版）
 *
 * 旧実装は「直近1本だけ」を見ていたため、たまたま調子の悪い1本や
 * 暑熱下の1本で設定全体が狂う問題があった。以下に変更する。
 *
 *  ① 直近8週間の閾値走・ペース走・距離走・CV走を複数参照する
 *  ② 暑熱条件フラグ付き・極端な外れ値を除外する
 *  ③ 直近ほど重みを大きくした重み付け平均でLTを推定する
 */

/** 種目別のLT換算補正（秒/km）。レースはLTより速いので遅い側へ補正する */
function ltOffsetFor(m: FitnessMarker, totalM: number): number {
  if (m.type === "race") {
    // 3000〜5000mのレースはLTよりおよそ10〜15秒/km速い
    return totalM >= 8000 ? 6 : 12;
  }
  if (m.purpose === "cv") {
    // CV実測はLTより速い。現行のCV処方幅（LTより6〜8秒/km速い）の
    // 中央値を逆算に使い、用途不明の走行には適用しない。
    return 7;
  }
  if (m.purpose === "threshold" || m.purpose === "tempo") return 0;
  // 旧データ互換: 用途未保存の長い練習だけ従来補正を残す。
  if (totalM >= 12000) return -8;
  return 0;
}

function effectivePurpose(m: FitnessMarker): FitnessMarkerPurpose {
  if (m.purpose) return m.purpose;
  if (m.type === "race") return "race";
  return "unknown";
}

function purposeExclusion(m: FitnessMarker): string | undefined {
  const purpose = effectivePurpose(m);
  if (purpose === "easy") return "イージー走はLT実測ではありません";
  if (purpose === "recovery") return "回復ジョグはLT実測ではありません";
  if (purpose === "long_run") return "ロングランはLT実測ではありません";
  if (purpose === "unknown" && (m.id.startsWith("past-fm-") || m.id.startsWith("ah-"))) {
    return "用途不明の自動取込（距離だけではLT走と判定できません）";
  }
  return undefined;
}

export interface LtSample {
  date: string;
  description: string;
  /** LT換算後のペース（秒/km） */
  ltPaceSecPerKm: number;
  totalM: number;
  ageDays: number;
  weight: number;
  excluded?: string; // 除外理由
  purpose: FitnessMarkerPurpose;
}

export interface LtEstimate {
  ltPaceSecPerKm: number;
  /** 採用したサンプル（監査用） */
  samples: LtSample[];
  excluded: LtSample[];
  source: string;
  /** 最終更新からの経過日数 */
  daysSinceLatest: number;
  confidence: "low" | "medium" | "high";
}

/** 直近ほど重い指数減衰の重み。半減期14日 */
function recencyWeight(ageDays: number): number {
  return Math.pow(0.5, ageDays / 14);
}

export function estimateLtFromMarkers(
  markers: FitnessMarker[],
  today: string,
  /** 2-1: 暑熱条件フラグが立っている日付の集合。該当日は除外する */
  heatFlaggedDates?: Set<string>
): LtEstimate | undefined {
  const raw: LtSample[] = [];

  for (const m of markers) {
    const age = diffDays(m.date, today);
    if (age < 0 || age > 56) continue; // 直近8週間のみ

    const dists = m.lapDistancesM ?? m.resultLapsSec.map(() => 1000);
    const totalM = dists.reduce((a, b) => a + b, 0);
    const totalSec = m.resultLapsSec.reduce((a, b) => a + b, 0);
    if (totalM < 3000 || totalSec <= 0) continue; // 持続的な走行のみ

    const pace = (totalSec / totalM) * 1000 + ltOffsetFor(m, totalM);
    const sample: LtSample = {
      date: m.date,
      description: m.description,
      ltPaceSecPerKm: pace,
      totalM,
      ageDays: age,
      weight: recencyWeight(age),
      purpose: effectivePurpose(m),
    };

    const excludedByPurpose = purposeExclusion(m);
    if (excludedByPurpose) {
      sample.excluded = excludedByPurpose;
      sample.weight = 0;
    } else if (heatFlaggedDates?.has(m.date)) {
      // ② 暑熱条件フラグ付きは除外
      sample.excluded = "暑熱条件フラグ";
      sample.weight = 0;
    }
    raw.push(sample);
  }

  if (raw.length === 0) return undefined;

  const usable = raw.filter((s) => !s.excluded);
  if (usable.length === 0) {
    return undefined; // すべて暑熱除外
  }

  // ② 外れ値除外: 中央値から ±25秒/km を超えるものを落とす
  //    （3本以上ある場合のみ。少数のときに落とすと推定不能になるため）
  const sorted = [...usable].sort((a, b) => a.ltPaceSecPerKm - b.ltPaceSecPerKm);
  const median = sorted[Math.floor(sorted.length / 2)].ltPaceSecPerKm;
  if (usable.length >= 3) {
    for (const s of usable) {
      if (Math.abs(s.ltPaceSecPerKm - median) > 25) {
        s.excluded = `外れ値（中央値${Math.round(median)}秒/kmから${Math.round(
          s.ltPaceSecPerKm - median
        )}秒差）`;
        s.weight = 0;
      }
    }
  }

  const adopted = usable.filter((s) => !s.excluded);
  if (adopted.length === 0) return undefined;

  // ③ 直近重視の重み付け平均
  const wsum = adopted.reduce((a, s) => a + s.weight, 0);
  const lt = adopted.reduce((a, s) => a + s.ltPaceSecPerKm * s.weight, 0) / wsum;

  const latest = adopted.reduce((a, s) => (s.ageDays < a.ageDays ? s : a), adopted[0]);
  const explicitPurposeCount = adopted.filter((s) => s.purpose !== "unknown").length;
  const confidence: LtEstimate["confidence"] =
    adopted.length >= 3 && explicitPurposeCount >= 2
      ? "high"
      : adopted.length >= 2 || explicitPurposeCount >= 1
        ? "medium"
        : "low";

  return {
    ltPaceSecPerKm: lt,
    samples: adopted,
    excluded: raw.filter((s) => s.excluded),
    source: `直近8週の実測${adopted.length}本の重み付け平均（最新: ${latest.date} ${latest.description}）`,
    daysSinceLatest: latest.ageDays,
    confidence,
  };
}

export interface CriticalVelocityEstimate {
  paceSecPerKm: number;
  samples: { date: string; description: string; distanceM: number; totalSec: number }[];
  source: string;
}

/**
 * 3000m〜5000mの異なる2距離のレース/テストから距離-時間直線の傾きを求める。
 * 1距離だけでは「LTから固定秒差」と区別できないため使わない。
 */
export function estimateCriticalVelocity(
  markers: FitnessMarker[],
  today: string,
  ltPaceSecPerKm: number,
  heatFlaggedDates?: Set<string>
): CriticalVelocityEstimate | undefined {
  const candidates = markers
    .map((marker) => {
      const distances = marker.lapDistancesM ?? marker.resultLapsSec.map(() => 1000);
      return {
        marker,
        ageDays: diffDays(marker.date, today),
        distanceM: distances.reduce((sum, value) => sum + value, 0),
        totalSec: marker.resultLapsSec.reduce((sum, value) => sum + value, 0),
      };
    })
    .filter(
      ({ marker, ageDays, distanceM, totalSec }) =>
        ageDays >= 0 &&
        ageDays <= 56 &&
        distanceM >= 3000 &&
        distanceM <= 5000 &&
        totalSec > 0 &&
        (marker.type === "race" || marker.type === "test") &&
        !heatFlaggedDates?.has(marker.date)
    )
    .sort((a, b) => b.marker.date.localeCompare(a.marker.date));

  const byDistance = new Map<number, (typeof candidates)[number]>();
  for (const candidate of candidates) {
    if (!byDistance.has(candidate.distanceM)) byDistance.set(candidate.distanceM, candidate);
  }
  const distinct = [...byDistance.values()].sort((a, b) => a.distanceM - b.distanceM);
  if (distinct.length < 2) return undefined;
  const slowDistance = distinct[0];
  const longDistance = distinct[distinct.length - 1];
  const deltaDistance = longDistance.distanceM - slowDistance.distanceM;
  const deltaTime = longDistance.totalSec - slowDistance.totalSec;
  if (deltaDistance <= 0 || deltaTime <= 0) return undefined;

  const pace = (deltaTime / deltaDistance) * 1000;
  // CVがLT以上に遅い、またはLTより20秒/km超速い結果は、距離/タイムの
  // 入力違いか2本の条件差が大きい可能性がある。値を丸めず固定差へ戻す。
  if (pace >= ltPaceSecPerKm || pace < ltPaceSecPerKm - 20) return undefined;

  const samples = [slowDistance, longDistance].map(({ marker, distanceM, totalSec }) => ({
    date: marker.date,
    description: marker.description,
    distanceM,
    totalSec,
  }));
  return {
    paceSecPerKm: pace,
    samples,
    source: `直近8週の異なる2距離（${samples
      .map((sample) => `${sample.distanceM}m`)
      .join("・")}）から距離-時間直線で算出`,
  };
}

/**
 * 本人がCVとして完遂した反復の実測ペースを、次のCV処方へ戻す。
 * これは生理学的なCritical Velocityの断定ではなく「成功した処方」の再利用。
 */
export function estimateCvPrescriptionFromMarkers(
  markers: FitnessMarker[],
  today: string,
  ltPaceSecPerKm: number,
  heatFlaggedDates?: Set<string>
): CriticalVelocityEstimate | undefined {
  const samples = markers
    .filter(
      (marker) =>
        marker.purpose === "cv" &&
        diffDays(marker.date, today) >= 0 &&
        diffDays(marker.date, today) <= 56 &&
        !heatFlaggedDates?.has(marker.date) &&
        (marker.rpe === undefined || marker.rpe <= 8)
    )
    .map((marker) => {
      const distances = marker.lapDistancesM ?? marker.resultLapsSec.map(() => 1000);
      const distanceM = distances.reduce((sum, distance) => sum + distance, 0);
      const totalSec = marker.resultLapsSec.reduce((sum, seconds) => sum + seconds, 0);
      return { marker, distanceM, totalSec };
    })
    .filter(({ distanceM, totalSec }) => distanceM >= 2400 && totalSec > 0)
    .map(({ marker, distanceM, totalSec }) => ({
      date: marker.date,
      description: marker.description,
      distanceM,
      totalSec,
      paceSecPerKm: (totalSec / distanceM) * 1000,
      weight: recencyWeight(diffDays(marker.date, today)),
    }))
    .filter(
      (sample) =>
        sample.paceSecPerKm < ltPaceSecPerKm &&
        sample.paceSecPerKm >= ltPaceSecPerKm - 20
    )
    .sort((a, b) => b.date.localeCompare(a.date));
  if (samples.length === 0) return undefined;
  const totalWeight = samples.reduce((sum, sample) => sum + sample.weight, 0);
  const paceSecPerKm =
    samples.reduce((sum, sample) => sum + sample.paceSecPerKm * sample.weight, 0) /
    totalWeight;
  return {
    paceSecPerKm,
    samples: samples.map(({ date, description, distanceM, totalSec }) => ({
      date,
      description,
      distanceM,
      totalSec,
    })),
    source: `直近8週の完遂CV実績${samples.length}件から処方ペースを算出（能力値の断定ではありません）`,
  };
}

/** 2-5. LTの更新を促すべきか（推奨更新頻度 3〜4週間） */
export const LT_REFRESH_DAYS = 28;

export function ltNeedsRefresh(est: LtEstimate | undefined): string | undefined {
  if (!est) return "有酸素の実測データがありません。閾値走かペース走の結果を1本入力してください。";
  if (est.daysSinceLatest >= LT_REFRESH_DAYS) {
    return `有酸素の実測が${est.daysSinceLatest}日前のものです。3〜4週ごとの更新を推奨します（設定ペースが現状と乖離している可能性）。`;
  }
  return undefined;
}

/**
 * 有酸素プロファイルを構築する。
 * 実測データが無い場合は CFE ベースの粗い推定値を使い、isEstimated を必ず立てる。
 */
export function buildAerobicProfile(
  markers: FitnessMarker[],
  today: string,
  cfe800Sec?: number,
  heatFlaggedDates?: Set<string>
): AerobicProfile {
  const est = estimateLtFromMarkers(markers, today, heatFlaggedDates);
  let lt: number;
  let isEstimated: boolean;
  let source: string;
  let confidence: AerobicProfile["confidence"];

  if (est) {
    lt = est.ltPaceSecPerKm;
    isEstimated = false;
    source = est.source;
    confidence = est.confidence;
  } else {
    // フォールバック: 800m能力からの粗い推定（精度が出ないことを明示する）
    // 中距離選手のLTはおおよそ 800mペースの 1.55〜1.65倍/km。中央値1.6を使用。
    const base = cfe800Sec ?? 112;
    lt = (base / 0.8) * 1.6;
    isEstimated = true;
    source = "実測データ不足のためCFEからの推定値（精度低。閾値走の実測入力を推奨）";
    confidence = "low";
  }
  const cvEstimate =
    estimateCriticalVelocity(markers, today, lt, heatFlaggedDates) ??
    estimateCvPrescriptionFromMarkers(markers, today, lt, heatFlaggedDates);
  const cv = cvEstimate
    ? { fast: cvEstimate.paceSecPerKm - 1, slow: cvEstimate.paceSecPerKm + 1 }
    : { fast: lt - 8, slow: lt - 6 };

  return {
    ltPaceSecPerKm: lt,
    cvPaceSecPerKm: cv,
    jogPaceSecPerKm: { fast: lt + 60, slow: lt + 80 },
    longRunPaceSecPerKm: { fast: lt + 60, slow: lt + 90 },
    isEstimated,
    sourceDescription: source,
    estimate: est,
    refreshHint: ltNeedsRefresh(est),
    confidence,
    cvSourceDescription:
      cvEstimate?.source ??
      "完遂CVまたは異なる距離のレース/テスト実測が不足しているためLTより6〜8秒/km速い暫定範囲",
    cvEstimate,
  };
}

/** RULE-13: グレーゾーン帯（LT+30〜50秒/km） */
export function isGrayZonePace(paceSecPerKm: number, ltPaceSecPerKm: number): boolean {
  const d = paceSecPerKm - ltPaceSecPerKm;
  return d >= 30 && d <= 50;
}
