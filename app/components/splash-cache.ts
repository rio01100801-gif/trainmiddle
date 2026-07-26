/**
 * R-2 ロード画面に出す値を作って localStorage に置く。
 *
 * スプラッシュは bundle.js を読み込む前に描画されるので、その場ではDBを読めない。
 * 前回起動時にここで書いておいた値を index.html が読む。
 *
 * 文字列の組み立てはここ（TypeScript側）に置く。
 * index.html のスクリプトでやると、テストできない場所にロジックが増える。
 * 向こうでやるのは「保存したレース日から今日までの日数を引く」だけにしてある。
 */

export const SPLASH_KEY = "forge:splash";

export interface SplashSummary {
  /** レース日（YYYY-MM-DD）。日数はスプラッシュ側で今日から計算する */
  raceDate?: string;
  /** 目標との差の1行（例: 目標 1:48.90 まで −5.7秒） */
  gapText?: string;
  /** レースも目標も無いときに出す代わりの1行 */
  fallbackText?: string;
}

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return m > 0 ? `${m}:${s.toFixed(2).padStart(5, "0")}` : s.toFixed(2);
}

/**
 * ダッシュボードの値から、スプラッシュに出す1行を作る。
 *
 * 出すのは1つだけ。読み込みの1〜2秒で読めるのは1行が限界で、
 * 2つ並べるとどちらも読まないまま消える。
 *
 * 優先順位:
 *   1. レースと目標がある → 目標までの距離（毎日少しずつ動く。起動のたびに見る値として適している）
 *   2. CFEだけある → 現在地
 *   3. どちらも無い（初回起動）→ 何も出さない。ロゴだけで成立させる
 */
export function buildSplashSummary(d: {
  targetRace?: { dateStart?: string } | null;
  goal?: { targetTimeSec?: number } | null;
  cfe?: { estimated800mSec?: number } | null;
}): SplashSummary {
  const raceDate = d?.targetRace?.dateStart;
  const target = d?.goal?.targetTimeSec;
  const cfe = d?.cfe?.estimated800mSec;

  if (target !== undefined && cfe !== undefined) {
    const gap = cfe - target;
    // 目標より速ければ「到達」と書く。マイナス表記のままだと読み違える
    const gapText =
      gap > 0
        ? `目標 ${fmtTime(target)} まで −${gap.toFixed(1)}秒`
        : `目標 ${fmtTime(target)} に到達（+${Math.abs(gap).toFixed(1)}秒）`;
    return { raceDate, gapText };
  }
  if (cfe !== undefined) {
    return { raceDate, fallbackText: `現在地 ${fmtTime(cfe)}（推定800m）` };
  }
  return { raceDate };
}

/** 保存する。localStorage が使えない環境でも落とさない */
export function saveSplashSummary(d: unknown): void {
  try {
    if (typeof localStorage === "undefined") return;
    const s = buildSplashSummary(d as never);
    localStorage.setItem(SPLASH_KEY, JSON.stringify(s));
  } catch {
    /* プライベートモード等で書けなくても、スプラッシュが素になるだけ */
  }
}
