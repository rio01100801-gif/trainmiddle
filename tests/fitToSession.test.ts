/**
 * FIT取込 Phase 4: 確認済み層（本人確認後の種別）から Session/SessionResult を
 * 機械的に導く純粋関数。`PastEntry` の `toSessionAndResult` と同じ考え方。
 */
import { describe, expect, it } from "vitest";
import { fitToSessionAndResult } from "@/lib/core/fitToSession";
import type { FitParseLap, FitParseResult } from "@/lib/core/fitParse";
import type { IntervalKind } from "@/lib/core/intervalClassify";

function baseParse(overrides: Partial<FitParseResult> = {}): FitParseResult {
  return {
    sessions: [],
    laps: [],
    records: [],
    eventCount: 0,
    hasDeveloperFields: false,
    warnings: [],
    ...overrides,
  };
}

function lap(overrides: Partial<FitParseLap> & { index: number }): FitParseLap {
  return { index: overrides.index, ...overrides };
}

// ウォームアップ→メイン×4（間にレストと明確なリカバリー）→クールダウン
// (tests/intervalClassify.test.ts と同じ構成)
const INTERVAL_LAPS: FitParseLap[] = [
  lap({ index: 0, startTimeUtc: "2026-07-20T10:00:00Z", distanceKm: 1, elapsedSec: 360 }),
  lap({ index: 1, startTimeUtc: "2026-07-20T10:06:00Z", distanceKm: 0.3, elapsedSec: 50, avgHr: 175 }),
  lap({ index: 2, startTimeUtc: "2026-07-20T10:06:50Z", distanceKm: 0.2, elapsedSec: 80 }),
  lap({ index: 3, startTimeUtc: "2026-07-20T10:08:10Z", distanceKm: 0.3, elapsedSec: 51, avgHr: 178 }),
  lap({ index: 4, startTimeUtc: "2026-07-20T10:09:01Z", distanceKm: 0.2, elapsedSec: 80 }),
  lap({ index: 5, startTimeUtc: "2026-07-20T10:10:21Z", distanceKm: 0.3, elapsedSec: 50, avgHr: 180 }),
  lap({ index: 6, startTimeUtc: "2026-07-20T10:11:11Z", distanceKm: 0.2, elapsedSec: 80 }),
  lap({ index: 7, startTimeUtc: "2026-07-20T10:12:31Z", distanceKm: 0.3, elapsedSec: 52, avgHr: 182 }),
  lap({ index: 8, startTimeUtc: "2026-07-20T10:13:23Z", distanceKm: 0 }),
  lap({ index: 9, startTimeUtc: "2026-07-20T10:13:53Z", distanceKm: 1, elapsedSec: 420 }),
];
const INTERVAL_KINDS: IntervalKind[] = [
  "warmup", "main", "recovery", "main", "recovery", "main", "recovery", "main", "rest", "cooldown",
];

