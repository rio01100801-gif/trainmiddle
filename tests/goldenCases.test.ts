/**
 * トレーニングロジック統合監査（2026-07-31）で要求されたゴールデンケース A〜J。
 *
 * 各ケースは「この入力ならこの挙動になるべき」という、実際の関数を通した
 * 固定シナリオのテスト。監査で見つかった2件の修正（目標タイム混入除去・
 * 暑熱/疲労ガードレール対称化）の直接検証は tests/cfe.test.ts 側にあるため、
 * ここでは監査で要求された残りのケースをカバーする。
 */
import { describe, it, expect } from "vitest";
import { diagnose } from "@/lib/core/diagnosis";
import { assessLimiter } from "@/lib/core/limiter";
import { initCfe, updateCfeFromResult } from "@/lib/core/cfe";
import { handleSkip } from "@/lib/core/propagation";
import { planVolumeProgression } from "@/lib/core/volumeProgression";
import { memRepo } from "./sqlite-helper";
import { makeSession, makeResult, makeRace, testAthlete } from "./helpers";
import { regeneratePlan, buildRuleContext } from "@/lib/service";
import type { Goal } from "@/lib/core/types";

const TODAY = "2026-07-26";

function setupWithGoal(targetTimeSec: number, overrides: Partial<Goal> = {}) {
  const repo = memRepo();
  repo.saveAthlete(testAthlete());
  const race = makeRace("2026-09-25");
  repo.saveRace(race);
  const goal: Goal = {
    targetEvent: "800m",
    targetTimeSec,
    targetRaceId: race.id,
    subRaceIds: [],
    ...overrides,
  };
  repo.saveGoal(goal);
  regeneratePlan(repo, TODAY);
  return repo;
}

describe("ゴールデンケース A: 速度型の選手", () => {
  it("400mが相対的に速い選手はathleteType=speed、主要な伸びしろは後半維持", () => {
    // 400m 47.0（速い）に対し800m 111.0（換算差が大きい）→ 速度資源を持て余している
    const athlete = testAthlete({ pb400mSec: 47.0, pb800mSec: 111.0, pb1500mSec: undefined });
    const d = diagnose(athlete);
    expect(d.athleteType).toBe("speed");
    expect(d.primaryGap).toBe("後半維持");
  });
});

describe("ゴールデンケース B: 持久型の選手", () => {
  it("400mの割に800mが優秀な選手はathleteType=endurance、主要な伸びしろは絶対スピード", () => {
    // 400m 52.0（遅い）に対し800m 108.0（換算差が小さい＝800mが優秀）
    const athlete = testAthlete({ pb400mSec: 52.0, pb800mSec: 108.0, pb1500mSec: undefined });
    const d = diagnose(athlete);
    expect(d.athleteType).toBe("endurance");
    expect(d.primaryGap).toBe("絶対スピード");
  });
});

describe("ゴールデンケース C: バランス型の選手", () => {
  it("換算差が標準域の選手はathleteType=balanced", () => {
    // 400m 49.0, 800m 107.0（換算差9.0秒=標準域下限）, 1500m 230.0（差16秒=標準域）
    const athlete = testAthlete({ pb400mSec: 49.0, pb800mSec: 107.0, pb1500mSec: 230.0 });
    const d = diagnose(athlete);
    expect(d.athleteType).toBe("balanced");
  });
});

describe("ゴールデンケース D: データ不足", () => {
  it("400m/1500mのPBが無くてもクラッシュせず、判定不能な指標はundefinedのまま返す", () => {
    const athlete = testAthlete({ pb400mSec: undefined, pb1500mSec: undefined });
    const d = diagnose(athlete);
    expect(d.speedReservePct).toBeUndefined();
    expect(d.conversionDiffSec).toBeUndefined();
    expect(d.diff8001500Sec).toBeUndefined();
    // 指標が無くても型自体は返す（balancedへフォールバック）。推測で埋めない。
    expect(d.athleteType).toBe("balanced");

    const l = assessLimiter(athlete);
    expect(l.limiter).toBe("unknown");
  });

  it("結果0件のCFEは初期値のまま。1件の結果だけで過度に信頼度が上がらない", () => {
    const cfe = initCfe(109.51, "2026-04-01");
    expect(cfe.history).toHaveLength(1); // 初期値そのものが最初の履歴になる
    const s = makeSession("2026-04-02", "high_lactate");
    const r = makeResult(s, { rpe: 8, achievement: "achieved" });
    const u = updateCfeFromResult(cfe, s, r);
    // 1件の結果で暗黙のCFEへ全振りせず、信頼度で重み付けした分だけ動く
    expect(Math.abs(u.deltaSec)).toBeLessThan(1.5);
  });
});

describe("ゴールデンケース E: 暑熱下の未達（統合監査で修正）", () => {
  it("28℃以上での未達はCFEを悪化させない（好走を反映しないのと対称）", () => {
    const cfe = initCfe(109.51, "2026-04-01");
    const s = makeSession("2026-08-01", "high_lactate", {
      targetPaces: [{ distanceM: 600, targetSecFast: 85.0, targetSecSlow: 85.0 }],
    });
    const rMiss = makeResult(s, {
      rpe: 9,
      achievement: "partial",
      actualLapsSec: [90, 90, 90],
      lapDistancesM: [600, 600, 600],
    });
    const u = updateCfeFromResult(cfe, s, rMiss, { tempC: 31 });
    expect(u.applied).toBe(false);
    expect(u.cfe.estimated800mSec).toBe(cfe.estimated800mSec);
  });
});

