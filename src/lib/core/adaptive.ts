/**
 * M-2 直近の状態に応じて内容と設定を随時変える
 *
 * 解こうとしている問題:
 * 設定ペースはCFEから作られるが、CFEは「能力の推定」であって
 * 「今日出せる値」ではない。両者がずれると設定が速すぎて実行できなくなり、
 * 実行できなかった実測がまたCFEに入って推定をさらに歪める。
 *
 * そこで両者を分ける。
 *   CFE       … 能力の推定。レース・実測から動く。ここは触らない
 *   設定ペース … 今日出せる値。直近の実行状況とその日の状態から動く
 *
 * 「実行できなかった」ことは能力低下とは限らない。暑かった、寝ていない、
 * 前日に別の練習が入った、そもそも設定が高すぎた。どれもCFEを下げる理由にはならない。
 * 設定だけを緩めて、CFEは実測（レース・TT）が出るまで動かさない。
 *
 * ただし緩めっぱなしにすると頭打ちになる。だから
 *   ・緩める幅に上限を置く（3%）
 *   ・直近3回とも設定より速ければ締める（締める側は保守的に1.5%）
 *   ・暑熱下の実測は判断材料から外す（環境要因なので M-9 が別に扱う）
 */
import type {
  DailyCheck,
  Session,
  SessionCategory,
  SessionChange,
  SessionResult,
  Signal,
  TargetPace,
} from "./types";
import { diffDays } from "./dates";
import { equivalentRepSec } from "./workoutLog";

// ---------------------------------------------------------------------------
// 閾値
// ---------------------------------------------------------------------------

/** 直近3回の平均乖離がこれを超えたら設定を緩める（指示書 M-2(a)） */
export const EASE_DEVIATION_SEC = 2.0;
/** 判断に使う直近の回数 */
export const TREND_SAMPLE_COUNT = 3;
/** 緩める側の上限。1回で3%以上動かすと別の練習になる */
export const MAX_EASE_PCT = 0.03;
/** 締める側の上限。速く走れた事実は能力の主張なので保守的に扱う */
export const MAX_TIGHTEN_PCT = 0.015;
/** その日の状態による調整の上限 */
export const MAX_DAILY_PCT = 0.02;
/** ジョグの心拍がベースラインからこれ以上高い状態が続けば疲労とみなす */
export const JOG_HR_FATIGUE_BPM = 4;

// ---------------------------------------------------------------------------
// (b)-1 直近のポイント練習の出来
// ---------------------------------------------------------------------------

export interface ExecutionSample {
  date: string;
  sessionId: string;
  category: SessionCategory;
  distanceM: number;
  targetSec: number;
  actualMeanSec: number;
  /** 1本あたりの乖離（秒）。正 = 設定より遅い */
  deviationSec: number;
  ratio: number;
  aborted: boolean;
  heatFlagged: boolean;
  achievement: SessionResult["achievement"];
  rpe: number;
  nextDayLegs?: SessionResult["nextDayLegs"];
  restSec?: number;
}

/** 実施タイムの平均。1本も無ければ undefined */
function meanRepSec(r: SessionResult): number | undefined {
  const interval = r.interval;
  const times = interval?.targetSec !== undefined && interval.distanceM > 0
    ? interval.results.map((rep) => equivalentRepSec(rep, interval.distanceM))
    : interval?.results.map((x) => x.actualSec) ?? r.actualLapsSec;
  if (!times || times.length === 0) return undefined;
  return times.reduce((a, b) => a + b, 0) / times.length;
}

function targetOf(session: Session, r: SessionResult): { targetSec: number; distanceM: number } | undefined {
  if (r.interval?.targetSec) {
    return { targetSec: r.interval.targetSec, distanceM: r.interval.distanceM };
  }
  const tp = session.targetPaces[0];
  if (!tp) return undefined;
  return { targetSec: (tp.targetSecFast + tp.targetSecSlow) / 2, distanceM: tp.distanceM };
}

/**
 * 直近の同カテゴリの実行状況を新しい順に取り出す。
 * 暑熱フラグの付いた日は環境要因なので判断材料から外す。
 */
