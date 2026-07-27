import { describe, it, expect } from "vitest";
import { runRuleEngine, weeklySummary } from "@/lib/core/rules";
import { ctx, makeSession, makeStrength, makeRace, violationsOf, testAthlete } from "./helpers";

describe("RULE-01 高乳酸の頻度と間隔", () => {
  it("5日未満の間隔でERROR", () => {
    const c = ctx({
      sessions: [
        makeSession("2026-04-06", "high_lactate"),
        makeSession("2026-04-09", "high_lactate"),
      ],
    });
    const v = violationsOf(runRuleEngine(c), "RULE-01");
    expect(v.length).toBeGreaterThan(0);
    expect(v[0].level).toBe("ERROR");
  });

  it("同一週内2回（間隔5日以上でも）でERROR", () => {
    // 月曜と土曜: 間隔5日だが同一週
    const c = ctx({
      sessions: [
        makeSession("2026-04-06", "high_lactate"), // 月
        makeSession("2026-04-11", "high_lactate"), // 土
      ],
    });
    expect(violationsOf(runRuleEngine(c), "RULE-01").length).toBeGreaterThan(0);
  });

  it("週1回・5日以上間隔なら違反なし", () => {
    const c = ctx({
      sessions: [
        makeSession("2026-04-06", "high_lactate"),
        makeSession("2026-04-14", "high_lactate"),
      ],
    });
    expect(violationsOf(runRuleEngine(c), "RULE-01").length).toBe(0);
  });

  it("モデリング期（レース14〜28日前）の3日間隔2連は1回だけ許可", () => {
    const race = makeRace("2026-05-10");
    const c = ctx({
      races: [race],
      sessions: [
        makeSession("2026-04-15", "high_lactate"), // レース25日前
        makeSession("2026-04-18", "high_lactate"), // レース22日前、3日間隔
      ],
    });
    expect(violationsOf(runRuleEngine(c), "RULE-01").length).toBe(0);
  });

  it("モデリング期の2連の直後7日間に高乳酸があるとERROR", () => {
    const race = makeRace("2026-05-10");
    const c = ctx({
      races: [race],
      sessions: [
        makeSession("2026-04-15", "high_lactate"),
        makeSession("2026-04-18", "high_lactate"),
        makeSession("2026-04-23", "high_lactate"), // 2連の5日後 → 禁止
      ],
    });
    expect(violationsOf(runRuleEngine(c), "RULE-01").length).toBeGreaterThan(0);
  });

  it("モデリング期外の3日間隔はERROR", () => {
    const c = ctx({
      sessions: [
        makeSession("2026-04-06", "high_lactate"),
        makeSession("2026-04-09", "high_lactate"),
      ],
    });
    expect(violationsOf(runRuleEngine(c), "RULE-01").length).toBeGreaterThan(0);
  });

  it("modeling カテゴリも高乳酸相当として扱う", () => {
    const c = ctx({
      sessions: [
        makeSession("2026-04-06", "high_lactate"),
        makeSession("2026-04-08", "modeling"),
      ],
    });
    expect(violationsOf(runRuleEngine(c), "RULE-01").length).toBeGreaterThan(0);
  });
});

describe("RULE-03 高負荷練習の間隔", () => {
  it("種類が異なる高負荷練習が連日ならERROR", () => {
    const c = ctx({
      sessions: [
        makeSession("2026-04-06", "race_economy"),
        makeSession("2026-04-07", "threshold"),
      ],
    });
    expect(violationsOf(runRuleEngine(c), "RULE-03").length).toBe(1);
  });

  it("中1日空けば違反なし（間の日がneuralでも可）", () => {
    const c = ctx({
      sessions: [
        makeSession("2026-04-06", "race_economy"),
        makeSession("2026-04-07", "neural"),
        makeSession("2026-04-08", "threshold"),
      ],
    });
    expect(violationsOf(runRuleEngine(c), "RULE-03").length).toBe(0);
  });

  it("同日に高負荷練習2つでERROR", () => {
    const c = ctx({
      sessions: [
        makeSession("2026-04-06", "race_economy"),
        makeSession("2026-04-06", "cv"),
      ],
    });
    expect(violationsOf(runRuleEngine(c), "RULE-03").length).toBe(1);
  });
});

