/**
 * 補強の一括入力。
 *
 * 実際のログには「体幹」「プライオ」「ウェイト」が普通に混ざる。
 * これまではカテゴリ未確定で全部落ちていたので、記録として残らなかった。
 *
 * ただし補強を SessionCategory に足すことはしない。
 * 走練習と同じ経路に入れると ACWR に二重で乗るし、
 * ルールエンジン22本が「補強は質練習か」を判定できない。
 * 既存の StrengthSession へ流すのが正しい置き場所。
 */
import { describe, it, expect } from "vitest";
import { Repo } from "@/lib/db/repo";
import { memRepo } from "./sqlite-helper";
import { importBulkRows, previewBulkText, regeneratePlan } from "@/lib/service";
import { inferCategory, inferStrengthType, parseContactCount } from "@/lib/core/bulkImport";
import { makeRace, testAthlete } from "./helpers";
import type { Goal } from "@/lib/core/types";

const TODAY = "2026-07-26";

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

describe("補強の判定", () => {
  it("語から種別を決める", () => {
    expect(inferStrengthType("プライオ")).toBe("plyometrics");
    expect(inferStrengthType("メディシンボール投げ")).toBe("medicine_ball");
    expect(inferStrengthType("体幹30分")).toBe("core");
    expect(inferStrengthType("ウェイト スクワット")).toBe("strength");
  });

  it("接地回数を拾う", () => {
    expect(parseContactCount("プライオ 接地120回")).toBe(120);
    expect(parseContactCount("バウンディング 80接地")).toBe(80);
    expect(parseContactCount("体幹30分")).toBeUndefined();
  });

  it("補強を走練習として解釈しない", () => {
    const r = inferCategory("ウェイト（スクワット・デッド）");
    expect(r.kind).toBe("strength");
    expect(r.category).toBeUndefined();
    expect(r.certain).toBe(true);
  });

  it("走練習と補強が同じ行にある場合は走練習を優先する", () => {
    // 「ジョグ40分＋体幹」は補強ではなくジョグとして残したい。
    // 有酸素量の把握が主目的で、補強は付随物だから
    const r = inferCategory("ジョグ40分＋体幹");
    expect(r.kind).toBe("continuous");
  });
});

describe("補強の登録先", () => {
  it("StrengthSession に入り、過去データには入らない", () => {
    const repo = setup();
    const rows = previewBulkText(
      repo,
      `7/20\tプライオ 接地120回
7/21\t体幹30分`,
      TODAY
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.ready)).toBe(true);

    const before = repo.listPastEntries().length;
    const out = importBulkRows(repo, rows);

    expect(out.strengthCount).toBe(2);
    expect(repo.listPastEntries()).toHaveLength(before); // 走練習側は増えない

    const st = repo.listStrengths("2026-07-01", "2026-07-31");
    const plyo = st.find((s) => s.date === "2026-07-20");
    expect(plyo?.type).toBe("plyometrics");
    expect(plyo?.contactCount).toBe(120);
    expect(st.find((s) => s.date === "2026-07-21")?.type).toBe("core");
  });

  it("補強は800m能力の推定に使われない", () => {
    // 補強からペースは出ないので、混ざると推定が壊れる
    const repo = setup();
    const rows = previewBulkText(repo, `7/20\tウェイト`, TODAY);
    importBulkRows(repo, rows);
    expect(repo.listPastEntries().filter((e) => e.kind === "strength")).toHaveLength(0);
  });
});
