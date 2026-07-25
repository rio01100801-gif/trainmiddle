/**
 * 4-5-8. 信号機モデル（DailyCheck からの自動判定）
 * 進行段階（筋 → 心拍 → 自律神経 → 中枢神経）を意識した設計。
 */
import type { DailyCheck, Signal } from "./types";

export interface SignalResult {
  signal: Signal;
  reasons: string[];
  action: string;
}

/**
 * 安静時HRのベースライン（直近28日の中央値など）と当日のチェックから信号を判定する。
 * - 緑: 安静HR平常、睡眠良好 → 通常進行
 * - 黄: 筋の張り / 安静HR+5 / 睡眠質低下 → 強度は維持し量を30%減
 * - 赤: 全身倦怠 / 安静HR+10 / 睡眠障害 → 完全休養（SKIP-02適用）
 */
export function judgeSignal(
  check: DailyCheck,
  baselineRestingHr?: number
): SignalResult {
  const reasons: string[] = [];
  let level: Signal = "green";

  const hrDelta =
    check.restingHr !== undefined && baselineRestingHr !== undefined
      ? check.restingHr - baselineRestingHr
      : undefined;

  // 赤の条件
  if (hrDelta !== undefined && hrDelta >= 10) {
    level = "red";
    reasons.push(`安静時HRがベースライン+${hrDelta}拍（自律神経系の疲労兆候）`);
  }
  if ((check.overallFatigue ?? 0) >= 4) {
    level = "red";
    reasons.push("全身倦怠感が強い");
  }
  if ((check.sleepQuality ?? 5) <= 1) {
    level = "red";
    reasons.push("睡眠障害レベルの睡眠質低下");
  }

  // 2-2: 脚の疲労が最大なら赤に準じる（走れない状態）
  if ((check.legFatigue ?? 0) >= 5) {
    level = "red";
    reasons.push("脚の疲労が最大レベル");
  }

  if (level !== "red") {
    // 黄の条件
    if (hrDelta !== undefined && hrDelta >= 5) {
      level = "yellow";
      reasons.push(`安静時HRがベースライン+${hrDelta}拍`);
    }
    if ((check.muscleTightness ?? 0) >= 4) {
      level = "yellow";
      reasons.push("筋の張りが強い（進行段階の初期: 筋レベル）");
    }
    if ((check.sleepQuality ?? 5) <= 2) {
      level = "yellow";
      reasons.push("睡眠の質が低下");
    }
    if ((check.legFatigue ?? 0) >= 4) {
      level = "yellow";
      reasons.push("脚の疲労が強い");
    }
    // モチベーション低下は中枢神経疲労の初期サイン。単独では黄にせず、
    // 他の指標と重なったときだけ理由として 追記する（過剰反応を避ける）
    if ((check.motivation ?? 5) <= 2 && level === "yellow") {
      reasons.push("モチベーション低下（中枢性疲労の可能性）");
    }
  }

  if (level === "green") reasons.push("安静時HR平常・睡眠良好");

  const action =
    level === "green"
      ? "通常進行"
      : level === "yellow"
        ? "強度は維持し、量を30%減"
        : "完全休養。SKIP-02を適用（質練習は削除、後ろ倒ししない）";

  return { signal: level, reasons, action };
}

/**
 * 黄信号が3日以上連続した場合は赤に準じた扱いとする。
 * 履歴（date昇順）を受け取り、最終日の実効信号を返す。
 */
export function effectiveSignal(history: DailyCheck[]): {
  signal: Signal;
  escalated: boolean;
  message?: string;
} {
  if (history.length === 0) return { signal: "green", escalated: false };
  const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
  const last = sorted[sorted.length - 1];
  if (last.signal === "red") return { signal: "red", escalated: false };

  let streak = 0;
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (sorted[i].signal === "yellow") streak++;
    else break;
  }
  if (streak >= 3) {
    return {
      signal: "red",
      escalated: true,
      message: `黄信号が${streak}日連続しています。赤に準じた扱い（完全休養・質練習削除）とします。`,
    };
  }
  return { signal: last.signal ?? "green", escalated: false };
}

/** 安静時HRの7日移動平均トレンド（上昇傾向で警告: 4-9-3） */
export function restingHrTrend(checks: DailyCheck[]): {
  trend: "rising" | "stable" | "falling" | "insufficient";
  slopePerDay?: number;
} {
  const withHr = checks
    .filter((c) => c.restingHr !== undefined)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-14);
  if (withHr.length < 7) return { trend: "insufficient" };
  const first = withHr.slice(0, Math.floor(withHr.length / 2));
  const second = withHr.slice(Math.floor(withHr.length / 2));
  const avg = (arr: DailyCheck[]) =>
    arr.reduce((a, c) => a + (c.restingHr ?? 0), 0) / arr.length;
  const slope = (avg(second) - avg(first)) / (withHr.length / 2);
  if (slope > 0.4) return { trend: "rising", slopePerDay: slope };
  if (slope < -0.4) return { trend: "falling", slopePerDay: slope };
  return { trend: "stable", slopePerDay: slope };
}