describe("RULE-04 週内高負荷の種類と組み合わせ", () => {
  it("高負荷3日でも特異的が2日以下ならWARNに留める", () => {
    const c = ctx({
      sessions: [
        makeSession("2026-04-06", "race_economy"),
        makeSession("2026-04-08", "threshold"),
        makeSession("2026-04-10", "cv"),
      ],
    });
    const violation = violationsOf(runRuleEngine(c), "RULE-04")[0];
    expect(violation.level).toBe("WARN");
    expect(violation.message).toContain("高負荷が3日");
  });

  it("高乳酸・中距離特異的が週3日ならERROR", () => {
    const c = ctx({
      sessions: [
        makeSession("2026-04-06", "high_lactate"),
        makeSession("2026-04-08", "race_economy"),
        makeSession("2026-04-10", "modeling"),
      ],
    });
    expect(violationsOf(runRuleEngine(c), "RULE-04")[0].level).toBe("ERROR");
  });

  it("有酸素高強度が週4日なら理由と変更案を一致させる", () => {
    const c = ctx({
      sessions: [
        makeSession("2026-04-06", "cv"),
        makeSession("2026-04-08", "threshold"),
        makeSession("2026-04-10", "cv"),
        makeSession("2026-04-12", "threshold"),
      ],
    });
    const violation = violationsOf(runRuleEngine(c), "RULE-04")[0];
    expect(violation.level).toBe("ERROR");
    expect(violation.message).toContain("種類を問わず高負荷日");
    expect(violation.suggestion).toContain("有酸素高強度");
    expect(violation.suggestion).not.toContain("高乳酸・中距離特異的の1回");
  });

  it("短いneuralは高負荷にカウントしない（週3回入れても違反なし）", () => {
    const c = ctx({
      sessions: [
        makeSession("2026-04-06", "race_economy"),
        makeSession("2026-04-07", "neural"),
        makeSession("2026-04-08", "threshold"),
        makeSession("2026-04-09", "neural"),
        makeSession("2026-04-11", "neural"),
      ],
    });
    expect(violationsOf(runRuleEngine(c), "RULE-04").length).toBe(0);
  });

  it("長い反復をneuralにしても軽負荷として扱わない", () => {
    const neural = makeSession("2026-04-07", "neural", {
      name: "スピード持久",
      prescription: "300m × 5本 r5分",
    });
    const c = ctx({
      sessions: [makeSession("2026-04-06", "threshold"), neural],
    });
    expect(violationsOf(runRuleEngine(c), "RULE-03")).toHaveLength(1);
    const classification = violationsOf(runRuleEngine(c), "RULE-04").find((v) =>
      v.message.includes("短い完全回復の刺激とは別")
    );
    expect(classification?.sessionIds).toContain(neural.id);
  });
});

describe("RULE-05 有酸素偏重の検出", () => {
  it("cv+threshold 2回 / 特異的1回以下でWARN", () => {
    const c = ctx({
      sessions: [
        makeSession("2026-04-06", "cv"),
        makeSession("2026-04-09", "threshold"),
        makeSession("2026-04-08", "aerobic"),
      ],
    });
    const v = violationsOf(runRuleEngine(c), "RULE-05");
    expect(v.length).toBe(1);
    expect(v[0].message).toContain("有酸素偏重");
  });

  it("特異的2回あれば警告なし", () => {
    const c = ctx({
      sessions: [
        makeSession("2026-04-06", "cv"),
        makeSession("2026-04-08", "race_economy"),
        makeSession("2026-04-10", "high_lactate"),
      ],
    });
    // RULE-04(週3回)は別途出るが、RULE-05は出ない
    expect(violationsOf(runRuleEngine(c), "RULE-05").length).toBe(0);
  });
});

describe("RULE-06 VLaMaxリスク", () => {
  it("連続3週で高乳酸3回以上でWARN", () => {
    const c = ctx({
      sessions: [
        makeSession("2026-04-06", "high_lactate"),
        makeSession("2026-04-14", "high_lactate"),
        makeSession("2026-04-22", "high_lactate"),
      ],
    });
    expect(violationsOf(runRuleEngine(c), "RULE-06").length).toBeGreaterThan(0);
  });
});

