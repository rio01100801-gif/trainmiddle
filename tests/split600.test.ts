/**
 * M-8 600m通過と残り200m。
 *
 * 800mで一番効くのは**残り200mで何秒落ちるか**。
 * ここは「材料が足りないときに推測で埋めない」が特に効く場所で、
 * 400+400 しか無いときの按分は **推定だと明示する**ようになっている。
 *
 * それなのに分岐カバレッジが半分だった。埋めたのは主に、
 * 材料として受け付けない形（距離が合わない・ラップが足りない・種目が違う）。
 * ここが緩むと、**800mでないものが600m通過として混ざる**。
 */
import { describe, expect, it } from "vitest";
import {
  MIN_SPLIT_SAMPLES,
  PASS_600_RATIO,
  from800Laps,
  splitReference,
  splitSamplesFromMarkers,
  splitSamplesFromPast,
  splitTrend,
  type SplitSample,
} from "@/lib/core/split600";
import type { FitnessMarker, PastEntry } from "@/lib/core/types";

describe("基準線", () => {
  it("目標タイムから600m通過と残り200mを割る", () => {
    const r = splitReference(108.9);
    expect(r.pass600Sec).toBeCloseTo(81.5, 1);
    expect(r.last200Sec).toBeCloseTo(27.4, 1);
    // 3つ足すと目標に戻る
    expect(r.pass600Sec + r.last200Sec).toBeCloseTo(108.9, 1);
  });

  it("比は目標タイムに依らない", () => {
    // 表示のため小数2桁に丸めているので、比はそのぶんだけずれる
    for (const t of [100, 108.9, 120]) {
      expect(splitReference(t).pass600Sec / t).toBeCloseTo(PASS_600_RATIO, 3);
    }
  });
});

describe("ラップから材料を作る", () => {
  it("200m刻みなら通過をそのまま足す（推定にしない）", () => {
    const s = from800Laps("2026-08-01", [26, 27, 28, 29]);
    expect(s?.pass600Sec).toBeCloseTo(81, 2);
    expect(s?.last200Sec).toBeCloseTo(29, 2);
    expect(s?.estimated).toBe(false);
  });

  it("100m刻みでも600mの地点で取れる", () => {
    const s = from800Laps("2026-08-01", [13, 13, 13.5, 13.5, 14, 14, 14.5, 14.5]);
    expect(s?.pass600Sec).toBeCloseTo(81, 1);
    expect(s?.estimated).toBe(false);
  });

  it("400+400 は按分するが、推定だと明示する", () => {
    /*
     * 後半は前半より落ちるので、単純な半分では速く出る。
     * 実測の後半400の48%を使う——**この値は推定なので、そう書く**。
     */
    const s = from800Laps("2026-08-01", [53, 56]);
    expect(s?.estimated).toBe(true);
    expect(s?.pass600Sec).toBeCloseTo(53 + 56 * 0.48, 2);
    expect(s?.source).toContain("推定");
  });

  it("距離の合計が800mでなければ受け付けない", () => {
    // 1000mのラップを800mの材料にしない
    expect(from800Laps("2026-08-01", [30, 30, 30, 30, 30], [200, 200, 200, 200, 200])).toBeUndefined();
  });

  it("刻みが分からなければ受け付けない（勝手に割らない）", () => {
    expect(from800Laps("2026-08-01", [26, 27, 28])).toBeUndefined();
    expect(from800Laps("2026-08-01", [108.9])).toBeUndefined();
  });

  it("400+400以外の2本は按分しない", () => {
    expect(from800Laps("2026-08-01", [40, 68], [300, 500])).toBeUndefined();
  });
});

describe("過去データから拾う", () => {
  const entry = (over: Partial<PastEntry> = {}): PastEntry =>
    ({
      id: "p1",
      date: "2026-08-01",
      kind: "race",
      distanceM: 800,
      lapsSec: [26, 27, 28, 29],
      ...over,
    }) as PastEntry;

  it("レースとTTだけ拾う", () => {
    expect(splitSamplesFromPast([entry({ kind: "race" })])).toHaveLength(1);
    expect(splitSamplesFromPast([entry({ kind: "timetrial" })])).toHaveLength(1);
    expect(splitSamplesFromPast([entry({ kind: "workout" as never })])).toHaveLength(0);
  });

  it("800m以外は拾わない", () => {
    expect(splitSamplesFromPast([entry({ distanceM: 1500 })])).toHaveLength(0);
  });

  it("ラップが1本以下なら拾わない（通過が取れない）", () => {
    expect(splitSamplesFromPast([entry({ lapsSec: [108.9] })])).toHaveLength(0);
    expect(splitSamplesFromPast([entry({ lapsSec: undefined })])).toHaveLength(0);
  });
});

