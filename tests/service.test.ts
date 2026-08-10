/**
 * サービス層の統合テスト: セットアップ → プラン生成 → 結果入力 → 補正の一連の流れ。
 * bun:sqlite で本番同一経路を検証する。
 */
import { describe, it, expect } from "vitest";
import { Repo } from "@/lib/db/repo";
import { memRepo } from "./sqlite-helper";
import {
  regeneratePlan,
  processResult,
  processSkip,
  restoreSkippedSession,
  processDailyCheck,
  processRaceResult,
  dashboard,
} from "@/lib/service";
import { makeRace, testAthlete, makeResult } from "./helpers";
import type { Goal } from "@/lib/core/types";
import { isHighLoadSession } from "@/lib/core/trainingClassification";


function setup(): { repo: Repo; raceId: string } {
  const repo = memRepo();
  repo.saveAthlete(testAthlete());
  const race = makeRace("2026-09-25", {
    advancementRule: "place",
    rounds: [
      { type: "heat", datetime: "2026-09-25T10:00:00" },
      { type: "final", datetime: "2026-09-27T15:00:00" },
    ],
  });
  repo.saveRace(race);
  const goal: Goal = {
    targetEvent: "800m",
    targetTimeSec: 108.9,
    targetRaceId: race.id,
    subRaceIds: [],
  };
  repo.saveGoal(goal);
  return { repo, raceId: race.id };
}

describe("サービス層: プラン生成", () => {
  it("プラン生成でセッション・補強・CFEが揃い、ERROR違反ゼロ", () => {
    const { repo } = setup();
    const out = regeneratePlan(repo, "2026-06-08");
    expect(out.sessionCount).toBeGreaterThan(50);
    expect(out.strengthCount).toBeGreaterThan(5);
    expect(out.violations.filter((v) => v.level === "ERROR")).toEqual([]);
    expect(repo.getCfe()).toBeDefined();
    // CFE初期値 = PB + 1.5
    expect(repo.getCfe()!.estimated800mSec).toBeCloseTo(111.01, 1);
  });

  it("予選の想定ペースがラウンドに自動設定される（place: 目標+5秒）", () => {
    const { repo, raceId } = setup();
    regeneratePlan(repo, "2026-06-08");
    const race = repo.listRaces().find((r) => r.id === raceId)!;
    const heat = race.rounds.find((r) => r.type === "heat")!;
    expect(heat.expectedPaceSec).toBeCloseTo(113.9, 1);
  });

  it("ラウンド間に回復プロトコルが生成される", () => {
    const { repo } = setup();
    regeneratePlan(repo, "2026-06-08");
    const rec = repo.listSessions().filter((s) => s.isRecoveryProtocol);
    expect(rec.length).toBeGreaterThan(0);
  });

  it("継続中の故障があると自動生成の高負荷を理由付きで回復メニューへ変更する", () => {
    const { repo } = setup();
    repo.saveInjury({
      id: "inj-active",
      date: "2026-06-07",
      bodyPart: "左ハムストリング",
      painLevel: 4,
      status: "ongoing",
    });

    const out = regeneratePlan(repo, "2026-06-08");
    expect(out.safetyAdjustments.length).toBeGreaterThan(0);
    expect(out.safetyAdjustments[0].reason).toContain("左ハムストリング");
    expect(repo.listSessions().filter((session) => session.origin === "generated").some(isHighLoadSession))
      .toBe(false);
    expect(repo.listSessions().some((session) => session.name === "回復ジョグ（故障保護）"))
      .toBe(true);
  });
});

