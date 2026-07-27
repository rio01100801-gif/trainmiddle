/**
 * リポジトリ層のテスト。bun:sqlite で本番と同一のSQL・シリアライズ経路を検証する。
 */
import { describe, it, expect } from "vitest";
import { Repo } from "@/lib/db/repo";
import { memRepo } from "./sqlite-helper";
import { makeSession, makeStrength, makeRace, makeResult, testAthlete } from "./helpers";
import { initCfe } from "@/lib/core/cfe";


describe("DB リポジトリ層", () => {
  it("曜日の優先/固定モードを既存JSON列で往復できる", () => {
    const repo = memRepo();
    repo.saveWeekTemplate({
      enabled: true,
      slots: { 1: "off", 3: "point" },
      modes: { 1: "preferred", 3: "fixed" },
    });
    expect(repo.getWeekTemplate()).toMatchObject({
      slots: { 1: "off", 3: "point" },
      modes: { 1: "preferred", 3: "fixed" },
    });
  });

  it("Athlete の保存・取得・上書き", () => {
    const repo = memRepo();
    const a = testAthlete();
    repo.saveAthlete(a);
    expect(repo.getAthlete()!.pb800mSec).toBe(109.51);
    repo.saveAthlete({ ...a, pb800mSec: 108.9 });
    expect(repo.getAthlete()!.pb800mSec).toBe(108.9);
  });

  it("Goal はシングルトン行として保持", () => {
    const repo = memRepo();
    repo.saveGoal({ targetEvent: "800m", targetTimeSec: 108.9, targetRaceId: "r1", subRaceIds: [] });
    repo.saveGoal({ targetEvent: "800m", targetTimeSec: 108.0, targetRaceId: "r1", subRaceIds: [] });
    expect(repo.getGoal()!.targetTimeSec).toBe(108.0);
  });

  it("Race の保存とラウンド構造の往復", () => {
    const repo = memRepo();
    const r = makeRace("2026-06-05", {
      rounds: [
        { type: "heat", datetime: "2026-06-05T10:00:00" },
        { type: "final", datetime: "2026-06-07T15:00:00" },
      ],
      advancementRule: "place_and_time",
      advancementDetail: "各組上位2着＋タイム上位2",
    });
    repo.saveRace(r);
    const loaded = repo.listRaces()[0];
    expect(loaded.rounds.length).toBe(2);
    expect(loaded.advancementDetail).toContain("上位2着");
  });

  it("Session の日付範囲検索とis_fixed往復", () => {
    const repo = memRepo();
    repo.saveSessions([
      makeSession("2026-04-01", "aerobic"),
      makeSession("2026-04-10", "high_lactate", { isFixed: true, fixedSource: "チーム練習" }),
      makeSession("2026-04-20", "race_economy"),
    ]);
    const range = repo.listSessions("2026-04-05", "2026-04-15");
    expect(range.length).toBe(1);
    expect(range[0].isFixed).toBe(true);
    expect(range[0].fixedSource).toBe("チーム練習");
    expect(repo.listSessions().length).toBe(3);
  });

  it("Session の更新（ステータス変更）と削除", () => {
    const repo = memRepo();
    const s = makeSession("2026-04-01", "high_lactate");
    repo.saveSession(s);
    repo.saveSession({ ...s, status: "completed" });
    expect(repo.getSession(s.id)!.status).toBe("completed");
    repo.deleteSession(s.id);
    expect(repo.getSession(s.id)).toBeUndefined();
  });

  it("SessionResult とセッションの紐付け", () => {
    const repo = memRepo();
    const s = makeSession("2026-04-01", "race_economy");
    repo.saveSession(s);
    repo.saveResult(makeResult(s, { rpe: 6, actualLapsSec: [85.2, 85.8, 86.0] }));
    const r = repo.resultForSession(s.id);
    expect(r!.actualLapsSec.length).toBe(3);
  });

  it("CFE の履歴が往復する", () => {
    const repo = memRepo();
    const cfe = initCfe(109.51, "2026-04-01");
    repo.saveCfe(cfe);
    const loaded = repo.getCfe()!;
    expect(loaded.estimated800mSec).toBeCloseTo(111.01, 2);
    expect(loaded.history.length).toBe(1);
  });

  it("DailyCheck は日付でupsert", () => {
    const repo = memRepo();
    repo.saveDailyCheck({ date: "2026-04-01", restingHr: 48, signal: "green" });
    repo.saveDailyCheck({ date: "2026-04-01", restingHr: 55, signal: "yellow" });
    const checks = repo.listDailyChecks();
    expect(checks.length).toBe(1);
    expect(checks[0].signal).toBe("yellow");
  });

  it("補強セッション・暑熱ブロックの保存", () => {
    const repo = memRepo();
    repo.saveStrength(makeStrength("2026-04-01", { contactCount: 120 }));
    expect(repo.listStrengths()[0].contactCount).toBe(120);
    repo.saveHeatBlock({ id: "hb1", startDate: "2026-07-01", endDate: "2026-07-12", targetRaceId: "r1" });
    repo.saveHeatEntry("hb1", { date: "2026-07-01", tempC: 32, avgHr: 150 });
    expect(repo.listHeatEntries("hb1").length).toBe(1);
  });

  it("変更差分ログ: 却下理由も記録され追跡可能（4-5-9）", () => {
    const repo = memRepo();
    repo.logChange(
      {
        sessionId: "s-1",
        field: "category",
        before: "high_lactate",
        after: "aerobic",
        reason: "赤信号のため",
        triggeredBy: "RULE-12",
        direction: "down",
      },
      false,
      "本人判断で実施したいため"
    );
    const log = repo.listChangeLog();
    expect(log.length).toBe(1);
    expect(log[0].accepted).toBe(false);
    expect(log[0].triggeredBy).toBe("RULE-12");
  });

  it("planned セッションの一括削除（プラン再生成用）", () => {
    const repo = memRepo();
    repo.saveSessions([
      makeSession("2026-04-01", "aerobic"),
      makeSession("2026-04-02", "cv", { status: "completed" }),
    ]);
    repo.deleteAllPlannedSessions();
    const rest = repo.listSessions();
    expect(rest.length).toBe(1);
    expect(rest[0].status).toBe("completed");
  });
});