export function executionSamples(
  sessions: Session[],
  results: SessionResult[],
  category: SessionCategory,
  before: string,
  limit: number = TREND_SAMPLE_COUNT,
  referenceSession?: Session,
  /**
   * セッション形式を変更した後のカテゴリ全体の傾向を見る場合だけ true。
   * 秒差ではなく target に対する ratio を主な補正根拠として扱う。
   */
  allowMixedDistances = false
): ExecutionSample[] {
  const byId = new Map(sessions.map((s) => [s.id, s]));
  const out: ExecutionSample[] = [];
  const referenceDistanceM = referenceSession?.targetPaces[0]?.distanceM;
  let selectedDistanceM = referenceDistanceM;
  const sorted = [...results].sort((a, b) => b.date.localeCompare(a.date));
  for (const r of sorted) {
    if (r.date >= before) continue;
    const s = byId.get(r.sessionId);
    if (!s || s.category !== category) continue;
    if (r.heatFlagged) continue;
    const t = targetOf(s, r);
    const actual = meanRepSec(r);
    if (!t || actual === undefined || t.targetSec <= 0) continue;
    if (!allowMixedDistances) {
      if (selectedDistanceM === undefined) selectedDistanceM = t.distanceM;
      if (t.distanceM !== selectedDistanceM) continue;
    }
    out.push({
      date: r.date,
      sessionId: r.sessionId,
      category,
      distanceM: t.distanceM,
      targetSec: t.targetSec,
      actualMeanSec: actual,
      deviationSec: actual - t.targetSec,
      ratio: actual / t.targetSec,
      aborted:
        r.aborted === true ||
        (r.completedReps !== undefined &&
          r.prescribedReps !== undefined &&
          r.completedReps < r.prescribedReps),
      heatFlagged: !!r.heatFlagged,
      achievement: r.achievement,
      rpe: r.rpe,
      nextDayLegs: r.nextDayLegs,
      restSec: r.interval?.restSec,
    });
    if (out.length >= limit) break;
  }
  return out;
}

export type TrendVerdict = "ease" | "tighten" | "hold";

export interface ExecutionTrend {
  samples: ExecutionSample[];
  meanDeviationSec: number;
  meanRatio: number;
  abortCount: number;
  underachievedCount: number;
  highStrainCount: number;
  verdict: TrendVerdict;
  /** 設定に掛ける倍率。1.02 = 2%緩める */
  factor: number;
  reason: string;
}

export function executionTrend(samples: ExecutionSample[]): ExecutionTrend {
  if (samples.length === 0) {
    return {
      samples,
      meanDeviationSec: 0,
      meanRatio: 1,
      abortCount: 0,
      underachievedCount: 0,
      highStrainCount: 0,
      verdict: "hold",
      factor: 1,
      reason: "同じカテゴリの実測がまだありません",
    };
  }
  const meanDeviationSec =
    samples.reduce((a, s) => a + s.deviationSec, 0) / samples.length;
  const meanRatio = samples.reduce((a, s) => a + s.ratio, 0) / samples.length;
  const abortCount = samples.filter((s) => s.aborted).length;
  const underachievedCount = samples.filter(
    (sample) => sample.achievement === "partial" || sample.achievement === "failed"
  ).length;
  const highStrainCount = samples.filter(
    (sample) => sample.rpe >= 9 || sample.nextDayLegs === "heavy"
  ).length;

  // 打ち切りが2回続いたら、設定が高すぎると判断する（M-3 と対）
  if (abortCount >= 2) {
    const factor = 1 + Math.min(MAX_EASE_PCT, Math.max(0.01, meanRatio - 1));
    return {
      samples,
      meanDeviationSec,
      meanRatio,
      abortCount,
      underachievedCount,
      highStrainCount,
      verdict: "ease",
      factor,
      reason: `直近${samples.length}回のうち${abortCount}回で打ち切りになっています。設定が高すぎます`,
    };
  }

  if (underachievedCount >= 2 || (underachievedCount >= 1 && highStrainCount >= 2)) {
    const factor = 1 + Math.min(MAX_EASE_PCT, Math.max(0.01, meanRatio - 1));
    return {
      samples,
      meanDeviationSec,
      meanRatio,
      abortCount,
      underachievedCount,
      highStrainCount,
      verdict: "ease",
      factor,
      reason: `同じ距離の直近${samples.length}回で未達${underachievedCount}回・高い負担反応${highStrainCount}回です`,
    };
  }

  if (samples.length >= TREND_SAMPLE_COUNT && meanDeviationSec > EASE_DEVIATION_SEC) {
    const factor = 1 + Math.min(MAX_EASE_PCT, meanRatio - 1);
    return {
      samples,
      meanDeviationSec,
      meanRatio,
      abortCount,
      underachievedCount,
      highStrainCount,
      verdict: "ease",
      factor,
      reason: `直近${samples.length}回の平均乖離が +${meanDeviationSec.toFixed(1)}秒/本（許容 ${EASE_DEVIATION_SEC.toFixed(1)}秒）`,
    };
  }

  if (
    samples.length >= TREND_SAMPLE_COUNT &&
    samples.every(
      (sample) =>
        sample.ratio < 1 &&
        sample.achievement === "achieved" &&
        sample.rpe <= 8 &&
        sample.nextDayLegs !== "heavy"
    )
  ) {
    const factor = 1 - Math.min(MAX_TIGHTEN_PCT, 1 - meanRatio);
    return {
      samples,
      meanDeviationSec,
      meanRatio,
      abortCount,
      underachievedCount,
      highStrainCount,
      verdict: "tighten",
      factor,
      reason: `直近${samples.length}回とも設定より速い（平均 ${meanDeviationSec.toFixed(1)}秒/本）`,
    };
  }

  return {
    samples,
    meanDeviationSec,
    meanRatio,
    abortCount,
    underachievedCount,
    highStrainCount,
    verdict: "hold",
    factor: 1,
    reason:
      samples.length < TREND_SAMPLE_COUNT
        ? `判断には直近${TREND_SAMPLE_COUNT}回が必要です（現在${samples.length}回）`
        : `平均乖離 ${meanDeviationSec >= 0 ? "+" : ""}${meanDeviationSec.toFixed(1)}秒/本。設定は据え置き`,
  };
}

