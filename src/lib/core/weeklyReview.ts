/**
 * M-11 週次レビューの自動生成
 *
 * そのまま指導者に見せられる文章にする。
 * 箇条書きを並べただけの体裁にしない。数字は必ず実測を引用する。
 * 「調子が良かった」ではなく「設定3:10に対して平均3:08、垂れ幅0.4秒」と書く。
 *
 * 定型文を組み合わせて作る。LLMは使わない。
 * 同じ週の同じデータからは必ず同じ文章が出る。
 */
import type { Session, SessionResult, DailyCheck, RuleViolation } from "./types";
import { addDays, diffDays, fmtTime } from "./dates";

export interface WeeklyReviewInput {
  weekStart: string;
  sessions: Session[];
  results: SessionResult[];
  checks: DailyCheck[];
  violations: RuleViolation[];
  acwr?: number;
  cfeSec?: number;
  targetSec?: number;
  limiterNarrative?: string;
}

export interface QualityLine {
  date: string;
  name: string;
  category: string;
  targetSec?: number;
  meanSec?: number;
  deviationSec?: number;
  fadeSec?: number;
  reps: number;
  plannedReps?: number;
  aborted: boolean;
  rpe: number;
}

export interface WeeklyReview {
  weekStart: string;
  weekEnd: string;
  qualityLines: QualityLine[];
  totalDistanceKm: number;
  qualityCount: number;
  /** そのまま貼れる文章 */
  text: string;
}

const CATEGORY_JP: Record<string, string> = {
  high_lactate: "高乳酸",
  race_economy: "経済走",
  modeling: "モデリング",
  cv: "CV",
  threshold: "閾値",
  neural: "神経系",
  aerobic: "有酸素",
  off: "休養",
};

function fmtSec(v: number): string {
  return v >= 60 ? fmtTime(v) : `${v.toFixed(1)}秒`;
}

