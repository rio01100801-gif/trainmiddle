/**
 * サービス層のうち、画面とAPIからしか呼ばれていなかった関数。
 *
 * どちらもE2Eでは通っているが、**境界の振る舞いが固定されていない**。
 * 材料が足りないときに、それらしい値を作って返していないことを見る。
 */
import { describe, expect, it } from "vitest";
import { memRepo } from "./sqlite-helper";
import { makeRace, testAthlete } from "./helpers";
import { convertMenuForMe, pendingFitImportSummaries, regeneratePlan } from "@/lib/service";
import type { Goal } from "@/lib/core/types";

const TODAY = "2026-07-26";

function setup(withGoal = true) {
  const repo = memRepo();
  repo.saveAthlete(testAthlete());
  if (!withGoal) return repo;
  const race = makeRace("2026-09-25");
  repo.saveRace(race);
  repo.saveGoal({
    targetEvent: "800m",
    targetTimeSec: 108.9,
    targetRaceId: race.id,
    subRaceIds: [],
  } as Goal);
  regeneratePlan(repo, TODAY);
  return repo;
}

describe("取り込み待ちのFIT", () => {
  it("何も取り込んでいなければ空（それらしい行を作らない）", () => {
    expect(pendingFitImportSummaries(setup())).toEqual([]);
  });

  it("読めなかったファイルも一覧から消さず、理由を付けて残す", () => {
    const repo = setup();
    repo.saveFitImport({
      id: "fit-broken",
      importedAtUtc: "2026-07-26T00:00:00Z",
      fileName: "broken.fit",
      rawBytesBase64: "",
      // 距離も時間も無い。取り込めないが、**黙って消さない**
      parse: { sessions: [], laps: [], records: [], eventCount: 0, hasDeveloperFields: false },
      autoClassification: { laps: [] },
      confirmedKinds: [],
    } as never);
    const out = pendingFitImportSummaries(repo);
    expect(out.length).toBe(1);
    expect(out[0].fileName).toBe("broken.fit");
    expect(out[0].error).toBeDefined();
  });

  it("予定に紐づいているかが分かる", () => {
    const repo = setup();
    repo.saveFitImport({
      id: "fit-ok",
      importedAtUtc: "2026-07-26T00:00:00Z",
      fileName: "run.fit",
      rawBytesBase64: "",
      parse: {
        sessions: [{ totalDistanceKm: 10, totalTimerSec: 3000, startTimeUtc: "2026-07-26T09:00:00Z" }],
        laps: [{ index: 0, distanceKm: 10, timerSec: 3000 }],
        records: [],
        eventCount: 0,
        hasDeveloperFields: false,
        activityTimestampUtc: "2026-07-26T09:00:00Z",
      },
      autoClassification: { laps: [] },
      confirmedKinds: ["main"],
    } as never);
    expect(pendingFitImportSummaries(repo)[0].linked).toBe(false);
  });
});

describe("他人のメニューを自分の設定に置き換える", () => {
  it("現在地が無ければ換算しない（推測で埋めない）", () => {
    const out = convertMenuForMe(setup(false), "300m×5 r5分", 108);
    expect(out.converted).toBeUndefined();
    expect(out.error).toMatch(/現在地/);
  });

  it("読めないメニューは、読めなかったと言って埋めない", () => {
    const out = convertMenuForMe(setup(), "なんかいい感じに走る", 108);
    // 「たぶんこうだろう」で数値を作らない。読めなかったことを本文に出す
    expect(out.text).toContain("読み取れませんでした");
    expect(out.converted?.structure.recognized).toBe(false);
    expect(out.converted?.structure.slots).toEqual([]);
    // 何が足りないかを言う（空欄にして理由を出す）
    expect(out.converted?.structure.issues?.join("")).toBeTruthy();
  });

  it("読めれば自分の設定に置き換わる", () => {
    const out = convertMenuForMe(setup(), "300m×5 @41.0秒 r5分", 108);
    expect(out.error).toBeUndefined();
    expect(out.converted).toBeDefined();
    expect(out.text).toContain("300");
  });
});