// ---------------------------------------------------------------------------
// (b)-3 ジョグの結果を状態の測定値として使う
// ---------------------------------------------------------------------------

export interface JogEfficiency {
  recentMeanHr?: number;
  baselineMeanHr?: number;
  deltaBpm?: number;
  recentCount: number;
  baselineCount: number;
  fatigued: boolean;
  note: string;
}

/**
 * 同じペース帯のジョグで心拍がどう動いたか。
 *
 * ジョグを「消化した記録」ではなく「状態の測定値」として扱う。
 * 同じペースで心拍が高いのは、走力低下より先に疲労として出る。
 * ペース帯をそろえないと意味が無いので、全ジョグの中央ペース±20秒/kmに限る。
 */
export function jogEfficiency(
  results: SessionResult[],
  today: string
): JogEfficiency {
  const jogs = results
    .filter((r) => r.continuous?.avgHr && r.continuous.avgPaceSecPerKm > 0)
    .map((r) => ({
      date: r.date,
      hr: r.continuous!.avgHr!,
      pace: r.continuous!.avgPaceSecPerKm,
      age: diffDays(r.date, today),
    }))
    .filter((x) => x.age >= 0 && x.age <= 35);

  if (jogs.length < 4) {
    return {
      recentCount: jogs.length,
      baselineCount: 0,
      fatigued: false,
      note: "ジョグの心拍データが足りません（同じペース帯で4本以上必要）",
    };
  }

  const paces = jogs.map((x) => x.pace).sort((a, b) => a - b);
  const median = paces[Math.floor(paces.length / 2)];
  const band = jogs.filter((x) => Math.abs(x.pace - median) <= 20);

  const recent = band.filter((x) => x.age <= 7);
  const baseline = band.filter((x) => x.age > 7);
  if (recent.length < 2 || baseline.length < 2) {
    return {
      recentCount: recent.length,
      baselineCount: baseline.length,
      fatigued: false,
      note: `同じペース帯（${Math.round(median)}秒/km±20）の本数が足りません（直近${recent.length}本 / 比較${baseline.length}本）`,
    };
  }

  const recentMeanHr = recent.reduce((a, x) => a + x.hr, 0) / recent.length;
  const baselineMeanHr = baseline.reduce((a, x) => a + x.hr, 0) / baseline.length;
  const deltaBpm = recentMeanHr - baselineMeanHr;
  const fatigued = deltaBpm >= JOG_HR_FATIGUE_BPM;
  return {
    recentMeanHr,
    baselineMeanHr,
    deltaBpm,
    recentCount: recent.length,
    baselineCount: baseline.length,
    fatigued,
    note: fatigued
      ? `同じペース帯のジョグで平均心拍が ${deltaBpm.toFixed(0)}bpm 高い（${baselineMeanHr.toFixed(0)}→${recentMeanHr.toFixed(0)}）。疲労が抜けていません`
      : `同じペース帯のジョグの平均心拍は ${deltaBpm >= 0 ? "+" : ""}${deltaBpm.toFixed(0)}bpm（${baselineMeanHr.toFixed(0)}→${recentMeanHr.toFixed(0)}）`,
  };
}

