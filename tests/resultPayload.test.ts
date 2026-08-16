/**
 * 記録画面が保存する中身の組み立て。
 *
 * これまで画面の中にあり、E2Eで1経路ずつ叩くしかなかった。
 * ここで一番見たいのは **隠れているモードの値が混ざらないこと**。
 * 実際に起きうる形（インターバルを入れてからジョグに切り替えて保存）を、
 * E2Eだけでなくここでも押さえる。
 */
import { describe, expect, it } from "vitest";
import {
  buildContinuousPayload,
  buildIntervalPayload,
  parsePerRepRestInput,
  parseRepTime,
  parseRestInput,
  type ContinuousDraft,
  type IntervalDraft,
  type ResultPayloadCommon,
} from "@/lib/core/resultPayload";

const common: ResultPayloadCommon = {
  sessionId: "s1",
  sessionCategory: "aerobic",
  date: "2026-08-16",
  rpe: 5,
  subjective: "easy",
};

function continuous(over: Partial<ContinuousDraft> = {}): ContinuousDraft {
  return { distanceKm: 10, durationMin: 50, paceOverride: false, ...over };
}

function interval(over: Partial<IntervalDraft> = {}): IntervalDraft {
  return {
    reps: 3,
    distanceM: 400,
    targetSec: 60,
    mixed: false,
    perRep: true,
    repTimes: ["60.0", "60.5", "61.0"],
    times: "",
    slotCount: 3,
    slotDistances: [],
    slotTargets: [],
    slotRestDistances: [],
    withRest: false,
    repRests: [],
    withActualDistance: false,
    repDistances: [],
    withHr: false,
    repHrs: [],
    hasStructuredPerRepRest: false,
    restType: "jog",
    restMode: "time",
    restValue: "300",
    ...over,
  };
}

describe("入力の書き方をほどく", () => {
  it("秒でも分:秒でも読む", () => {
    expect(parseRepTime("41.6")).toBeCloseTo(41.6);
    expect(parseRepTime("1:26.5")).toBeCloseTo(86.5);
  });

  it("空欄と0は読まない（0本目として混ざらないように）", () => {
    expect(parseRepTime("")).toBeUndefined();
    expect(parseRepTime("   ")).toBeUndefined();
    expect(parseRepTime("0")).toBeUndefined();
    expect(parseRepTime("abc")).toBeUndefined();
  });

  it("レストは単位が無ければ秒として読む（入力欄なので）", () => {
    expect(parseRestInput("300")).toBe(300);
    expect(parseRestInput("6分")).toBe(360);
    expect(parseRestInput("90秒")).toBe(90);
    expect(parseRestInput("")).toBeUndefined();
  });

  it("距離のレストは秒に直さない", () => {
    expect(parseRestInput("200m")).toBeUndefined();
    expect(parsePerRepRestInput("200m").restDistanceM).toBe(200);
  });
});

describe("持続走", () => {
  it("距離・時間・ペースを入れる", () => {
    const p = buildContinuousPayload(common, continuous());
    expect(p.continuous).toMatchObject({ distanceKm: 10, durationMin: 50 });
    expect((p.continuous as { avgPaceSecPerKm: number }).avgPaceSecPerKm).toBeCloseTo(300);
  });

  it("インターバルの値は付かない", () => {
    /*
     * 引数の型で混ざりようがないようにしてあるが、
     * 将来 common に足したときに漏れないよう、形でも押さえる。
     */
    const p = buildContinuousPayload(common, continuous());
    expect(p.interval).toBeUndefined();
    expect(p.actualLapsSec).toBeUndefined();
    expect(p.lapDistancesM).toBeUndefined();
  });

  it("ペースから距離を出したときは「上書き」にしない", () => {
    // それが実測そのものなので、手で入れたペースの上書きとは別
    const p = buildContinuousPayload(
      common,
      continuous({ paceOverride: true, derived: "distanceKm" })
    );
    expect((p.continuous as { paceOverridden?: boolean }).paceOverridden).toBeUndefined();
  });

  it("手で入れたペースが使われたときだけ上書きにする", () => {
    const p = buildContinuousPayload(
      common,
      continuous({ paceOverride: true, derived: "durationSec" })
    );
    expect((p.continuous as { paceOverridden?: boolean }).paceOverridden).toBe(true);
  });

  it("丸めは距離が小数2桁・時間が1桁", () => {
    const p = buildContinuousPayload(common, continuous({ distanceKm: 10.126, durationMin: 50.44 }));
    expect(p.continuous).toMatchObject({ distanceKm: 10.13, durationMin: 50.4 });
  });
});

