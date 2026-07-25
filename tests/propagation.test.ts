import { describe, it, expect } from "vitest";
import {
  propagate,
  propagateRedSignal,
  handleSkip,
  phaseRollback,
  resolveConflicts,
  priorityRank,
  judgeEconomyTrend,
  shouldApplyUpwardRevision,
} from "@/lib/core/propagation";
import { makeSession, makeResult, testAthlete } from "./helpers";
import type { SessionChange } from "@/lib/core/types";

describe("4-5-3 波及ルール", () => {
  it("PROP-01: 経済走[未達×きつい] → 同週/翌週の高乳酸を弱める", () => {
    const eco = makeSession("2026-04-07", "race_economy");
    const hl = makeSession("2026-04-14", "high_lactate");
    const r = makeResult(eco, { achievement: "partial", subjective: "very_hard", rpe: 9 });
    const changes = propagate({
      session: eco,
      result: r,
      upcomingSessions: [hl],
      athlete: testAthlete(),
    });
    const p1 = changes.find((c) => c.triggeredBy === "PROP-01");
    expect(p1).toBeDefined();
    expect(p1!.direction).toBe("down");
    expect(String(p1!.after)).toContain("本数-1");
  });

  it("PROP-01: recovery_profile=slow なら下げ幅1.5倍(-3%)", () => {
    const eco = makeSession("2026-04-07", "race_economy");
    const hl = makeSession("2026-04-14", "high_lactate");
    const r = makeResult(eco, { achievement: "failed", subjective: "very_hard", rpe: 9 });
    const changes = propagate({
      session: eco,
      result: r,
      upcomingSessions: [hl],
      athlete: testAthlete({ recoveryProfile: "slow" }),
    });
    expect(String(changes[0].after)).toContain("-3%");
  });

  it("PROP-02: 高乳酸[未達] → 次のmodelingを軽く/後ろ倒し", () => {
    const hl = makeSession("2026-04-07", "high_lactate");
    const mod = makeSession("2026-04-15", "modeling");
    const r = makeResult(hl, { achievement: "partial", rpe: 8 });
    const changes = propagate({
      session: hl,
      result: r,
      upcomingSessions: [mod],
      athlete: testAthlete(),
    });
    expect(changes.some((c) => c.triggeredBy === "PROP-02")).toBe(true);
  });

  it("PROP-03: cv/threshold[未達×きつい] → 実測再取得提案、特異的は変更しない", () => {
    const th = makeSession("2026-04-07", "threshold");
    const hl = makeSession("2026-04-10", "high_lactate");
    const eco = makeSession("2026-04-13", "race_economy");
    const r = makeResult(th, { achievement: "failed", subjective: "hard", rpe: 9 });
    const changes = propagate({
      session: th,
      result: r,
      upcomingSessions: [hl, eco],
      athlete: testAthlete(),
    });
    const p3 = changes.filter((c) => c.triggeredBy === "PROP-03");
    expect(p3.length).toBe(1);
    // 特異的セッションへの変更が無いこと
    expect(changes.some((c) => c.sessionId === hl.id)).toBe(false);
    expect(changes.some((c) => c.sessionId === eco.id)).toBe(false);
  });

  it("PROP-04: 脚が重い2連続 → 翌週の質練習を1本offに", () => {
    const hl = makeSession("2026-04-07", "high_lactate");
    const nextWeekQ = makeSession("2026-04-15", "race_economy");
    const r = makeResult(hl, { nextDayLegs: "heavy", rpe: 8 });
    const changes = propagate({
      session: hl,
      result: r,
      upcomingSessions: [nextWeekQ],
      athlete: testAthlete(),
      recentNextDayLegs: ["heavy"],
    });
    const p4 = changes.find((c) => c.triggeredBy === "PROP-04");
    expect(p4).toBeDefined();
    expect(p4!.action).toBe("replace_with_off");
  });

  it("PROP-05: modeling[達成×余裕] → テーパー変更なし、CFEのみ", () => {
    const mod = makeSession("2026-05-20", "modeling");
    const taperSession = makeSession("2026-05-25", "neural");
    const r = makeResult(mod, { achievement: "achieved", subjective: "easy", rpe: 7 });
    const changes = propagate({
      session: mod,
      result: r,
      upcomingSessions: [taperSession],
      athlete: testAthlete(),
    });
    const p5 = changes.find((c) => c.triggeredBy === "PROP-05");
    expect(p5).toBeDefined();
    // テーパーセッションへの変更が無いこと
    expect(changes.some((c) => c.sessionId === taperSession.id)).toBe(false);
  });

  it("PROP-06: 赤信号 → 直後3日間の質練習をaerobicに置換", () => {
    const q1 = makeSession("2026-04-08", "high_lactate");
    const q2 = makeSession("2026-04-10", "threshold");
    const far = makeSession("2026-04-15", "race_economy");
    const changes = propagateRedSignal("2026-04-07", [q1, q2, far]);
    expect(changes.length).toBe(2);
    expect(changes.every((c) => c.action === "replace_with_aerobic")).toBe(true);
    expect(changes.some((c) => c.sessionId === far.id)).toBe(false);
  });

  it("固定セッションには波及しない（RULE-15）", () => {
    const eco = makeSession("2026-04-07", "race_economy");
    const hlFixed = makeSession("2026-04-14", "high_lactate", { isFixed: true });
    const r = makeResult(eco, { achievement: "failed", subjective: "very_hard", rpe: 9 });
    const changes = propagate({
      session: eco,
      result: r,
      upcomingSessions: [hlFixed],
      athlete: testAthlete(),
    });
    expect(changes.some((c) => c.sessionId === hlFixed.id)).toBe(false);
  });

  it("良い結果の反映制限: 同一フェーズ3回連続まで据え置き", () => {
    expect(shouldApplyUpwardRevision(1).apply).toBe(false);
    expect(shouldApplyUpwardRevision(2).apply).toBe(false);
    expect(shouldApplyUpwardRevision(3).apply).toBe(true);
  });
});

