import { describe, expect, it } from "vitest";
import {
  planVolumeProgression,
  VOLUME_HORIZON_DAYS,
  WEEKLY_VOLUME_INCREASE_LIMIT,
} from "@/lib/core/volumeProgression";
import { makeSession } from "./helpers";

describe("量を増やすのカレンダー反映", () => {
  const anchor = () =>
    makeSession("2026-07-20", "high_lactate", {
      prescription: "300m × 5 r5分",
      durationMin: 60,
      distanceKm: 8,
    });

  it("今後14日の自動生成ジョグへ時間増加を反映する", () => {
    const base = anchor();
    const jog = makeSession("2026-07-22", "aerobic", {
      prescription: "40分ジョグ",
      durationMin: 40,
      distanceKm: 8,
    });
    const filler = makeSession("2026-07-24", "aerobic", {
      prescription: "50分ジョグ",
      durationMin: 50,
      distanceKm: 10,
    });
    const changes = planVolumeProgression({
      sessions: [base, jog, filler],
      anchorSessionId: base.id,
      today: "2026-07-20",
      raceDate: "2026-09-20",
    });
    expect(VOLUME_HORIZON_DAYS).toBe(14);
    expect(changes.some((change) => change.sessionId === jog.id)).toBe(true);
    expect(changes.find((change) => change.sessionId === jog.id)!.next.durationMin).toBe(45);
  });

  it("完了済み・過去・手動変更・固定・回復日を上書きしない", () => {
    const base = anchor();
    const protectedSessions = [
      makeSession("2026-07-19", "aerobic", { status: "planned", durationMin: 40 }),
      makeSession("2026-07-21", "aerobic", { status: "completed", durationMin: 40 }),
      makeSession("2026-07-22", "aerobic", { status: "modified", durationMin: 40 }),
      makeSession("2026-07-23", "aerobic", { isFixed: true, durationMin: 40 }),
      makeSession("2026-07-24", "aerobic", { name: "回復ジョグ", durationMin: 30 }),
    ];
    const changes = planVolumeProgression({
      sessions: [base, ...protectedSessions],
      anchorSessionId: base.id,
      today: "2026-07-20",
    });
    expect(changes).toEqual([]);
  });

  it("テーパーと高乳酸・モデリングの本数を増やさない", () => {
    const base = anchor();
    const sessions = [
      base,
      makeSession("2026-07-22", "high_lactate", { prescription: "300m × 5" }),
      makeSession("2026-07-24", "modeling", { prescription: "600m + 200m" }),
      makeSession("2026-07-26", "aerobic", {
        phase: "Taper",
        durationMin: 40,
        prescription: "40分ジョグ",
      }),
    ];
    const changes = planVolumeProgression({
      sessions,
      anchorSessionId: base.id,
      today: "2026-07-20",
    });
    expect(changes).toEqual([]);
  });

  it("週全体の増加を10%以内に抑える", () => {
    const base = anchor();
    const jogs = [22, 23, 24].map((day) =>
      makeSession(`2026-07-${day}`, "aerobic", {
        prescription: "40分ジョグ",
        durationMin: 40,
        distanceKm: 4,
      })
    );
    const sessions = [base, ...jogs];
    const changes = planVolumeProgression({
      sessions,
      anchorSessionId: base.id,
      today: "2026-07-20",
    });
    const delta = changes.reduce((sum, change) => {
      const before = sessions.find((session) => session.id === change.sessionId)!.distanceKm ?? 0;
      return sum + (change.next.distanceKm ?? 0) - before;
    }, 0);
    const weekDistance = sessions.reduce((sum, session) => sum + (session.distanceKm ?? 0), 0);
    expect(delta).toBeLessThanOrEqual(weekDistance * WEEKLY_VOLUME_INCREASE_LIMIT);
  });
});
