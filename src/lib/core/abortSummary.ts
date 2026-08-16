/**
 * 打ち切りの理由別の内訳。
 *
 * 「なぜ止めたか」は forge-v98 から記録しているが、**貯まっても誰も見ていなかった**。
 * 理由ごとに扱いが違う（設定を緩める材料になるもの／ならないもの）ので、
 * どの理由がどれだけ起きているかは、そのまま次の判断の材料になる。
 *
 * ---
 *
 * **なぜ端末の中で数えるのか。**
 *
 * 記録は端末（PWAのIndexedDB）にあり、PC側のSQLiteは開発用のダミー。
 * 「3回たまったら知らせる」を定期実行の仕掛けで作っても、
 * **数えるのはダミーのほう**になる。本物を数えられるのはアプリの中だけ。
 * だから画面に出す。鍵も通信も要らない。
 */
import { ABORT_CAUSES, abortCauseLabel, type AbortCause } from "./abortCause";
import { diffDays } from "./dates";
import type { SessionResult } from "./types";

/** 数える範囲。BACKFILL と同じ12週に揃える（見る窓を画面ごとに変えない） */
export const ABORT_SUMMARY_WEEKS = 12;

/**
 * 「出力が出すぎた」がこの回数たまったら、設定を上げる材料にするか検討する。
 *
 * **3回は「たまたま調子が良かった日」を除くための下限であって、
 * これだけで設定を動かす根拠ではない。**
 * 実行可能率の測定（BACKLOG A-2）と両方そろって初めて動かす。
 * 判断の中身は BACKLOG の A-2b に条件つきで書いてある。
 */
export const TOO_FAST_REVIEW_COUNT = 3;

export interface AbortCount {
  cause: AbortCause | "unknown";
  label: string;
  count: number;
  /** 設定ペースを緩める材料に数えるか（画面で扱いの違いを見せる） */
  countsTowardPaceEase: boolean;
}

export interface AbortSummary {
  /** 数えた範囲の日数 */
  windowDays: number;
  total: number;
  counts: AbortCount[];
  /** 「出力が出すぎた」が検討の回数に達したか */
  tooFastReached: boolean;
  tooFastCount: number;
}

/**
 * 直近12週の打ち切りを理由ごとに数える。
 *
 * 0件の理由は返さない（並べても読むものが増えるだけ）。
 * 理由が入っていない打ち切り（旧データ）は「未記入」としてまとめる——
 * **勝手にどれかの理由に割り振らない。**
 */
export function abortSummary(results: SessionResult[], today: string): AbortSummary {
  const windowDays = ABORT_SUMMARY_WEEKS * 7;
  const tally = new Map<AbortCause | "unknown", number>();
  let total = 0;

  for (const r of results) {
    if (!r.aborted) continue;
    if (diffDays(r.date, today) > windowDays) continue;
    const key = r.abortCause ?? "unknown";
    tally.set(key, (tally.get(key) ?? 0) + 1);
    total += 1;
  }

  // 並びは理由の一覧と同じ順。数の多い順にすると、見るたびに位置が変わる
  const counts: AbortCount[] = [];
  for (const info of ABORT_CAUSES) {
    const count = tally.get(info.id) ?? 0;
    if (count === 0) continue;
    counts.push({
      cause: info.id,
      label: info.label,
      count,
      countsTowardPaceEase: info.id === "pace" || info.id === "fatigue",
    });
  }
  const unknown = tally.get("unknown") ?? 0;
  if (unknown > 0) {
    counts.push({
      cause: "unknown",
      label: "未記入",
      count: unknown,
      // 理由を選べるようにする前の打ち切りは中止基準そのもの（abortCause.ts）
      countsTowardPaceEase: true,
    });
  }

  const tooFastCount = tally.get("too_fast") ?? 0;
  return {
    windowDays,
    total,
    counts,
    tooFastCount,
    tooFastReached: tooFastCount >= TOO_FAST_REVIEW_COUNT,
  };
}

/** 画面に出す一文。数えただけで終わらせず、次に何を見るかまで書く */
export function describeAbortSummary(summary: AbortSummary): string {
  if (summary.total === 0) {
    return `直近${ABORT_SUMMARY_WEEKS}週で途中でやめた練習はありません。`;
  }
  const eased = summary.counts
    .filter((c) => c.countsTowardPaceEase)
    .reduce((a, c) => a + c.count, 0);
  return (
    `直近${ABORT_SUMMARY_WEEKS}週で${summary.total}回。` +
    `うち${eased}回を設定ペースの見直しに数えています` +
    `（${abortCauseLabel("pace")}・${abortCauseLabel("fatigue")}のみ）。`
  );
}
