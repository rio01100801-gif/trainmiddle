/**
 * M-2 サービス層。
 *
 * 一番大事なのは「設定は動くが CFE は動かない」こと。
 * 実行できなかったことを能力低下として記録し始めると、
 * 設定がさらに下がって、下がった設定で走れたことがまた実力と読まれる。
 */
import { describe, it, expect } from "vitest";
import { memRepo } from "./sqlite-helper";
import {
  adaptiveProposal,
  applyAdaptiveProposal,
  rejectAdaptiveProposal,
  prescriptionText,
  processResult,
  regeneratePlan,
} from "@/lib/service";
import { makeRace, testAthlete } from "./helpers";
import type { Goal, Session, SessionResult } from "@/lib/core/types";

const TODAY = "2026-07-26";

function setup() {
  const repo = memRepo();
  repo.saveAthlete(testAthlete());
  const race = makeRace("2026-09-25");
  repo.saveRace(race);
  const goal: Goal = {
    targetEvent: "800m",
    targetTimeSec: 108.9,
    targetRaceId: race.id,
    subRaceIds: [],
  };
  repo.saveGoal(goal);
  regeneratePlan(repo, "2026-06-01");
  return repo;
}

/** 過去の高乳酸セッションに「設定より大きく遅い」実測を入れる */
function recordSlow(repo: ReturnType<typeof memRepo>, count: number) {
  const done = repo
    .listSessions()
    .filter((s) => s.category === "high_lactate" && s.date < TODAY)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-count);
  expect(done.length).toBe(count);
  for (const s of done) {
    const tp = s.targetPaces[0];
    const target = (tp.targetSecFast + tp.targetSecSlow) / 2;
    const times = [target + 2.5, target + 2.8, target + 3.2];
    const r: SessionResult = {
      id: `res-${s.id}`,
      sessionId: s.id,
      date: s.date,
      actualLapsSec: times,
      lapDistancesM: times.map(() => tp.distanceM),
      interval: {
        reps: 3,
        distanceM: tp.distanceM,
        targetSec: target,
        restType: "jog",
        restSec: 300,
        results: times.map((t, i) => ({
          index: i + 1,
          distanceM: tp.distanceM,
          targetSec: target,
          actualSec: t,
        })),
      },
      achievement: "partial",
      rpe: 9,
      subjective: "very_hard",
    };
    processResult(repo, r);
  }
  return done;
}

describe("M-2 提案", () => {
  it("設定より遅い実測が3回続いたら、次の設定が緩む", () => {
    const repo = setup();
    recordSlow(repo, 3);
    const out = adaptiveProposal(repo, TODAY);
    expect(out.session).toBeDefined();
    expect(out.proposal?.hasChange).toBe(true);
    expect(out.proposal!.offsetSecPerRep).toBeGreaterThan(0);
    expect(out.context!.trend.verdict).toBe("ease");
  });

  it("提案しただけでは保存されない", () => {
    const repo = setup();
    recordSlow(repo, 3);
    const out = adaptiveProposal(repo, TODAY);
    const before = repo.getSession(out.session!.id)!.targetPaces[0].targetSecFast;
    adaptiveProposal(repo, TODAY);
    expect(repo.getSession(out.session!.id)!.targetPaces[0].targetSecFast).toBe(before);
  });

  it("適用すると設定が変わり、CFEは変わらない", () => {
    const repo = setup();
    recordSlow(repo, 3);
    const cfeBefore = repo.getCfe()!.estimated800mSec;
    const out = adaptiveProposal(repo, TODAY);
    const id = out.session!.id;
    const before = repo.getSession(id)!.targetPaces[0].targetSecFast;

    const applied = applyAdaptiveProposal(repo, id, TODAY);
    expect(applied.applied).toBe(true);
    expect(repo.getSession(id)!.targetPaces[0].targetSecFast).toBeGreaterThan(before);
    expect(repo.getCfe()!.estimated800mSec).toBe(cfeBefore);
  });

  it("変更は理由つきで履歴に残る", () => {
    const repo = setup();
    recordSlow(repo, 3);
    const out = adaptiveProposal(repo, TODAY);
    applyAdaptiveProposal(repo, out.session!.id, TODAY);
    const log = repo.listChangeLog().filter((c) => c.triggeredBy === "M-2");
    expect(log.length).toBeGreaterThan(0);
    expect(log[0].reason).toContain("平均乖離");
    expect(log[0].accepted).toBe(true);
  });

  it("辞退したら記録され、設定は変わらない", () => {
    const repo = setup();
    recordSlow(repo, 3);
    const out = adaptiveProposal(repo, TODAY);
    const id = out.session!.id;
    const before = repo.getSession(id)!.targetPaces[0].targetSecFast;

    rejectAdaptiveProposal(repo, id, TODAY, "今週は設定どおりやってみる");
    expect(repo.getSession(id)!.targetPaces[0].targetSecFast).toBe(before);
    expect(adaptiveProposal(repo, TODAY, { sessionId: id }).rejected).toBeDefined();
    const log = repo.listChangeLog().filter((c) => c.accepted === false);
    expect(log.length).toBeGreaterThan(0);
  });

  it("材料が無ければ提案しない", () => {
    const repo = setup();
    const out = adaptiveProposal(repo, TODAY);
    expect(out.proposal?.hasChange).toBe(false);
  });

  it("赤信号の日は質を入れないと出す", () => {
    const repo = setup();
    repo.saveDailyCheck({
      date: TODAY,
      legFatigue: 5,
      overallFatigue: 5,
      sleepQuality: 1,
      motivation: 1,
      signal: "red",
    });
    const out = adaptiveProposal(repo, TODAY);
    expect(out.context!.daily.blocked).toBe(true);
  });

  it("暑熱を渡すと設定が緩み、その旨が理由に出る", () => {
    const repo = setup();
    const out = adaptiveProposal(repo, TODAY, { tempC: 33, humidityPct: 70 });
    expect(out.context!.heat.applied).toBe(true);
    expect(out.proposal!.reasons.join()).toContain("WBGT");
    expect(out.proposal!.offsetSecPerRep).toBeGreaterThan(0);
  });
});

describe("M-3 処方の表示", () => {
  it("質練習には許容幅と打ち切り条件が付く", () => {
    const repo = setup();
    const s = repo.listSessions().find((x) => x.category === "high_lactate")!;
    const text = prescriptionText(s);
    expect(text).toContain("許容");
    expect(text).toContain("打ち切る");
  });

  it("有酸素には付けない", () => {
    const repo = setup();
    const s = repo.listSessions().find((x) => x.category === "aerobic")!;
    expect(prescriptionText(s)).toBe(s.prescription);
  });
});
