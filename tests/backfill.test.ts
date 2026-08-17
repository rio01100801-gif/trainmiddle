import { describe, it, expect } from "vitest";
import {
  assessCurrentFitness,
  impliedFromInterval,
  personalConverter,
  recencyWeight,
  riegel,
  toFitnessMarker,
  toSessionAndResult,
  type PastEntry,
} from "@/lib/core/backfill";
import { specificPace } from "@/lib/core/pace";
import { testAthlete } from "./helpers";

const TODAY = "2026-07-25";

function entry(over: Partial<PastEntry> & Pick<PastEntry, "kind">): PastEntry {
  return { id: `pe-${Math.random()}`, date: TODAY, ...over } as PastEntry;
}

describe("他距離 → 800m 換算", () => {
  const a = testAthlete(); // 800m 109.51 / 400m 49.0 / 1500m 236.0
  const conv = personalConverter(a);

  it("800mはそのまま使う", () => {
    expect(conv.to800m(110.5, 800)).toBe(110.5);
    expect(conv.reliability(800)).toBe(1.0);
  });

  it("400mは本人の換算差（PBから実測）を使う", () => {
    // 本人の換算差 = 109.51 - 49.0*2 = 11.51
    // 50.0秒で走った場合 → 50.0*2 + 11.51 = 111.51
    expect(conv.to800m(50.0, 400)!).toBeCloseTo(111.51, 2);
  });

  it("1500mも本人の差を使う", () => {
    // 差 = 236.0 - 109.51*2 = 16.98
    // 4:00 (240秒) → (240 - 16.98)/2 = 111.51
    expect(conv.to800m(240, 1500)!).toBeCloseTo(111.51, 2);
  });

  it("PBが無ければ一般式にフォールバックする（信頼度も下がる）", () => {
    const noPb = personalConverter(testAthlete({ pb400mSec: undefined }));
    expect(noPb.to800m(50, 400)).toBeCloseTo(riegel(50, 400, 800), 3);
    expect(noPb.reliability(400)).toBeLessThan(conv.reliability(400));
  });

  it("換算距離から遠いほど信頼度が下がる", () => {
    expect(conv.reliability(800)).toBeGreaterThan(conv.reliability(600));
    expect(conv.reliability(600)).toBeGreaterThan(conv.reliability(1500));
    expect(conv.reliability(5000)).toBe(0);
  });
});

