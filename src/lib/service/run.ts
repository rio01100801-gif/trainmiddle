/**
 * M-4 セッション中の入力。
 *
 * 走っている最中に1本ずつ入れて、その場で「続けるか止めるか」を返す。
 * 終えたらそのまま結果になる（`processResult` に渡すだけで、
 * ここで結果の意味づけはしない）。
 *
 * **ここは呼ぶだけの層。** workflow.ts の側からここを参照しているものは無い
 * （`scripts/ci/check-service-layers.mjs` が片方向であることを見張っている）。
 * だから循環せずに切り出せた。予定と結果の輪はそのまま workflow.ts に残っている。
 *
 * 移動しただけで中身は変えていない。
 */
import type { Session, SessionResult } from "../core/types";
import type { Store } from "../db/store";
import {
  abortCriteria,
  evaluateReps,
  prescriptionWithCriteria,
  type AbortCriteria,
  type RepEvaluation,
} from "../core/abort";
import { repsOf } from "../core/adaptive";
import { normalizeAbortCause, describeAbortCause, needsInjuryLog, type AbortCause } from "../core/abortCause";
import { isHighLoadSession } from "../core/trainingClassification";
import { ProcessResultOutput, processResult } from "./workflow";

// ---------------------------------------------------------------------------
// M-4 セッション中の入力
// ---------------------------------------------------------------------------

export interface SessionProgress {
  sessionId: string;
  /** 入れた順の実施タイム（秒） */
  reps: number[];
  targetSec: number;
  plannedReps: number;
  distanceM: number;
  updatedAt: string;
}

function progressKey(sessionId: string): string {
  return `progress:${sessionId}`;
}

/**
 * 走っている最中の入力を保存する。
 *
 * 端末を閉じても消えないこと。1本ごとに入れる使い方なので、
 * 画面を閉じた瞬間に消えるなら誰も使わない。
 */
export function saveSessionProgress(
  repo: Store,
  sessionId: string,
  reps: number[],
  today: string
): SessionProgressView {
  const prev = repo.getKv<SessionProgress>(progressKey(sessionId));
  const session = repo.getSession(sessionId);
  if (!session) throw new Error("セッションが見つかりません");
  const tp = session.targetPaces[0];
  const p: SessionProgress = {
    sessionId,
    reps,
    targetSec: prev?.targetSec ?? (tp ? (tp.targetSecFast + tp.targetSecSlow) / 2 : 0),
    plannedReps: prev?.plannedReps ?? repsOf(session) ?? reps.length,
    distanceM: prev?.distanceM ?? tp?.distanceM ?? 0,
    updatedAt: today,
  };
  repo.saveKv(progressKey(sessionId), p);
  return sessionProgress(repo, sessionId);
}

export interface SessionProgressView {
  progress: SessionProgress;
  criteria: AbortCriteria;
  evaluation: RepEvaluation;
}

export function sessionProgress(repo: Store, sessionId: string): SessionProgressView {
  const session = repo.getSession(sessionId);
  if (!session) throw new Error("セッションが見つかりません");
  const tp = session.targetPaces[0];
  const stored = repo.getKv<SessionProgress>(progressKey(sessionId));
  const progress: SessionProgress = stored ?? {
    sessionId,
    reps: [],
    targetSec: tp ? (tp.targetSecFast + tp.targetSecSlow) / 2 : 0,
    plannedReps: repsOf(session) ?? 0,
    distanceM: tp?.distanceM ?? 0,
    updatedAt: session.date,
  };
  const criteria = abortCriteria(session.category, progress.targetSec);
  return {
    progress,
    criteria,
    evaluation: evaluateReps(
      progress.reps,
      progress.targetSec,
      progress.plannedReps,
      criteria
    ),
  };
}

/**
 * セッションを終える。入力済みの本数がそのまま記録になる。
 * 打ち切りは「失敗」ではなく正常な運用として残す。
 */
export function finishSessionProgress(
  repo: Store,
  sessionId: string,
  input: { rpe: number; subjective: SessionResult["subjective"]; aborted?: boolean; note?: string;
    tempC?: number; humidityPct?: number; abortCause?: AbortCause; abortNote?: string }
): ProcessResultOutput {
  const view = sessionProgress(repo, sessionId);
  const session = repo.getSession(sessionId)!;
  const { progress } = view;
  const abortCause = normalizeAbortCause(input.abortCause);
  /*
   * 理由が選ばれていれば打ち切り。
   * 以前は「中止基準に引っかかったか」だけで決めていたので、
   * 痛みや時間で止めた場合は普通の完了として記録されていた。
   * 本人が止めたと言っているのに、機械が「完走」と書き換えないようにする。
   */
  const aborted =
    abortCause !== undefined ||
    (input.aborted ??
      (progress.reps.length < progress.plannedReps && view.evaluation.verdict === "stop"));

  const result: SessionResult = {
    id: `res-${sessionId}`,
    sessionId,
    date: session.date,
    actualLapsSec: progress.reps,
    lapDistancesM: progress.reps.map(() => progress.distanceM),
    interval: {
      reps: progress.plannedReps,
      distanceM: progress.distanceM,
      targetSec: progress.targetSec,
      restType: "jog",
      results: progress.reps.map((t, i) => ({
        index: i + 1,
        distanceM: progress.distanceM,
        targetSec: progress.targetSec,
        actualSec: t,
      })),
    },
    completedReps: progress.reps.length,
    prescribedReps: progress.plannedReps,
    aborted,
    abortReason: aborted ? view.evaluation.message : undefined,
    abortCause,
    abortNote: input.abortNote?.trim() || undefined,
    achievement: "achieved",
    rpe: input.rpe,
    subjective: input.subjective,
    note: input.note,
    weatherTempC: input.tempC,
    humidityPct: input.humidityPct,
  };
  const out = processResult(repo, result);
  repo.deleteKv(progressKey(sessionId));
  if (aborted) {
    out.guardrailNotes = [
      "打ち切りとして記録しました。失敗ではありません。中止基準にしたがって止めた本数はCFEの未達には数えません",
      // 選んだ理由が何に効いたかを、その場で返す（黙って扱いを変えない）
      ...(abortCause ? [describeAbortCause(abortCause, input.abortNote)] : []),
      ...(needsInjuryLog(abortCause)
        ? ["痛みで止めたときは、部位と強さを故障ログに残してください。残さないと次のメニューの判定に届きません"]
        : []),
      ...out.guardrailNotes,
    ];
  }
  return out;
}

/** 入力途中を捨てる */
export function discardSessionProgress(repo: Store, sessionId: string): void {
  repo.deleteKv(progressKey(sessionId));
}