// ---------------------------------------------------------------------------
// (b)-4 ポイント練習の心拍を状態の測定値として使う（Q-1）
// ---------------------------------------------------------------------------

/** ポイント練習の心拍が前回までより高い、と見なす差。ジョグ側と揃える */
export const QUALITY_HR_FATIGUE_BPM = 4;
/** 直近側・比較側それぞれに必要な本数 */
export const QUALITY_HR_MIN_EACH = 2;
/**
 * タイムがこれ以上速くなっていたら、心拍が上がっていても疲労とみなさない。
 * 速く走れば心拍は上がる。上がったことそのものを悪い材料にすると
 * 「速く走ったのに疲労と判定される」ことになる。
 */
const QUALITY_HR_FASTER_SEC = 0.3;

export interface QualityHrTrend {
  recentMeanHr?: number;
  baselineMeanHr?: number;
  deltaBpm?: number;
  /** 同じ期間のタイムの動き。負なら速くなっている */
  deltaSec?: number;
  recentCount: number;
  baselineCount: number;
  fatigued: boolean;
  note: string;
}

/**
 * 同じカテゴリ・同じ距離のポイント練習で、1本あたりの平均心拍がどう動いたか。
 *
 * ジョグ（jogEfficiency）と同じ考え方をポイント練習側にも置く。
 * 同じ設定で同じタイムなのに心拍が高いなら、こなせてはいても状態は落ちている。
 *
 * 日付の窓ではなく本数で区切る。ポイント練習は週1〜2本しかないので、
 * 「直近7日で2本」を条件にすると、ほとんどの週で材料が揃わない。
 */
export function qualityHrTrend(
  sessions: Session[],
  results: SessionResult[],
  category: SessionCategory,
  today: string
): QualityHrTrend {
  const byId = new Map(sessions.map((s) => [s.id, s]));
  const samples = results
    .filter((r) => {
      const s = byId.get(r.sessionId);
      return s?.category === category && !r.heatFlagged && !!r.interval;
    })
    .map((r) => {
      const hrs = (r.interval!.results ?? [])
        .map((x) => x.avgHr)
        .filter((v): v is number => typeof v === "number" && v > 0);
      const times = (r.interval!.results ?? [])
        .map((x) => x.actualSec)
        .filter((v) => typeof v === "number" && v > 0);
      return {
        date: r.date,
        distanceM: r.interval!.distanceM,
        hr: hrs.length > 0 ? hrs.reduce((a, b) => a + b, 0) / hrs.length : undefined,
        sec: times.length > 0 ? times.reduce((a, b) => a + b, 0) / times.length : undefined,
        age: diffDays(r.date, today),
      };
    })
    .filter((x) => x.hr !== undefined && x.sec !== undefined && x.age >= 0 && x.age <= 35)
    .sort((a, b) => b.date.localeCompare(a.date));

  // 距離が違うと心拍の出方も違う。最も本数の多い距離だけで比べる
  const counts = new Map<number, number>();
  for (const x of samples) counts.set(x.distanceM, (counts.get(x.distanceM) ?? 0) + 1);
  let best: number | undefined;
  for (const [d, n] of counts) if (best === undefined || n > counts.get(best)!) best = d;
  const band = samples.filter((x) => x.distanceM === best);

  if (band.length < QUALITY_HR_MIN_EACH * 2) {
    return {
      recentCount: band.length,
      baselineCount: 0,
      fatigued: false,
      note: `ポイント練習の心拍データが足りません（同じ距離で${QUALITY_HR_MIN_EACH * 2}本以上必要）`,
    };
  }

  const recent = band.slice(0, QUALITY_HR_MIN_EACH);
  const baseline = band.slice(QUALITY_HR_MIN_EACH);
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const recentMeanHr = mean(recent.map((x) => x.hr!));
  const baselineMeanHr = mean(baseline.map((x) => x.hr!));
  const deltaBpm = recentMeanHr - baselineMeanHr;
  const deltaSec = mean(recent.map((x) => x.sec!)) - mean(baseline.map((x) => x.sec!));

  const faster = deltaSec <= -QUALITY_HR_FASTER_SEC;
  const fatigued = deltaBpm >= QUALITY_HR_FATIGUE_BPM && !faster;

  const hrPart = `${best}mの平均心拍が ${deltaBpm >= 0 ? "+" : ""}${deltaBpm.toFixed(0)}bpm（${baselineMeanHr.toFixed(0)}→${recentMeanHr.toFixed(0)}）`;
  const secPart = `タイムは ${deltaSec >= 0 ? "+" : ""}${deltaSec.toFixed(1)}秒/本`;
  return {
    recentMeanHr,
    baselineMeanHr,
    deltaBpm,
    deltaSec,
    recentCount: recent.length,
    baselineCount: baseline.length,
    fatigued,
    note: fatigued
      ? `同じ${hrPart}、${secPart}。こなせてはいますが状態は落ちています`
      : faster && deltaBpm >= QUALITY_HR_FATIGUE_BPM
      ? `${hrPart}。ただし${secPart}なので、速く走ったぶんとして扱います`
      : `${hrPart}、${secPart}`,
  };
}