describe("サービス層: 有酸素の実測データ（FitnessMarker）", () => {
  it("実測が無いうちは有酸素の設定が「推定値」と明示される", () => {
    const { repo } = setup();
    regeneratePlan(repo, "2026-06-08");
    const th = repo.listSessions().find((s) => s.category === "threshold");
    expect(th).toBeDefined();
    expect(th!.prescription).toContain("推定");
    expect(th!.targetPaces[0].isEstimated).toBe(true);
  });

  it("実測(8km@3:50/km)を登録して再生成すると、実測ベースの設定に切り替わる", () => {
    const { repo } = setup();
    regeneratePlan(repo, "2026-06-08");
    repo.saveMarker({
      id: "fm-1",
      date: "2026-06-07",
      type: "workout",
      description: "8kmペース走",
      resultLapsSec: [1840], // 8km を 30:40 = 3:50/km
      lapDistancesM: [8000],
      avgHr: 186,
    });
    regeneratePlan(repo, "2026-06-08");
    const th = repo.listSessions().find((s) => s.category === "threshold");
    expect(th!.prescription).not.toContain("推定");
    expect(th!.targetPaces[0].isEstimated).toBe(false);
    // LT 3:50/km(230秒) がそのまま閾値設定になる
    expect(th!.targetPaces[0].targetSecFast).toBeCloseTo(230, 0);
    // ジョグは LT+60〜80秒/km
    const jog = repo.listSessions().find((s) => s.category === "aerobic" && s.paceSecPerKm);
    expect(jog!.paceSecPerKm!).toBeGreaterThan(230 + 55);
    expect(jog!.paceSecPerKm!).toBeLessThan(230 + 85);
  });

  it("有酸素の設定はCFEの変化では動かない（実測から独立して管理される）", () => {
    const { repo } = setup();
    repo.saveMarker({
      id: "fm-1",
      date: "2026-06-07",
      type: "workout",
      description: "8kmペース走",
      resultLapsSec: [1840],
      lapDistancesM: [8000],
    });
    regeneratePlan(repo, "2026-06-08");
    const before = repo.listSessions().find((s) => s.category === "threshold")!;
    const hl = repo
      .listSessions()
      .filter((s) => s.category === "high_lactate" && s.targetPaces.length > 0)
      .sort((a, b) => a.date.localeCompare(b.date))[0];
    processResult(
      repo,
      makeResult(hl, { rpe: 10, achievement: "failed", subjective: "very_hard" })
    );
    const after = repo.getSession(before.id)!;
    expect(after.targetPaces[0].targetSecFast).toBeCloseTo(
      before.targetPaces[0].targetSecFast,
      3
    );
  });
});

describe("サービス層: 結果入力 → CFE → ペース再計算の連動", () => {
  it("きつい未達の結果でCFEが悪化し、未来の特異的セッションのペースが遅くなる", () => {
    const { repo } = setup();
    regeneratePlan(repo, "2026-06-08");
    const hl = repo
      .listSessions()
      .filter((s) => s.category === "high_lactate" && s.targetPaces.length > 0)
      .sort((a, b) => a.date.localeCompare(b.date))[0];
    expect(hl).toBeDefined();

    const before = repo.getCfe()!.estimated800mSec;
    const out = processResult(
      repo,
      makeResult(hl, {
        rpe: 10, // 期待8 → +2
        achievement: "partial",
        completedReps: 3,
        prescribedReps: 5,
      })
    );
    expect(out.cfeAfter).toBeGreaterThan(before);
    // ペース再計算の変更差分が「理由付き」で出る（4-5-9）
    const paceChanges = out.changes.filter((c) => c.triggeredBy === "CFE");
    expect(paceChanges.length).toBeGreaterThan(0);
    expect(paceChanges[0].reason).toContain("CFE");
    expect(paceChanges[0].direction).toBe("down");
  });

  it("経済走[未達×きつい]でPROP-01が高乳酸に波及する", () => {
    const { repo } = setup();
    regeneratePlan(repo, "2026-06-08");
    const eco = repo
      .listSessions()
      .filter((s) => s.category === "race_economy")
      .sort((a, b) => a.date.localeCompare(b.date))[0];
    const out = processResult(
      repo,
      makeResult(eco, { rpe: 9, achievement: "failed", subjective: "very_hard" })
    );
    expect(out.changes.some((c) => c.triggeredBy === "PROP-01")).toBe(true);
  });

  it("変更差分はログに記録され追跡可能", () => {
    const { repo } = setup();
    regeneratePlan(repo, "2026-06-08");
    const eco = repo
      .listSessions()
      .filter((s) => s.category === "race_economy")[0];
    processResult(
      repo,
      makeResult(eco, { rpe: 9, achievement: "failed", subjective: "very_hard" })
    );
    expect(repo.listChangeLog().length).toBeGreaterThan(0);
  });
});

