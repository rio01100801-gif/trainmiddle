import { describe, it, expect } from "vitest";
import { generatePlan, phaseForDaysToRace } from "@/lib/core/periodization";
import { buildAerobicProfile } from "@/lib/core/pace";
import { runRuleEngine } from "@/lib/core/rules";
import { ctx, makeRace, testAthlete } from "./helpers";
import type { Goal } from "@/lib/core/types";

describe("4-6 フェーズ割当", () => {
  it("レースまでの日数からフェーズを判定する", () => {
    expect(phaseForDaysToRace(100)).toBe("Base");
    expect(phaseForDaysToRace(84)).toBe("Base");
    expect(phaseForDaysToRace(70)).toBe("Build");
    expect(phaseForDaysToRace(40)).toBe("Specific");
    expect(phaseForDaysToRace(20)).toBe("Modeling");
    expect(phaseForDaysToRace(7)).toBe("Taper");
  });
});

describe("4-6 プラン自動生成", () => {
  const athlete = testAthlete();
  const race = makeRace("2026-09-27"); // 約16週後
  const goal: Goal = {
    targetEvent: "800m",
    targetTimeSec: 108.9,
    targetRaceId: race.id,
    subRaceIds: [],
  };
  const aerobic = buildAerobicProfile([], "2026-06-08", 111.0);
  const plan = generatePlan({
    athlete,
    goal,
    races: [race],
    cfeSec: 111.0,
    aerobicProfile: aerobic,
    startDate: "2026-06-08", // 月曜
  });

  it("フェーズが Base → Build → Specific → Modeling → Taper の順に並ぶ", () => {
    const phases = plan.phaseByWeek.map((p) => p.phase);
    const order = ["Base", "Build", "Specific", "Modeling", "Taper"];
    let maxIdx = 0;
    for (const p of phases) {
      const i = order.indexOf(p);
      expect(i).toBeGreaterThanOrEqual(maxIdx === 0 ? 0 : maxIdx - 0);
      maxIdx = Math.max(maxIdx, i);
    }
    expect(phases[0]).toBe("Base");
    expect(phases[phases.length - 1]).toBe("Taper");
  });

  it("Base期にもneural（坂ダッシュ等）が微量で入る（非線形ピリオダイゼーション）", () => {
    const baseSessions = plan.sessions.filter((s) => s.phase === "Base");
    const neural = baseSessions.filter((s) => s.category === "neural");
    expect(neural.length).toBeGreaterThan(0);
  });

  it("生成されたプランはルールエンジンのERROR違反を出さない", () => {
    const violations = runRuleEngine(
      ctx({
        sessions: plan.sessions,
        strengthSessions: plan.strengthSessions,
        races: [race],
        goal,
        evaluationDate: "2026-06-08",
      })
    );
    const errors = violations.filter((v) => v.level === "ERROR");
    expect(errors).toEqual([]);
  });

  it("最終高乳酸はレース7〜9日前に1回だけ配置される（RULE-07準拠）", () => {
    const hlNearRace = plan.sessions.filter(
      (s) =>
        (s.category === "high_lactate" || s.category === "modeling") &&
        s.date >= "2026-09-13" // 14日前以降
    );
    expect(hlNearRace.length).toBe(1);
    expect(hlNearRace[0].date >= "2026-09-18" && hlNearRace[0].date <= "2026-09-20").toBe(
      true
    );
  });

  it("レース7日前以降に質練習が無い（RULE-08準拠）", () => {
    const quality = plan.sessions.filter(
      (s) =>
        ["high_lactate", "race_economy", "modeling", "cv", "threshold"].includes(
          s.category
        ) && s.date > "2026-09-20"
    );
    expect(quality.length).toBe(0);
  });

  it("高乳酸翌日のロングランは生成段階でペースが落とされる（RULE-02を自ら踏まない）", () => {
    // 生成プラン全体でRULE-02のWARNが出ないことを確認する
    const violations = runRuleEngine(
      ctx({
        sessions: plan.sessions,
        strengthSessions: plan.strengthSessions,
        races: [race],
        goal,
        ltPaceSecPerKm: aerobic.ltPaceSecPerKm,
        evaluationDate: "2026-06-08",
      })
    );
    expect(violations.filter((v) => v.rule === "RULE-02")).toEqual([]);
  });

  it("全セッションに根拠（rationale）が付与される", () => {
    const withoutRationale = plan.sessions.filter(
      (s) => s.category !== "off" && !s.rationale
    );
    expect(withoutRationale.length).toBe(0);
  });

  it("補強は質練習日のpmにブロック化される（4-8-1）", () => {
    const qualityDates = new Set(
      plan.sessions
        .filter((s) =>
          ["high_lactate", "race_economy", "modeling", "cv", "threshold"].includes(
            s.category
          )
        )
        .map((s) => s.date)
    );
    for (const st of plan.strengthSessions) {
      expect(qualityDates.has(st.date)).toBe(true);
      expect(st.timeOfDay).toBe("pm");
    }
  });

  it("通過点レース(B)の前3日は軽くなる", () => {
    const subRace = makeRace("2026-08-09", { priority: "B" });
    const goal2: Goal = { ...goal, subRaceIds: [subRace.id] };
    const plan2 = generatePlan({
      athlete,
      goal: goal2,
      races: [race, subRace],
      cfeSec: 111.0,
      aerobicProfile: aerobic,
      startDate: "2026-06-08",
    });
    const before = plan2.sessions.filter(
      (s) => s.date >= "2026-08-06" && s.date <= "2026-08-08"
    );
    for (const s of before) {
      expect(["aerobic", "neural", "off"]).toContain(s.category);
    }
  });

  it("有酸素ペースが推定値の場合、処方に推定であることが明示される", () => {
    const threshold = plan.sessions.find((s) => s.category === "threshold");
    if (threshold) {
      expect(threshold.prescription).toContain("推定");
    }
  });
});
