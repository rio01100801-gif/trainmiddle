/**
 * M-5 予定の編集・移動。
 *
 * 動かせるようにするだけでは足りない。
 * 高乳酸を前倒しして間隔が4日になった、ということが普通に起きる。
 * 動かした瞬間に何が壊れるかを出して、代わりに置ける日まで示す。
 */
import { describe, it, expect } from "vitest";
import { memRepo } from "./sqlite-helper";
import {
  addSession,
  deletePlannedSession,
  editSession,
  regeneratePlan,
} from "@/lib/service";
import { makeRace, testAthlete } from "./helpers";
import { addDays } from "@/lib/core/dates";
import type { Goal } from "@/lib/core/types";

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
  regeneratePlan(repo, TODAY);
  return repo;
}

function hlSessions(repo: ReturnType<typeof memRepo>) {
  return repo
    .listSessions()
    .filter((s) => s.category === "high_lactate" && s.date > TODAY)
    .sort((a, b) => a.date.localeCompare(b.date));
}

describe("内容の変更", () => {
  it("設定タイムを直せる", () => {
    const repo = setup();
    const s = hlSessions(repo)[0];
    const out = editSession(
      repo,
      s.id,
      { targetPaces: [{ ...s.targetPaces[0], targetSecFast: 43, targetSecSlow: 44 }] },
      TODAY
    );
    expect(out.applied).toBe(true);
    expect(repo.getSession(s.id)!.targetPaces[0].targetSecFast).toBe(43);
  });

  it("固定セッションは変更できない", () => {
    const repo = setup();
    const s = hlSessions(repo)[0];
    repo.saveSession({ ...s, isFixed: true, fixedSource: "チーム練習" });
    const out = editSession(repo, s.id, { date: addDays(s.date, 1) }, TODAY);
    expect(out.ok).toBe(false);
    expect(out.error).toContain("固定");
  });
});

describe("移動とルール検査", () => {
  it("高乳酸の間隔が5日を切る移動は止めて、代わりの日を出す", () => {
    const repo = setup();
    const hl = hlSessions(repo);
    expect(hl.length).toBeGreaterThanOrEqual(2);
    // 2本目を1本目の4日後へ動かす
    const target = addDays(hl[0].date, 4);
    const out = editSession(repo, hl[1].id, { date: target }, TODAY);

    expect(out.applied).toBe(false);
    expect(out.newViolations.some((v) => v.rule === "RULE-01")).toBe(true);
    expect(out.alternatives.length).toBeGreaterThan(0);
    // 元の日付のまま
    expect(repo.getSession(hl[1].id)!.date).toBe(hl[1].date);
  });

  it("強行できるが、強行したことが残る", () => {
    const repo = setup();
    const hl = hlSessions(repo);
    const target = addDays(hl[0].date, 4);
    const out = editSession(repo, hl[1].id, { date: target }, TODAY, { force: true });

    expect(out.applied).toBe(true);
    expect(repo.getSession(hl[1].id)!.date).toBe(target);
    const log = repo.listChangeLog().filter((c) => c.triggeredBy === "M-5");
    expect(log[0].rejectReason).toContain("強行");
  });

  it("問題の無い移動はそのまま通る", () => {
    const repo = setup();
    const hl = hlSessions(repo);
    const out = editSession(repo, hl[0].id, { date: addDays(hl[0].date, 1) }, TODAY);
    expect(out.applied).toBe(true);
    expect(out.newViolations.filter((v) => v.level === "ERROR")).toHaveLength(0);
  });

  it("下見だけして適用しないこともできる", () => {
    const repo = setup();
    const hl = hlSessions(repo);
    const before = repo.getSession(hl[0].id)!.date;
    const out = editSession(repo, hl[0].id, { date: addDays(before, 1) }, TODAY, { dryRun: true });
    expect(out.applied).toBe(false);
    expect(repo.getSession(hl[0].id)!.date).toBe(before);
  });

  it("検査のあとに予定が壊れていない", () => {
    const repo = setup();
    const hl = hlSessions(repo);
    const countBefore = repo.listSessions().length;
    editSession(repo, hl[1].id, { date: addDays(hl[0].date, 4) }, TODAY);
    expect(repo.listSessions().length).toBe(countBefore);
    expect(repo.getSession(hl[1].id)).toBeDefined();
  });
});

describe("追加と削除", () => {
  it("同じ日に午前の練習を足せる", () => {
    const repo = setup();
    const date = addDays(TODAY, 2);
    const out = addSession(
      repo,
      { date, category: "aerobic", name: "朝ジョグ", timeOfDay: "am", durationMin: 30, distanceKm: 6 },
      TODAY
    );
    expect(out.applied).toBe(true);
    expect(repo.listSessions().filter((s) => s.date === date).length).toBeGreaterThanOrEqual(2);
  });

  it("予定を消せる", () => {
    const repo = setup();
    const s = hlSessions(repo)[0];
    expect(deletePlannedSession(repo, s.id, TODAY).applied).toBe(true);
    expect(repo.getSession(s.id)).toBeUndefined();
  });
});