describe("サービス層: スキップ", () => {
  it("疲労スキップは削除（後ろ倒ししない）", () => {
    const { repo } = setup();
    regeneratePlan(repo, "2026-06-08");
    const q = repo.listSessions().filter((s) => s.category === "high_lactate")[0];
    const out = processSkip(repo, q.id, "fatigue");
    expect(out.decision.action).toBe("delete");
    expect(repo.getSession(q.id)!.status).toBe("skipped");
  });

  it("予定スキップは後ろ倒しを試み、違反が出れば削除に切り替える", () => {
    const { repo } = setup();
    regeneratePlan(repo, "2026-06-08");
    const q = repo
      .listSessions()
      .filter((s) => s.category === "race_economy" && s.date < "2026-09-01")[0];
    const out = processSkip(repo, q.id, "schedule");
    expect(["postpone", "delete_recommended"]).toContain(out.decision.action);
    const s = repo.getSession(q.id)!;
    if (out.decision.action === "postpone") {
      expect(s.status).toBe("modified");
    } else {
      expect(s.status).toBe("skipped");
    }
  });

  /*
   * 固定枠（チーム練習等）は日時が決まっているから固定枠なので、
   * 後ろ倒しした「チーム練習」は実在しない予定になる。
   */
  it("固定枠は予定スキップでも後ろ倒しせず、その日のまま中止にする", () => {
    const { repo } = setup();
    regeneratePlan(repo, "2026-06-08");
    const target = repo
      .listSessions()
      .filter((s) => s.category === "race_economy" && s.date < "2026-09-01")[0];
    repo.saveSession({ ...target, isFixed: true });

    const out = processSkip(repo, target.id, "schedule");
    const after = repo.getSession(target.id)!;
    expect(after.status).toBe("skipped");
    expect(after.date).toBe(target.date); // 日付が動いていない
    expect(out.decision.action).toBe("delete");
  });

  it("中止を取り消すと予定に戻る。記録が入っていれば戻さない", () => {
    const { repo } = setup();
    regeneratePlan(repo, "2026-06-08");
    const q = repo.listSessions().filter((s) => s.category === "high_lactate")[0];
    processSkip(repo, q.id, "fatigue");
    expect(repo.getSession(q.id)!.status).toBe("skipped");

    const back = restoreSkippedSession(repo, q.id, "2026-06-08");
    expect(back.ok).toBe(true);
    expect(repo.getSession(q.id)!.status).toBe("planned");

    // 中止していないものは戻す対象にならない
    expect(restoreSkippedSession(repo, q.id, "2026-06-08").ok).toBe(false);
  });
});

describe("サービス層: 日次チェックと赤信号", () => {
  it("安静HR+10で赤信号 → 直後3日の質練習が自動置換される", () => {
    const { repo } = setup();
    regeneratePlan(repo, "2026-06-08");
    // ベースライン形成
    for (let i = 1; i <= 7; i++) {
      processDailyCheck(repo, { date: `2026-06-${String(8 + i).padStart(2, "0")}`, restingHr: 48 });
    }
    const nextQ = repo
      .listSessions()
      .filter((s) => s.status === "planned" && s.date >= "2026-06-16" && s.date <= "2026-06-19")
      .find((s) => ["high_lactate", "race_economy", "cv", "threshold", "modeling"].includes(s.category));
    const out = processDailyCheck(repo, { date: "2026-06-16", restingHr: 60 });
    expect(out.signal).toBe("red");
    if (nextQ) {
      const after = repo.getSession(nextQ.id)!;
      expect(after.category).toBe("aerobic");
      expect(after.status).toBe("modified");
    }
  });
});