describe("fitToSessionAndResult", () => {
  it("GRPありでインターバルを分類し、リカバリーを直後のrestAfterへ組み込む", () => {
    const parse = baseParse({ laps: INTERVAL_LAPS, utcOffsetSec: 9 * 3600 });
    const { session, result, warnings } = fitToSessionAndResult({
      sourceId: "t1",
      fileName: "sample.fit",
      parse,
      confirmedKinds: INTERVAL_KINDS,
      grpSecPerM: 1.2 / 400, // 400mを1.2秒/mのGRP (仮の高速設定)
    });

    expect(session.id).toBe("fit-s-t1");
    expect(session.date).toBe("2026-07-20"); // UTC+9で19:00台なので同日
    expect(session.backfilled).toBe(true);
    expect(session.isFixed).toBe(true);
    expect(session.status).toBe("completed");
    expect(result.id).toBe("fit-r-t1");
    expect(result.sessionId).toBe(session.id);
    expect(result.interval?.reps).toBe(4);
    expect(result.interval?.results.map((r) => r.actualSec)).toEqual([50, 51, 50, 52]);
    // rep1の直後はlap2(recovery, 80秒・200m)のみ
    expect(result.interval?.results[0].restAfterSec).toBe(80);
    expect(result.interval?.results[0].restAfterDistanceM).toBe(200);
    // 最後のrepの後ろはrest(lap8, 距離0)のみ。距離0でも「何かある」ことは分かる
    expect(result.interval?.results[3].restAfterSec).toBeUndefined();
    expect(result.interval?.results[0].avgHr).toBe(175);
    expect(warnings).toHaveLength(0);
  });

  /*
   * 実運用で報告された構成（2026-08-01）。
   * 1000m×4 r200jog を、時計で1000mの中を 400m / 400m / 200m と刻んで走った。
   * lapとlapの間に休みが無い（時刻が連続している）ので、この3つは
   * 別々の本ではなく1本の中の通過。以前はlap1つを1本と数えていたため
   * 「1000m×4」が「396m×12」として記録されていた。
   */
  it("1本の中を刻んだlap（400/400/200）を1本にまとめる", () => {
    // 実際の記録: 3:16.1(1:18.9-1:18.5-38.7) / 3:14.9 / 3:14.2 / 3:14.7
    const sub: Array<[number, number]> = [
      [0.396, 78.87], [0.396, 78.55], [0.198, 38.67], [0.2, 81.8],
      [0.396, 77.8], [0.396, 77.4], [0.198, 39.7], [0.2, 85.6],
      [0.396, 77.0], [0.396, 78.2], [0.198, 39.0], [0.2, 80.0],
      [0.396, 77.6], [0.396, 78.4], [0.198, 38.7],
    ];
    let t = Date.UTC(2026, 6, 25, 10, 0, 0);
    const laps: FitParseLap[] = sub.map(([distanceKm, elapsedSec], index) => {
      const startTimeUtc = new Date(t).toISOString();
      t += elapsedSec * 1000; // 休みを含めて時刻は連続している
      return lap({ index, startTimeUtc, endTimeUtc: new Date(t).toISOString(), distanceKm, elapsedSec });
    });
    const kinds: IntervalKind[] = sub.map(([d]) => (d === 0.2 ? "recovery" : "main"));

    const { result } = fitToSessionAndResult({
      sourceId: "t-merge",
      fileName: "1000x4.fit",
      parse: baseParse({ laps, utcOffsetSec: 9 * 3600 }),
      confirmedKinds: kinds,
      grpSecPerM: 195 / 1000,
    });

    expect(result.interval?.reps).toBe(4);
    expect(result.interval?.distanceM).toBe(990); // 396+396+198（GPSの実測をそのまま出す）
    expect(result.interval?.results.map((r) => Math.round(r.actualSec * 10) / 10)).toEqual([
      196.1, 194.9, 194.2, 194.7,
    ]);
    // 刻んだ通過は捨てずに残す（本人が「1:18.9-1:18.5-38.7」で見ているため）
    expect(result.interval?.results[0].splitsSec).toEqual([78.87, 78.55, 38.67]);
    // 1本目の直後の休みはジョグ1つぶんだけ（次の本の通過を巻き込まない）
    expect(result.interval?.results[0].restAfterSec).toBe(82);
  });

  it("休みを挟まずに時刻が飛んでいる（記録を止めて再開した）lapは別の本として数える", () => {
    const laps: FitParseLap[] = [
      lap({ index: 0, startTimeUtc: "2026-07-25T10:00:00Z", endTimeUtc: "2026-07-25T10:01:20Z", distanceKm: 0.4, elapsedSec: 80 }),
      // 前のlapの終わりから3分空いている＝間に休みがあった
      lap({ index: 1, startTimeUtc: "2026-07-25T10:04:20Z", endTimeUtc: "2026-07-25T10:05:40Z", distanceKm: 0.4, elapsedSec: 80 }),
    ];
    const { result } = fitToSessionAndResult({
      sourceId: "t-gap",
      fileName: "gap.fit",
      parse: baseParse({ laps, utcOffsetSec: 9 * 3600 }),
      confirmedKinds: ["main", "main"],
      grpSecPerM: 80 / 400,
    });
    expect(result.interval?.reps).toBe(2);
    expect(result.interval?.results[0].splitsSec).toBeUndefined();
  });

  it("GRP未設定のときは距離だけの暫定カテゴリにし、警告を出す", () => {
    const parse = baseParse({ laps: INTERVAL_LAPS, utcOffsetSec: 9 * 3600 });
    const { session, warnings } = fitToSessionAndResult({
      sourceId: "t2",
      fileName: "sample.fit",
      parse,
      confirmedKinds: INTERVAL_KINDS,
    });
    expect(session.category).toBe("high_lactate"); // 300m <= 600m
    expect(warnings.some((w) => w.includes("GRP"))).toBe(true);
  });

  it("メインが無ければ持続走として扱う（sessionの総距離・総時間を使う）", () => {
    const parse = baseParse({
      sessions: [
        {
          startTimeUtc: "2026-07-20T10:00:00Z",
          totalDistanceKm: 10,
          totalElapsedSec: 3000,
          avgHr: 150,
          maxHr: 165,
        },
      ],
      laps: [
        lap({ index: 0, startTimeUtc: "2026-07-20T10:00:00Z", distanceKm: 5, elapsedSec: 1500 }),
        lap({ index: 1, startTimeUtc: "2026-07-20T10:25:00Z", distanceKm: 5, elapsedSec: 1500 }),
      ],
      utcOffsetSec: 0,
    });
    const { session, result } = fitToSessionAndResult({
      sourceId: "t3",
      fileName: "jog.fit",
      parse,
      confirmedKinds: ["warmup", "warmup"],
    });
    expect(session.category).toBe("aerobic");
    expect(session.surface).toBe("road");
    expect(result.continuous).toMatchObject({
      distanceKm: 10,
      durationMin: 50,
      avgPaceSecPerKm: 300,
      avgHr: 150,
      maxHr: 165,
    });
  });

  it("utcOffsetSecが無ければUTC基準の日付にし、警告を出す", () => {
    const parse = baseParse({ laps: INTERVAL_LAPS, utcOffsetSec: undefined });
    const { session, warnings } = fitToSessionAndResult({
      sourceId: "t4",
      fileName: "sample.fit",
      parse,
      confirmedKinds: INTERVAL_KINDS,
      grpSecPerM: 1.2 / 400,
    });
    expect(session.date).toBe("2026-07-20");
    expect(warnings.some((w) => w.includes("タイムゾーン"))).toBe(true);
  });

  it("lapが0件なら登録できない", () => {
    const parse = baseParse();
    expect(() =>
      fitToSessionAndResult({ sourceId: "t5", fileName: "empty.fit", parse, confirmedKinds: [] })
    ).toThrow();
  });

  it("confirmedKindsの件数がlapと一致しなければ登録できない", () => {
    const parse = baseParse({ laps: INTERVAL_LAPS });
    expect(() =>
      fitToSessionAndResult({
        sourceId: "t6",
        fileName: "sample.fit",
        parse,
        confirmedKinds: ["main"],
      })
    ).toThrow();
  });

  it("インターバルはメイン区間だけの平均でランニングダイナミクスを出す", () => {
    const laps: FitParseLap[] = INTERVAL_LAPS.map((l, i) =>
      [1, 3, 5, 7].includes(i)
        ? { ...l, avgCadenceSpm: 180 + i, avgVerticalOscillationMm: 8, avgGroundContactTimeMs: 230, avgStepLengthM: 1.1, avgTemperatureC: 27 }
        : { ...l, avgCadenceSpm: 999, avgVerticalOscillationMm: 999, avgGroundContactTimeMs: 999, avgStepLengthM: 9, avgTemperatureC: -99 }
    );
    const parse = baseParse({ laps, utcOffsetSec: 9 * 3600 });
    const { result } = fitToSessionAndResult({
      sourceId: "t8",
      fileName: "sample.fit",
      parse,
      confirmedKinds: INTERVAL_KINDS,
      grpSecPerM: 1.2 / 400,
    });
    // メイン区間(index 1,3,5,7)のavgCadenceSpmは181,183,185,187 → 平均184
    expect(result.avgCadenceSpm).toBe(184);
    expect(result.avgVerticalOscillationMm).toBe(8);
    expect(result.avgGroundContactTimeMs).toBe(230);
    expect(result.avgStepLengthM).toBe(1.1);
    expect(result.weatherTempC).toBe(27);
  });

  it("デバイスがダイナミクスに対応していなければ推測で埋めずundefinedのままにする", () => {
    const parse = baseParse({ laps: INTERVAL_LAPS, utcOffsetSec: 9 * 3600 });
    const { result } = fitToSessionAndResult({
      sourceId: "t9",
      fileName: "sample.fit",
      parse,
      confirmedKinds: INTERVAL_KINDS,
      grpSecPerM: 1.2 / 400,
    });
    expect(result.avgCadenceSpm).toBeUndefined();
    expect(result.avgVerticalOscillationMm).toBeUndefined();
    expect(result.avgGroundContactTimeMs).toBeUndefined();
    expect(result.avgStepLengthM).toBeUndefined();
    expect(result.weatherTempC).toBeUndefined();
  });

  it("持続走はセッション全体のランニングダイナミクスを使う", () => {
    const parse = baseParse({
      sessions: [
        {
          startTimeUtc: "2026-07-20T10:00:00Z",
          totalDistanceKm: 10,
          totalElapsedSec: 3000,
          avgCadenceSpm: 172,
          avgVerticalOscillationMm: 9.2,
          avgGroundContactTimeMs: 250,
          avgStepLengthM: 1.05,
          avgTemperatureC: 30,
        },
      ],
      laps: [
        lap({ index: 0, startTimeUtc: "2026-07-20T10:00:00Z", distanceKm: 5, elapsedSec: 1500 }),
        lap({ index: 1, startTimeUtc: "2026-07-20T10:25:00Z", distanceKm: 5, elapsedSec: 1500 }),
      ],
      utcOffsetSec: 0,
    });
    const { result } = fitToSessionAndResult({
      sourceId: "t10",
      fileName: "jog.fit",
      parse,
      confirmedKinds: ["warmup", "warmup"],
    });
    expect(result.avgCadenceSpm).toBe(172);
    expect(result.avgVerticalOscillationMm).toBe(9.2);
    expect(result.avgGroundContactTimeMs).toBe(250);
    expect(result.avgStepLengthM).toBe(1.05);
    expect(result.weatherTempC).toBe(30);
  });

  it("日時を特定できるフィールドが無ければ登録できない", () => {
    const parse = baseParse({
      laps: [lap({ index: 0, distanceKm: 1, elapsedSec: 300 })],
    });
    expect(() =>
      fitToSessionAndResult({
        sourceId: "t7",
        fileName: "sample.fit",
        parse,
        confirmedKinds: ["warmup"],
      })
    ).toThrow();
  });
});
