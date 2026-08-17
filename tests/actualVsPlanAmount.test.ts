/**
 * 予定と違うことをやったか。
 *
 * これまで**種目の食い違い**（ジョグの予定でインターバル）しか見ていなかった。
 * 30分の予定を50分やっても種目は同じなので、カレンダーには何も出ず、
 * 予定どおりに見えていた（実際に指摘された）。
 *
 * ここで守らせたいのは2つ。
 *   ・意味のある差は見逃さない（30分 → 50分）
 *   ・普通の揺れに印を付けない（40分 → 42分）
 *     **印が付いていること自体が情報でなくなる**ため
 */
import { describe, expect, it } from "vitest";
import { actualDiffersFromPlan, describeActualResult } from "@/lib/core/actualVsPlan";
import type { Session, SessionResult } from "@/lib/core/types";

function jogSession(over: Partial<Session> = {}): Session {
  return {
    id: "s1",
    date: "2026-08-18",
    category: "aerobic",
    name: "ジョグ",
    status: "planned",
    durationMin: 30,
    ...over,
  } as Session;
}

function jogResult(durationMin: number, distanceKm?: number): SessionResult {
  return {
    id: "r1",
    sessionId: "s1",
    date: "2026-08-18",
    actualLapsSec: [],
    continuous: { distanceKm: distanceKm ?? 6, durationMin },
    achievement: "achieved",
    rpe: 5,
    subjective: "easy",
  } as SessionResult;
}

describe("量の食い違い（時間）", () => {
  it("30分の予定を50分やったら違うと言う", () => {
    expect(actualDiffersFromPlan(jogSession({ durationMin: 30 }), jogResult(50))).toBe(true);
  });

  it("50分の予定を30分で終えても違うと言う（減った側も見る）", () => {
    expect(actualDiffersFromPlan(jogSession({ durationMin: 50 }), jogResult(30))).toBe(true);
  });

  it("40分 → 42分は普通の揺れなので言わない", () => {
    expect(actualDiffersFromPlan(jogSession({ durationMin: 40 }), jogResult(42))).toBe(false);
  });

  it("10分 → 12分も言わない（割合は20%だが差は2分）", () => {
    expect(actualDiffersFromPlan(jogSession({ durationMin: 10 }), jogResult(12))).toBe(false);
  });

  it("90分 → 95分も言わない（差は5分だが割合が小さい）", () => {
    expect(actualDiffersFromPlan(jogSession({ durationMin: 90 }), jogResult(95))).toBe(false);
  });

  it("予定に時間が無ければ言わない（比べる先が無い）", () => {
    expect(actualDiffersFromPlan(jogSession({ durationMin: undefined }), jogResult(50))).toBe(
      false
    );
  });

  it("同じなら言わない", () => {
    expect(actualDiffersFromPlan(jogSession({ durationMin: 40 }), jogResult(40))).toBe(false);
  });
});

describe("量の食い違い（距離）", () => {
  it("8kmの予定を12km走ったら違うと言う", () => {
    const s = jogSession({ durationMin: undefined, distanceKm: 8 });
    expect(actualDiffersFromPlan(s, jogResult(50, 12))).toBe(true);
  });

  it("10km → 10.5km は言わない", () => {
    const s = jogSession({ durationMin: undefined, distanceKm: 10 });
    expect(actualDiffersFromPlan(s, jogResult(50, 10.5))).toBe(false);
  });
});

describe("これまでどおり見るもの", () => {
  it("ジョグの予定でインターバルをやったら違うと言う", () => {
    const r = {
      id: "r1",
      sessionId: "s1",
      date: "2026-08-18",
      actualLapsSec: [],
      interval: { reps: 5, distanceM: 300, restType: "jog", restSec: 300, results: [] },
      achievement: "achieved",
      rpe: 7,
      subjective: "hard",
    } as SessionResult;
    expect(actualDiffersFromPlan(jogSession(), r)).toBe(true);
  });

  it("記録が無ければ言わない", () => {
    expect(actualDiffersFromPlan(jogSession(), undefined)).toBe(false);
  });
});

describe("インターバルの距離", () => {
  const point = {
    id: "s2",
    date: "2026-08-18",
    category: "high_lactate",
    name: "高乳酸",
    status: "planned",
    targetPaces: [{ distanceM: 300, targetSecFast: 41, targetSecSlow: 42 }],
  } as Session;

  const ivResult = (distanceM: number): SessionResult =>
    ({
      id: "r2",
      sessionId: "s2",
      date: "2026-08-18",
      actualLapsSec: [],
      interval: { reps: 5, distanceM, restType: "jog", restSec: 300, results: [] },
      achievement: "achieved",
      rpe: 8,
      subjective: "hard",
    }) as SessionResult;

  it("300m予定を400mでやったら違うと言う", () => {
    expect(actualDiffersFromPlan(point, ivResult(400))).toBe(true);
  });

  it("同じ距離なら言わない", () => {
    expect(actualDiffersFromPlan(point, ivResult(300))).toBe(false);
  });

  /*
   * 本数の減りは「中止 2/4本」の印で既に出している。
   * 同じことを2つの印で言うと、どちらを見ればいいのか分からなくなる。
   */
  it("本数が違うだけでは言わない（打ち切りの印と二重にしない）", () => {
    const fewer = {
      ...ivResult(300),
      interval: { reps: 3, distanceM: 300, restType: "jog", restSec: 300, results: [] },
    } as SessionResult;
    expect(actualDiffersFromPlan(point, fewer)).toBe(false);
  });
});

describe("実際にやった内容の要約", () => {
  it("持続走は距離と時間で出す", () => {
    expect(describeActualResult(jogResult(50, 10))).toBe("10km 50分");
  });
});