describe("ポイント練習 → 800m 換算", () => {
  it("設定どおりなら、距離によらずimplied800はCFEと一致する", () => {
    const cfeSec = 109.51;
    for (const distanceM of [200, 300, 400, 600, 800]) {
      const target = specificPace(cfeSec, "high_lactate", distanceM);
      const targetMidpoint = (target.targetSecFast + target.targetSecSlow) / 2;
      const result = impliedFromInterval(
        entry({
          kind: "interval",
          category: "high_lactate",
          repDistanceM: distanceM,
          repTimesSec: [targetMidpoint, targetMidpoint, targetMidpoint],
        })
      );

      expect(result?.implied800mSec, `${distanceM}m`).toBeCloseTo(cfeSec, 8);
    }
  });

  it("換算側だけ標準400mへRiegel補正すると、設定どおりでも距離別に乖離する", () => {
    const cfeSec = 109.51;
    const distances = [200, 300, 400, 600, 800];
    const expectedBroken = [114.16, 111.42, 109.51, 106.88, 105.05];

    const oneSidedCorrection = distances.map((distanceM) => {
      const target = specificPace(cfeSec, "high_lactate", distanceM);
      const targetMidpoint = (target.targetSecFast + target.targetSecSlow) / 2;
      const normalized400m = riegel(targetMidpoint, distanceM, 400);
      const prescriptionRatio = targetMidpoint / distanceM / (cfeSec / 800);
      return (normalized400m / 400 / prescriptionRatio) * 800;
    });

    for (let i = 0; i < distances.length; i++) {
      expect(oneSidedCorrection[i], `${distances[i]}m`).toBeCloseTo(expectedBroken[i], 2);
      if (distances[i] !== 400) {
        expect(oneSidedCorrection[i], `${distances[i]}mがCFEから乖離`).not.toBeCloseTo(cfeSec, 1);
      }
    }
  });

  it("高乳酸の設定式を逆算する", () => {
    // 高乳酸の比率は 0.95〜0.97、中央 0.96
    // 300m を 42.0秒平均 → 800m相当 = 42/300/0.96*800 = 116.67
    const r = impliedFromInterval(
      entry({
        kind: "interval",
        category: "high_lactate",
        repDistanceM: 300,
        repTimesSec: [42.0, 42.0, 42.0, 42.0],
      })
    )!;
    expect(r.implied800mSec).toBeCloseTo(116.67, 1);
  });

  it("RPEが低い練習は能力の根拠にしない", () => {
    const r = impliedFromInterval(
      entry({
        kind: "interval",
        category: "high_lactate",
        repDistanceM: 300,
        repTimesSec: [42, 42, 42],
        rpe: 5,
      })
    );
    expect(r).toBeUndefined();
  });

  it("神経系は設定用比率があっても800m能力へ換算しない", () => {
    const result = impliedFromInterval(
      entry({
        kind: "interval",
        category: "neural",
        repDistanceM: 200,
        repTimesSec: [24, 24, 24],
        rpe: 9,
      })
    );

    expect(result).toBeUndefined();
  });

  it("標準より長いレストで出したタイムは割り引く", () => {
    const base = impliedFromInterval(
      entry({
        kind: "interval",
        category: "high_lactate",
        repDistanceM: 300,
        repTimesSec: [42, 42, 42],
        restSec: 240,
      })
    )!;
    const longRest = impliedFromInterval(
      entry({
        kind: "interval",
        category: "high_lactate",
        repDistanceM: 300,
        repTimesSec: [42, 42, 42],
        restSec: 600,
      })
    )!;
    // 同じタイムでもレストが長い方が「遅い（＝能力は低い）」と評価される
    expect(longRest.implied800mSec).toBeGreaterThan(base.implied800mSec);
  });

  it("本数が少ないほど信頼度が低い", () => {
    const few = impliedFromInterval(
      entry({ kind: "interval", category: "high_lactate", repDistanceM: 300, repTimesSec: [42, 42] })
    )!;
    const many = impliedFromInterval(
      entry({
        kind: "interval",
        category: "high_lactate",
        repDistanceM: 300,
        repTimesSec: [42, 42, 42, 42, 42, 42],
      })
    )!;
    expect(many.reliability).toBeGreaterThan(few.reliability);
  });

  it("練習からの推定はレースより必ず信頼度が低い", () => {
    const conv = personalConverter(testAthlete());
    const workout = impliedFromInterval(
      entry({
        kind: "interval",
        category: "modeling",
        repDistanceM: 600,
        repTimesSec: [84, 84, 84, 84, 84],
      })
    )!;
    expect(workout.reliability).toBeLessThan(conv.reliability(800));
  });
});