describe("実測マーカーから拾う", () => {
  const marker = (over: Partial<FitnessMarker> = {}): FitnessMarker => ({
    id: "m1",
    date: "2026-08-01",
    type: "race",
    description: "県選手権",
    resultLapsSec: [26, 27, 28, 29],
    ...over,
  });

  it("拾ったら、どこから来たかを残す", () => {
    const out = splitSamplesFromMarkers([marker()]);
    expect(out).toHaveLength(1);
    expect(out[0].source).toContain("県選手権");
  });

  it("説明が空でも出どころを空にしない", () => {
    expect(splitSamplesFromMarkers([marker({ description: "" })])[0].source).toContain("実測");
  });

  it("距離が合わないものは拾わない", () => {
    expect(splitSamplesFromMarkers([marker({ resultLapsSec: [26, 27, 28] })])).toHaveLength(0);
  });

  it("合計が0以下なら拾わない", () => {
    expect(splitSamplesFromMarkers([marker({ resultLapsSec: [0, 0, 0, 0] })])).toHaveLength(0);
  });
});

describe("傾向", () => {
  const sample = (over: Partial<SplitSample> = {}): SplitSample => ({
    date: "2026-08-01",
    source: "800mレース（区間ラップ）",
    pass600Sec: 82,
    last200Sec: 29,
    totalSec: 111,
    estimated: false,
    ...over,
  });

  it("材料が足りなければ、何が材料になるかを言って止める", () => {
    const t = splitTrend([sample()], 108.9);
    expect(t.enough).toBe(false);
    expect(t.narrative).toContain(`${MIN_SPLIT_SAMPLES}本`);
    // 何を入れれば足りるのかを書く（足りないとだけ言わない）
    expect(t.narrative).toContain("区間ラップ");
  });

  it("材料が無くても落ちない", () => {
    expect(splitTrend([], 108.9).enough).toBe(false);
  });

  it("2本そろえば基準との差を出す", () => {
    const t = splitTrend([sample({ date: "2026-07-01" }), sample({ date: "2026-08-01" })], 108.9);
    expect(t.enough).toBe(true);
    expect(t.pass600GapSec).toBeCloseTo(0.5, 1);
    expect(t.narrative).toContain("基準比");
  });

  it("古い順に並べ替える（入れた順に依らない）", () => {
    const t = splitTrend(
      [sample({ date: "2026-08-01" }), sample({ date: "2026-07-01" })],
      108.9
    );
    expect(t.samples.map((s) => s.date)).toEqual(["2026-07-01", "2026-08-01"]);
    expect(t.latest?.date).toBe("2026-08-01");
  });

  it("残り200mが速くなったか遅くなったかを言う", () => {
    const faster = splitTrend(
      [sample({ date: "2026-07-01", last200Sec: 30 }), sample({ date: "2026-08-01", last200Sec: 28 })],
      108.9
    );
    expect(faster.last200TrendSec).toBeCloseTo(-2, 1);
    expect(faster.narrative).toContain("速くなっています");

    const slower = splitTrend(
      [sample({ date: "2026-07-01", last200Sec: 28 }), sample({ date: "2026-08-01", last200Sec: 30 })],
      108.9
    );
    expect(slower.narrative).toContain("遅くなっています");
  });

  it("直近が推定なら、推定だと言う", () => {
    const t = splitTrend(
      [sample({ date: "2026-07-01" }), sample({ date: "2026-08-01", estimated: true })],
      108.9
    );
    expect(t.narrative).toContain("推定");
    expect(t.narrative).toContain("200m刻み");
  });

  it("残り200mが取れていなくても、600m通過だけで出す", () => {
    const t = splitTrend(
      [
        sample({ date: "2026-07-01", last200Sec: undefined }),
        sample({ date: "2026-08-01", last200Sec: undefined }),
      ],
      108.9
    );
    expect(t.enough).toBe(true);
    expect(t.last200GapSec).toBeUndefined();
    expect(t.last200TrendSec).toBeUndefined();
  });
});
