/**
 * P-2 / P-3 一括入力ぶんが下流に届いているか。
 *
 * 一括入力から作られた SessionResult に interval / continuous が入っていないと、
 * 週次レビュー・同一処方の比較・M-2の判断材料が、エラーも出さずに空になる。
 * 「コードはあるが実データで発火しない」という壊れ方をするので、
 * ここでは常に **実際に一括入力を通してから** 下流を確かめる。
 */
import { describe, expect, it } from "vitest";
import { memRepo } from "./sqlite-helper";
import { testAthlete } from "./helpers";
import {
  applyAssessedCfe,
  assessFitness,
  buildRuleContext,
  importBulkRows,
  previewBulkText,
  samePrescriptionGroups,
  setupCfeIfNeeded,
  taperPlan,
  weeklyReview,
} from "@/lib/service";
import { acwr, dailyLoads } from "@/lib/core/load";
import { executionSamples, executionTrend, jogEfficiency } from "@/lib/core/adaptive";
import { parseRest } from "@/lib/core/bulkImport";
import type { Repo } from "@/lib/db/repo";

const TODAY = "2026-07-26";
const RACE_DATE = "2026-08-05";

/** 実際の日誌に近い形。設定つきの高乳酸3回とジョグ4本を含む */
const LOG = [
  "6/29 50minジョグ 9.0km 平均心拍150",
  "7/1 300(41.5)×5 r5min 42.0 42.3 42.6 42.9 43.2",
  "7/4 55minジョグ 10.0km 平均心拍151",
  "7/6 300(42)＋600(1:26)＋600(1:26) r15min",
  "42 1:26 1:25",
  "7/8 300(41.5)×5 r5min 44.2 44.5 44.8 45.1 45.4",
  "7/13 レース　800m 1:56.0(56.0-60.0)",
  "7/16 65minジョグ　11.8km 平均心拍154",
  "7/18 1000(3:15-25)×4 r200jog 3:27 3:26 3:27 3:27 平均心拍180 最大195",
  "7/20 300(41.5)×5 r5min 44.4 44.7 45.0 45.3 45.6",
  "7/22 55minジョグ 10.0km 平均心拍162",
  "7/24 50minジョグ 9.1km 平均心拍163",
].join("\n");

function setup(): Repo {
  const repo = memRepo();
  repo.saveAthlete(testAthlete());
  repo.saveRace({
    id: "race-1",
    name: "目標レース",
    dateStart: RACE_DATE,
    priority: "A",
    rounds: [{ type: "final", datetime: `${RACE_DATE}T14:00:00` }],
    peakTargetRound: "final",
  } as never);
  repo.saveGoal({
    targetEvent: "800m",
    targetTimeSec: 108.9,
    targetRaceId: "race-1",
    subRaceIds: [],
  } as never);
  setupCfeIfNeeded(repo, TODAY);
  const rows = previewBulkText(repo, LOG, TODAY);
  importBulkRows(
    repo,
    rows.filter((r) => r.ready),
    TODAY
  );
  return repo;
}

describe("レストの構造化", () => {
  it("単位から時間と距離を区別する", () => {
    expect(parseRest("5min")).toEqual({ restSec: 300, restType: undefined });
    expect(parseRest("90秒")).toEqual({ restSec: 90, restType: undefined });
    expect(parseRest("200jog")).toEqual({ restDistanceM: 200, restType: "jog" });
    expect(parseRest("100walk")).toEqual({ restDistanceM: 100, restType: "walk" });
    expect(parseRest("400m")).toEqual({ restDistanceM: 400, restType: undefined });
  });

  it("単位が無いものは時間とも距離とも決めない（推測で埋めない）", () => {
    expect(parseRest("5")).toEqual({ restType: undefined });
  });
});

describe("P-2 一括入力ぶんが構造化記録として入る", () => {
  it("インターバルとジョグの両方に構造が付く", () => {
    const repo = setup();
    const results = repo.listResults();
    expect(results.filter((r) => r.interval).length).toBeGreaterThan(0);
    expect(results.filter((r) => r.continuous).length).toBeGreaterThan(0);

    // 設定タイムが落ちていないこと。ここが欠けると「設定に対してどうだったか」が出せない
    const hl = results.find((r) => r.interval?.distanceM === 300 && r.interval.reps === 5);
    expect(hl?.interval?.targetSec).toBe(41.5);
    expect(hl?.interval?.results.map((x) => x.actualSec)).toHaveLength(5);
    expect(hl?.interval?.restSec).toBe(300);

    // ジョグは心拍とペースが揃っていること（M-2 の材料になる）
    const jog = results.find((r) => r.continuous?.avgHr === 154);
    expect(jog?.continuous?.distanceKm).toBe(11.8);
    expect(jog?.continuous?.avgPaceSecPerKm).toBeGreaterThan(0);
  });

  it("週次レビューに一括入力ぶんが含まれる", () => {
    const repo = setup();
    const wr = weeklyReview(repo, TODAY, "2026-07-20");
    expect(wr.qualityLines.length).toBeGreaterThan(0);
    expect(wr.totalDistanceKm).toBeGreaterThan(0);
    // 設定に対する乖離まで出ていること（本数だけ数えても意味が無い）
    expect(wr.qualityLines.some((q) => q.deviationSec !== undefined)).toBe(true);
  });
});