describe("RULE-07 / RULE-08 / RULE-09 テーパー保護", () => {
  it("レース14日前以降の高乳酸2回でERROR", () => {
    const race = makeRace("2026-05-10");
    const c = ctx({
      races: [race],
      sessions: [
        makeSession("2026-05-01", "high_lactate"), // 9日前
        makeSession("2026-05-05", "high_lactate"), // 5日前
      ],
    });
    expect(violationsOf(runRuleEngine(c), "RULE-07").length).toBeGreaterThan(0);
  });

  it("レース8日前の高乳酸1回は適正配置", () => {
    const race = makeRace("2026-05-10");
    const c = ctx({
      races: [race],
      sessions: [makeSession("2026-05-02", "high_lactate")], // 8日前
    });
    expect(violationsOf(runRuleEngine(c), "RULE-07").length).toBe(0);
  });

  it("レース5日前の高乳酸は配置違反（7〜9日前でない）", () => {
    const race = makeRace("2026-05-10");
    const c = ctx({
      races: [race],
      sessions: [makeSession("2026-05-05", "high_lactate")],
    });
    expect(violationsOf(runRuleEngine(c), "RULE-07").length).toBe(1);
  });

  it("レース7日前以降の質練習(threshold)はRULE-08違反、autofixでneural化を提案", () => {
    const race = makeRace("2026-05-10");
    const c = ctx({
      races: [race],
      sessions: [makeSession("2026-05-06", "threshold")], // 4日前
    });
    const v = violationsOf(runRuleEngine(c), "RULE-08");
    expect(v.length).toBe(1);
    expect(v[0].autofix?.[0].after).toBe("neural");
  });

  it("レース7日前以降のneuralは違反にならない", () => {
    const race = makeRace("2026-05-10");
    const c = ctx({
      races: [race],
      sessions: [makeSession("2026-05-07", "neural")],
    });
    expect(violationsOf(runRuleEngine(c), "RULE-08").length).toBe(0);
  });

  it("C優先度（練習レース）にはテーパー保護ルールを適用しない", () => {
    const race = makeRace("2026-05-10", { priority: "C" });
    const c = ctx({
      races: [race],
      sessions: [makeSession("2026-05-06", "threshold")],
    });
    expect(violationsOf(runRuleEngine(c), "RULE-08").length).toBe(0);
  });

  it("レース前3日間の走行距離が通常週換算50%超でRULE-09違反", () => {
    const race = makeRace("2026-05-10");
    const sessions = [];
    // 通常期: 28日前〜7日前に毎日10km（日平均10km）
    for (let d = 7; d <= 28; d++) {
      const date = new Date(Date.UTC(2026, 4, 10));
      date.setUTCDate(date.getUTCDate() - d);
      sessions.push(
        makeSession(date.toISOString().slice(0, 10), "aerobic", { distanceKm: 10 })
      );
    }
    // レース前3日: 合計20km（上限は 10×3×0.5 = 15km）
    sessions.push(makeSession("2026-05-07", "aerobic", { distanceKm: 8 }));
    sessions.push(makeSession("2026-05-08", "aerobic", { distanceKm: 7 }));
    sessions.push(makeSession("2026-05-09", "aerobic", { distanceKm: 5 }));
    const c = ctx({ races: [race], sessions });
    expect(violationsOf(runRuleEngine(c), "RULE-09").length).toBe(1);
  });
});

describe("RULE-10 / RULE-11 暑熱", () => {
  it("heat_tolerance=low かつ 28℃以上の高乳酸でWARN", () => {
    const c = ctx({
      sessions: [makeSession("2026-04-15", "high_lactate")],
      dayTempsC: { "2026-04-15": 30 },
    });
    expect(violationsOf(runRuleEngine(c), "RULE-10").length).toBe(1);
  });

  it("気温データが無くても夏季(7月)はフラグで警告", () => {
    const c = ctx({ sessions: [makeSession("2026-07-15", "race_economy")] });
    expect(violationsOf(runRuleEngine(c), "RULE-10").length).toBe(1);
  });

  it("heat_tolerance=normal なら警告なし", () => {
    const c = ctx({
      athlete: testAthlete({ heatTolerance: "normal" }),
      sessions: [makeSession("2026-07-15", "high_lactate")],
    });
    expect(violationsOf(runRuleEngine(c), "RULE-10").length).toBe(0);
  });

  it("真夏の2部練習でWARN", () => {
    const c = ctx({
      sessions: [
        makeSession("2026-07-20", "aerobic", { timeOfDay: "am" }),
        makeSession("2026-07-20", "neural", { timeOfDay: "pm" }),
      ],
    });
    expect(violationsOf(runRuleEngine(c), "RULE-11").length).toBe(1);
  });
});

