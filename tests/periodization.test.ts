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

  it("400mPBが未設定でも、流しを含むプランを例外なく生成する", () => {
    const athleteWithout400mPb = { ...athlete, pb400mSec: undefined };
    const generated = generatePlan({
      athlete: athleteWithout400mPb,
      goal,
      races: [race],
      cfeSec: 111.0,
      aerobicProfile: aerobic,
      startDate: "2026-06-08",
    });
    const neural = generated.sessions.filter((session) => session.category === "neural");
    const pacedNeural = neural.filter((session) => session.targetPaces.length > 0);

    expect(neural.length).toBeGreaterThan(0);
    expect(pacedNeural.length).toBeGreaterThan(0);
    expect(pacedNeural.every((session) => session.targetPaces.every((pace) => pace.isEstimated))).toBe(
      true
    );
  });

  describe("不具合対応: 「ジョグ＋坂ダッシュ/流し」の複合メニューを別々のセッションに分ける", () => {
    // 坂ダッシュ・流しは同じ日にジョグ枠を別途自動生成する（combinedJogMin）。
    const hillOrStrides = plan.sessions.filter(
      (s) =>
        s.category === "neural" &&
        (s.name === "坂ダッシュ" || s.name === "流し" || s.name === "刺激入れ（流し）")
    );

    it("坂ダッシュ・流しの日が少なくとも1件は生成される", () => {
      expect(hillOrStrides.length).toBeGreaterThan(0);
    });

    it("坂ダッシュ・流しの文面にジョグは含まれず、同じ日に別のaerobicセッションがある", () => {
      for (const s of hillOrStrides) {
        expect(s.prescription).not.toContain("ジョグ");
        const companion = plan.sessions.find(
          (o) =>
            o.date === s.date &&
            o.category === "aerobic" &&
            o.timeOfDay !== s.timeOfDay
        );
        expect(companion, `${s.date}の${s.name}に対応するジョグ枠が無い`).toBeDefined();
        expect(companion!.prescription).toContain("ジョグ");
      }
    });

    it("同じ入力からは常に同じ組（決定的）になる", () => {
      const again = generatePlan({
        athlete,
        goal,
        races: [race],
        cfeSec: 111.0,
        aerobicProfile: aerobic,
        startDate: "2026-06-08",
      });
      const pairKey = (s: { date: string; category: string; timeOfDay?: string }) =>
        `${s.date}|${s.category}|${s.timeOfDay}`;
      expect(again.sessions.map(pairKey)).toEqual(plan.sessions.map(pairKey));
    });
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

  it("複数候補を持つ自動生成セッションに選択根拠を保存する", () => {
    const generated = plan.sessions.filter((session) =>
      ["threshold", "cv", "high_lactate", "race_economy", "modeling"].includes(
        session.category
      ) && session.phase !== "Taper"
    );
    expect(generated.length).toBeGreaterThan(0);
    for (const session of generated) {
      expect(session.generation?.templateId).toBeTruthy();
      expect(session.generation?.variationGroup).toBeTruthy();
      expect(session.generation?.selectionReasons.length).toBeGreaterThan(0);
      expect(session.generation?.alternativeTemplateIds.length).toBeGreaterThan(0);
    }
  });

  it("同じ入力ではテンプレート選択も含めて同じプランになる", () => {
    const again = generatePlan({
      athlete,
      goal,
      races: [race],
      cfeSec: 111.0,
      aerobicProfile: aerobic,
      startDate: "2026-06-08",
    });
    expect(
      again.sessions.map((session) => [session.id, session.generation?.templateId])
    ).toEqual(plan.sessions.map((session) => [session.id, session.generation?.templateId]));
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

  it("回復ジョグと通常ジョグ・ロングランの目的を保存データで区別する", () => {
    const recovery = plan.sessions.find((session) => session.name.includes("回復ジョグ"));
    const long = plan.sessions.find((session) => session.name === "ロングラン");
    expect(recovery?.aerobicPurpose).toBe("recovery");
    expect(recovery?.prescription).toContain("RPE 2〜3");
    expect(long?.aerobicPurpose).toBe("long_run");
  });
});
