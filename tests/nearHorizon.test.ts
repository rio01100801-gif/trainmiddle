/**
 * 確定範囲の作り直し。
 *
 * 見張っているのは、以前 `repaceFutureSessions` が持っていた不具合の再発。
 * 設定ペース（targetPaces）だけを更新して処方の文面を放置すると、
 * 画面に出ている秒数と実際の設定が食い違う。CFEが2.5秒動いたときに
 * 34枠すべてで「画面52.5秒 / 実際51.6秒」になっていた。
 */
import { describe, expect, it } from "vitest";
import { memRepo } from "./sqlite-helper";
import { refreshNearHorizon, regeneratePlan } from "@/lib/service";
import { makeRace, testAthlete } from "./helpers";
import { CONFIRM_HORIZON_DAYS } from "@/lib/core/horizon";
import { addDays } from "@/lib/core/dates";
import type { Session } from "@/lib/core/types";

const TODAY = "2026-08-11";

function setup() {
  const repo = memRepo();
  repo.saveAthlete(testAthlete());
  const race = makeRace("2026-11-15");
  repo.saveRace(race);
  repo.saveGoal({
    targetEvent: "800m",
    targetTimeSec: 108.9,
    targetRaceId: race.id,
    subRaceIds: [],
  });
  regeneratePlan(repo, TODAY);
  return repo;
}

/** CFEを実際に動かす（速くなった方向） */
function bumpCfe(repo: ReturnType<typeof memRepo>, deltaSec: number) {
  const cfe = repo.getCfe()!;
  repo.saveCfe({ ...cfe, estimated800mSec: cfe.estimated800mSec + deltaSec });
}

/** 処方の文面に書かれている秒数（`@39.5〜40.4秒` の速い側） */
function secInText(s: Session): number | undefined {
  const m = s.prescription.match(/@(?:\d+m\s)?(\d+\.\d)〜/);
  return m ? Number(m[1]) : undefined;
}

describe("文面と設定ペースの整合", () => {
  it("作り直したあと、処方に書かれた秒数と設定ペースが一致する", () => {
    const repo = setup();
    bumpCfe(repo, -2.5);
    refreshNearHorizon(repo, TODAY);

    const until = addDays(TODAY, CONFIRM_HORIZON_DAYS);
    const checked = repo
      .listSessions()
      .filter(
        (s) =>
          s.date >= TODAY &&
          s.date <= until &&
          s.targetPaces.length > 0 &&
          secInText(s) !== undefined
      );
    expect(checked.length).toBeGreaterThan(0);
    for (const s of checked) {
      expect(secInText(s)).toBeCloseTo(s.targetPaces[0].targetSecFast, 1);
    }
  });

  it("CFEが動けば確定範囲の内容が実際に変わる（何もしていないわけではない）", () => {
    const repo = setup();
    bumpCfe(repo, -2.5);
    const changes = refreshNearHorizon(repo, TODAY);
    expect(changes.length).toBeGreaterThan(0);
    expect(changes[0].reason).toContain("確定範囲");
    expect(changes[0].triggeredBy).toBe("CFE");
  });

  it("CFEが変わっていなければ何も書き換えない（同じ入力から同じ結果）", () => {
    const repo = setup();
    expect(refreshNearHorizon(repo, TODAY)).toHaveLength(0);
  });
});

describe("触ってはいけないもの", () => {
  it("確定範囲の外は作り直さない", () => {
    const repo = setup();
    const until = addDays(TODAY, CONFIRM_HORIZON_DAYS);
    const far = repo
      .listSessions()
      .filter((s) => s.date > until && s.targetPaces.length > 0)
      .sort((a, b) => a.date.localeCompare(b.date))[0];
    expect(far).toBeDefined();
    const before = { pre: far.prescription, pace: far.targetPaces[0].targetSecFast };

    bumpCfe(repo, -2.5);
    refreshNearHorizon(repo, TODAY);

    const after = repo.getSession(far.id)!;
    expect(after.prescription).toBe(before.pre);
    expect(after.targetPaces[0].targetSecFast).toBe(before.pace);
  });

  it("本人が編集した予定は上書きしない（M-2を適用したものを含む）", () => {
    const repo = setup();
    const target = repo
      .listSessions()
      .filter((s) => s.date >= TODAY && s.date <= addDays(TODAY, 7) && s.targetPaces.length > 0)[0];
    expect(target).toBeDefined();
    repo.saveSession({ ...target, prescription: "本人が書いた内容", userEdited: true });

    bumpCfe(repo, -2.5);
    refreshNearHorizon(repo, TODAY);

    expect(repo.getSession(target.id)!.prescription).toBe("本人が書いた内容");
  });

  it("固定枠（コーチ指定）は上書きしない", () => {
    const repo = setup();
    const target = repo
      .listSessions()
      .filter((s) => s.date >= TODAY && s.date <= addDays(TODAY, 7) && s.targetPaces.length > 0)[0];
    repo.saveSession({ ...target, isFixed: true });

    bumpCfe(repo, -2.5);
    refreshNearHorizon(repo, TODAY);

    expect(repo.getSession(target.id)!.prescription).toBe(target.prescription);
  });

  it("実施済みは上書きしない", () => {
    const repo = setup();
    const target = repo
      .listSessions()
      .filter((s) => s.date >= TODAY && s.date <= addDays(TODAY, 7) && s.targetPaces.length > 0)[0];
    repo.saveSession({ ...target, status: "completed" });

    bumpCfe(repo, -2.5);
    refreshNearHorizon(repo, TODAY);

    const after = repo.getSession(target.id)!;
    expect(after.prescription).toBe(target.prescription);
    expect(after.status).toBe("completed");
  });

  it("作り直しは本人の編集にしない（userEdited を立てない）", () => {
    const repo = setup();
    bumpCfe(repo, -2.5);
    refreshNearHorizon(repo, TODAY);
    const until = addDays(TODAY, CONFIRM_HORIZON_DAYS);
    const touched = repo
      .listSessions()
      .filter((s) => s.date >= TODAY && s.date <= until && s.origin === "generated");
    expect(touched.length).toBeGreaterThan(0);
    for (const s of touched) expect(s.userEdited).not.toBe(true);
  });
});