describe("RULE-12 赤信号", () => {
  it("直近14日に赤信号 → 次の質練習をaerobicに置換提案(ERROR)", () => {
    const c = ctx({
      evaluationDate: "2026-04-10",
      dailyChecks: [{ date: "2026-04-08", signal: "red" }],
      sessions: [makeSession("2026-04-12", "high_lactate")],
    });
    const v = violationsOf(runRuleEngine(c), "RULE-12");
    expect(v.length).toBe(1);
    expect(v[0].autofix?.[0].action).toBe("replace_with_aerobic");
  });

  it("15日以上前の赤信号は対象外", () => {
    const c = ctx({
      evaluationDate: "2026-04-25",
      dailyChecks: [{ date: "2026-04-08", signal: "red" }],
      sessions: [makeSession("2026-04-27", "high_lactate")],
    });
    expect(violationsOf(runRuleEngine(c), "RULE-12").length).toBe(0);
  });
});

describe("RULE-13 グレーゾーン", () => {
  it("週のジョグの半数以上がLT+30〜50秒/kmに集中でWARN", () => {
    const c = ctx({
      ltPaceSecPerKm: 230,
      sessions: [
        makeSession("2026-04-06", "aerobic", { paceSecPerKm: 265 }),
        makeSession("2026-04-07", "aerobic", { paceSecPerKm: 270 }),
        makeSession("2026-04-09", "aerobic", { paceSecPerKm: 300 }),
      ],
    });
    expect(violationsOf(runRuleEngine(c), "RULE-13").length).toBe(1);
  });
});

describe("RULE-15 固定セッション", () => {
  it("固定セッションのみ関与する違反は「回避不能」として警告のみ", () => {
    const c = ctx({
      sessions: [
        makeSession("2026-04-06", "high_lactate", {
          isFixed: true,
          fixedSource: "チーム練習",
        }),
        makeSession("2026-04-08", "high_lactate", {
          isFixed: true,
          fixedSource: "チーム練習",
        }),
      ],
    });
    const v = violationsOf(runRuleEngine(c), "RULE-01");
    expect(v.length).toBeGreaterThan(0);
    expect(v[0].unavoidable).toBe(true);
    expect(v[0].suggestion).toContain("当日の対処案");
    expect(v[0].autofix).toBeUndefined();
  });

  it("片方が可動なら回避不能にしない", () => {
    const c = ctx({
      sessions: [
        makeSession("2026-04-06", "high_lactate", { isFixed: true }),
        makeSession("2026-04-08", "high_lactate"),
      ],
    });
    const v = violationsOf(runRuleEngine(c), "RULE-01");
    expect(v[0].unavoidable).toBeUndefined();
  });
});

describe("RULE-16 / RULE-17 負荷", () => {
  it("ACWR 1.5超でWARN", () => {
    const c = ctx({ currentAcwr: 1.6 });
    expect(violationsOf(runRuleEngine(c), "RULE-16").length).toBe(1);
  });

  it("ACWR 0.8未満で負荷不足通知", () => {
    const c = ctx({ currentAcwr: 0.6 });
    const v = violationsOf(runRuleEngine(c), "RULE-16");
    expect(v.length).toBe(1);
    expect(v[0].message).toContain("負荷不足");
  });

  it("週間走行距離の前週比15%超でWARN", () => {
    const sessions = [
      makeSession("2026-04-06", "aerobic", { distanceKm: 30 }),
      makeSession("2026-04-13", "aerobic", { distanceKm: 40 }),
    ];
    const c = ctx({ sessions });
    expect(violationsOf(runRuleEngine(c), "RULE-17").length).toBe(1);
  });
});