describe("ゴールデンケース F: 脚が重い（疲労）連続時の未達（統合監査で修正）", () => {
  it("脚が重い2連続のあとの未達はCFEを悪化させない", () => {
    const cfe = initCfe(109.51, "2026-04-01");
    const s = makeSession("2026-04-02", "high_lactate", {
      targetPaces: [{ distanceM: 600, targetSecFast: 85.0, targetSecSlow: 85.0 }],
    });
    const rMiss = makeResult(s, {
      rpe: 9,
      achievement: "partial",
      actualLapsSec: [90, 90, 90],
      lapDistancesM: [600, 600, 600],
    });
    const u = updateCfeFromResult(cfe, s, rMiss, { heavyLegsStreak: 2 });
    expect(u.applied).toBe(false);
    expect(u.cfe.estimated800mSec).toBe(cfe.estimated800mSec);
  });
});

describe("ゴールデンケース G: 故障シグナル + 曜日固定スケジュール", () => {
  it("故障によるスキップは後ろ倒しされず削除される（曜日固定に埋もれない）", () => {
    const s = makeSession("2026-04-02", "high_lactate", { isFixed: true });
    const decision = handleSkip(s, "injury");
    expect(decision.action).toBe("delete");
    expect(decision.triggeredBy).toBe("SKIP-02");
  });

  it("レース14日以内なら理由に関わらず後ろ倒ししない", () => {
    const s = makeSession("2026-09-15", "modeling");
    const decision = handleSkip(s, "schedule", { daysToNearestRace: 10 });
    expect(decision.action).toBe("delete");
    expect(decision.triggeredBy).toBe("SKIP-05");
  });
});

describe("ゴールデンケース H: レース前・テーパー", () => {
  it("テーパー期のセッションは自動ボリューム増加の対象から除外される", () => {
    const anchor = makeSession("2026-09-10", "aerobic", {
      id: "anchor",
      status: "planned",
      durationMin: 40,
    });
    const taperCandidate = makeSession("2026-09-11", "aerobic", {
      id: "taper-1",
      status: "planned",
      phase: "Taper",
      durationMin: 40,
    });
    const changes = planVolumeProgression({
      sessions: [anchor, taperCandidate],
      anchorSessionId: "anchor",
      today: "2026-09-10",
      raceDate: "2026-09-25",
    });
    expect(changes.some((c) => c.sessionId === "taper-1")).toBe(false);
  });

  it("レース14日以内のセッションもボリューム増加の対象から除外される", () => {
    const anchor = makeSession("2026-09-10", "aerobic", {
      id: "anchor",
      status: "planned",
      durationMin: 40,
    });
    const nearRace = makeSession("2026-09-12", "aerobic", {
      id: "near-race",
      status: "planned",
      phase: "Specific",
      durationMin: 40,
    });
    const changes = planVolumeProgression({
      sessions: [anchor, nearRace],
      anchorSessionId: "anchor",
      today: "2026-09-10",
      raceDate: "2026-09-25", // near-raceまで13日
    });
    expect(changes.some((c) => c.sessionId === "near-race")).toBe(false);
  });
});

describe("ゴールデンケース I: 単発の外れ値", () => {
  it("1回の極端な未達・高RPEでもCFE更新は±1.5秒（レース以外）の上限を超えない", () => {
    const cfe = initCfe(109.51, "2026-04-01");
    const s = makeSession("2026-04-02", "modeling", {
      targetPaces: [{ distanceM: 600, targetSecFast: 85.0, targetSecSlow: 85.0 }],
    });
    const rExtreme = makeResult(s, {
      rpe: 10,
      achievement: "failed",
      actualLapsSec: [150, 150, 150], // 現実離れした大幅未達
      lapDistancesM: [600, 600, 600],
    });
    const u = updateCfeFromResult(cfe, s, rExtreme);
    expect(Math.abs(u.deltaSec)).toBeLessThanOrEqual(1.5);
  });
});

describe("ゴールデンケース J: 同一条件での再生成の決定性", () => {
  it("同じ設定・同じ日付で2回プラン生成しても、生成される週内容は完全一致する", () => {
    const a = setupWithGoal(108.9);
    const b = setupWithGoal(108.9);
    const sig = (r: ReturnType<typeof memRepo>) =>
      r
        .listSessions()
        .sort((x, y) => x.date.localeCompare(y.date) || x.timeOfDay.localeCompare(y.timeOfDay))
        .map((s) => `${s.date}|${s.timeOfDay}|${s.category}|${s.prescription}`)
        .join("\n");
    expect(sig(a)).toBe(sig(b));
  });

  it("同じ選手データからのカテゴリ分類は、生成直後のセッションでも一貫している", () => {
    const repo = setupWithGoal(108.9);
    const ctx = buildRuleContext(repo, TODAY);
    const week = ctx.allSessions.filter((s) => s.date >= "2026-07-27" && s.date <= "2026-08-02");
    for (const s of week) {
      expect(typeof s.category).toBe("string");
      expect(s.category.length).toBeGreaterThan(0);
    }
  });
});
