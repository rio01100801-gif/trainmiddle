/**
 * FIT取込 Phase 2: ファイルの解析（file_id / session / lap / record / event / sport
 * を区別する。ラップを「疾走本数」と断定する区間復元はPhase 3）。
 *
 * 解析には `fit-file-parser`（MIT）を使う。理由は README を参照。
 * 単位変換はライブラリのオプション（`lengthUnit: "km"` / `speedUnit: "km/h"`）に
 * 任せ、そこからFORGEの単位（km・秒/km・UTC ISO文字列）へ変換する。
 *
 * 読めなかった値・異常な値（NaN・Infinity・負数・ゼロ除算）は推測で埋めず
 * `undefined` にする。何を読めなかったかは `warnings` に残す。
 */
import FitParser from "fit-file-parser";

export interface FitParseWarning {
  code: string;
  message: string;
}

/**
 * ランニングダイナミクス系の共通フィールド。
 *
 * FITのcadence系フィールドはランニングでは片脚分（rpm）で記録される
 * （Garmin FIT SDKの既知の仕様。多くのランニングアプリ・解析ツールが
 * 同様に2倍して「歩数/分」として表示する）。ここでは2倍したうえで
 * spm（歩数/分）として持つ。デバイスが対応していない場合、これらの
 * フィールドはFIT側に存在しないため、常にundefined（推測で埋めない）。
 */
export interface FitDynamics {
  avgCadenceSpm?: number;
  maxCadenceSpm?: number;
  avgTemperatureC?: number;
  maxTemperatureC?: number;
  /** 上下動（mm） */
  avgVerticalOscillationMm?: number;
  /** 接地時間（ms） */
  avgGroundContactTimeMs?: number;
  /** ストライド長（m） */
  avgStepLengthM?: number;
}

export interface FitParseSession extends FitDynamics {
  sport?: string;
  startTimeUtc?: string;
  endTimeUtc?: string;
  totalElapsedSec?: number;
  /** 総経過時間との差が停止時間に相当する */
  totalTimerSec?: number;
  totalDistanceKm?: number;
  avgHr?: number;
  maxHr?: number;
}

export interface FitParseLap extends FitDynamics {
  index: number;
  startTimeUtc?: string;
  endTimeUtc?: string;
  elapsedSec?: number;
  /** 一時停止を除く実動時間。ペース・練習負荷の計算ではこちらを優先する。 */
  timerSec?: number;
  distanceKm?: number;
  avgHr?: number;
  maxHr?: number;
}

export interface FitParseRecord {
  timeUtc?: string;
  distanceKm?: number;
  /** 秒/km。FORGEの内部表現に合わせる（km/hのまま持たない） */
  paceSecPerKm?: number;
  hr?: number;
  cadenceSpm?: number;
  temperatureC?: number;
  verticalOscillationMm?: number;
  groundContactTimeMs?: number;
  stepLengthM?: number;
}

export interface FitParseResult {
  fileType?: string;
  manufacturer?: string;
  timeCreatedUtc?: string;
  activityTimestampUtc?: string;
  /**
   * activityメッセージの timestamp（UTC）と local_timestamp（デバイス側の
   * ローカル時刻）の差から求めたUTCオフセット（秒）。local_timestampが
   * 無ければ求めようがないため未確定のままにする（推測しない）。
   */
  utcOffsetSec?: number;
  sessions: FitParseSession[];
  laps: FitParseLap[];
  records: FitParseRecord[];
  /** eventメッセージの件数。Phase 3の区間復元で使う */
  eventCount: number;
  /** developer field（未知の拡張フィールド）が含まれていたか */
  hasDeveloperFields: boolean;
  warnings: FitParseWarning[];
}

/** NaN・Infinity・負数（許可しない場合）を推測で丸めず、読めなかった扱いにする */
function safeNumber(
  value: unknown,
  options: { allowZero?: boolean; allowNegative?: boolean } = {}
): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (!options.allowNegative && value < 0) return undefined;
  if (!options.allowZero && value === 0) return undefined;
  return value;
}

/**
 * FITのランニングcadenceは片脚分（rpm）で記録される（Garmin FIT SDKの既知の仕様）。
 * 実際の歩数/分（spm）にするため2倍する。他の主要な解析ツールも同様に扱う。
 */
const RUNNING_CADENCE_LEGS = 2;

function cadenceSpm(value: unknown): number | undefined {
  const v = safeNumber(value);
  return v === undefined ? undefined : v * RUNNING_CADENCE_LEGS;
}

/** ストライド長はFIT上はmm。表示単位のmに変換する */
function stepLengthM(value: unknown): number | undefined {
  const v = safeNumber(value);
  return v === undefined ? undefined : v / 1000;
}

/** fit-file-parserの生出力（session/lapメッセージ）のうち、ダイナミクス系フィールドだけの形 */
interface RawDynamicsFields {
  avg_cadence?: unknown;
  max_cadence?: unknown;
  avg_temperature?: unknown;
  max_temperature?: unknown;
  avg_vertical_oscillation?: unknown;
  avg_stance_time?: unknown;
  avg_step_length?: unknown;
}