describe("現在地の推定", () => {
  const athlete = testAthlete();

  it("直近性の重みは半減期28日", () => {
    expect(recencyWeight(0)).toBeCloseTo(1, 5);
    expect(recencyWeight(28)).toBeCloseTo(0.5, 5);
    expect(recencyWeight(84)).toBeCloseTo(0.125, 5);
  });

  it("800mレースが1本あればそのタイムに近い推定になる", () => {
    const a = assessCurrentFitness(
      [entry({ kind: "race", date: "2026-07-20", distanceM: 800, timeSec: 112.5, tempC: 20 })],
      athlete,
      TODAY
    );
    expect(a.estimated800mSec).toBeCloseTo(112.5, 2);
  });

  it("古いデータほど影響が小さい", () => {
    const recentOnly = assessCurrentFitness(
      [entry({ kind: "race", date: "2026-07-20", distanceM: 800, timeSec: 113, tempC: 20 })],
      athlete,
      TODAY
    ).estimated800mSec!;
    const withOldFast = assessCurrentFitness(
      [
        entry({ kind: "race", date: "2026-07-20", distanceM: 800, timeSec: 113, tempC: 20 }),
        entry({ kind: "race", date: "2026-05-05", distanceM: 800, timeSec: 109.5, tempC: 18 }),
      ],
      athlete,
      TODAY
    ).estimated800mSec!;
    // 古い速い記録に引っ張られはするが、支配はされない
    expect(withOldFast).toBeLessThan(recentOnly);
    expect(withOldFast).toBeGreaterThan(111.0);
  });

  it("12週より古いデータは対象外として除外する", () => {
    const a = assessCurrentFitness(
      [entry({ kind: "race", date: "2026-01-10", distanceM: 800, timeSec: 109.5 })],
      athlete,
      TODAY
    );
    expect(a.estimated800mSec).toBeUndefined();
    expect(a.excluded[0].reason).toContain("週前");
  });

  it("ジョグ・持続走は800m能力の推定に使わない", () => {
    const a = assessCurrentFitness(
      [entry({ kind: "continuous", date: "2026-07-20", distanceKm: 10, durationMin: 45 })],
      athlete,
      TODAY
    );
    expect(a.estimated800mSec).toBeUndefined();
    expect(a.excluded[0].reason).toContain("有酸素");
  });

  it("神経系は設定ペースに使っても現在地の測定からは除外する", () => {
    const assessment = assessCurrentFitness(
      [
        entry({
          kind: "interval",
          date: "2026-07-20",
          category: "neural",
          repDistanceM: 200,
          repTimesSec: [24, 24, 24],
          rpe: 9,
        }),
      ],
      athlete,
      TODAY
    );

    expect(assessment.estimated800mSec).toBeUndefined();
    expect(assessment.excluded[0].reason).toContain("設定ペース用");
  });

  it("涼しい実測が2件以上あれば暑熱下のデータを除外する", () => {
    const a = assessCurrentFitness(
      [
        entry({ kind: "race", date: "2026-07-20", distanceM: 800, timeSec: 111, tempC: 19 }),
        entry({ kind: "race", date: "2026-07-10", distanceM: 800, timeSec: 111, tempC: 20 }),
        entry({ kind: "timetrial", date: "2026-07-15", distanceM: 800, timeSec: 118, tempC: 33 }),
      ],
      athlete,
      TODAY
    );
    expect(a.excluded.some((e) => e.reason.includes("暑熱"))).toBe(true);
    // 暑熱下の118秒に引っ張られていない
    expect(a.estimated800mSec).toBeCloseTo(111, 1);
  });

  it("涼しい実測が足りないときは暑熱下も使うが、過小評価である旨を明示する", () => {
    const a = assessCurrentFitness(
      [entry({ kind: "race", date: "2026-07-20", distanceM: 800, timeSec: 116, tempC: 33 })],
      athlete,
      TODAY
    );
    expect(a.estimated800mSec).toBeCloseTo(116, 1);
    expect(a.notes.join("")).toContain("過小評価");
  });

  it("実測が無ければ推定せず、何を入れればよいか伝える", () => {
    const a = assessCurrentFitness([], athlete, TODAY);
    expect(a.estimated800mSec).toBeUndefined();
    expect(a.confidence).toBe(0);
    expect(a.notes.join("")).toContain("タイムトライアル");
  });

  it("実測どうしが食い違うときは信頼度を落として警告する", () => {
    const a = assessCurrentFitness(
      [
        entry({ kind: "race", date: "2026-07-20", distanceM: 800, timeSec: 109.0, tempC: 18 }),
        entry({
          kind: "interval",
          date: "2026-07-18",
          category: "high_lactate",
          repDistanceM: 300,
          repTimesSec: [45, 45, 45, 45],
          tempC: 18,
          rpe: 9,
        }),
      ],
      athlete,
      TODAY
    );
    expect(a.notes.join("")).toContain("ばらつき");
    expect(a.confidence).toBeLessThan(1);
  });

  it("現在のCFEが実測より速すぎる場合に警告する（設定ペースが実力を上回る）", () => {
    const a = assessCurrentFitness(
      [entry({ kind: "race", date: "2026-07-20", distanceM: 800, timeSec: 114, tempC: 19 })],
      athlete,
      TODAY,
      { currentCfeSec: 111.0 }
    );
    expect(a.deltaFromCfeSec).toBeCloseTo(3.0, 1);
    expect(a.notes.join("")).toContain("設定ペースが実力を上回");
  });

  it("未来の日付は受け付けない", () => {
    const a = assessCurrentFitness(
      [entry({ kind: "race", date: "2026-08-30", distanceM: 800, timeSec: 110 })],
      athlete,
      TODAY
    );
    expect(a.excluded[0].reason).toContain("未来");
  });
});

