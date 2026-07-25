/**
 * M-3 中止基準を処方に含める / M-4 セッション中の判定
 *
 * なぜ必要か:
 * 処方が「1000m×4 3:10」という点だけだと、3:16で走り始めた時点で
 * どうすべきかが決まっていない。実際の800m練習では、
 * 設定から外れ始めたときに本数を切る判断のほうが、最後まで消化することより重要になる。
 *
 * 設定から大きく外れた本数を消化しても、狙った代謝刺激は入らない。
 * 残るのは疲労だけで、次の質練習まで影響する。
 * 耐乳酸型は1本目を突っ込んで後半が垂れやすいので、
 * 垂れた状態で消化を続けると、耐乳酸練習ではなく単なる糖枯渇練習に変わる。
 *
 * だから打ち切りは「失敗」ではない。設定が高すぎたか、その日の状態が悪かったかの
 * どちらかであって、どちらも次の設定を決める材料になる（M-2 が受け取る）。
 */
import type { SessionCategory } from "./types";

export interface AbortCriteria {
  /** 1本あたりの許容幅（秒）。設定 + これを超えたら「外れた」とみなす */
  toleranceSec: number;
  /** 何本連続で外れたら打ち切るか */
  maxConsecutiveOver: number;
  /** 画面に出す一文 */
  text: string;
}

/**
 * 高乳酸・モデリングは1本でも大きく外れたら止める。
 * このカテゴリは「レースペース近辺を狙った本数だけ繰り返す」のが目的なので、
 * 1本外れた時点で目的から外れている。
 * それ以外は2本連続を条件にする（1本の乱れはよくあるため）。
 */
export const STRICT_CATEGORIES: SessionCategory[] = ["high_lactate", "modeling"];
export const STRICT_TOLERANCE_SEC = 2.0;
/** 許容幅は設定の1.5%。1000mを3:10なら約2.9秒 */
export const TOLERANCE_RATIO = 0.015;
export const MIN_TOLERANCE_SEC = 2.0;

export function abortCriteria(
  category: SessionCategory,
  targetSec: number
): AbortCriteria {
  if (STRICT_CATEGORIES.includes(category)) {
    return {
      toleranceSec: STRICT_TOLERANCE_SEC,
      maxConsecutiveOver: 1,
      text: `設定+${STRICT_TOLERANCE_SEC.toFixed(1)}秒を1本でも超えたら残りを打ち切る`,
    };
  }
  const tol = Math.round(Math.max(MIN_TOLERANCE_SEC, targetSec * TOLERANCE_RATIO) * 10) / 10;
  return {
    toleranceSec: tol,
    maxConsecutiveOver: 2,
    text: `2本連続で設定+${tol.toFixed(1)}秒を超えたら残りを打ち切る`,
  };
}

/** 処方に添える1行。設定と許容と打ち切り条件を1つの文にする */
export function prescriptionWithCriteria(
  prescription: string,
  targetSec: number,
  c: AbortCriteria
): string {
  return `${prescription}\n設定 ${fmt(targetSec)}（許容 +${c.toleranceSec.toFixed(1)}秒）／${c.text}`;
}

function fmt(sec: number): string {
  if (sec < 60) return `${sec.toFixed(1)}秒`;
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}

// ---------------------------------------------------------------------------
// セッション中の判定（M-4）
// ---------------------------------------------------------------------------

export type RepVerdict = "continue" | "stop" | "done";

export interface RepEvaluation {
  verdict: RepVerdict;
  /** 直近の1本 */
  lastSec?: number;
  /** 設定との差（正 = 遅い） */
  lastDeviationSec?: number;
  /** 垂れ幅: 最後の1本 − 最初の1本 */
  fadeSec?: number;
  consecutiveOver: number;
  doneReps: number;
  /** 画面に出す1行 */
  message: string;
}

/**
 * 1本入れるごとに、次を行うべきかを返す。
 * 出すのは3つだけ（直近の1本・設定との差・続行か中止か）。
 * 走っている最中に読める情報量には限りがある。
 */
export function evaluateReps(
  actualSec: number[],
  targetSec: number,
  plannedReps: number,
  c: AbortCriteria
): RepEvaluation {
  const done = actualSec.length;
  if (done === 0) {
    return {
      verdict: "continue",
      consecutiveOver: 0,
      doneReps: 0,
      message: `設定 ${fmt(targetSec)}。1本目を入れてください`,
    };
  }

  const last = actualSec[done - 1];
  const dev = last - targetSec;
  const fade = last - actualSec[0];

  let consecutive = 0;
  for (let i = done - 1; i >= 0; i--) {
    if (actualSec[i] - targetSec > c.toleranceSec) consecutive++;
    else break;
  }

  if (consecutive >= c.maxConsecutiveOver) {
    return {
      verdict: "stop",
      lastSec: last,
      lastDeviationSec: dev,
      fadeSec: fade,
      consecutiveOver: consecutive,
      doneReps: done,
      message:
        (consecutive === 1
          ? `設定+${c.toleranceSec.toFixed(1)}秒を超えました。`
          : `${consecutive}本連続で設定+${c.toleranceSec.toFixed(1)}秒を超えました。`) +
        "ここで打ち切ってください。残りを消化しても狙った刺激は入らず、疲労だけが残ります",
    };
  }

  if (done >= plannedReps) {
    return {
      verdict: "done",
      lastSec: last,
      lastDeviationSec: dev,
      fadeSec: fade,
      consecutiveOver: consecutive,
      doneReps: done,
      message: `予定の${plannedReps}本が終わりました`,
    };
  }

  return {
    verdict: "continue",
    lastSec: last,
    lastDeviationSec: dev,
    fadeSec: fade,
    consecutiveOver: consecutive,
    doneReps: done,
    message:
      `設定との差 ${dev >= 0 ? "+" : ""}${dev.toFixed(1)}秒` +
      (done >= 2 ? `／垂れ幅 ${fade >= 0 ? "+" : ""}${fade.toFixed(1)}秒` : "") +
      `。残り${plannedReps - done}本`,
  };
}
