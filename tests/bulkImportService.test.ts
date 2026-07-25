/**
 * F-2 一括入力のサービス層テスト。
 *
 * 守りたいのは「未確定の行が保存に流れないこと」。
 * 一括入力は一度に何十件も入るので、1件でも推測が混ざると
 * どれが推測だったのか後から分からなくなる。
 */
import { describe, it, expect } from "vitest";
import { Repo } from "@/lib/db/repo";
import { memRepo } from "./sqlite-helper";
import {
  importBulkRows,
  previewBulkText,
  rowToPastEntry,
  regeneratePlan,
  assessFitness,
  dashboard,
  raceSplitPlan,
} from "@/lib/service";
import { acwr, dailyLoads } from "@/lib/core/load";
import { makeRace, testAthlete } from "./helpers";
import type { Goal } from "@/lib/core/types";

const TODAY = "2026-07-26";

const LOG = `日付\t練習内容\t練習結果
7/22\t8000mペース走（3:50/km）＋流し4本\t平均3:50 平均心拍186
7/23\tジョグ40〜50分（4:50〜5:10/km）\t51分　平均4:40 平均心拍154
7/24\tジョグ30分＋流し6本\t30分　平均5:40 平均心拍134
7/25土曜\t1000m×4〜5（3:10〜3:15）r200m jog\t`;

