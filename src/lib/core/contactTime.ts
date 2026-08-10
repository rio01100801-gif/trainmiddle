/**
 * M-10 接地時間の疲労指標化
 *
 * 疲労が溜まると、同じペースでも接地時間が伸びる。
 * 主観や安静時心拍より先に出ることがあるので、故障の予兆としても使える。
 *
 * 本人の高速走行時の接地時間は152〜160ms。
 * ベースラインは実測の中央値から作り、そこから+5%以上の状態が3日続いたら知らせる。
 *
 * ペース帯をそろえないと意味が無い。
 * ジョグの接地時間とインターバルの接地時間を混ぜて平均を取っても何も分からない。
 * 同じペース帯（±20秒/km）のサンプルだけで比べる。
 *
 * データが無ければ何も出さない。推測で埋めない。
 */
import { diffDays } from "./dates";
import type { SessionResult } from "./types";

export interface ContactSample {
  date: string;
  /** 平均接地時間（ms） */
  contactMs: number;
  /** そのときのペース（秒/km） */
  paceSecPerKm?: number;
  source?: string;
}

export const CONTACT_FATIGUE_PCT = 0.05;
export const CONTACT_FATIGUE_DAYS = 3;
export const BASELINE_WINDOW_DAYS = 42;
export const PACE_BAND_SEC = 20;

export interface ContactAssessment {
  baselineMs?: number;
  recentMs?: number;
  deltaPct?: number;
  /** 閾値を超えた連続日数 */
  consecutiveDays: number;
  fatigued: boolean;
  sampleCount: number;
  narrative: string;
}

/**
 * 接地時間から疲労を判定する。
 *
 * @param samples 取り込んだ接地時間
 * @param today   評価日
 */