// ---------------------------------------------------------------------------
// (b)-2 その日の状態
// ---------------------------------------------------------------------------

export interface DailyAdjustment {
  /** 設定に掛ける倍率。1.01 = 1%緩める */
  factor: number;
  /** 本数の増減。-1 = 1本減らす */
  repDelta: number;
  /** 本数に掛ける倍率（黄信号の30%減など） */
  repFactor: number;
  /** true = この日に質を入れない */
  blocked: boolean;
  reasons: string[];
}

/**
 * その日のコンディションから調整量を出す。
 *
 * 黄信号で「強度を落とさず量を30%減らす」のは既存のルールに合わせている。
 * ここで強度側も落とすと、同じ状態に対してルールエンジンと違う指示が出る。
 */
export function dailyAdjustment(
  check: DailyCheck | undefined,
  signal: Signal,
  jog?: JogEfficiency,
  restingHrBaseline?: number,
  /** Q-1: ポイント練習側の心拍。ジョグと同じ重みで扱う */
  qualityHr?: QualityHrTrend
): DailyAdjustment {
  const reasons: string[] = [];
  let pct = 0;
  let repFactor = 1;

  if (signal === "red") {
    return {
      factor: 1,
      repDelta: 0,
      repFactor: 0,
      blocked: true,
      reasons: ["赤信号。この日に高負荷練習は入れません"],
    };
  }
  if (signal === "yellow") {
    repFactor = 0.7;
    reasons.push("黄信号。強度は維持したまま量を30%減らします");
  }

  if (check) {
    if ((check.legFatigue ?? 0) >= 4) {
      pct += 0.01;
      reasons.push(`脚の疲労 ${check.legFatigue}/5`);
    }
    if ((check.overallFatigue ?? 0) >= 4) {
      pct += 0.01;
      reasons.push(`全身疲労 ${check.overallFatigue}/5`);
    }
    if (check.sleepQuality !== undefined && check.sleepQuality <= 2) {
      pct += 0.005;
      reasons.push(`睡眠 ${check.sleepQuality}/5`);
    }
    if (
      check.restingHr !== undefined &&
      restingHrBaseline !== undefined &&
      check.restingHr - restingHrBaseline >= 5
    ) {
      pct += 0.01;
      reasons.push(
        `安静時HR ${check.restingHr}（平常 ${Math.round(restingHrBaseline)} から +${Math.round(check.restingHr - restingHrBaseline)}）`
      );
    }
  }

  if (jog?.fatigued) {
    pct += 0.005;
    reasons.push(jog.note);
  }

  // Q-1: ポイント練習の心拍。ジョグと同じ扱い（合計は MAX_DAILY_PCT で頭打ち）
  if (qualityHr?.fatigued) {
    pct += 0.005;
    reasons.push(qualityHr.note);
  }

  const capped = Math.min(MAX_DAILY_PCT, pct);
  return {
    factor: 1 + capped,
    repDelta: 0,
    repFactor,
    blocked: false,
    reasons,
  };
}

// ---------------------------------------------------------------------------
// (c)(d) 次のポイント練習を作り直す
// ---------------------------------------------------------------------------

