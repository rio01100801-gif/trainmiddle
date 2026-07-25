/**
 * 入力の摩擦を減らす（改修指示書 D-3）
 *
 * トラックでスマホに数字を打つとき、コロンやピリオドを手で入れるのは遅い。
 * 数字だけ連続で打てば整形されるようにする。
 *
 *   3040   → 30:40      （4桁は 分分:秒秒）
 *   13530  → 1:35.30    （5桁は 分:秒秒.100分の1秒）
 *   103530 → 10:35.30   （6桁）
 *
 * 桁数で意味を決めているのは、800m選手が入力する値の実態に合わせているため。
 * 4桁は「30:40のようなジョグの所要時間」、5〜6桁は「1:35.30のようなラップ」。
 */

/** 数字だけの連続入力をタイム表記へ整形する。判断できない場合はそのまま返す */
export function formatTimeInput(raw: string): string {
  const digits = raw.replace(/[^0-9]/g, "");
  if (raw !== digits) return raw; // すでに : や . が入っている＝手で書いているので触らない
  if (digits.length <= 2) return digits;
  if (digits.length === 3) return `${digits[0]}:${digits.slice(1)}`;
  if (digits.length === 4) return `${digits.slice(0, 2)}:${digits.slice(2)}`;
  if (digits.length === 5) return `${digits[0]}:${digits.slice(1, 3)}.${digits.slice(3)}`;
  if (digits.length === 6)
    return `${digits.slice(0, 2)}:${digits.slice(2, 4)}.${digits.slice(4)}`;
  return raw;
}

/** "1:35.30" / "95.3" / "30:40" を秒に変換する */
export function parseTimeToSec(v: string): number | undefined {
  const t = v.trim();
  if (!t) return undefined;
  if (t.includes(":")) {
    const [m, s] = t.split(":");
    const mm = Number(m);
    const ss = Number(s);
    if (isNaN(mm) || isNaN(ss)) return undefined;
    return mm * 60 + ss;
  }
  const n = Number(t);
  return isNaN(n) ? undefined : n;
}

// ---------------------------------------------------------------------------
// F-1. 時間・ペースの柔軟な入力
// ---------------------------------------------------------------------------

/**
 * 所要時間の表記を秒に変換する。
 *
 *   "51"       → 51分   （単位なしの数値は「分」として読む）
 *   "51分"     → 51分
 *   "51:30"    → 51分30秒
 *   "1:05:00"  → 1時間5分
 *   "1時間5分" → 1時間5分
 *
 * 練習日誌に書かれる所要時間は分単位が圧倒的に多いので、
 * 単位なしの数値は「分」に倒す。ペース（parsePaceToSecPerKm）とは規則が違うので注意。
 */
export function parseDurationToSec(v: string): number | undefined {
  const t = v.trim().replace(/\s/g, "");
  if (!t) return undefined;

  // 1時間5分 / 5分30秒 のような和文表記
  const jp = /^(?:(\d+)時間)?(?:(\d+)分)?(?:(\d+)秒)?$/.exec(t);
  if (jp && (jp[1] || jp[2] || jp[3])) {
    return Number(jp[1] ?? 0) * 3600 + Number(jp[2] ?? 0) * 60 + Number(jp[3] ?? 0);
  }

  const parts = t.split(":");
  if (parts.length === 3) {
    const [h, m, s] = parts.map(Number);
    if ([h, m, s].some(isNaN)) return undefined;
    return h * 3600 + m * 60 + s;
  }
  if (parts.length === 2) {
    const [m, s] = parts.map(Number);
    if ([m, s].some(isNaN)) return undefined;
    return m * 60 + s;
  }
  const n = Number(t);
  if (isNaN(n)) return undefined;
  return n * 60; // 単位なし＝分
}

/**
 * ペース表記を 秒/km に変換する。
 *
 *   "4:40"     → 280
 *   "4:40/km"  → 280
 *   "@3:50"    → 230
 *   "280"      → 280（単位なしの数値は「秒/km」として読む）
 *
 * 所要時間と違い、ペースは分:秒で書かれるのが普通なので、
 * 単位なしの数値は分に倒さず秒として読む。
 */
export function parsePaceToSecPerKm(v: string): number | undefined {
  const t = v.trim().replace(/[@\s]/g, "").replace(/\/km$/i, "").replace(/毎km$/, "");
  if (!t) return undefined;
  if (t.includes(":")) {
    const [m, s] = t.split(":").map(Number);
    if ([m, s].some(isNaN)) return undefined;
    return m * 60 + s;
  }
  const n = Number(t);
  return isNaN(n) ? undefined : n;
}

/** 秒/km を "4:40" 表記へ */
export function fmtPaceSecPerKm(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec - m * 60);
  // 59.6秒が 4:60 にならないよう繰り上げる
  return s === 60 ? `${m + 1}:00` : `${m}:${String(s).padStart(2, "0")}`;
}

/** 秒を "51:30" / "1:05:00" 表記へ */
export function fmtDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec - h * 3600) / 60);
  const s = Math.round(sec - h * 3600 - m * 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

export interface RunTriple {
  distanceKm?: number;
  durationSec?: number;
  paceSecPerKm?: number;
}

export interface RunTripleResult extends RunTriple {
  /** 自動計算で埋めた項目 */
  derived?: keyof RunTriple;
  /** 3つとも入力されていて計算値とずれている場合の警告 */
  mismatch?: string;
}

/** 入力された3つの値が食い違っているとみなす相対誤差 */
export const TRIPLE_MISMATCH_TOLERANCE = 0.03;

/**
 * 距離・時間・ペースのうち2つが入っていれば残り1つを埋める。
 *
 * 練習日誌には「51分 平均4:40」のように距離が書かれていないことが多い。
 * 距離を必須にすると、ユーザーが電卓を叩くか、諦めて入力しなくなる。
 *
 * 3つとも入っている場合は上書きせず、矛盾していれば警告だけ出す
 * （どれが正しいかはこちらでは判断できないため、本人に直させる）。
 */
export function completeRunTriple(input: RunTriple): RunTripleResult {
  const { distanceKm, durationSec, paceSecPerKm } = input;
  const has = (v?: number) => v !== undefined && isFinite(v) && v > 0;

  if (has(distanceKm) && has(durationSec) && has(paceSecPerKm)) {
    const expected = durationSec! / distanceKm!;
    const diff = Math.abs(expected - paceSecPerKm!) / expected;
    return {
      ...input,
      mismatch:
        diff > TRIPLE_MISMATCH_TOLERANCE
          ? `距離と時間から計算したペースは ${fmtPaceSecPerKm(expected)}/km で、入力値 ${fmtPaceSecPerKm(
              paceSecPerKm!
            )}/km と ${Math.round(diff * 100)}% ずれています。どれかが違っている可能性があります。`
          : undefined,
    };
  }
  if (has(durationSec) && has(paceSecPerKm)) {
    return {
      ...input,
      distanceKm: Math.round((durationSec! / paceSecPerKm!) * 100) / 100,
      derived: "distanceKm",
    };
  }
  if (has(distanceKm) && has(paceSecPerKm)) {
    return {
      ...input,
      durationSec: Math.round(distanceKm! * paceSecPerKm!),
      derived: "durationSec",
    };
  }
  if (has(distanceKm) && has(durationSec)) {
    return {
      ...input,
      paceSecPerKm: Math.round((durationSec! / distanceKm!) * 10) / 10,
      derived: "paceSecPerKm",
    };
  }
  return { ...input };
}
