import { describe, it, expect } from "vitest";
import { findPreviousEntry } from "@/lib/core/workoutLog";
import { makeSession, makeResult } from "./helpers";
import type { Session, SessionResult } from "@/lib/core/types";

/**
 * D-3「前回と同じ」
 *
 * ここで守りたいのは「違う練習を前回と同じとして出さないこと」。
 * トラックで急いで入力しているときに中身を見ずに登録されると、
 * そのままCFEの更新に流れてしまう。
 */
describe("D-3 前回と同じ", () => {
  function fixture(): { sessions: Session[]; results: SessionResult[] } {
    const hl1 = makeSession("2026-07-07", "high_lactate");
    const hl2 = makeSession("2026-07-14", "high_lactate");
    const eco = makeSession("2026-07-17", "race_economy");
    const hlFuture = makeSession("2026-07-28", "high_lactate");
    const sessions = [hl1, hl2, eco, hlFuture];
    const results = [
      makeResult(hl1, { rpe: 8 }),
      makeResult(hl2, { rpe: 9 }),
      makeResult(eco, { rpe: 6 }),
    ];
    return { sessions, results };
  }

  it("同じカテゴリの直近の記録を返す", () => {
    const { sessions, results } = fixture();
    const p = findPreviousEntry(sessions, results, "high_lactate", "2026-07-21");
    expect(p?.date).toBe("2026-07-14");
    expect(p?.result.rpe).toBe(9);
  });

  it("違うカテゴリの記録は絶対に返さない（経済走に高乳酸を持ってこない）", () => {
    const { sessions, results } = fixture();
    const p = findPreviousEntry(sessions, results, "race_economy", "2026-07-21");
    expect(p?.date).toBe("2026-07-17");
    expect(p?.category).toBe("race_economy");
  });

  it("未来のセッションは対象外（まだ実施していないものを前回にしない）", () => {
    const { sessions, results } = fixture();
    const p = findPreviousEntry(sessions, results, "high_lactate", "2026-07-10");
    expect(p?.date).toBe("2026-07-07");
  });

  it("記録が無いセッションは対象外", () => {
    const { sessions } = fixture();
    const p = findPreviousEntry(sessions, [], "high_lactate", "2026-07-21");
    expect(p).toBeUndefined();
  });

  it("自分自身は対象から外す（同じ日を読み込んで上書きしない）", () => {
    const { sessions, results } = fixture();
    const self = sessions.find((s) => s.date === "2026-07-14")!;
    const p = findPreviousEntry(
      sessions,
      results,
      "high_lactate",
      "2026-07-21",
      self.id
    );
    expect(p?.date).toBe("2026-07-07");
  });

  it("出典ラベルを必ず返す（画面に出させて事故を防ぐ）", () => {
    const { sessions, results } = fixture();
    const p = findPreviousEntry(sessions, results, "high_lactate", "2026-07-21");
    expect(p?.label).toContain("07-14");
    expect(p?.label.length).toBeGreaterThan(5);
  });

  it("候補が無ければ undefined（何も読み込まない）", () => {
    const { sessions, results } = fixture();
    expect(findPreviousEntry(sessions, results, "modeling", "2026-07-21")).toBeUndefined();
  });
});
