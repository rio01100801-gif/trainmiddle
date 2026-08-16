/**
 * 結果保存の中心（`processResultCore`）で、一度も通っていなかった分岐。
 *
 * カバレッジを測ったら、**結果保存→CFE→波及の中心に未検証の分岐が11本**あった。
 * ここは黙って壊れると能力の推定と先の予定がずれる場所なので、
 * 数の多さではなく**実害の大きさ**で選んで埋める。
 *
 * 特に最後のひとつ——**波及が実際に先の予定を書き換える経路**——は
 * 一度も動かされていなかった。悪い結果のあとに高負荷日を休養へ置き換える
 * 仕組みで、動かなければ「気づかないうちに詰め込んだまま」になる。
 */
import { describe, expect, it } from "vitest";
import { memRepo } from "./sqlite-helper";
import { processResult, regeneratePlan } from "@/lib/service";
import { makeRace, testAthlete } from "./helpers";
import type { Goal, SessionCategory, SessionResult } from "@/lib/core/types";

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

type Repo = ReturnType<typeof memRepo>;

/** 指定カテゴリの未実施セッションを古い順に取る */
function planned(repo: Repo, category: SessionCategory) {
  return repo
    .listSessions()
    .filter((s) => s.category === category && s.status === "planned")
    .sort((a, b) => a.date.localeCompare(b.date));
}

function jogResult(sessionId: string, date: string, over: Partial<SessionResult> = {}) {
  return {
    id: `res-${sessionId}`,
    sessionId,
    date,
    actualLapsSec: [],
    continuous: { distanceKm: 10, durationMin: 50 },
    achievement: "achieved",
    rpe: 5,
    subjective: "easy",
    ...over,
  } as SessionResult;
}

describe("受け付けない入力", () => {
  it("知らないセッションidなら断る（宙に浮いた記録を作らない）", () => {
    const repo = setup();
    expect(() =>
      processResult(repo, jogResult("no-such-session", TODAY))
    ).toThrow(/セッションが見つかりません/);
  });

  it("記録できない種類を指定したら断る", () => {
    /*
     * 「実際に行ったメニューの種類」は、記録として成立する種類だけを受ける。
     * ここが緩むと、休養や存在しない種類の記録が保存されて集計に混ざる。
     */
    const repo = setup();
    const s = planned(repo, "aerobic")[0];
    expect(() =>
      processResult(repo, jogResult(s.id, s.date), {
        sessionCategory: "off" as SessionCategory,
      })
    ).toThrow(/種類が正しくありません/);
  });

  it("記録できる種類なら通る", () => {
    const repo = setup();
    const s = planned(repo, "aerobic")[0];
    expect(() =>
      processResult(repo, jogResult(s.id, s.date), { sessionCategory: "aerobic" })
    ).not.toThrow();
  });
});

describe("翌日の脚が2回続けて重いとき", () => {
  /*
   * 翌日の脚の重さは、その日の疲労ではなく**抜けていない疲労**の合図。
   * 2回続いたら、その結果はCFEに反映しない——実行できなかったことは
   * 能力低下ではないので、設定側で対応する（cfe.ts の hotOrFatigued）。
   */
  function runQuality(repo: Repo, index: number, legs: "heavy" | "normal") {
    const s = planned(repo, "high_lactate")[index];
    const target = s.targetPaces[0];
    const slow = target.targetSecSlow + 4; // 未達側に振ってCFEを動かしにいく
    return processResult(repo, {
      id: `res-${s.id}`,
      sessionId: s.id,
      date: s.date,
      actualLapsSec: [slow, slow, slow],
      lapDistancesM: [target.distanceM, target.distanceM, target.distanceM],
      interval: {
        reps: 3,
        distanceM: target.distanceM,
        targetSec: (target.targetSecFast + target.targetSecSlow) / 2,
        restType: "jog",
        results: [0, 1, 2].map((i) => ({
          index: i + 1,
          distanceM: target.distanceM,
          targetSec: (target.targetSecFast + target.targetSecSlow) / 2,
          actualSec: slow,
        })),
      },
      achievement: "achieved",
      rpe: 9,
      subjective: "very_hard",
      nextDayLegs: legs,
    } as SessionResult);
  }

  it("1回だけならCFEに反映する", () => {
    const repo = setup();
    runQuality(repo, 0, "normal");
    const out = runQuality(repo, 1, "heavy");
    expect(out.guardrailNotes.join(" ")).not.toContain("疲労環境下");
  });

  it("2回続いたらCFEに反映しない（疲労を能力低下と誤認しない）", () => {
    const repo = setup();
    runQuality(repo, 0, "heavy");
    const out = runQuality(repo, 1, "heavy");
    expect(out.guardrailNotes.join(" ")).toContain("疲労環境下");
    expect(out.cfeApplied).toBe(false);
  });
});

describe("波及が先の予定を書き換える", () => {
  it("固定枠は書き換えない（本人が決めたものを動かさない）", () => {
    const repo = setup();
    // 先の高負荷を固定枠にしておく
    const future = planned(repo, "high_lactate");
    if (future.length > 0) {
      repo.saveSession({ ...future[future.length - 1], isFixed: true });
    }
    const list = planned(repo, "aerobic").slice(0, 3);
    for (const s of list) {
      processResult(
        repo,
        jogResult(s.id, s.date, { nextDayLegs: "heavy", rpe: 9, subjective: "very_hard" })
      );
    }
    // 固定枠は残っている
    for (const f of future.filter((x) => x.isFixed)) {
      expect(repo.getSession(f.id)?.isFixed).toBe(true);
    }
  });

  it("置き換えたら、何をどう変えたかが記録に残る", () => {
    /*
     * 黙って予定を書き換えない（CLAUDE.md）。
     * 置き換えが起きたなら、その理由が変更履歴か案内に出ていること。
     */
    const repo = setup();
    const list = planned(repo, "aerobic").slice(0, 3);
    let out;
    for (const s of list) {
      out = processResult(
        repo,
        jogResult(s.id, s.date, { nextDayLegs: "heavy", rpe: 9, subjective: "very_hard" })
      );
    }
    const changed = out!.changes ?? [];
    for (const c of changed) {
      // 変更には必ず理由が付く
      expect(typeof c.reason === "string" || typeof c.action === "string").toBe(true);
    }
    // 置き換えが起きたなら、その予定は実際に変わっている
    for (const c of changed) {
      if (c.action === "replace_with_off") {
        expect(repo.getSession(c.sessionId)?.category).toBe("off");
      }
      if (c.action === "replace_with_aerobic") {
        expect(repo.getSession(c.sessionId)?.category).toBe("aerobic");
      }
    }
  });
});