function setup(): Repo {
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

describe("F-2 一括入力", () => {
  it("プレビューは保存しない", () => {
    const repo = setup();
    const before = repo.listPastEntries().length;
    previewBulkText(repo, LOG, TODAY);
    expect(repo.listPastEntries()).toHaveLength(before);
  });

  it("確定できる行だけ登録し、未確定は登録しない", () => {
    const repo = setup();
    const rows = previewBulkText(repo, LOG, TODAY);
    const out = importBulkRows(repo, rows);
    // 1000m×4 はカテゴリ未確定なので登録されない
    expect(out.imported).toBe(3);
    expect(out.skipped).toBe(1);
    expect(repo.listPastEntries()).toHaveLength(3);
  });

  it("人がカテゴリを確定させれば登録できる", () => {
    const repo = setup();
    const rows = previewBulkText(repo, LOG, TODAY);
    const fixed = rows.map((r) =>
      r.categoryUncertain ? { ...r, category: "cv" as const, categoryUncertain: false } : r
    );
    const out = importBulkRows(repo, fixed);
    expect(out.imported).toBe(4);
    expect(out.skipped).toBe(0);
  });

  it("日誌の値がそのまま保存される（勝手に丸めない）", () => {
    const repo = setup();
    importBulkRows(repo, previewBulkText(repo, LOG, TODAY));
    const jog = repo.listPastEntries().find((e) => e.date === "2026-07-23")!;
    expect(jog.kind).toBe("continuous");
    expect(jog.durationMin).toBeCloseTo(51, 1);
    expect(jog.distanceKm).toBeCloseTo(10.93, 1);
    expect(jog.avgHr).toBe(154);
  });

  it("流しの本数を主セッションの本数に混ぜない", () => {
    const repo = setup();
    importBulkRows(repo, previewBulkText(repo, LOG, TODAY));
    const pace = repo.listPastEntries().find((e) => e.date === "2026-07-22")!;
    expect(pace.kind).toBe("continuous");
    expect(pace.reps).toBeUndefined();
    expect(pace.distanceKm).toBeCloseTo(8, 1);
    // 元の記述は備考として残す
    expect(pace.note).toContain("流し");
  });

  it("一括入力もCFEを動かさない（承認するまで反映しない）", () => {
    const repo = setup();
    const before = repo.getCfe()!.estimated800mSec;
    importBulkRows(repo, previewBulkText(repo, LOG, TODAY));
    expect(repo.getCfe()!.estimated800mSec).toBe(before);
    expect(repo.getCfe()!.history).toHaveLength(1);
  });

  it("一括入力した分がACWRの下地になる", () => {
    const repo = setup();
    // 4週間ぶんのジョグを日誌形式で作る
    const lines: string[] = [];
    for (let d = 1; d <= 28; d++) {
      if (d % 7 === 0) continue;
      const date = new Date(Date.UTC(2026, 5, 28 + d)).toISOString().slice(0, 10);
      const [, m, dd] = date.split("-");
      lines.push(`${Number(m)}/${Number(dd)}\tジョグ50分\t50分　平均4:40 平均心拍150`);
    }
    const rows = previewBulkText(repo, lines.join("\n"), TODAY);
    const out = importBulkRows(repo, rows);
    expect(out.imported).toBeGreaterThan(20);

    const loads = dailyLoads({
      sessions: repo.listSessions(),
      resultsBySessionId: new Map(repo.listResults().map((r) => [r.sessionId, r])),
      strengthSessions: repo.listStrengths(),
    });
    expect(acwr(loads, TODAY).rating).not.toBe("insufficient_data");
    expect(dashboard(repo, TODAY).acwr.acwr).toBeGreaterThan(0);
  });

  it("同じ日付を2回入れてもIDが衝突して壊れない", () => {
    const repo = setup();
    const rows = previewBulkText(repo, LOG, TODAY);
    importBulkRows(repo, rows);
    const n1 = repo.listPastEntries().length;
    importBulkRows(repo, rows);
    // 同じ内容なので上書きされ、件数は増えない（重複登録を防ぐ）
    expect(repo.listPastEntries()).toHaveLength(n1);
  });

  it("ready でない行は rowToPastEntry を通しても登録経路に乗らない", () => {
    const repo = setup();
    const rows = previewBulkText(repo, "7/20\tジョグ\tよかった", TODAY);
    expect(rows[0].ready).toBe(false);
    const out = importBulkRows(repo, rows);
    expect(out.imported).toBe(0);
    expect(repo.listPastEntries()).toHaveLength(0);
  });

  it("推定にも反映される", () => {
    const repo = setup();
    importBulkRows(
      repo,
      previewBulkText(repo, "7/18\t記録会 800m\t1:54.20", TODAY)
    );
    const a = assessFitness(repo, TODAY);
    expect(a.estimated800mSec).toBeCloseTo(114.2, 1);
  });
});

describe("F-2 保存する値の丸め", () => {
  it("割り算の結果をそのまま保存しない（30.666666666666668分にしない）", () => {
    const repo = setup();
    // 8km @3:50/km = 1840秒 = 30.6666...分
    importBulkRows(
      repo,
      previewBulkText(repo, "7/12\t8000mペース走\t平均3:50 平均心拍186", TODAY)
    );
    const e = repo.listPastEntries().find((x) => x.date === "2026-07-12")!;
    expect(e.durationMin).toBeDefined();
    // 小数1桁までに収まっていること
    const decimals = String(e.durationMin).split(".")[1] ?? "";
    expect(decimals.length).toBeLessThanOrEqual(1);
    expect(e.durationMin).toBeCloseTo(30.7, 1);
  });

  it("距離も同様に丸まっている", () => {
    const repo = setup();
    importBulkRows(
      repo,
      previewBulkText(repo, "7/13\tジョグ50分\t51分　平均4:40", TODAY)
    );
    const e = repo.listPastEntries().find((x) => x.date === "2026-07-13")!;
    const decimals = String(e.distanceKm).split(".")[1] ?? "";
    expect(decimals.length).toBeLessThanOrEqual(2);
  });
});

describe("F-2 レースの区間ラップを落とさない", () => {
  it("一括入力したレースのラップが配分シミュレータに届く", () => {
    const repo = setup();
    importBulkRows(
      repo,
      previewBulkText(
        repo,
        "7/13 レース　800m 1:56.0(56.0-60.0)\n7/14 レース　800m 1:53.49(56.7-56.7)",
        TODAY
      )
    );
    const races = repo.listPastEntries().filter((e) => e.kind === "race");
    expect(races).toHaveLength(2);
    expect(races.every((r) => (r.lapsSec?.length ?? 0) === 2)).toBe(true);

    const plan = raceSplitPlan(repo)!;
    expect(plan.blockedReason).toBeUndefined();
    expect(plan.options).toHaveLength(3);
    // 実測の落ち幅 = (4.0 + 0.0) / 2 = 2.0
    expect(plan.measuredFadeSec).toBeCloseTo(2.0, 1);
  });

  it("休養日も記録として残る", () => {
    const repo = setup();
    importBulkRows(repo, previewBulkText(repo, "7/5 オフ", TODAY));
    const off = repo.listPastEntries().find((e) => e.kind === "off");
    expect(off).toBeDefined();
    // 能力推定には使わない
    const a = assessFitness(repo, TODAY);
    expect(a.excluded.some((x) => x.reason.includes("休養日"))).toBe(true);
  });
});
