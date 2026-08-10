/**
 * FIT取込 Phase 2: 解析（file_id / session / lap / record を区別）。
 *
 * `fit-file-parser` のデコード結果から、FORGEの単位（km・秒/km・UTC ISO文字列）へ
 * 変換する。読めなかった・異常な値は推測で埋めず undefined + warnings にする。
 */
import { describe, expect, it } from "vitest";
import { parseFitFile } from "@/lib/core/fitParse";
import { buildFitFile } from "./fixtures/fitEncoder";

describe("parseFitFile", () => {
  it("session・lap・recordを区別して抽出する", async () => {
    const bytes = buildFitFile({
      timeCreated: "2026-07-20T09:55:00Z",
      activityTimestamp: "2026-07-20T10:05:00Z",
      activityLocalTimestamp: "2026-07-20T19:05:00Z", // UTC+9（JST）
      sessions: [
        {
          startTime: "2026-07-20T10:00:00Z",
          timestamp: "2026-07-20T10:05:00Z",
          sport: 1,
          totalElapsedSec: 300,
          totalTimerSec: 290,
          totalDistanceM: 1000,
          avgHr: 150,
          maxHr: 175,
        },
      ],
      laps: [
        {
          startTime: "2026-07-20T10:00:00Z",
          timestamp: "2026-07-20T10:02:30Z",
          totalElapsedSec: 150,
          totalTimerSec: 145,
          totalDistanceM: 500,
          avgHr: 148,
          maxHr: 170,
        },
      ],
      records: [
        { timestamp: "2026-07-20T10:00:10Z", heartRate: 140, distanceM: 30, speedMs: 4 },
      ],
    });

    const result = await parseFitFile(bytes);

    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]).toMatchObject({
      sport: "running",
      totalElapsedSec: 300,
      totalTimerSec: 290,
      totalDistanceKm: 1,
      avgHr: 150,
      maxHr: 175,
    });

    expect(result.laps).toHaveLength(1);
    expect(result.laps[0]).toMatchObject({
      elapsedSec: 150,
      timerSec: 145,
      distanceKm: 0.5,
      avgHr: 148,
      maxHr: 170,
    });

    expect(result.records).toHaveLength(1);
    expect(result.records[0].hr).toBe(140);
    expect(result.records[0].distanceKm).toBeCloseTo(0.03, 5);
    // 4 m/s = 14.4 km/h -> 3600 / 14.4 = 250 秒/km
    expect(result.records[0].paceSecPerKm).toBeCloseTo(250, 3);
  });

  it("activityのtimestampとlocal_timestampの差からUTC offsetを求める", async () => {
    const bytes = buildFitFile({
      activityTimestamp: "2026-07-20T10:05:00Z",
      activityLocalTimestamp: "2026-07-20T19:05:00Z",
    });
    const result = await parseFitFile(bytes);
    expect(result.utcOffsetSec).toBe(9 * 3600);
  });

  it("local_timestampが無ければoffsetは未確定のままにする（推測しない）", async () => {
    const bytes = buildFitFile({ activityTimestamp: "2026-07-20T10:05:00Z" });
    const result = await parseFitFile(bytes);
    expect(result.utcOffsetSec).toBeUndefined();
  });

  it("sessionが無いFITでも空配列で扱い、クラッシュしない", async () => {
    const bytes = buildFitFile({ records: [{ timestamp: "2026-07-20T10:00:00Z", heartRate: 140 }] });
    const result = await parseFitFile(bytes);
    expect(result.sessions).toEqual([]);
    expect(result.records).toHaveLength(1);
  });

  it("lapが無くてもクラッシュしない", async () => {
    const bytes = buildFitFile({
      sessions: [{ startTime: "2026-07-20T10:00:00Z", timestamp: "2026-07-20T10:05:00Z" }],
    });
    const result = await parseFitFile(bytes);
    expect(result.laps).toEqual([]);
  });

  it("recordが無くてもクラッシュしない", async () => {
    const bytes = buildFitFile({
      sessions: [{ startTime: "2026-07-20T10:00:00Z", timestamp: "2026-07-20T10:05:00Z" }],
    });
    const result = await parseFitFile(bytes);
    expect(result.records).toEqual([]);
  });

  it("心拍が無いrecordはhrをundefinedのままにする（0にしない）", async () => {
    const bytes = buildFitFile({
      records: [{ timestamp: "2026-07-20T10:00:00Z", distanceM: 10, speedMs: 3 }],
    });
    const result = await parseFitFile(bytes);
    expect(result.records[0].hr).toBeUndefined();
  });

  it("速度0の区間はpaceSecPerKmを未確定にする（ゼロ除算でInfinityにしない）", async () => {
    const bytes = buildFitFile({
      records: [{ timestamp: "2026-07-20T10:00:00Z", speedMs: 0 }],
    });
    const result = await parseFitFile(bytes);
    expect(result.records[0].paceSecPerKm).toBeUndefined();
  });

  it("同じ入力からは常に同じ結果になる（決定的処理）", async () => {
    const bytes = buildFitFile({
      sessions: [{ startTime: "2026-07-20T10:00:00Z", timestamp: "2026-07-20T10:05:00Z", totalDistanceM: 1000 }],
    });
    const a = await parseFitFile(bytes);
    const b = await parseFitFile(bytes);
    expect(a).toEqual(b);
  });

  it("解析できないバイト列は例外にし、成功として扱わない", async () => {
    await expect(parseFitFile(new Uint8Array([1, 2, 3]))).rejects.toThrow();
  });

  it("file_idのタイムスタンプと作成機器情報を取り出す", async () => {
    const bytes = buildFitFile({ manufacturer: 1, timeCreated: "2026-07-20T09:55:00Z" });
    const result = await parseFitFile(bytes);
    expect(result.manufacturer).toBe("garmin");
    expect(result.timeCreatedUtc).toBe("2026-07-20T09:55:00.000Z");
  });

  describe("ランニングダイナミクス（ピッチ・ストライド・上下動・接地時間・気温）", () => {
    it("sessionのダイナミクスを取り出す。cadenceは片脚分から歩数/分へ2倍にする", async () => {
      const bytes = buildFitFile({
        sessions: [
          {
            startTime: "2026-07-20T10:00:00Z",
            timestamp: "2026-07-20T10:05:00Z",
            avgCadence: 85, // rpm（片脚） → 170spm
            maxCadence: 95,
            avgTemperatureC: 28,
            maxTemperatureC: 31,
            avgVerticalOscillationMm: 8.5,
            avgGroundContactTimeMs: 245,
            avgStepLengthMm: 1120,
          },
        ],
      });
      const result = await parseFitFile(bytes);
      const s = result.sessions[0];
      expect(s.avgCadenceSpm).toBe(170);
      expect(s.maxCadenceSpm).toBe(190);
      expect(s.avgTemperatureC).toBe(28);
      expect(s.maxTemperatureC).toBe(31);
      expect(s.avgVerticalOscillationMm).toBeCloseTo(8.5, 5);
      expect(s.avgGroundContactTimeMs).toBeCloseTo(245, 5);
      expect(s.avgStepLengthM).toBeCloseTo(1.12, 5);
    });

    it("lapのダイナミクスを取り出す", async () => {
      const bytes = buildFitFile({
        laps: [
          {
            startTime: "2026-07-20T10:00:00Z",
            timestamp: "2026-07-20T10:05:00Z",
            avgCadence: 90,
            avgVerticalOscillationMm: 7.9,
            avgGroundContactTimeMs: 230,
            avgStepLengthMm: 1200,
          },
        ],
      });
      const result = await parseFitFile(bytes);
      const l = result.laps[0];
      expect(l.avgCadenceSpm).toBe(180);
      expect(l.avgVerticalOscillationMm).toBeCloseTo(7.9, 5);
      expect(l.avgGroundContactTimeMs).toBeCloseTo(230, 5);
      expect(l.avgStepLengthM).toBeCloseTo(1.2, 5);
    });

    it("recordごとのダイナミクスを取り出す", async () => {
      const bytes = buildFitFile({
        records: [
          {
            timestamp: "2026-07-20T10:00:00Z",
            cadence: 88,
            temperatureC: 29,
            verticalOscillationMm: 8.2,
            groundContactTimeMs: 240,
            stepLengthMm: 1150,
          },
        ],
      });
      const result = await parseFitFile(bytes);
      const r = result.records[0];
      expect(r.cadenceSpm).toBe(176);
      expect(r.temperatureC).toBe(29);
      expect(r.verticalOscillationMm).toBeCloseTo(8.2, 5);
      expect(r.groundContactTimeMs).toBeCloseTo(240, 5);
      expect(r.stepLengthM).toBeCloseTo(1.15, 5);
    });

    it("気温は0度・氷点下でも読み取れる（0や負数を欠損扱いにしない）", async () => {
      const bytes = buildFitFile({
        sessions: [
          {
            startTime: "2026-07-20T10:00:00Z",
            timestamp: "2026-07-20T10:05:00Z",
            avgTemperatureC: 0,
          },
        ],
        records: [{ timestamp: "2026-07-20T10:00:00Z", temperatureC: -3 }],
      });
      const result = await parseFitFile(bytes);
      expect(result.sessions[0].avgTemperatureC).toBe(0);
      expect(result.records[0].temperatureC).toBe(-3);
    });

    it("デバイスがダイナミクスに対応していなければ推測で埋めずundefinedのままにする", async () => {
      const bytes = buildFitFile({
        sessions: [{ startTime: "2026-07-20T10:00:00Z", timestamp: "2026-07-20T10:05:00Z", avgHr: 150 }],
        records: [{ timestamp: "2026-07-20T10:00:00Z", heartRate: 150 }],
      });
      const result = await parseFitFile(bytes);
      const s = result.sessions[0];
      const r = result.records[0];
      expect(s.avgCadenceSpm).toBeUndefined();
      expect(s.avgVerticalOscillationMm).toBeUndefined();
      expect(s.avgGroundContactTimeMs).toBeUndefined();
      expect(s.avgStepLengthM).toBeUndefined();
      expect(s.avgTemperatureC).toBeUndefined();
      expect(r.cadenceSpm).toBeUndefined();
      expect(r.verticalOscillationMm).toBeUndefined();
    });
  });
});
