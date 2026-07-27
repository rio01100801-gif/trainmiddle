/**
 * Apple Health 連携（エクスポートファイルの取り込み）
 *
 * ■ 方式の選定理由（重要）
 * HealthKit の API は iOS ネイティブ専用で、Safari / PWA からは呼び出せない。
 * これはコードで回避できるものではなく、プラットフォームの制約である。
 * そのため本アプリでは、iPhone の「ヘルスケア」アプリが標準で書き出せる
 * エクスポート（書き出したデータ.zip 内の export.xml）を取り込む方式を採る。
 * 開発者アカウントもネイティブアプリも不要で、今日から使える唯一の経路。
 *
 * ■ 設計思想（要望9に対応）
 * 取り込んだデータを「表示する」ことは目的ではない。
 * 睡眠・安静時HR・HRV → 疲労シグナル
 * ワークアウト（距離・時間・HR） → FitnessMarker → LT推定 → CFE / ACWR
 * へ変換することを目的とする。Apple Health はあくまでセンサー。
 */
import type { DailyCheck, FitnessMarker } from "./types";

// ---------------------------------------------------------------------------
// プロバイダ抽象（要望8: 将来 garmin / coros / polar を足せる形にする）
// ---------------------------------------------------------------------------

export type HealthProvider = "apple_health" | "garmin" | "coros" | "polar";

export const PROVIDER_LABELS: Record<HealthProvider, string> = {
  apple_health: "Apple ヘルスケア",
  garmin: "Garmin（未対応）",
  coros: "COROS（未対応）",
  polar: "Polar（未対応）",
};

export interface SyncRecord {
  provider: HealthProvider;
  syncedAt: string; // ISO
  /** 取り込んだ件数 */
  workouts: number;
  dailyChecks: number;
  /** 取り込んだデータの期間 */
  fromDate?: string;
  toDate?: string;
  note?: string;
}

// ---------------------------------------------------------------------------
// パース結果
// ---------------------------------------------------------------------------

export interface HealthDaily {
  date: string;
  restingHr?: number;
  hrvSdnnMs?: number;
  sleepHours?: number;
  sleepStartTime?: string;
  sleepEndTime?: string;
  steps?: number;
}

export interface HealthWorkout {
  date: string;
  activityType: string;
  durationMin: number;
  distanceKm?: number;
  avgHr?: number;
  maxHr?: number;
  energyKcal?: number;
}

export interface HealthImportResult {
  daily: HealthDaily[];
  workouts: HealthWorkout[];
  /** 取得できなかった項目（要望4: 取得できない場合は無視する） */
  missing: string[];
  fromDate?: string;
  toDate?: string;
}

// ---------------------------------------------------------------------------
// パーサ
// ---------------------------------------------------------------------------

/** "2026-07-24 07:32:00 +0900" → "2026-07-24"（端末ローカル日付をそのまま採用） */
function dateOf(attr: string): string {
  return attr.slice(0, 10);
}

/**
 * Apple Health の日時 "2026-07-24 07:32:00 +0900" を epoch ms にする。
 * Date.parse はこの空白区切り＋オフセット形式を確実には解釈しないため、
 * ISO 8601 形式に整えてから渡す。
 */
function parseHealthDate(attr: string): number {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})\s*([+-]\d{2}:?\d{2})?$/.exec(
    attr.trim()
  );
  if (!m) return NaN;
  const tz = m[3] ? (m[3].includes(":") ? m[3] : `${m[3].slice(0, 3)}:${m[3].slice(3)}`) : "Z";
  return Date.parse(`${m[1]}T${m[2]}${tz}`);
}

function num(v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  const n = Number(v);
  return isFinite(n) ? n : undefined;
}

const ATTR = (s: string, name: string): string | undefined => {
  const m = new RegExp(`${name}="([^"]*)"`).exec(s);
  return m ? m[1] : undefined;
};

/**
 * export.xml のテキストから必要なレコードだけを抽出する。
 * ファイルは数百MBになりうるため、正規表現で必要な行だけを拾い、
 * cutoffDate より古いものは捨ててメモリを抑える。
 */
