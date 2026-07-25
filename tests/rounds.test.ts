import { describe, it, expect } from "vitest";
import {
  planHeatPace,
  assignExpectedPaces,
  recoveryProtocol,
  generateRecoverySessions,
  taperAnchor,
  diagnoseRounds,
} from "@/lib/core/rounds";
import { makeRace } from "./helpers";

describe("4-7-1 予選の想定ペース", () => {
  it("place: 目標+4〜6秒。上限の明示を含む", () => {
    const race = makeRace("2026-06-05", {
      advancementRule: "place",
      rounds: [
        { type: "heat", datetime: "2026-06-05T10:00:00" },
        { type: "final", datetime: "2026-06-07T15:00:00" },
      ],
    });
    const plan = planHeatPace(race, 108.9)!;
    expect(plan.expectedTimeSec).toBeCloseTo(113.9, 1);
    expect(plan.upperLimitNote).toContain("着に入れば足りる");
    expect(plan.lapFront400Sec + plan.lapBack400Sec).toBeCloseTo(plan.expectedTimeSec, 1);
  });

  it("time: ボーダータイム + 安全マージン0.5秒", () => {
    const race = makeRace("2026-06-05", {
      advancementRule: "time",
      borderTimeSec: 111.0,
      rounds: [
        { type: "heat", datetime: "2026-06-05T10:00:00" },
        { type: "final", datetime: "2026-06-07T15:00:00" },
      ],
    });
    const plan = planHeatPace(race, 108.9)!;
    expect(plan.expectedTimeSec).toBeCloseTo(110.5, 1);
  });

  it("place_and_time: 速い方を採用し、条件付き指示を出す", () => {
    const race = makeRace("2026-06-05", {
      advancementRule: "place_and_time",
      borderTimeSec: 111.0,
      rounds: [
        { type: "heat", datetime: "2026-06-05T10:00:00" },
        { type: "final", datetime: "2026-06-07T15:00:00" },
      ],
    });
    const plan = planHeatPace(race, 108.9)!;
    expect(plan.expectedTimeSec).toBeCloseTo(110.5, 1); // min(113.9, 110.5)
    expect(plan.conditionalNote).toBeDefined();
  });

  it("assignExpectedPaces がラウンドに想定を書き込む", () => {
    const race = makeRace("2026-06-05", {
      advancementRule: "place",
      rounds: [
        { type: "heat", datetime: "2026-06-05T10:00:00" },
        { type: "semifinal", datetime: "2026-06-06T15:00:00" },
        { type: "final", datetime: "2026-06-07T15:00:00" },
      ],
    });
    const updated = assignExpectedPaces(race, 108.9);
    expect(updated.rounds[0].expectedPaceSec).toBeCloseTo(113.9, 1);
    expect(updated.rounds[2].expectedPaceSec).toBeCloseTo(108.9, 1);
  });
});

describe("4-7-2 ラウンド間回復プロトコル", () => {
  it("同日: ジョグ10〜15分、流しなし", () => {
    const p = recoveryProtocol(0);
    expect(p[0]).toContain("流しは行わない");
  });

  it("翌日: ジョグ20〜30分 + 流し2〜3本", () => {
    expect(recoveryProtocol(1)[0]).toContain("流し2〜3本");
  });

  it("中1日: 2日分のプロトコル", () => {
    expect(recoveryProtocol(2).length).toBe(2);
  });

  it("中2日以上: 中日に150m×2〜3を1回まで", () => {
    const p = recoveryProtocol(3);
    expect(p.join()).toContain("150m");
  });

  it("回復セッションは isRecoveryProtocol=true で生成される", () => {
    const race = makeRace("2026-06-05", {
      rounds: [
        { type: "heat", datetime: "2026-06-05T10:00:00" },
        { type: "final", datetime: "2026-06-07T15:00:00" },
      ],
    });
    const sessions = generateRecoverySessions(race);
    expect(sessions.length).toBe(1); // 中1日 → 間の1日
    expect(sessions[0].isRecoveryProtocol).toBe(true);
    expect(sessions[0].date).toBe("2026-06-06");
  });
});

describe("4-7-3 テーパー基準日", () => {
  it("基準日はpeak_target_round、質練習カットオフは初戦3日前", () => {
    const race = makeRace("2026-06-05", {
      rounds: [
        { type: "heat", datetime: "2026-06-05T10:00:00" },
        { type: "final", datetime: "2026-06-07T15:00:00" },
      ],
    });
    const a = taperAnchor(race);
    expect(a.peakDate).toBe("2026-06-07");
    expect(a.firstRoundDate).toBe("2026-06-05");
    expect(a.qualityCutoffDate).toBe("2026-06-02");
  });
});

describe("4-7-4 ラウンド結果診断", () => {
  it("CFE更新には最速ラウンドを使う", () => {
    const d = diagnoseRounds([
      { roundType: "heat", timeSec: 112.5 },
      { roundType: "final", timeSec: 110.2 },
    ]);
    expect(d.fastestTimeSec).toBe(110.2);
    expect(d.assessment).toContain("良好");
  });

  it("決勝が予選より遅い場合は回復不足/出し切り警告", () => {
    const d = diagnoseRounds([
      { roundType: "heat", timeSec: 110.0 },
      { roundType: "final", timeSec: 111.5 },
    ]);
    expect(d.assessment).toContain("出し切って");
  });
});