describe("4-5-4 スキップ処理", () => {
  it("SKIP-01: off/aerobicのスキップは何もしない", () => {
    const s = makeSession("2026-04-07", "aerobic");
    const d = handleSkip(s, "fatigue");
    expect(d.action).toBe("none");
    expect(d.triggeredBy).toBe("SKIP-01");
  });

  it("SKIP-02: 疲労/赤信号/故障の質練習スキップは削除（後ろ倒ししない）", () => {
    const s = makeSession("2026-04-07", "high_lactate");
    for (const reason of ["fatigue", "red_signal", "injury"] as const) {
      const d = handleSkip(s, reason);
      expect(d.action).toBe("delete");
      expect(d.triggeredBy).toBe("SKIP-02");
    }
  });

  it("SKIP-03: 予定/天候は最大2日後ろ倒し可", () => {
    const s = makeSession("2026-04-07", "race_economy");
    const d = handleSkip(s, "schedule");
    expect(d.action).toBe("postpone");
    expect(d.maxPostponeDays).toBe(2);
    expect(d.message).toContain("ルールエンジン");
  });

  it("SKIP-04: 2回連続スキップでフェーズ巻き戻し提案", () => {
    const s = makeSession("2026-04-07", "high_lactate");
    const d = handleSkip(s, "fatigue", { previousQualitySkipped: true });
    expect(d.phaseRollbackSuggested).toBe(true);
    expect(phaseRollback("Specific")).toBe("Build");
    expect(phaseRollback("Base")).toBe("Base");
  });

  it("SKIP-05: レース14日以内は理由を問わず削除のみ", () => {
    const s = makeSession("2026-04-07", "race_economy");
    const d = handleSkip(s, "schedule", { daysToNearestRace: 10 });
    expect(d.action).toBe("delete");
    expect(d.triggeredBy).toBe("SKIP-05");
  });
});