describe("インターバル", () => {
  it("本ごとの実測が入る", () => {
    const p = buildIntervalPayload(common, interval());
    expect(p.actualLapsSec).toEqual([60, 60.5, 61]);
    expect(p.lapDistancesM).toEqual([400, 400, 400]);
  });

  it("持続走の値は付かない", () => {
    const p = buildIntervalPayload(common, interval());
    expect(p.continuous).toBeUndefined();
    expect(p.durationMin).toBeUndefined();
  });

  it("複合なら共通の設定タイムを持たない（本ごとに違うため）", () => {
    const p = buildIntervalPayload(common, interval({ mixed: true }));
    expect((p.interval as { targetSec?: number }).targetSec).toBeUndefined();
  });

  it("まとめて貼った場合も1本ずつに開く", () => {
    const p = buildIntervalPayload(
      common,
      interval({ perRep: false, times: "60.0,60.5,61.0" })
    );
    expect(p.actualLapsSec).toEqual([60, 60.5, 61]);
  });

  it("予定より短い本は実距離を残す（500m予定を400mで止めた本）", () => {
    const p = buildIntervalPayload(
      common,
      interval({
        distanceM: 500,
        slotDistances: [500, 500, 500],
        withActualDistance: true,
        repDistances: ["500", "500", "400"],
      })
    );
    expect(p.lapDistancesM).toEqual([500, 500, 400]);
  });

  it("レストは時間指定なら秒だけ、距離指定なら距離だけ入れる", () => {
    const byTime = buildIntervalPayload(common, interval({ restMode: "time", restValue: "300" }));
    expect(byTime.interval).toMatchObject({ restSec: 300, restDistanceM: undefined });
    const byDist = buildIntervalPayload(
      common,
      interval({ restMode: "distance", restValue: "200" })
    );
    expect(byDist.interval).toMatchObject({ restSec: undefined, restDistanceM: 200 });
  });

  it("本ごとのレストがあるときは共通のレストを入れない（二重に持たない）", () => {
    const p = buildIntervalPayload(common, interval({ hasStructuredPerRepRest: true }));
    expect(p.interval).toMatchObject({ restSec: undefined, restDistanceM: undefined });
  });

  it("本ごとのレストを入れると、その本だけに付く", () => {
    const p = buildIntervalPayload(
      common,
      interval({ withRest: true, repRests: ["3分", "5分", ""] })
    );
    const results = (p.interval as { results: { restAfterSec?: number }[] }).results;
    expect(results[0].restAfterSec).toBe(180);
    expect(results[1].restAfterSec).toBe(300);
    // 空欄の本はセッション共通の設定を使うので、ここでは持たない
    expect(results[2].restAfterSec).toBeUndefined();
  });

  it("空欄の本は処方の距離レストに落ちる", () => {
    const p = buildIntervalPayload(
      common,
      interval({ withRest: true, repRests: ["", "", ""], slotRestDistances: [200, 200, undefined] })
    );
    const results = (p.interval as { results: { restAfterDistanceM?: number }[] }).results;
    expect(results[0].restAfterDistanceM).toBe(200);
    expect(results[2].restAfterDistanceM).toBeUndefined();
  });

  it("本ごとの心拍を入れると付く。空欄と0は入れない", () => {
    const p = buildIntervalPayload(
      common,
      interval({ withHr: true, repHrs: ["170", "", "0"] })
    );
    const results = (p.interval as { results: { avgHr?: number }[] }).results;
    expect(results[0].avgHr).toBe(170);
    expect(results[1].avgHr).toBeUndefined();
    expect(results[2].avgHr).toBeUndefined();
  });

  it("まとめて入れたときは本ごとの心拍・距離・レストを見ない", () => {
    // 欄が出ていないので、残っていた値が混ざらないこと
    const p = buildIntervalPayload(
      common,
      interval({
        perRep: false,
        times: "60.0,60.5,61.0",
        withHr: true,
        repHrs: ["170", "171", "172"],
        withActualDistance: true,
        repDistances: ["300", "300", "300"],
      })
    );
    const results = (p.interval as { results: { avgHr?: number }[] }).results;
    expect(results.every((r) => r.avgHr === undefined)).toBe(true);
    expect(p.lapDistancesM).toEqual([400, 400, 400]);
  });
});

describe("どちらのモードでも共通", () => {
  it("その日の条件と打ち切りの理由が付く", () => {
    const withEnv: ResultPayloadCommon = {
      ...common,
      conditions: ["rain"],
      shoeId: "shoe-1",
      abortCause: "condition",
      weatherTempC: 26,
    };
    for (const p of [
      buildContinuousPayload(withEnv, continuous()),
      buildIntervalPayload(withEnv, interval()),
    ]) {
      expect(p.conditions).toEqual(["rain"]);
      expect(p.shoeId).toBe("shoe-1");
      expect(p.abortCause).toBe("condition");
      expect(p.weatherTempC).toBe(26);
    }
  });

  it("達成度はサービス層が実測から決めるので、ここでは仮置き", () => {
    expect(buildContinuousPayload(common, continuous()).achievement).toBe("achieved");
    expect(buildIntervalPayload(common, interval()).achievement).toBe("achieved");
  });
});
