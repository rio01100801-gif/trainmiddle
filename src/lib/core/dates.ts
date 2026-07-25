/** 日付ユーティリティ。タイムゾーン非依存で YYYY-MM-DD を扱う */

/**
 * 実行環境のローカルタイムゾーンでの「今日」。
 * new Date().toISOString() はUTCのため、日本では朝9時前に前日になってしまう。
 * 「今日」が必要な箇所は必ずこれを使うこと。
 */
export function localToday(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseDate(d: string): Date {
  // "YYYY-MM-DD" または ISO 日時
  const dateOnly = d.slice(0, 10);
  const [y, m, day] = dateOnly.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}

export function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(dateStr: string, days: number): string {
  const d = parseDate(dateStr);
  d.setUTCDate(d.getUTCDate() + days);
  return fmtDate(d);
}

/** b - a の日数差 */
export function diffDays(a: string, b: string): number {
  return Math.round((parseDate(b).getTime() - parseDate(a).getTime()) / 86400000);
}

/** その日付が属する週の月曜日 */
export function weekStart(dateStr: string): string {
  const d = parseDate(dateStr);
  const dow = d.getUTCDay(); // 0=Sun
  const offset = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + offset);
  return fmtDate(d);
}

export function month(dateStr: string): number {
  return parseDate(dateStr).getUTCMonth() + 1;
}

/** 7〜8月 = 真夏（RULE-11） */
export function isMidsummer(dateStr: string): boolean {
  const m = month(dateStr);
  return m === 7 || m === 8;
}

/** 6〜9月 = 夏季フラグ（RULE-10 のフォールバック） */
export function isSummer(dateStr: string): boolean {
  const m = month(dateStr);
  return m >= 6 && m <= 9;
}

/** 秒 → "1:48.9" 形式 */
export function fmtTime(sec: number): string {
  if (!isFinite(sec)) return "-";
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  const sStr = s.toFixed(1).padStart(4, "0");
  return m > 0 ? `${m}:${sStr}` : s.toFixed(1);
}

/** 秒/km → "3:50/km" 形式 */
export function fmtPacePerKm(secPerKm: number): string {
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm - m * 60);
  return `${m}:${String(s).padStart(2, "0")}/km`;
}