describe("4-5-5 優先順位の衝突解決", () => {
  const mk = (
    triggeredBy: string,
    direction: "up" | "down" | "neutral",
    after: string
  ): SessionChange => ({
    sessionId: "s-x",
    field: "prescription",
    before: "base",
    after,
    reason: "",
    triggeredBy,
    direction,
  });

  it("ERROR級ルールはCFE上げ方向に勝つ", () => {
    const resolved = resolveConflicts([
      mk("CFE", "up", "経済走+2%"),
      mk("RULE-08", "down", "neuralのみ"),
    ]);
    expect(resolved.length).toBe(1);
    expect(resolved[0].triggeredBy).toBe("RULE-08");
  });

  it("下げ方向の波及はCFE上げ方向に勝つ（例: PROP-01 vs CFE改善）", () => {
    const resolved = resolveConflicts([
      mk("CFE", "up", "高乳酸を追加"),
      mk("PROP-01", "down", "本数-1"),
    ]);
    expect(resolved[0].triggeredBy).toBe("PROP-01");
  });

  it("スキップルールは波及ルールに勝つ", () => {
    const resolved = resolveConflicts([
      mk("PROP-02", "down", "軽くする"),
      mk("SKIP-05", "down", "削除"),
    ]);
    expect(resolved[0].triggeredBy).toBe("SKIP-05");
  });

  it("優先順位の数値化: ERROR級 < SKIP < PROP下げ < CFE下げ < CFE上げ < WARN級", () => {
    expect(priorityRank(mk("RULE-01", "down", ""))).toBeLessThan(
      priorityRank(mk("SKIP-02", "down", ""))
    );
    expect(priorityRank(mk("SKIP-02", "down", ""))).toBeLessThan(
      priorityRank(mk("PROP-01", "down", ""))
    );
    expect(priorityRank(mk("PROP-01", "down", ""))).toBeLessThan(
      priorityRank(mk("CFE", "down", ""))
    );
    expect(priorityRank(mk("CFE", "down", ""))).toBeLessThan(
      priorityRank(mk("CFE", "up", ""))
    );
    expect(priorityRank(mk("CFE", "up", ""))).toBeLessThan(
      priorityRank(mk("RULE-05", "down", ""))
    );
  });

  it("異なるセッションへの変更は両方残る", () => {
    const a = { ...mk("PROP-01", "down", "x"), sessionId: "s-1" };
    const b = { ...mk("PROP-02", "down", "y"), sessionId: "s-2" };
    expect(resolveConflicts([a, b]).length).toBe(2);
  });
});

describe("4-5-6 経済走の特別ルール", () => {
  it("同設定でRPE低下 → 適応進行（最重要シグナル）", () => {
    const j = judgeEconomyTrend([
      { date: "2026-04-01", rpe: 7, prescription: "600×3 r7" },
      { date: "2026-04-08", rpe: 6, prescription: "600×3 r7" },
      { date: "2026-04-15", rpe: 5, prescription: "600×3 r7" },
    ]);
    expect(j.judgement).toBe("progress");
  });

  it("同設定でRPE上昇 → 疲労蓄積", () => {
    const j = judgeEconomyTrend([
      { date: "2026-04-01", rpe: 6, prescription: "600×3 r7" },
      { date: "2026-04-08", rpe: 8, prescription: "600×3 r7" },
    ]);
    expect(j.judgement).toBe("fatigue");
  });

  it("同設定でRPE不変 → 据え置き反復", () => {
    const j = judgeEconomyTrend([
      { date: "2026-04-01", rpe: 6, prescription: "600×3 r7" },
      { date: "2026-04-08", rpe: 6, prescription: "600×3 r7" },
    ]);
    expect(j.judgement).toBe("repeat");
  });

  it("設定が変わっていれば比較不能", () => {
    const j = judgeEconomyTrend([
      { date: "2026-04-01", rpe: 6, prescription: "600×3 r7" },
      { date: "2026-04-08", rpe: 5, prescription: "600×4 r7" },
    ]);
    expect(j.judgement).toBe("insufficient_data");
  });
});
