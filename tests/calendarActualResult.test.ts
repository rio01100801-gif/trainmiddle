/**
 * 不具合2: 予定と違う練習をして結果を記録すると、カレンダーに予定のメニューが
 * 残ってしまう問題。src/lib/core/actualVsPlan.ts の判定・要約をテストする
 * （app/calendar/page.tsx のDayRowはこれをそのまま使う）。
 */
import { describe, it, expect } from "vitest";
import { actualDiffersFromPlan, describeActualResult } from "@/lib/core/actualVsPlan";
import { makeSession } from "./helpers";

describe("actualDiffersFromPlan", () => {
  it("結果が無ければ食い違いなし", () => {
    const s = makeSession("2026-04-02", "high_lactate");
    expect(actualDiffersFromPlan(s, undefined)).toBe(false);
  });

  it("有酸素の予定にintervalの結果は食い違い", () => {
    const s = makeSession("2026-04-02", "aerobic");
    const r = { interval: { reps: 5, distanceM: 300, targetSec: 55 } };
    expect(actualDiffersFromPlan(s, r)).toBe(true);
  });

  it("高乳酸の予定にcontinuousの結果は食い違い（坂ダッシュの代わりにジョグをした等）", () => {
    const s = makeSession("2026-04-02", "high_lactate");
    const r = { continuous: { distanceKm: 8, durationMin: 45, avgPaceSecPerKm: 337 } };
    expect(actualDiffersFromPlan(s, r)).toBe(true);
  });

  it("予定どおりの種別なら食い違いなし", () => {
    const aerobic = makeSession("2026-04-02", "aerobic");
    const jogResult = { continuous: { distanceKm: 8, durationMin: 45, avgPaceSecPerKm: 337 } };
    expect(actualDiffersFromPlan(aerobic, jogResult)).toBe(false);

    const hl = makeSession("2026-04-02", "high_lactate");
    const intervalResult = { interval: { reps: 5, distanceM: 300, targetSec: 55 } };
    expect(actualDiffersFromPlan(hl, intervalResult)).toBe(false);
  });
});

describe("describeActualResult", () => {
  it("intervalの結果を本数・距離・目標で要約する", () => {
    const r = { interval: { reps: 6, distanceM: 200, targetSec: 32 } };
    expect(describeActualResult(r)).toBe("6本 200m @32秒");
  });

  it("continuousの結果を距離・時間で要約する", () => {
    const r = { continuous: { distanceKm: 10, durationMin: 50, avgPaceSecPerKm: 300 } };
    expect(describeActualResult(r)).toBe("10km 50分");
  });

  it("どちらも無ければundefined", () => {
    expect(describeActualResult({})).toBeUndefined();
    expect(describeActualResult(undefined)).toBeUndefined();
  });
});