describe("P-3 一括入力ぶんを消費する各所", () => {
  it("同一処方の経時比較に出る", () => {
    const repo = setup();
    const groups = samePrescriptionGroups(repo);
    const g = groups.find((x) => x.key.distanceM === 300 && x.key.reps === 5);
    expect(g).toBeDefined();
    expect(g!.occurrences.length).toBe(3);
    // 42秒台 → 45秒台なので悪化と判定されること
    expect(g!.avgTrend.judgement).toBe("worsening");
  });

  it("負荷（ACWR）には算入される", () => {
    const repo = setup();
    const results = repo.listResults();
    const loads = dailyLoads({
      sessions: repo.listSessions(),
      resultsBySessionId: new Map(results.map((r) => [r.sessionId, r])),
      strengthSessions: repo.listStrengths(),
    });
    expect(loads.get("2026-07-20")).toBeGreaterThan(0);
    expect(acwr(loads, TODAY).acuteLoad).toBeGreaterThan(0);
  });

  it("ルールエンジンの評価対象からは外れたままにする（既存の設計判断）", () => {
    const repo = setup();
    const ctx = buildRuleContext(repo, TODAY);
    expect(ctx.sessions.every((s) => !s.backfilled)).toBe(true);
    // 除外しても負荷は効いていること
    expect(ctx.currentAcwr === undefined || ctx.currentAcwr > 0).toBe(true);
  });
});

describe("M-2 一括入力ぶんが判断材料になる", () => {
  it("直近3回の実測から設定が緩む（CFEは動かさない）", () => {
    const repo = setup();
    const before = repo.getCfe()?.estimated800mSec;
    const samples = executionSamples(
      repo.listSessions(),
      repo.listResults(),
      "high_lactate",
      TODAY
    );
    expect(samples.length).toBe(3);
    const trend = executionTrend(samples);
    expect(trend.verdict).toBe("ease");
    expect(trend.factor).toBeGreaterThan(1);
    // 実行できなかったことは能力低下ではない。CFEは触らない
    expect(repo.getCfe()?.estimated800mSec).toBe(before);
  });

  it("ジョグの心拍が判断材料として使われる", () => {
    const repo = setup();
    const jog = jogEfficiency(repo.listResults(), TODAY);
    expect(jog.recentCount).toBeGreaterThanOrEqual(2);
    expect(jog.baselineCount).toBeGreaterThanOrEqual(2);
    expect(jog.deltaBpm).toBeDefined();
    // 150前後 → 162前後なので疲労として出ること
    expect(jog.fatigued).toBe(true);
  });
});

describe("M-6 レース前の変則調整", () => {
  it("14日前・10日前・7日前・前日で切り替わる", () => {
    const repo = setup();
    expect(taperPlan(repo, "2026-07-22").stage).toBe("t14");
    expect(taperPlan(repo, "2026-07-26").stage).toBe("t10");
    expect(taperPlan(repo, "2026-07-29").stage).toBe("t7");
    expect(taperPlan(repo, "2026-08-04").stage).toBe("eve");
  });

  it("固定練習は動かさない", () => {
    const repo = setup();
    repo.saveSession({
      id: "fixed-1",
      date: "2026-07-30",
      category: "high_lactate",
      name: "チーム練習",
      prescription: "300m×6",
      targetPaces: [],
      transfer800m: 4,
      transfer1500m: 3,
      riskLevel: "high",
      phase: "Specific",
      status: "planned",
      isFixed: true,
      timeOfDay: "pm",
    });
    const adj = taperPlan(repo, "2026-07-29").adjustments.find((a) => a.sessionId === "fixed-1");
    expect(adj?.kind).toBe("keep");
    expect(adj?.before).toBe(adj?.after);
  });
});

describe("一括入力ぶんはCFEの逐次更新に流れない", () => {
  it("登録しただけではCFEが動かず、承認して初めて動く", () => {
    const repo = memRepo();
    repo.saveAthlete(testAthlete());
    setupCfeIfNeeded(repo, TODAY);
    const before = repo.getCfe()!.estimated800mSec;
    const historyBefore = repo.getCfe()!.history.length;

    const rows = previewBulkText(repo, LOG, TODAY);
    importBulkRows(
      repo,
      rows.filter((r) => r.ready),
      TODAY
    );
    expect(repo.getCfe()!.estimated800mSec).toBe(before);
    expect(repo.getCfe()!.history.length).toBe(historyBefore);

    const a = assessFitness(repo, TODAY);
    expect(a.estimated800mSec).toBeDefined();
    applyAssessedCfe(repo, TODAY, "テスト");
    expect(repo.getCfe()!.estimated800mSec).not.toBe(before);
  });
});