export function parseAppleHealthExport(
  xml: string,
  opts: { cutoffDate?: string } = {}
): HealthImportResult {
  const cutoff = opts.cutoffDate;
  const dailyMap = new Map<string, HealthDaily>();
  const workouts: HealthWorkout[] = [];
  const seen = new Set<string>();

  const touch = (date: string): HealthDaily => {
    let d = dailyMap.get(date);
    if (!d) {
      d = { date };
      dailyMap.set(date, d);
    }
    return d;
  };

  // --- Record 要素（安静時HR / HRV / 睡眠 / 歩数） ---
  const recordRe = /<Record\b[^>]*\/?>/g;
  let m: RegExpExecArray | null;
  const sleepSpans: { date: string; start: string; end: string; ms: number }[] = [];

  while ((m = recordRe.exec(xml)) !== null) {
    const tag = m[0];
    const type = ATTR(tag, "type");
    if (!type) continue;
    const startDate = ATTR(tag, "startDate");
    if (!startDate) continue;
    const date = dateOf(startDate);
    if (cutoff && date < cutoff) continue;

    switch (type) {
      case "HKQuantityTypeIdentifierRestingHeartRate": {
        const v = num(ATTR(tag, "value"));
        if (v !== undefined) {
          touch(date).restingHr = v;
          seen.add("restingHr");
        }
        break;
      }
      case "HKQuantityTypeIdentifierHeartRateVariabilitySDNN": {
        const v = num(ATTR(tag, "value"));
        if (v !== undefined) {
          touch(date).hrvSdnnMs = v;
          seen.add("hrv");
        }
        break;
      }
      case "HKQuantityTypeIdentifierStepCount": {
        const v = num(ATTR(tag, "value"));
        if (v !== undefined) {
          const d = touch(date);
          d.steps = (d.steps ?? 0) + v;
          seen.add("steps");
        }
        break;
      }
      case "HKCategoryTypeIdentifierSleepAnalysis": {
        const value = ATTR(tag, "value") ?? "";
        // "InBed" は実睡眠ではないので除外し、Asleep* のみを合算する
        if (!/Asleep/.test(value)) break;
        const end = ATTR(tag, "endDate");
        if (!end) break;
        const ms = parseHealthDate(end) - parseHealthDate(startDate);
        if (!isFinite(ms) || ms <= 0) break;
        // 就寝が日をまたぐため、起床日（endDate）側の日付に寄せる
        sleepSpans.push({ date: dateOf(end), start: startDate, end, ms });
        seen.add("sleep");
        break;
      }
    }
  }

  for (const sp of sleepSpans) {
    const d = touch(sp.date);
    d.sleepHours = (d.sleepHours ?? 0) + sp.ms / 3600000;
    if (!d.sleepStartTime || sp.start < d.sleepStartTime) d.sleepStartTime = sp.start;
    if (!d.sleepEndTime || sp.end > d.sleepEndTime) d.sleepEndTime = sp.end;
  }

  // --- Workout 要素 ---
  const workoutRe = /<Workout\b[^>]*(?:\/>|>[\s\S]*?<\/Workout>)/g;
  while ((m = workoutRe.exec(xml)) !== null) {
    const block = m[0];
    const startDate = ATTR(block, "startDate");
    if (!startDate) continue;
    const date = dateOf(startDate);
    if (cutoff && date < cutoff) continue;

    const activityType = (ATTR(block, "workoutActivityType") ?? "").replace(
      "HKWorkoutActivityType",
      ""
    );
    let durationMin = num(ATTR(block, "duration")) ?? 0;
    if ((ATTR(block, "durationUnit") ?? "min") === "s") durationMin /= 60;

    let distanceKm = num(ATTR(block, "totalDistance"));
    const distUnit = ATTR(block, "totalDistanceUnit") ?? "km";
    if (distanceKm !== undefined && distUnit === "mi") distanceKm *= 1.609344;
    if (distanceKm !== undefined && distUnit === "m") distanceKm /= 1000;

    // 新しい書式では心拍が WorkoutStatistics に入る
    const avgHr =
      num(/type="HKQuantityTypeIdentifierHeartRate"[^>]*average="([\d.]+)"/.exec(block)?.[1]) ??
      undefined;
    const maxHr =
      num(/type="HKQuantityTypeIdentifierHeartRate"[^>]*maximum="([\d.]+)"/.exec(block)?.[1]) ??
      undefined;
    const energyKcal =
      num(ATTR(block, "totalEnergyBurned")) ??
      num(
        /type="HKQuantityTypeIdentifierActiveEnergyBurned"[^>]*sum="([\d.]+)"/.exec(block)?.[1]
      );

    if (avgHr !== undefined) seen.add("workoutHr");
    seen.add("workout");
    workouts.push({ date, activityType, durationMin, distanceKm, avgHr, maxHr, energyKcal });
  }

  const daily = [...dailyMap.values()].sort((a, b) => a.date.localeCompare(b.date));
  const allDates = [...daily.map((d) => d.date), ...workouts.map((w) => w.date)].sort();

  const missing: string[] = [];
  if (!seen.has("restingHr")) missing.push("安静時心拍");
  if (!seen.has("hrv")) missing.push("HRV");
  if (!seen.has("sleep")) missing.push("睡眠");
  if (!seen.has("workout")) missing.push("ワークアウト");
  if (!seen.has("workoutHr")) missing.push("ワークアウト中の心拍");

  return {
    daily,
    workouts,
    missing,
    fromDate: allDates[0],
    toDate: allDates[allDates.length - 1],
  };
}

