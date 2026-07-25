/**
 * 4-5-7. レース結果によるピリオダイゼーション見直し
 */
import type { Athlete, Diagnosis } from "./types";
import { diagnose } from "./diagnosis";
import { goalFeasibility } from "./cfe";
import { fmtTime } from "./dates";

export interface RaceAnalysisInput {
  /** 前半400m / 後半400m（秒）。分割入力から合算したもの */
  front400Sec: number;
  back400Sec: number;
  /** レース前の設定（想定ラップ） */
  plannedFront400Sec?: number;
  plannedBack400Sec?: number;
  targetTimeSec: number;
  rpe?: number;
  athlete: Athlete;
  cfeAfterRaceSec: number;
  weeksToTargetRace: number;
}

export interface RatioAdjustment {
  category: string;
  change: "increase" | "decrease" | "keep";
  reason: string;
}

export interface RaceAnalysisOutput {
  totalSec: number;
  splitDiffSec: number; // d = 前半 − 後半（正 = 後半が遅い）
  primaryIssue: string;
  adjustments: RatioAdjustment[];
  extraActions: string[];
  rediagnosis: Diagnosis;
  feasibility: ReturnType<typeof goalFeasibility>;
}

export function analyzeRace(input: RaceAnalysisInput): RaceAnalysisOutput {
  const { front400Sec: f, back400Sec: b, targetTimeSec } = input;
  const total = f + b;
  const d = b - f; // 後半 − 前半 = 減速幅
  const adjustments: RatioAdjustment[] = [];
  const extraActions: string[] = [];
  let primaryIssue: string;

  if (d > 4.0) {
    primaryIssue = "後半維持に課題（減速幅が4秒超）";
    adjustments.push(
      {
        category: "high_lactate",
        change: "increase",
        reason: "後半の失速抑制には耐乳酸刺激の比率を上げる必要がある",
      },
      {
        category: "modeling",
        change: "increase",
        reason: "レース再現でペース配分と後半の押し切りを訓練する",
      }
    );
  } else if (d >= 1.0) {
    primaryIssue = "標準的な減速。配分変更なし";
    adjustments.push({
      category: "all",
      change: "keep",
      reason: "前後半差1.0〜4.0秒は800mとして標準的な減速幅",
    });
  } else if (total > targetTimeSec) {
    primaryIssue = "前半の余裕度／絶対スピードに課題（イーブン以上で走っても目標未達）";
    adjustments.push(
      {
        category: "race_economy",
        change: "increase",
        reason: "前半をより低コストで通過する経済性が必要",
      },
      {
        category: "neural",
        change: "increase",
        reason: "絶対スピードを上げ、レースペースの相対強度を下げる",
      }
    );
  } else {
    primaryIssue = "目標達成。現行配分を維持";
    adjustments.push({ category: "all", change: "keep", reason: "目標達成のため" });
  }

  // 前半が設定より1.5秒以上遅い → ペース感覚のズレ。modeling を1回追加
  if (input.plannedFront400Sec !== undefined && f - input.plannedFront400Sec >= 1.5) {
    extraActions.push(
      `前半400mが設定(${input.plannedFront400Sec.toFixed(1)}秒)より${(f - input.plannedFront400Sec).toFixed(1)}秒遅い: ペース感覚のズレ。modeling を1回追加してください。`
    );
  }
  // 後半が設定より3秒以上遅い かつ RPE最大 → 特異的持久力不足。Specific期の延長を提案
  if (
    input.plannedBack400Sec !== undefined &&
    b - input.plannedBack400Sec >= 3.0 &&
    (input.rpe ?? 0) >= 10
  ) {
    extraActions.push(
      "後半400mが設定より3秒以上遅く、RPEが最大: 特異的持久力不足です。Specific期の延長を提案します。"
    );
  }

  // ③ タイプ診断の再実行
  const rediagnosis = diagnose(
    { ...input.athlete, pb800mSec: Math.min(input.athlete.pb800mSec, total) },
    targetTimeSec
  );

  // ④ 目標の現実性再評価
  const feasibility = goalFeasibility(
    input.cfeAfterRaceSec,
    targetTimeSec,
    input.weeksToTargetRace
  );

  return {
    totalSec: total,
    splitDiffSec: d,
    primaryIssue,
    adjustments,
    extraActions,
    rediagnosis,
    feasibility,
  };
}

export function describeRaceAnalysis(o: RaceAnalysisOutput): string {
  const lines = [
    `合計 ${fmtTime(o.totalSec)}（前後半差 ${o.splitDiffSec >= 0 ? "+" : ""}${o.splitDiffSec.toFixed(1)}秒）`,
    `診断: ${o.primaryIssue}`,
    ...o.adjustments.map(
      (a) =>
        `- ${a.category}: ${a.change === "increase" ? "比率を上げる" : a.change === "decrease" ? "比率を下げる" : "維持"}（${a.reason}）`
    ),
    ...o.extraActions,
  ];
  if (o.feasibility.warn && o.feasibility.message) lines.push(`⚠ ${o.feasibility.message}`);
  return lines.join("\n");
}
