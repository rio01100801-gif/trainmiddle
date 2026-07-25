/**
 * M-6 レース前の変則調整。
 *
 * 原則は「量を落として強度は維持」。
 * 強度まで落とすとレースペース感覚と神経系の出力が落ちる。
 */
import { describe, it, expect } from "vitest";
import {
  planTaper,
  shouldSuppressVolumeAdjustment,
  taperStage,
  VOLUME_RATIO,
} from "@/lib/core/taper";
import { memRepo } from "./sqlite-helper";
import { applyTaperPlan, regeneratePlan, taperPlan, rejectTaperPlan } from "@/lib/service";
import { makeRace, makeSession, testAthlete } from "./helpers";
import type { Goal, Session } from "@/lib/core/types";

const RACE = "2026-09-25";

describe("段階の判定", () => {
  it("残り日数で段階が決まる", () => {
    expect(taperStage("2026-09-01", RACE)).toBe("none");
    expect(taperStage("2026-09-12", RACE)).toBe("t14");
    expect(taperStage("2026-09-16", RACE)).toBe("t10");
    expect(taperStage("2026-09-19", RACE)).toBe("t7");
    expect(taperStage("2026-09-23", RACE)).toBe("t3");
    expect(taperStage("2026-09-24", RACE)).toBe("eve");
  });

  it("段階が進むほど量が減る", () => {
    expect(VOLUME_RATIO.t14).toBeGreaterThan(VOLUME_RATIO.t10);
    expect(VOLUME_RATIO.t10).toBeGreaterThan(VOLUME_RATIO.t7);
    expect(VOLUME_RATIO.t7).toBeGreaterThan(VOLUME_RATIO.t3);
  });

  it("テーパー期はM-2の量の調整を止める（二重に落とさない）", () => {
    expect(shouldSuppressVolumeAdjustment("none")).toBe(false);
    expect(shouldSuppressVolumeAdjustment("t10")).toBe(true);
  });
});

describe("調整の中身", () => {
  function hl(date: string): Session {
    return makeSession(date, "high_lactate", {
      prescription: "300m × 4 @41.5秒 r5分",
      targetPaces: [{ distanceM: 300, targetSecFast: 41, targetSecSlow: 42 }],
    });
  }
  function jog(date: string, min: number): Session {
    return makeSession(date, "aerobic", {
      prescription: `ジョグ${min}分`,
      durationMin: min,
      paceSecPerKm: 300,
      distanceKm: (min * 60) / 300,
    });
  }

  it("14日前は本数を減らすが設定は変えない", () => {
    const s = hl("2026-09-12");
    const adj = planTaper([s], RACE, "2026-09-11");
    const a = adj.find((x) => x.sessionId === s.id)!;
    expect(a.kind).toBe("reduce_reps");
    expect(a.after).toBe("3本");
    // 設定タイムはそのまま
    expect(a.next!.targetPaces[0].targetSecFast).toBe(41);
    expect(a.reason).toContain("速さではありません");
  });

  it("7日前以降の高乳酸は外す", () => {
    const s = hl("2026-09-20");
    const a = planTaper([s], RACE, "2026-09-19")[0];
    expect(a.kind).toBe("replace");
    expect(a.next!.category).toBe("neural");
    expect(a.reason).toContain("回復が間に合いません");
  });

  it("ジョグは段階に応じて時間を落とす", () => {
    const s = jog("2026-09-16", 60);
    const a = planTaper([s], RACE, "2026-09-15")[0];
    expect(a.kind).toBe("reduce_volume");
    expect(a.next!.durationMin).toBe(48); // 60 × 0.8
    expect(a.next!.prescription).toContain("48分");
  });

  it("固定セッションは動かさない", () => {
    const s = { ...hl("2026-09-20"), isFixed: true, fixedSource: "チーム練習" };
    const a = planTaper([s], RACE, "2026-09-19")[0];
    expect(a.kind).toBe("keep");
    expect(a.next).toBeUndefined();
  });

  it("テーパー期の外は触らない", () => {
    expect(planTaper([hl("2026-08-20")], RACE, "2026-08-19")).toHaveLength(0);
  });
});

describe("サービス層", () => {
  function setup(today: string) {
    const repo = memRepo();
    repo.saveAthlete(testAthlete());
    const race = makeRace(RACE);
    repo.saveRace(race);
    const goal: Goal = {
      targetEvent: "800m",
      targetTimeSec: 108.9,
      targetRaceId: race.id,
      subRaceIds: [],
    };
    repo.saveGoal(goal);
    regeneratePlan(repo, today);
    return repo;
  }

  it("段階と予告が出る", () => {
    const repo = setup("2026-09-13");
    const p = taperPlan(repo, "2026-09-13");
    expect(p.stage).toBe("t14");
    expect(p.notice).toContain("レースまで");
    expect(p.applied).toBe(false);
  });

  it("適用するまで予定は変わらない", () => {
    const repo = setup("2026-09-13");
    const p = taperPlan(repo, "2026-09-13");
    const target = p.adjustments.find((a) => a.next);
    expect(target).toBeDefined();
    const before = repo.getSession(target!.sessionId)!;
    taperPlan(repo, "2026-09-13");
    expect(repo.getSession(target!.sessionId)).toEqual(before);
  });

  it("適用すると変更履歴に残る", () => {
    const repo = setup("2026-09-13");
    const out = applyTaperPlan(repo, "2026-09-13");
    expect(out.applied).toBeGreaterThan(0);
    expect(repo.listChangeLog().filter((c) => c.triggeredBy === "M-6").length).toBeGreaterThan(0);
  });

  it("辞退できる", () => {
    const repo = setup("2026-09-13");
    rejectTaperPlan(repo, "2026-09-13", "今回は自分で組む");
    expect(taperPlan(repo, "2026-09-13").rejected?.reason).toBe("今回は自分で組む");
  });

  it("通常期には何も出ない", () => {
    const repo = setup("2026-07-26");
    const p = taperPlan(repo, "2026-07-26");
    expect(p.stage).toBe("none");
    expect(p.adjustments).toHaveLength(0);
  });
});
