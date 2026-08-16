/**
 * カレンダーに出す「中止」の印。
 *
 * これまでカレンダーは**種目の食い違いしか見ていなかった**ので、
 * 「4本の予定を2本で止めた」は画面のどこにも出ていなかった。
 * 予定どおり終えた日と見分けが付かず、あとから週を眺めても
 * どこで切ったのかが分からない。
 */
import { describe, expect, it } from "vitest";
import { describeAbort } from "@/lib/core/actualVsPlan";
import type { SessionResult } from "@/lib/core/types";

const result = (over: Partial<SessionResult> = {}): SessionResult =>
  ({
    id: "r1",
    sessionId: "s1",
    date: "2026-08-17",
    actualLapsSec: [],
    achievement: "achieved",
    rpe: 7,
    subjective: "moderate",
    ...over,
  }) as SessionResult;

describe("中止の印", () => {
  it("やめていなければ出さない", () => {
    expect(describeAbort(result())).toBeUndefined();
    expect(describeAbort(undefined)).toBeUndefined();
  });

  it("本数が分かれば何本で切ったかを出す", () => {
    expect(describeAbort(result({ aborted: true, completedReps: 2, prescribedReps: 4 }))).toBe(
      "中止 2/4本"
    );
  });

  it("理由が入っていれば添える（扱いが違うものを同じ顔にしない）", () => {
    const out = describeAbort(
      result({ aborted: true, completedReps: 2, prescribedReps: 4, abortCause: "condition" })
    );
    expect(out).toContain("2/4本");
    expect(out).toContain("天候・路面");
  });

  it("本数が分からなくても、中止だとは言う", () => {
    expect(describeAbort(result({ aborted: true }))).toBe("中止");
  });

  it("理由だけ分かるときは理由を出す", () => {
    expect(describeAbort(result({ aborted: true, abortCause: "taper" }))).toBe("中止 レースの調整");
  });
});