describe("サービス層: レース結果", () => {
  it("最速ラウンドでCFE更新、決勝<予選なら良好評価", () => {
    const { repo, raceId } = setup();
    regeneratePlan(repo, "2026-06-08");
    const before = repo.getCfe()!.estimated800mSec;
    const out = processRaceResult(
      repo,
      raceId,
      [
        { roundType: "heat", timeSec: 113.0 },
        {
          roundType: "final",
          timeSec: 110.0,
          front400Sec: 53.8,
          back400Sec: 56.2,
          rpe: 9,
        },
      ],
      "2026-07-05"
    );
    expect(out.cfeAfter).toBeLessThan(before);
    expect(out.roundsDiagnosis.assessment).toContain("良好");
    expect(out.analysis).toBeDefined();
    expect(out.analysis!.primaryIssue).toContain("標準");
  });
});

describe("サービス層: 今日のメニューと準備度", () => {
  it("質練習日は質練習が主役として選ばれ、準備度と内訳が返る", () => {
    const { repo } = setup();
    regeneratePlan(repo, "2026-06-08");
    const hl = repo
      .listSessions()
      .filter((s) => s.category === "high_lactate")
      .sort((a, b) => a.date.localeCompare(b.date))[0];
    const d = dashboard(repo, hl.date);
    expect(d.todaySession?.id).toBe(hl.id);
    expect(d.readiness).toBeDefined();
    expect(d.readiness!.score).toBeGreaterThan(0);
    expect(d.readiness!.breakdown.length).toBeGreaterThan(0);
  });

  it("赤信号の日は準備度がlowになり、質を入れるなと出る", () => {
    const { repo } = setup();
    regeneratePlan(repo, "2026-06-08");
    const hl = repo
      .listSessions()
      .filter((s) => s.category === "high_lactate")
      .sort((a, b) => a.date.localeCompare(b.date))[0];
    for (let i = 1; i <= 6; i++) {
      processDailyCheck(repo, {
        date: `2026-06-${String(8 + i).padStart(2, "0")}`,
        restingHr: 48,
      });
    }
    processDailyCheck(repo, { date: hl.date, restingHr: 62 });
    const d = dashboard(repo, hl.date);
    expect(d.signal).toBe("red");
    expect(d.readiness!.level).toBe("low");
  });

  it("CFEの前回比は「下がる＝改善」の符号で返る", () => {
    const { repo } = setup();
    regeneratePlan(repo, "2026-06-08");
    const hl = repo
      .listSessions()
      .filter((s) => s.category === "high_lactate" && s.targetPaces.length > 0)
      .sort((a, b) => a.date.localeCompare(b.date))[0];
    processResult(repo, makeResult(hl, { rpe: 10, achievement: "failed" }));
    const d = dashboard(repo, "2026-08-01");
    // 悪化したので正の値（＝遅くなった）
    expect(d.cfeDelta).toBeGreaterThan(0);
  });
});

describe("サービス層: ダッシュボード", () => {
  it("診断・週サマリー・ACWR・実現性評価が揃う", () => {
    const { repo } = setup();
    regeneratePlan(repo, "2026-06-08");
    const d = dashboard(repo, "2026-06-10");
    expect(d.diagnosis!.athleteType).toBe("lactate_tolerant");
    expect(d.weeklySummary).toBeDefined();
    expect(d.cfe).toBeDefined();
    expect(d.feasibility).toBeDefined();
    // 111.01 → 108.9 / 16週 = 0.13秒/週 → 現実的
    expect(d.feasibility!.warn).toBe(false);
  });
});

describe("service: injury onset window", () => {
  it("onset記録の14日保護を将来プラン全体へ延長しない", () => {
    const { repo } = setup();
    repo.saveInjury({
      id: "inj-onset",
      date: "2026-06-07",
      bodyPart: "左ふくらはぎ",
      painLevel: 3,
      status: "onset",
    });

    const out = regeneratePlan(repo, "2026-06-08");
    expect(out.safetyAdjustments.length).toBeGreaterThan(0);
    expect(out.safetyAdjustments.every((item) => item.date <= "2026-06-21")).toBe(true);
    expect(
      repo
        .listSessions()
        .filter((session) => session.origin === "generated" && session.date > "2026-06-21")
        .some(isHighLoadSession)
    ).toBe(true);
  });
});
