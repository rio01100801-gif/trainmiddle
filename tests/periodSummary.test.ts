/**
 * 分析画面 PERFORMANCE の期間集計。
 * 予定を数えない／既存の負荷定義を使う／前期比の定義、を固定する。
 */
import { describe, expect, it } from "vitest";
import {
  formatPeriodRange,
  periodSummary,
  PERIOD_DAYS,
  type PeriodKind,
} from "@/lib/core/periodSummary";
import { makeResult, makeSession } from "./helpers";
import type { Session, SessionResult } from "@/lib/core/types";

/** 実施済みのジョグを1本作る */
function done(date: string, distanceKm: number, durationMin: number, rpe = 3) {
  const s = makeSession(date, "aerobic", { status: "completed", distanceKm, durationMin });
  const r = makeResult(s, {
    rpe,
    durationMin,
    continuous: { distanceKm, durationMin, avgPaceSecPerKm: (durationMin * 60) / distanceKm },
  });
  return { s, r };
}

function run(entries: { s: Session; r?: SessionResult }[], today: string, kind: PeriodKind) {
  return periodSummary({
    sessions: entries.map((e) => e.s),
    resultsBySessionId: new Map(
      entries.filter((e) => e.r).map((e) => [e.s.id, e.r as SessionResult])
    ),
    today,
    kind,
  });
}

describe("PERFORMANCE の期間集計", () => {
  it("期間は今日で終わる移動窓（暦の月境界ではない）", () => {
    const out = run([], "2026-05-20", "month");
    expect(out.to).toBe("2026-05-20");
    expect(out.from).toBe("2026-04-21"); // 30日窓
    expect(out.prevTo).toBe("2026-04-20");
    expect(out.prevFrom).toBe("2026-03-22");
    expect(formatPeriodRange(out)).toBe("4/21 - 5/20");
  });

  it("WEEK/MONTH/YEARの窓の長さ", () => {
    expect(PERIOD_DAYS.week).toBe(7);
    expect(PERIOD_DAYS.month).toBe(30);
    expect(PERIOD_DAYS.year).toBe(365);
  });

  it("実施したぶんだけを数え、予定は数えない", () => {
    const planned = makeSession("2026-05-19", "aerobic", { distanceKm: 99, durationMin: 99 });
    const a = done("2026-05-18", 10, 50);
    const out = run([a, { s: planned }], "2026-05-20", "week");
    expect(out.totalDistanceKm).toBe(10);
    expect(out.totalDurationMin).toBe(50);
  });

  it("強度は既存の負荷定義（RPE×分）の合計", () => {
    const a = done("2026-05-18", 10, 50, 4);
    const out = run([a], "2026-05-20", "week");
    expect(out.totalLoad).toBe(200); // 4 × 50
  });

  it("平均ペースは総時間÷総距離。距離が0なら出さない（推測で埋めない）", () => {
    const a = done("2026-05-18", 10, 50);
    expect(run([a], "2026-05-20", "week").avgPaceSecPerKm).toBeCloseTo(300, 5);
    expect(run([], "2026-05-20", "week").avgPaceSecPerKm).toBeUndefined();
  });

  it("前期比は直前の同じ長さの期間と比べる", () => {
    const cur = done("2026-05-18", 12, 60);
    const prev = done("2026-05-10", 10, 50); // 5/7〜5/13 が前期
    const out = run([cur, prev], "2026-05-20", "week");
    expect(out.totalDistanceKm).toBe(12);
    expect(out.deltaPct).toBe(20); // (12-10)/10
  });

  it("前期が0なら増減率は出さない（何倍か定義できない）", () => {
    const cur = done("2026-05-18", 12, 60);
    expect(run([cur], "2026-05-20", "week").deltaPct).toBeUndefined();
  });

  it("折れ線は累積で、単調に増える（実施が無い日は横ばい）", () => {
    const a = done("2026-05-18", 5, 25);
    const b = done("2026-05-20", 7, 35);
    const out = run([a, b], "2026-05-20", "week");
    const ys = out.points.map((p) => p.cumulativeKm);
    for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeGreaterThanOrEqual(ys[i - 1]);
    expect(ys[ys.length - 1]).toBe(12);
    expect(out.points).toHaveLength(7);
  });

  it("YEARは点を間引くが、最終値は総距離と一致する", () => {
    const a = done("2026-05-18", 8, 40);
    const out = run([a], "2026-05-20", "year");
    expect(out.points.length).toBeLessThan(60);
    expect(out.points[out.points.length - 1].cumulativeKm).toBe(out.totalDistanceKm);
  });

  it("同じ入力からは同じ結果になる（決定的）", () => {
    const a = done("2026-05-18", 8, 40);
    const x = run([a], "2026-05-20", "month");
    const y = run([a], "2026-05-20", "month");
    expect(x).toEqual(y);
  });
});