function dynamicsOf(src: RawDynamicsFields): FitDynamics {
  return {
    avgCadenceSpm: cadenceSpm(src.avg_cadence),
    maxCadenceSpm: cadenceSpm(src.max_cadence),
    avgTemperatureC: safeNumber(src.avg_temperature, { allowZero: true, allowNegative: true }),
    maxTemperatureC: safeNumber(src.max_temperature, { allowZero: true, allowNegative: true }),
    avgVerticalOscillationMm: safeNumber(src.avg_vertical_oscillation),
    avgGroundContactTimeMs: safeNumber(src.avg_stance_time),
    avgStepLengthM: stepLengthM(src.avg_step_length),
  };
}

function toIso(value: unknown): string | undefined {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  }
  return undefined;
}

export async function parseFitFile(bytes: Uint8Array): Promise<FitParseResult> {
  const parser = new FitParser({
    mode: "list",
    lengthUnit: "km",
    speedUnit: "km/h",
  });

  /*
   * fit-file-parser は Node.js Buffer と ArrayBuffer の両方を受ける。
   * ここでは Buffer グローバル（ブラウザに存在しない）に依存しないよう
   * ArrayBuffer を渡す。PWAビルド（bunによるesbuildバンドル）でも
   * Node固有APIへの依存を増やさないため。
   */
  const arrayBuffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(arrayBuffer).set(bytes);
  const data: any = await parser.parseAsync(arrayBuffer);

  const warnings: FitParseWarning[] = [];
  const fileId = data.file_ids?.[0];
  const activity = data.activity;

  let utcOffsetSec: number | undefined;
  if (activity?.timestamp && activity?.local_timestamp) {
    const utcMs = new Date(activity.timestamp).getTime();
    const localMs = new Date(activity.local_timestamp).getTime();
    if (Number.isFinite(utcMs) && Number.isFinite(localMs)) {
      utcOffsetSec = Math.round((localMs - utcMs) / 1000);
    }
  } else {
    warnings.push({
      code: "no_local_timestamp",
      message: "local_timestampが無く、記録デバイスのタイムゾーンを確認できません。",
    });
  }

  const sessions: FitParseSession[] = (data.sessions ?? []).map((s: any) => ({
    sport: typeof s.sport === "string" ? s.sport : undefined,
    startTimeUtc: toIso(s.start_time),
    endTimeUtc: toIso(s.timestamp),
    totalElapsedSec: safeNumber(s.total_elapsed_time, { allowZero: true }),
    totalTimerSec: safeNumber(s.total_timer_time, { allowZero: true }),
    totalDistanceKm: safeNumber(s.total_distance, { allowZero: true }),
    avgHr: safeNumber(s.avg_heart_rate),
    maxHr: safeNumber(s.max_heart_rate),
    ...dynamicsOf(s),
  }));

  const laps: FitParseLap[] = (data.laps ?? []).map((l: any, index: number) => ({
    index,
    startTimeUtc: toIso(l.start_time),
    endTimeUtc: toIso(l.timestamp),
    elapsedSec: safeNumber(l.total_elapsed_time, { allowZero: true }),
    timerSec: safeNumber(l.total_timer_time, { allowZero: true }),
    distanceKm: safeNumber(l.total_distance, { allowZero: true }),
    avgHr: safeNumber(l.avg_heart_rate),
    maxHr: safeNumber(l.max_heart_rate),
    ...dynamicsOf(l),
  }));

  const records: FitParseRecord[] = (data.records ?? []).map((r: any) => {
    const speedKmh = safeNumber(r.speed, { allowZero: true });
    // 秒/km = 3600 / (km/h)。速度0や欠損はゼロ除算・Infinityになるので未確定にする。
    const paceSecPerKm =
      speedKmh !== undefined && speedKmh > 0 ? 3600 / speedKmh : undefined;
    return {
      timeUtc: toIso(r.timestamp),
      distanceKm: safeNumber(r.distance, { allowZero: true }),
      paceSecPerKm,
      hr: safeNumber(r.heart_rate),
      cadenceSpm: cadenceSpm(r.cadence),
      temperatureC: safeNumber(r.temperature, { allowZero: true, allowNegative: true }),
      verticalOscillationMm: safeNumber(r.vertical_oscillation),
      groundContactTimeMs: safeNumber(r.stance_time),
      stepLengthM: stepLengthM(r.step_length),
    };
  });

  const hasDeveloperFields =
    (Array.isArray(data.developer_data_ids) && data.developer_data_ids.length > 0) ||
    (Array.isArray(data.field_descriptions) && data.field_descriptions.length > 0);
  if (hasDeveloperFields) {
    warnings.push({
      code: "developer_fields_ignored",
      message: "このファイルには機種独自の拡張フィールドが含まれていますが、まだ解析していません。",
    });
  }

  return {
    fileType: typeof fileId?.type === "string" ? fileId.type : undefined,
    manufacturer: typeof fileId?.manufacturer === "string" ? fileId.manufacturer : undefined,
    timeCreatedUtc: toIso(fileId?.time_created),
    activityTimestampUtc: toIso(activity?.timestamp),
    utcOffsetSec,
    sessions,
    laps,
    records,
    eventCount: Array.isArray(data.events) ? data.events.length : 0,
    hasDeveloperFields,
    warnings,
  };
}