function signed(v: number): string {
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}`;
}

export function buildWeeklyReview(input: WeeklyReviewInput): WeeklyReview {
  const { weekStart, sessions, results, checks, violations } = input;
  const weekEnd = addDays(weekStart, 6);
  const inWeek = <T extends { date: string }>(x: T) => x.date >= weekStart && x.date <= weekEnd;

  const weekSessions = sessions.filter(inWeek);
  const byId = new Map(weekSessions.map((s) => [s.id, s]));
  const weekResults = results.filter((r) => inWeek(r) && byId.has(r.sessionId));

  const qualityLines: QualityLine[] = [];
  for (const r of weekResults) {
    const s = byId.get(r.sessionId)!;
    if (!r.interval) continue;
    const times = r.interval.results.map((x) => x.actualSec);
    if (times.length === 0) continue;
    const mean = times.reduce((a, b) => a + b, 0) / times.length;
    const target = r.interval.targetSec;
    qualityLines.push({
      date: r.date,
      name: s.name,
      category: CATEGORY_JP[s.category] ?? s.category,
      targetSec: target,
      meanSec: mean,
      deviationSec: target ? mean - target : undefined,
      fadeSec: times.length >= 2 ? times[times.length - 1] - times[0] : undefined,
      reps: times.length,
      plannedReps: r.prescribedReps,
      aborted: !!r.aborted,
      rpe: r.rpe,
    });
  }

  const totalDistanceKm = Math.round(
    weekResults.reduce(
      (a, r) => a + (r.continuous?.distanceKm ?? 0),
      0
    ) +
      weekSessions
        .filter((s) => s.status === "completed" && !results.some((r) => r.sessionId === s.id))
        .reduce((a, s) => a + (s.distanceKm ?? 0), 0)
  );

  // ---- 文章 ----
  const p: string[] = [];

  p.push(
    `${weekStart.slice(5).replace("-", "/")}〜${weekEnd.slice(5).replace("-", "/")}の週です。` +
      `ポイント練習は${qualityLines.length}本、走行距離は約${totalDistanceKm}kmでした。`
  );

  for (const q of qualityLines) {
    const parts: string[] = [];
    parts.push(`${q.date.slice(5).replace("-", "/")}は${q.category}で${q.name}`);
    if (q.targetSec !== undefined && q.meanSec !== undefined) {
      parts.push(
        `設定${fmtSec(q.targetSec)}に対して平均${fmtSec(q.meanSec)}（${signed(q.deviationSec ?? 0)}秒）`
      );
    }
    if (q.fadeSec !== undefined) {
      parts.push(`垂れ幅は${signed(q.fadeSec)}秒`);
    }
    if (q.aborted) {
      parts.push(
        `${q.plannedReps ?? "?"}本の予定を${q.reps}本で打ち切りました（中止基準にしたがって止めたもので、失敗ではありません）`
      );
    } else if (q.plannedReps && q.reps < q.plannedReps) {
      parts.push(`${q.plannedReps}本の予定に対して${q.reps}本`);
    }
    parts.push(`RPEは${q.rpe}`);
    p.push(parts.join("、") + "。");
  }

  // 垂れ幅と平均は別々に評価する
  const withFade = qualityLines.filter((q) => q.fadeSec !== undefined);
  if (withFade.length >= 2) {
    const meanDev =
      qualityLines
        .filter((q) => q.deviationSec !== undefined)
        .reduce((a, q) => a + q.deviationSec!, 0) /
      Math.max(1, qualityLines.filter((q) => q.deviationSec !== undefined).length);
    const meanFade = withFade.reduce((a, q) => a + q.fadeSec!, 0) / withFade.length;
    p.push(
      `週を通した設定との差は平均${signed(meanDev)}秒、垂れ幅は平均${signed(meanFade)}秒でした。` +
        (meanDev <= 0 && meanFade > 1.0
          ? "平均は設定どおりですが後半で垂れているので、1本目の入りが速すぎないか確認してください。"
          : meanDev > 1.0
          ? "設定に届いていないので、設定側を見直すか、当日の状態を確認する必要があります。"
          : "設定・垂れ幅ともに大きな問題はありません。")
    );
  }

  const weekChecks = checks.filter(inWeek);
  const hrs = weekChecks.map((c) => c.restingHr).filter((v): v is number => v !== undefined);
  const fatigues = weekChecks
    .map((c) => c.overallFatigue)
    .filter((v): v is number => v !== undefined);
  if (hrs.length > 0 || fatigues.length > 0) {
    const bits: string[] = [];
    if (hrs.length > 0) {
      bits.push(`安静時心拍は平均${Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length)}`);
    }
    if (fatigues.length > 0) {
      bits.push(
        `全身疲労は平均${(fatigues.reduce((a, b) => a + b, 0) / fatigues.length).toFixed(1)}/5`
      );
    }
    p.push(`コンディションは${bits.join("、")}でした。`);
  }

  if (input.acwr !== undefined) {
    p.push(
      `急性:慢性の負荷比は${input.acwr.toFixed(2)}です。` +
        (input.acwr > 1.3
          ? "上がりすぎているので、来週は量を戻します。"
          : input.acwr < 0.8
          ? "落ちているので、来週は量を戻していきます。"
          : "適正の範囲です。")
    );
  }

  const errors = violations.filter((v) => v.level === "ERROR");
  if (errors.length > 0) {
    p.push(
      `構成上の問題が${errors.length}件出ています。${errors
        .slice(0, 2)
        .map((v) => v.message)
        .join(" ")}`
    );
  }

  if (input.limiterNarrative) p.push(input.limiterNarrative);

  if (input.cfeSec !== undefined && input.targetSec !== undefined) {
    p.push(
      `現在の推定は${fmtTime(input.cfeSec)}で、目標${fmtTime(input.targetSec)}との差は${(
        input.cfeSec - input.targetSec
      ).toFixed(1)}秒です。`
    );
  }

  return {
    weekStart,
    weekEnd,
    qualityLines,
    totalDistanceKm,
    qualityCount: qualityLines.length,
    text: p.join("\n\n"),
  };
}