describe("過去データ → セッション/結果/マーカー変換", () => {
  it("負荷計算に使えるようセッションと結果を作り、backfilled を立てる", () => {
    const { session, result } = toSessionAndResult(
      entry({
        kind: "interval",
        date: "2026-07-01",
        category: "high_lactate",
        repDistanceM: 300,
        repTimesSec: [42, 42.5, 43, 43.5],
        restSec: 240,
      })
    );
    expect(session.backfilled).toBe(true);
    expect(result.backfilled).toBe(true);
    expect(session.status).toBe("completed");
    expect(session.category).toBe("high_lactate");
    expect(result.actualLapsSec).toHaveLength(4);
    expect(session.distanceKm).toBeGreaterThan(0);
  });

  it("持続走は用途不明のマーカーになり、距離だけでLT走と断定しない", () => {
    const fm = toFitnessMarker(
      entry({ kind: "continuous", date: "2026-07-01", distanceKm: 8, durationMin: 30.5, avgHr: 172 })
    )!;
    expect(fm.resultLapsSec[0]).toBeCloseTo(1830, 0);
    expect(fm.lapDistancesM![0]).toBe(8000);
    expect(fm.avgHr).toBe(172);
    expect(fm.purpose).toBe("unknown");
  });

  it("3km未満の持続走はLT推定に使わない", () => {
    expect(
      toFitnessMarker(entry({ kind: "continuous", distanceKm: 2, durationMin: 10 }))
    ).toBeUndefined();
  });

  it("ポイント練習以外はマーカーにしない", () => {
    expect(toFitnessMarker(entry({ kind: "race", distanceM: 800, timeSec: 110 }))).toBeUndefined();
  });
});

describe("暑熱の扱いは件数ではなく重みで判断する", () => {
  const athlete = testAthlete();

  it("涼しい日の800mレースが1本あれば、暑熱下の練習は除外される", () => {
    const a = assessCurrentFitness(
      [
        entry({ kind: "race", date: "2026-07-18", distanceM: 800, timeSec: 114.2, tempC: 19 }),
        entry({
          kind: "interval",
          date: "2026-07-15",
          category: "high_lactate",
          repDistanceM: 300,
          repTimesSec: [46.5, 47.0, 47.4, 48.2],
          restSec: 240,
          rpe: 9,
          tempC: 34,
        }),
      ],
      athlete,
      TODAY
    );
    // 暑熱下の練習（800m換算で約2:11相当）に引っ張られていないこと
    expect(a.estimated800mSec).toBeCloseTo(114.2, 1);
    expect(a.excluded.some((e) => e.reason.includes("暑熱"))).toBe(true);
  });

  it("涼しいデータが練習だけ1本なら重みが足りず、暑熱下も併用する", () => {
    const a = assessCurrentFitness(
      [
        entry({
          kind: "interval",
          date: "2026-07-18",
          category: "high_lactate",
          repDistanceM: 300,
          repTimesSec: [44, 44, 44, 44],
          rpe: 9,
          tempC: 20,
        }),
        entry({ kind: "race", date: "2026-07-15", distanceM: 800, timeSec: 118, tempC: 34 }),
      ],
      athlete,
      TODAY
    );
    expect(a.notes.join("")).toContain("過小評価");
    expect(a.excluded.some((e) => e.reason.includes("暑熱"))).toBe(false);
  });
});