describe("RULE-18 / RULE-19 補強配置", () => {
  it("heavy補強が質練習の前日にあるとERROR", () => {
    const c = ctx({
      sessions: [makeSession("2026-04-08", "race_economy")],
      strengthSessions: [makeStrength("2026-04-07", { loadLevel: "heavy" })],
    });
    expect(violationsOf(runRuleEngine(c), "RULE-18").length).toBe(1);
  });

  it("質練習当日pmのheavy補強は違反にならない（ブロック化の原則）", () => {
    const c = ctx({
      sessions: [makeSession("2026-04-08", "race_economy")],
      strengthSessions: [makeStrength("2026-04-08", { loadLevel: "heavy" })],
    });
    expect(violationsOf(runRuleEngine(c), "RULE-18").length).toBe(0);
  });

  it("レース7日前以降のmoderate補強はERROR、coreは可", () => {
    const race = makeRace("2026-05-10");
    const c = ctx({
      races: [race],
      strengthSessions: [
        makeStrength("2026-05-06", { loadLevel: "moderate" }),
        makeStrength("2026-05-06", { type: "core", loadLevel: "light" }),
      ],
    });
    const v = violationsOf(runRuleEngine(c), "RULE-19");
    expect(v.length).toBe(1);
  });
});

describe("RULE-20 / RULE-21 ラウンド管理", () => {
  it("ラウンド間の日にneuralを配置するとERROR", () => {
    const race = makeRace("2026-06-05", {
      rounds: [
        { type: "heat", datetime: "2026-06-05T10:00:00" },
        { type: "final", datetime: "2026-06-07T15:00:00" },
      ],
    });
    const c = ctx({
      races: [race],
      sessions: [makeSession("2026-06-06", "neural")],
    });
    expect(violationsOf(runRuleEngine(c), "RULE-20").length).toBe(1);
  });

  it("回復プロトコルのセッションは許可", () => {
    const race = makeRace("2026-06-05", {
      rounds: [
        { type: "heat", datetime: "2026-06-05T10:00:00" },
        { type: "final", datetime: "2026-06-07T15:00:00" },
      ],
    });
    const c = ctx({
      races: [race],
      sessions: [
        makeSession("2026-06-06", "neural", { isRecoveryProtocol: true }),
      ],
    });
    expect(violationsOf(runRuleEngine(c), "RULE-20").length).toBe(0);
  });

  it("予選想定が目標タイム以上に速いとRULE-21警告", () => {
    const race = makeRace("2026-06-05", {
      rounds: [
        { type: "heat", datetime: "2026-06-05T10:00:00", expectedPaceSec: 108.0 },
        { type: "final", datetime: "2026-06-07T15:00:00" },
      ],
    });
    const c = ctx({
      races: [race],
      goal: {
        targetEvent: "800m",
        targetTimeSec: 108.9,
        targetRaceId: race.id,
        subRaceIds: [],
      },
    });
    expect(violationsOf(runRuleEngine(c), "RULE-21").length).toBe(1);
  });
});

describe("RULE-22 暑熱順化ブロック", () => {
  it("ブロック期間中のhigh_lactate/modelingでWARN", () => {
    const c = ctx({
      heatBlocks: [
        { id: "hb1", startDate: "2026-07-01", endDate: "2026-07-14", targetRaceId: "r" },
      ],
      sessions: [makeSession("2026-07-05", "modeling")],
    });
    expect(violationsOf(runRuleEngine(c), "RULE-22").length).toBe(1);
  });
});

describe("週次サマリー", () => {
  it("カテゴリ回数・転移度スコア・高乳酸28日頻度を計算する", () => {
    const c = ctx({
      sessions: [
        makeSession("2026-04-06", "high_lactate", { transfer800m: 5, durationMin: 60 }),
        makeSession("2026-04-08", "aerobic", { transfer800m: 2, durationMin: 40 }),
        makeSession("2026-04-01", "high_lactate"), // 前週（28日以内）
      ],
    });
    const s = weeklySummary(c, "2026-04-06");
    expect(s.categoryCounts.high_lactate).toBe(1);
    expect(s.categoryCounts.aerobic).toBe(1);
    expect(s.highLactateLast28d).toBe(2);
    // 転移度は負荷加重平均: (5×8×60 + 2×3×40) / (8×60+3×40) = (2400+240)/600 = 4.4
    expect(s.transfer800mScore).toBeCloseTo(4.4, 1);
  });

  it("skippedセッションはサマリーから除外", () => {
    const c = ctx({
      sessions: [makeSession("2026-04-06", "high_lactate", { status: "skipped" })],
    });
    const s = weeklySummary(c, "2026-04-06");
    expect(s.categoryCounts.high_lactate).toBe(0);
  });
});