export interface PrescriptionProposal {
  sessionId: string;
  date: string;
  category: SessionCategory;
  /** 元の処方（表示用） */
  beforePrescription: string;
  afterPrescription: string;
  beforePaces: TargetPace[];
  afterPaces: TargetPace[];
  beforeReps?: number;
  afterReps?: number;
  /** 1本あたり何秒緩めた／締めたか（代表距離での値） */
  offsetSecPerRep: number;
  blocked: boolean;
  reasons: string[];
  changes: SessionChange[];
  /** 何も変わらないなら false。画面に出す必要が無い */
  hasChange: boolean;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/** 処方の文字列に含まれる設定タイムを書き換える代わりに、注記を足す */
function annotate(prescription: string, note: string): string {
  return `${prescription}${note ? `\n${note}` : ""}`;
}

export interface AdjustInput {
  session: Session;
  trend: ExecutionTrend;
  daily: DailyAdjustment;
  /** M-9 暑熱補正の倍率。1.02 = 2%緩める */
  heatFactor?: number;
  heatNote?: string;
  /** 本数の下限。これを下回るならセッションとして成立しない */
  minReps?: number;
}

/**
 * 設定と本数を作り直す。
 *
 * 何をどれだけ動かしたかを必ず reasons に残す。
 * 黙って数値を書き換えると、次に未達だったときに
 * 「設定が下がったからできたのか、実力が上がったのか」が判別できなくなる。
 */
export function adjustPrescription(input: AdjustInput): PrescriptionProposal {
  const { session, trend, daily, heatFactor = 1, heatNote, minReps = 2 } = input;
  const reasons: string[] = [];
  const changes: SessionChange[] = [];

  const factor = trend.factor * daily.factor * heatFactor;
  const beforePaces = session.targetPaces;
  const afterPaces = beforePaces.map((tp) => ({
    ...tp,
    targetSecFast: round1(tp.targetSecFast * factor),
    targetSecSlow: round1(tp.targetSecSlow * factor),
  }));

  if (trend.verdict !== "hold") {
    reasons.push(
      `${trend.verdict === "ease" ? "設定を緩めます" : "設定を締めます"}: ${trend.reason}`
    );
  }
  reasons.push(...daily.reasons);
  if (heatFactor !== 1 && heatNote) reasons.push(heatNote);

  // 本数
  const beforeReps = repsOf(session);
  let afterReps = beforeReps;
  if (beforeReps !== undefined && daily.repFactor !== 1) {
    afterReps = Math.max(minReps, Math.round(beforeReps * daily.repFactor));
  }

  const rep = beforePaces[0];
  const offsetSecPerRep = rep
    ? round1(
        (afterPaces[0].targetSecFast + afterPaces[0].targetSecSlow) / 2 -
          (rep.targetSecFast + rep.targetSecSlow) / 2
      )
    : 0;

  const paceChanged = Math.abs(offsetSecPerRep) >= 0.1;
  const repsChanged = afterReps !== beforeReps;

  if (paceChanged && rep) {
    changes.push({
      sessionId: session.id,
      field: "targetPaces",
      before: `${rep.targetSecFast.toFixed(1)}〜${rep.targetSecSlow.toFixed(1)}秒/${rep.distanceM}m`,
      after: `${afterPaces[0].targetSecFast.toFixed(1)}〜${afterPaces[0].targetSecSlow.toFixed(1)}秒/${afterPaces[0].distanceM}m`,
      reason: reasons.join(" / "),
      triggeredBy: "M-2",
      direction: offsetSecPerRep > 0 ? "down" : "up",
      action: "modify",
    });
  }
  if (repsChanged && beforeReps !== undefined && afterReps !== undefined) {
    changes.push({
      sessionId: session.id,
      field: "reps",
      before: beforeReps,
      after: afterReps,
      reason: daily.reasons.join(" / ") || "当日の状態による本数調整",
      triggeredBy: "M-2",
      direction: afterReps < beforeReps ? "down" : "up",
      action: "modify",
    });
  }

  const noteLines: string[] = [];
  if (paceChanged)
    noteLines.push(
      `設定を1本あたり ${offsetSecPerRep > 0 ? "+" : ""}${offsetSecPerRep.toFixed(1)}秒 調整`
    );
  if (repsChanged) noteLines.push(`本数 ${beforeReps} → ${afterReps}`);

  return {
    sessionId: session.id,
    date: session.date,
    category: session.category,
    beforePrescription: session.prescription,
    afterPrescription: annotate(session.prescription, noteLines.join(" / ")),
    beforePaces,
    afterPaces,
    beforeReps,
    afterReps,
    offsetSecPerRep,
    blocked: daily.blocked,
    reasons,
    changes,
    hasChange: paceChanged || repsChanged || daily.blocked,
  };
}

/** 処方文字列から本数を読む（「300m × 4」「1000m×4」いずれも） */
export function repsOf(session: Session): number | undefined {
  const m = /×\s*(\d+)|x\s*(\d+)/.exec(session.prescription);
  if (!m) return undefined;
  const n = Number(m[1] ?? m[2]);
  return isFinite(n) && n > 0 ? n : undefined;
}
