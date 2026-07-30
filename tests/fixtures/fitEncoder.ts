/**
 * テスト用FITフィクスチャの組み立て。
 *
 * `fit-file-parser` 自体の `FitEncoder`（生のFIT global message番号・field番号を
 * 指定する低レベルAPI）を使い、本物のFITバイト列を作る。手書きでバイトを
 * 組み立てるより、実際のライブラリのデコード結果と必ず整合する。
 *
 * field番号は message種別ごとに異なる（例: avg_heart_rateはsessionが16、lapは15）。
 * 実際にエンコード→デコードして確認した値を使っている（フィールド定義は
 * `node_modules/fit-file-parser/dist/cjs/garmin_profile.generated.js` で確認済み）。
 */
import { FitBaseType, FitEncoder } from "fit-file-parser";

function ts(iso: string): number {
  return FitEncoder.toFitTimestamp(new Date(iso));
}

export interface FixtureSession {
  startTime: string;
  timestamp: string;
  sport?: number; // enum値。running=1
  totalElapsedSec?: number;
  totalTimerSec?: number;
  totalDistanceM?: number;
  avgHr?: number;
  maxHr?: number;
}
export interface FixtureLap {
  startTime: string;
  timestamp: string;
  totalElapsedSec?: number;
  totalDistanceM?: number;
  avgHr?: number;
  maxHr?: number;
}
export interface FixtureRecord {
  timestamp: string;
  heartRate?: number;
  distanceM?: number;
  speedMs?: number;
}

export function buildFitFile(opts: {
  fileType?: number;
  manufacturer?: number;
  timeCreated?: string;
  activityTimestamp?: string;
  activityLocalTimestamp?: string;
  sessions?: FixtureSession[];
  laps?: FixtureLap[];
  records?: FixtureRecord[];
  includeDeveloperField?: boolean;
}): Uint8Array {
  const enc = new FitEncoder();

  // file_id (global #0)
  enc.writeMessage(0, [
    { number: 0, size: 1, baseType: FitBaseType.Enum, value: opts.fileType ?? 4 },
    { number: 1, size: 2, baseType: FitBaseType.Uint16, value: opts.manufacturer ?? 1 },
    ...(opts.timeCreated
      ? [{ number: 4, size: 4, baseType: FitBaseType.Uint32, value: ts(opts.timeCreated) }]
      : []),
  ]);

  if (opts.activityTimestamp) {
    const fields = [
      { number: 253, size: 4, baseType: FitBaseType.Uint32, value: ts(opts.activityTimestamp) },
    ];
    if (opts.activityLocalTimestamp) {
      fields.push({
        number: 5,
        size: 4,
        baseType: FitBaseType.Uint32,
        value: ts(opts.activityLocalTimestamp),
      });
    }
    enc.writeMessage(34, fields, 1);
  }

  for (const s of opts.sessions ?? []) {
    const fields = [
      { number: 253, size: 4, baseType: FitBaseType.Uint32, value: ts(s.timestamp) },
      { number: 2, size: 4, baseType: FitBaseType.Uint32, value: ts(s.startTime) },
    ];
    if (s.sport !== undefined) fields.push({ number: 5, size: 1, baseType: FitBaseType.Enum, value: s.sport });
    if (s.totalElapsedSec !== undefined)
      fields.push({ number: 7, size: 4, baseType: FitBaseType.Uint32, value: Math.round(s.totalElapsedSec * 1000) });
    if (s.totalTimerSec !== undefined)
      fields.push({ number: 8, size: 4, baseType: FitBaseType.Uint32, value: Math.round(s.totalTimerSec * 1000) });
    if (s.totalDistanceM !== undefined)
      fields.push({ number: 9, size: 4, baseType: FitBaseType.Uint32, value: Math.round(s.totalDistanceM * 100) });
    if (s.avgHr !== undefined) fields.push({ number: 16, size: 1, baseType: FitBaseType.Uint8, value: s.avgHr });
    if (s.maxHr !== undefined) fields.push({ number: 17, size: 1, baseType: FitBaseType.Uint8, value: s.maxHr });
    enc.writeMessage(18, fields, 2);
  }

  for (const l of opts.laps ?? []) {
    const fields = [
      { number: 253, size: 4, baseType: FitBaseType.Uint32, value: ts(l.timestamp) },
      { number: 2, size: 4, baseType: FitBaseType.Uint32, value: ts(l.startTime) },
    ];
    if (l.totalElapsedSec !== undefined)
      fields.push({ number: 7, size: 4, baseType: FitBaseType.Uint32, value: Math.round(l.totalElapsedSec * 1000) });
    if (l.totalDistanceM !== undefined)
      fields.push({ number: 9, size: 4, baseType: FitBaseType.Uint32, value: Math.round(l.totalDistanceM * 100) });
    // lapメッセージはsessionと番号がずれる: avg_heart_rate=15, max_heart_rate=16
    if (l.avgHr !== undefined) fields.push({ number: 15, size: 1, baseType: FitBaseType.Uint8, value: l.avgHr });
    if (l.maxHr !== undefined) fields.push({ number: 16, size: 1, baseType: FitBaseType.Uint8, value: l.maxHr });
    enc.writeMessage(19, fields, 3);
  }

  for (const r of opts.records ?? []) {
    const fields = [
      { number: 253, size: 4, baseType: FitBaseType.Uint32, value: ts(r.timestamp) },
    ];
    if (r.heartRate !== undefined) fields.push({ number: 3, size: 1, baseType: FitBaseType.Uint8, value: r.heartRate });
    if (r.distanceM !== undefined)
      fields.push({ number: 5, size: 4, baseType: FitBaseType.Uint32, value: Math.round(r.distanceM * 100) });
    if (r.speedMs !== undefined)
      fields.push({ number: 6, size: 2, baseType: FitBaseType.Uint16, value: Math.round(r.speedMs * 1000) });
    enc.writeMessage(20, fields, 4);
  }

  return enc.close();
}
