/**
 * 打ち切りの理由別の内訳。
 *
 * 理由は forge-v98 から記録していたが、**貯まっても誰も見ていなかった**。
 * 数えるのは端末の中でしかできない（本物の記録はPWAのIndexedDBにあり、
 * PC側のSQLiteは開発用のダミー）。だから定期実行ではなく画面に出す。
 */
import { describe, expect, it } from "vitest";
import {
  ABORT_SUMMARY_WEEKS,
  TOO_FAST_REVIEW_COUNT,
  abortSummary,
  describeAbortSummary,
} from "@/lib/core/abortSummary";
import type { SessionResult } from "@/lib/core/types";
import type { AbortCause } from "@/lib/core/abortCause";

const TODAY = "2026-08-17";
const r = (over: Partial<SessionResult> = {}): SessionResult =>
  ({
    id: `r-${Math.random()}`,
    sessionId: `s-${Math.random()}`,
    date: TODAY,
    actualLapsSec: [],
    achievement: "achieved",
    rpe: 7,
    subjective: "moderate",
    ...over,
  }) as SessionResult;

const aborted = (cause?: AbortCause, date = TODAY) =>
  r({ aborted: true, abortCause: cause, date });

describe("数える", () => {
  it("打ち切っていない記録は数えない", () => {
    expect(abortSummary([r(), r()], TODAY).total).toBe(0);
  });

  it("理由ごとに数える", () => {
    const s = abortSummary([aborted("pace"), aborted("pace"), aborted("condition")], TODAY);
    expect(s.total).toBe(3);
    expect(s.counts.find((c) => c.cause === "pace")?.count).toBe(2);
    expect(s.counts.find((c) => c.cause === "condition")?.count).toBe(1);
  });

  it("0件の理由は並べない", () => {
    const s = abortSummary([aborted("pace")], TODAY);
    expect(s.counts).toHaveLength(1);
  });

  it("並びは理由の一覧と同じ順（見るたびに位置が変わらない）", () => {
    const a = abortSummary([aborted("condition"), aborted("pace")], TODAY);
    const b = abortSummary([aborted("pace"), aborted("condition")], TODAY);
    expect(a.counts.map((c) => c.cause)).toEqual(b.counts.map((c) => c.cause));
    expect(a.counts[0].cause).toBe("pace");
  });

  it("理由の無い打ち切りは「未記入」にまとめる（勝手に割り振らない）", () => {
    const s = abortSummary([aborted(undefined)], TODAY);
    expect(s.counts[0].cause).toBe("unknown");
    expect(s.counts[0].label).toBe("未記入");
    // 旧データの打ち切りは中止基準そのものなので、設定に反映される側
    expect(s.counts[0].countsTowardPaceEase).toBe(true);
  });

  it("扱いの違いを持つ（設定に反映するかどうか）", () => {
    const s = abortSummary([aborted("pace"), aborted("condition")], TODAY);
    expect(s.counts.find((c) => c.cause === "pace")?.countsTowardPaceEase).toBe(true);
    expect(s.counts.find((c) => c.cause === "condition")?.countsTowardPaceEase).toBe(false);
  });
});

describe("数える範囲", () => {
  it("12週より古い記録は数えない", () => {
    const old = "2026-01-01"; // 12週以上前
    expect(abortSummary([aborted("pace", old)], TODAY).total).toBe(0);
    expect(ABORT_SUMMARY_WEEKS).toBe(12);
  });

  it("範囲の中なら数える", () => {
    expect(abortSummary([aborted("pace", "2026-08-01")], TODAY).total).toBe(1);
  });
});

describe("出力が出すぎたの検討の合図", () => {
  it("回数に届くまでは出さない", () => {
    const s = abortSummary(
      Array.from({ length: TOO_FAST_REVIEW_COUNT - 1 }, () => aborted("too_fast")),
      TODAY
    );
    expect(s.tooFastReached).toBe(false);
  });

  it("届いたら出す", () => {
    const s = abortSummary(
      Array.from({ length: TOO_FAST_REVIEW_COUNT }, () => aborted("too_fast")),
      TODAY
    );
    expect(s.tooFastReached).toBe(true);
    expect(s.tooFastCount).toBe(TOO_FAST_REVIEW_COUNT);
  });

  it("ほかの理由が何回あっても合図にはならない", () => {
    const s = abortSummary(
      Array.from({ length: 10 }, () => aborted("condition")),
      TODAY
    );
    expect(s.tooFastReached).toBe(false);
  });
});

describe("説明文", () => {
  it("1回も無ければそう言う", () => {
    expect(describeAbortSummary(abortSummary([], TODAY))).toContain("ありません");
  });

  it("何回を設定の見直しに数えたかを書く（黙って扱いを変えない）", () => {
    const text = describeAbortSummary(
      abortSummary([aborted("pace"), aborted("condition"), aborted("schedule")], TODAY)
    );
    expect(text).toContain("3回");
    expect(text).toContain("1回を設定ペースの見直しに数えています");
  });
});
