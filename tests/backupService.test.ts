/**
 * M-12 書き出しと復元。
 *
 * iPhoneのPWAはストレージが消えることがある。
 * 数か月ぶんの実測が消えると現在地の推定がやり直しになるので、
 * ここが壊れていると他の機能の意味が薄れる。
 */
import { describe, it, expect } from "vitest";
import { memRepo } from "./sqlite-helper";
import {
  backupStatus,
  exportBackup,
  importBackup,
  processResult,
  regeneratePlan,
} from "@/lib/service";
import { makeRace, testAthlete } from "./helpers";
import type { Goal, SessionResult } from "@/lib/core/types";

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
  regeneratePlan(repo, "2026-07-01");
  const s = repo.listSessions().find((x) => x.category === "high_lactate")!;
  const r: SessionResult = {
    id: "res-1",
    sessionId: s.id,
    date: s.date,
    actualLapsSec: [41.5, 41.8],
    lapDistancesM: [300, 300],
    achievement: "achieved",
    rpe: 8,
    subjective: "hard",
  };
  processResult(repo, r);
  repo.saveDailyCheck({ date: "2026-07-20", restingHr: 48, overallFatigue: 2 });
  return repo;
}

describe("書き出し", () => {
  it("件数つきで全部入る", () => {
    const repo = setup();
    const f = exportBackup(repo, "2026-07-26T09:00:00Z");
    expect(f.format).toBe("forge-backup");
    expect(f.counts.sessions).toBeGreaterThan(0);
    expect(f.counts.results).toBe(1);
    expect(f.athleteName).toBe("テスト選手");
  });

  it("書き出したら催促が止まる", () => {
    const repo = setup();
    expect(backupStatus(repo, TODAY).remind).toBe(true);
    exportBackup(repo, "2026-07-26T09:00:00Z");
    expect(backupStatus(repo, TODAY).remind).toBe(false);
  });

  it("14日たてばまた促す", () => {
    const repo = setup();
    exportBackup(repo, "2026-07-01T09:00:00Z");
    expect(backupStatus(repo, "2026-07-20").remind).toBe(true);
  });
});

describe("復元", () => {
  it("上書きで丸ごと戻る", () => {
    const src = setup();
    src.saveMarker({
      id: "marker-threshold",
      date: "2026-07-18",
      type: "workout",
      purpose: "threshold",
      description: "閾値走",
      resultLapsSec: [1800],
      lapDistancesM: [8000],
    });
    src.saveWeekTemplate({
      enabled: true,
      slots: { 1: "off", 3: "point" },
      modes: { 1: "preferred", 3: "fixed" },
    });
    const file = exportBackup(src, "2026-07-26T09:00:00Z");

    const dst = memRepo();
    const report = importBackup(dst, file, "replace");
    expect(report.mode).toBe("replace");
    expect(dst.getAthlete()!.pb800mSec).toBe(109.51);
    expect(dst.listResults()).toHaveLength(1);
    expect(dst.listSessions().length).toBe(src.listSessions().length);
    expect(dst.getCfe()!.estimated800mSec).toBe(src.getCfe()!.estimated800mSec);
    expect(dst.getWeekTemplate()?.modes).toEqual({ 1: "preferred", 3: "fixed" });
    expect(dst.listMarkers().find((marker) => marker.id === "marker-threshold")?.purpose).toBe(
      "threshold"
    );
    expect(dst.listSessions().some((session) => session.aerobicPurpose === "recovery")).toBe(
      true
    );
    const generated = src.listSessions().find((session) => session.generation);
    expect(generated).toBeDefined();
    expect(dst.getSession(generated!.id)?.generation).toEqual(generated!.generation);
  });

  it("統合しても重複しない", () => {
    const src = setup();
    const file = exportBackup(src, "2026-07-26T09:00:00Z");
    const before = src.listSessions().length;

    // 同じファイルを自分自身に統合する
    const report = importBackup(src, file, "merge");
    expect(src.listSessions().length).toBe(before);
    expect(src.listResults()).toHaveLength(1);
    expect(report.added.sessions).toBe(0);
    expect(report.updated.sessions).toBe(before);
  });

  it("日次コンディションは日付で突き合わせる", () => {
    const src = setup();
    const file = exportBackup(src, "2026-07-26T09:00:00Z");
    const dst = memRepo();
    dst.saveDailyCheck({ date: "2026-07-20", restingHr: 99 });
    importBackup(dst, file, "merge");
    expect(dst.listDailyChecks().filter((c) => c.date === "2026-07-20")).toHaveLength(1);
    expect(dst.listDailyChecks().find((c) => c.date === "2026-07-20")!.restingHr).toBe(48);
  });

  it("別のファイルは受け付けない", () => {
    const dst = memRepo();
    expect(() => importBackup(dst, { hello: "world" }, "replace")).toThrow(/FORGE/);
  });

  it("上書きすると元のデータは残らない", () => {
    const src = setup();
    const file = exportBackup(src, "2026-07-26T09:00:00Z");
    const dst = setup();
    dst.saveInjury({ id: "inj-x", date: "2026-07-10", bodyPart: "右アキレス腱", painLevel: 3, status: "onset" });
    importBackup(dst, file, "replace");
    expect(dst.listInjuries().find((i) => i.id === "inj-x")).toBeUndefined();
  });
});
