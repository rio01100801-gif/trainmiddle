/**
 * Apple Health の取り込み。
 *
 * 書き出した export.xml を読んで、日次コンディションと有酸素マーカーに変換する。
 * **HealthKit は Web から直接読めない。** だから自動同期ではなく、
 * 本人が書き出したファイルを渡す形になっている。
 *
 * サービス層の一番下。ここから他のサービスを呼ばない
 * （`ci:layers` が向きを見張っている）。
 *
 * 移動しただけで中身は変えていない。
 */
import { addDays, diffDays } from "../core/dates";
import { hrvDeviation, parseAppleHealthExport, toDailyCheck, toFitnessMarker, type SyncRecord } from "../core/healthImport";
import { judgeSignal } from "../core/signal";
import { Store } from "../db/store";

// ---------------------------------------------------------------------------
// Apple Health 取り込み
// ---------------------------------------------------------------------------

export interface HealthImportSummary {
  sync: SyncRecord;
  /** 取り込みで疲労シグナルが変わった日 */
  signalChanges: { date: string; signal: string }[];
  hrvNote?: string;
  ltUpdated: boolean;
}

/**
 * Apple Health のエクスポート(export.xml)を取り込み、
 * 分析エンジンの入力（DailyCheck / FitnessMarker）に変換して保存する。
 *
 * 主観入力（脚の疲労・モチベーション）は上書きしない。
 * センサーで測れるもの（安静時HR・睡眠）だけを埋める。
 */
export function importAppleHealth(
  repo: Store,
  xml: string,
  today: string,
  opts: { days?: number } = {}
): HealthImportSummary {
  const days = opts.days ?? 120;
  const cutoffDate = addDays(today, -days);
  const parsed = parseAppleHealthExport(xml, { cutoffDate });

  // --- 日次データ → DailyCheck ---
  const existing = new Map(repo.listDailyChecks().map((c) => [c.date, c]));
  let dailyCount = 0;
  for (const h of parsed.daily) {
    if (h.restingHr === undefined && h.sleepHours === undefined) continue;
    const merged = toDailyCheck(h, existing.get(h.date));
    const baseline = baselineRestingHr(repo, h.date);
    const judged = judgeSignal(merged, baseline);
    repo.saveDailyCheck({ ...merged, signal: judged.signal });
    dailyCount++;
  }

  // --- ワークアウト → FitnessMarker ---
  // HealthKitだけでは走行目的が分からないため、unknownで保存しLTには自動採用しない。
  let workoutCount = 0;
  for (const w of parsed.workouts) {
    const fm = toFitnessMarker(w);
    if (!fm) continue;
    repo.saveMarker(fm);
    workoutCount++;
  }

  // --- HRV のベースライン比較 ---
  const todayHrv = parsed.daily.find((d) => d.date === today)?.hrvSdnnMs;
  const hrv = hrvDeviation(todayHrv, parsed.daily);

  const sync: SyncRecord = {
    provider: "apple_health",
    syncedAt: new Date().toISOString(),
    workouts: workoutCount,
    dailyChecks: dailyCount,
    fromDate: parsed.fromDate,
    toDate: parsed.toDate,
    note:
      parsed.missing.length > 0
        ? `取得できなかった項目: ${parsed.missing.join("・")}（無視して続行しました）`
        : undefined,
  };
  repo.saveSync(sync);

  const signalChanges = repo
    .listDailyChecks()
    .filter((c) => c.signal && c.signal !== "green" && c.date >= cutoffDate)
    .map((c) => ({ date: c.date, signal: c.signal! }));

  return {
    sync,
    signalChanges,
    hrvNote: hrv.note,
    ltUpdated: false,
  };
}

/** 安静時HRのベースライン（直近28日の中央値） */
function baselineRestingHr(repo: Store, onDate: string): number | undefined {
  const withHr = repo
    .listDailyChecks()
    .filter(
      (c) =>
        c.restingHr !== undefined && c.date < onDate && diffDays(c.date, onDate) <= 28
    )
    .map((c) => c.restingHr!)
    .sort((a, b) => a - b);
  if (withHr.length < 5) return undefined;
  return withHr[Math.floor(withHr.length / 2)];
}