// ---------------------------------------------------------------------------
// 変換: Apple Health → アプリの分析エンジンへの入力
// ---------------------------------------------------------------------------

/** 睡眠時間(h) → 睡眠状態スコア 1〜5（5=良い） */
export function sleepHoursToScore(h: number): number {
  if (h >= 8) return 5;
  if (h >= 7) return 4;
  if (h >= 6) return 3;
  if (h >= 5) return 2;
  return 1;
}

/**
 * HealthDaily → DailyCheck。
 * 主観入力（脚の疲労・モチベーション）は上書きしない。
 * センサーで取れるもの（安静時HR・睡眠）だけを埋め、主観は本人の入力を尊重する。
 */
export function toDailyCheck(h: HealthDaily, existing?: DailyCheck): DailyCheck {
  return {
    ...(existing ?? { date: h.date }),
    date: h.date,
    restingHr: h.restingHr ?? existing?.restingHr,
    sleepQuality:
      h.sleepHours !== undefined ? sleepHoursToScore(h.sleepHours) : existing?.sleepQuality,
  };
}

/** ランニングのワークアウト種別か（自転車・水泳等はLT推定に使わない） */
export function isRunning(activityType: string): boolean {
  return /Running|TrackAndField|CrossCountrySkiing/i.test(activityType);
}

/**
 * HealthWorkout → FitnessMarker。
 * 3km以上のランニングのみを対象にする（LT推定は持続走が前提のため）。
 */
export function toFitnessMarker(w: HealthWorkout): FitnessMarker | undefined {
  if (!isRunning(w.activityType)) return undefined;
  if (!w.distanceKm || w.distanceKm < 3) return undefined;
  if (!w.durationMin || w.durationMin <= 0) return undefined;
  return {
    id: `ah-${w.date}-${Math.round(w.distanceKm * 100)}`,
    date: w.date,
    type: "workout",
    description: `${w.distanceKm.toFixed(1)}km ランニング（Apple ヘルスケア）`,
    resultLapsSec: [w.durationMin * 60],
    lapDistancesM: [w.distanceKm * 1000],
    avgHr: w.avgHr ? Math.round(w.avgHr) : undefined,
    maxHr: w.maxHr ? Math.round(w.maxHr) : undefined,
    // HealthKitのワークアウト種別だけでは、閾値走か回復ジョグかを判別できない。
    // 距離だけでLT材料にせず、本人が用途を確認できるまでunknownとして保存する。
    purpose: "unknown",
  };
}

/**
 * HRV と 安静時HR から自律神経の状態を評価する。
 * 疲労シグナル（4-5-8）の補助入力として使う。
 * HRVは個人差が非常に大きいため、絶対値ではなく本人のベースラインとの比で見る。
 */
export function hrvDeviation(
  todayHrv: number | undefined,
  history: { date: string; hrvSdnnMs?: number }[]
): { deviationPct?: number; note?: string } {
  if (todayHrv === undefined) return {};
  const past = history
    .map((h) => h.hrvSdnnMs)
    .filter((v): v is number => typeof v === "number");
  if (past.length < 7) {
    return { note: "HRVのベースライン算出には7日以上の記録が必要です" };
  }
  const sorted = [...past].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  if (median <= 0) return {};
  const dev = ((todayHrv - median) / median) * 100;
  let note: string | undefined;
  if (dev <= -20) {
    note = `HRVがベースラインより${Math.abs(dev).toFixed(0)}%低下（自律神経の疲労兆候）`;
  } else if (dev >= 20) {
    note = `HRVがベースラインより${dev.toFixed(0)}%高い（回復良好）`;
  }
  return { deviationPct: dev, note };
}