export function assessContactTime(
  samples: ContactSample[],
  today: string
): ContactAssessment {
  const inWindow = samples
    .filter((s) => {
      const age = diffDays(s.date, today);
      return age >= 0 && age <= BASELINE_WINDOW_DAYS;
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  if (inWindow.length < 6) {
    return {
      consecutiveDays: 0,
      fatigued: false,
      sampleCount: inWindow.length,
      narrative:
        inWindow.length === 0
          ? "接地時間のデータがありません。接地時間を記録する時計のFITを取り込むと、主観より早く疲労を拾えます"
          : `接地時間のデータが${inWindow.length}件です。判定には6件必要です`,
    };
  }

  // ペース帯をそろえる。ペースが無いサンプルはそのまま使う
  const paced = inWindow.filter((s) => s.paceSecPerKm !== undefined);
  let band = inWindow;
  if (paced.length >= 6) {
    const paces = paced.map((s) => s.paceSecPerKm!).sort((a, b) => a - b);
    const median = paces[Math.floor(paces.length / 2)];
    band = paced.filter((s) => Math.abs(s.paceSecPerKm! - median) <= PACE_BAND_SEC);
    if (band.length < 6) band = inWindow;
  }

  const older = band.filter((s) => diffDays(s.date, today) > 7);
  const recent = band.filter((s) => diffDays(s.date, today) <= 7);
  if (older.length < 3 || recent.length < 2) {
    return {
      consecutiveDays: 0,
      fatigued: false,
      sampleCount: band.length,
      narrative: `比較できる本数が足りません（基準${older.length}件 / 直近${recent.length}件）`,
    };
  }

  const sortedOlder = [...older].map((s) => s.contactMs).sort((a, b) => a - b);
  const baselineMs = sortedOlder[Math.floor(sortedOlder.length / 2)];
  const recentMs = recent.reduce((a, s) => a + s.contactMs, 0) / recent.length;
  const deltaPct = (recentMs - baselineMs) / baselineMs;

  // 新しい順に、閾値を超えている日が何日続いているか
  let consecutiveDays = 0;
  for (let i = band.length - 1; i >= 0; i--) {
    if ((band[i].contactMs - baselineMs) / baselineMs >= CONTACT_FATIGUE_PCT) consecutiveDays++;
    else break;
  }

  const fatigued = consecutiveDays >= CONTACT_FATIGUE_DAYS;
  return {
    baselineMs: Math.round(baselineMs),
    recentMs: Math.round(recentMs),
    deltaPct,
    consecutiveDays,
    fatigued,
    sampleCount: band.length,
    narrative: fatigued
      ? `同じペース帯の接地時間が基準の${Math.round(baselineMs)}msから${Math.round(recentMs)}ms（${(deltaPct * 100).toFixed(1)}%増）に伸び、${consecutiveDays}日続いています。疲労が抜けていない可能性が高く、故障の予兆としても見てください`
      : `同じペース帯の接地時間は基準${Math.round(baselineMs)}msに対して直近${Math.round(recentMs)}ms（${(deltaPct * 100).toFixed(1)}%）。範囲内です`,
  };
}

/**
 * その記録の代表的なペース（秒/km）。
 *
 * 接地時間はペース帯をそろえないと比べられないので、材料には必ずペースを添える。
 * 持続走は平均ペースをそのまま、インターバルは疾走部分の合計距離と合計時間から出す
 * （レストを含めると「その接地時間で走っていた速さ」とずれる）。
 */
function paceOf(result: SessionResult): number | undefined {
  if (result.continuous?.avgPaceSecPerKm) return result.continuous.avgPaceSecPerKm;
  let sec = 0;
  let meters = 0;
  for (const rep of result.interval?.results ?? []) {
    if (rep.actualSec > 0 && rep.distanceM > 0) {
      sec += rep.actualSec;
      meters += rep.distanceM;
    }
  }
  return meters > 0 ? (sec / meters) * 1000 : undefined;
}

/**
 * 記録から接地時間の材料を作る。
 *
 * FIT取込は `SessionResult.avgGroundContactTimeMs` を保存していたのに、
 * 判定側はCSV取り込み専用の保存領域しか見ておらず、アプリの中にある値が
 * 使われないまま「時計から書き出してください」と案内していた。
 *
 * 接地時間が入っていない記録は材料にしない（対応していない時計では
 * undefined のまま来る。0で埋めない）。
 */
export function contactSamplesFromResults(results: SessionResult[]): ContactSample[] {
  return results
    .filter((r) => r.avgGroundContactTimeMs !== undefined && r.avgGroundContactTimeMs > 0)
    .map((r) => ({
      date: r.date,
      contactMs: r.avgGroundContactTimeMs!,
      paceSecPerKm: paceOf(r),
      source: "時計の記録",
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * CSVから取り込む。
 * 想定する列: 日付, 接地時間(ms), ペース(秒/km または m:ss/km)
 * 列名は見ず、位置で読む。時計ごとに列名が違うため。
 */
export function parseContactCsv(text: string): ContactSample[] {
  const out: ContactSample[] = [];
  for (const line of text.split(/\r?\n/)) {
    const cells = line.split(/[,\t]/).map((c) => c.trim());
    if (cells.length < 2) continue;
    const date = normalizeDate(cells[0]);
    if (!date) continue;
    const ms = Number(cells[1]);
    if (!isFinite(ms) || ms < 80 || ms > 500) continue;
    let pace: number | undefined;
    if (cells[2]) {
      pace = parsePace(cells[2]);
    }
    out.push({ date, contactMs: ms, paceSecPerKm: pace, source: "CSV取り込み" });
  }
  return out;
}

function normalizeDate(s: string): string | undefined {
  const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(s);
  if (!m) return undefined;
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
}

function parsePace(s: string): number | undefined {
  const mm = /^(\d{1,2}):(\d{2})/.exec(s);
  if (mm) return Number(mm[1]) * 60 + Number(mm[2]);
  const n = Number(s);
  return isFinite(n) && n > 60 ? n : undefined;
}
