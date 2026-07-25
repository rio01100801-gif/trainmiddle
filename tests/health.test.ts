import { describe, it, expect } from "vitest";
import {
  hrvDeviation,
  isRunning,
  parseAppleHealthExport,
  sleepHoursToScore,
  toDailyCheck,
  toFitnessMarker,
} from "@/lib/core/healthImport";

const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<HealthData locale="ja_JP">
 <Record type="HKQuantityTypeIdentifierRestingHeartRate" unit="count/min" startDate="2026-07-24 07:32:00 +0900" endDate="2026-07-24 07:32:00 +0900" value="48"/>
 <Record type="HKQuantityTypeIdentifierRestingHeartRate" unit="count/min" startDate="2026-07-23 07:20:00 +0900" endDate="2026-07-23 07:20:00 +0900" value="52"/>
 <Record type="HKQuantityTypeIdentifierHeartRateVariabilitySDNN" unit="ms" startDate="2026-07-24 07:32:00 +0900" endDate="2026-07-24 07:32:00 +0900" value="62"/>
 <Record type="HKCategoryTypeIdentifierSleepAnalysis" value="HKCategoryValueSleepAnalysisInBed" startDate="2026-07-23 23:00:00 +0900" endDate="2026-07-24 07:30:00 +0900"/>
 <Record type="HKCategoryTypeIdentifierSleepAnalysis" value="HKCategoryValueSleepAnalysisAsleepDeep" startDate="2026-07-23 23:30:00 +0900" endDate="2026-07-24 02:30:00 +0900"/>
 <Record type="HKCategoryTypeIdentifierSleepAnalysis" value="HKCategoryValueSleepAnalysisAsleepCore" startDate="2026-07-24 02:30:00 +0900" endDate="2026-07-24 07:00:00 +0900"/>
 <Record type="HKQuantityTypeIdentifierStepCount" unit="count" startDate="2026-07-24 09:00:00 +0900" endDate="2026-07-24 10:00:00 +0900" value="4000"/>
 <Record type="HKQuantityTypeIdentifierStepCount" unit="count" startDate="2026-07-24 12:00:00 +0900" endDate="2026-07-24 13:00:00 +0900" value="3000"/>
 <Workout workoutActivityType="HKWorkoutActivityTypeRunning" duration="50" durationUnit="min" totalDistance="11.2" totalDistanceUnit="km" startDate="2026-07-24 06:00:00 +0900" endDate="2026-07-24 06:50:00 +0900">
  <WorkoutStatistics type="HKQuantityTypeIdentifierHeartRate" average="145.2" maximum="162" unit="count/min"/>
  <WorkoutStatistics type="HKQuantityTypeIdentifierActiveEnergyBurned" sum="620" unit="kcal"/>
 </Workout>
 <Workout workoutActivityType="HKWorkoutActivityTypeCycling" duration="60" durationUnit="min" totalDistance="30" totalDistanceUnit="km" startDate="2026-07-22 06:00:00 +0900" endDate="2026-07-22 07:00:00 +0900"/>
 <Workout workoutActivityType="HKWorkoutActivityTypeRunning" duration="20" durationUnit="min" totalDistance="2.0" totalDistanceUnit="km" startDate="2026-07-20 06:00:00 +0900" endDate="2026-07-20 06:20:00 +0900"/>
</HealthData>`;

describe("Apple Health エクスポートの取り込み", () => {
  const r = parseAppleHealthExport(SAMPLE);

  it("安静時心拍を日付ごとに取り込む", () => {
    expect(r.daily.find((d) => d.date === "2026-07-24")!.restingHr).toBe(48);
    expect(r.daily.find((d) => d.date === "2026-07-23")!.restingHr).toBe(52);
  });

  it("HRV(SDNN)を取り込む", () => {
    expect(r.daily.find((d) => d.date === "2026-07-24")!.hrvSdnnMs).toBe(62);
  });

  it("睡眠は InBed を除外し Asleep のみ合算する（起床日側に寄せる）", () => {
    const d = r.daily.find((x) => x.date === "2026-07-24")!;
    // Deep 3h + Core 4.5h = 7.5h（InBed 8.5h は使わない）
    expect(d.sleepHours).toBeCloseTo(7.5, 1);
  });

  it("歩数は同一日で合算する", () => {
    expect(r.daily.find((d) => d.date === "2026-07-24")!.steps).toBe(7000);
  });

  it("ワークアウトの距離・時間・心拍を取り込む", () => {
    const w = r.workouts.find((w) => w.date === "2026-07-24")!;
    expect(w.distanceKm).toBeCloseTo(11.2, 1);
    expect(w.durationMin).toBe(50);
    expect(w.avgHr).toBeCloseTo(145.2, 1);
    expect(w.maxHr).toBe(162);
    expect(w.energyKcal).toBe(620);
  });

  it("取得できなかった項目を列挙する（取得できない場合は無視する）", () => {
    const empty = parseAppleHealthExport("<HealthData></HealthData>");
    expect(empty.missing).toContain("安静時心拍");
    expect(empty.missing).toContain("睡眠");
    expect(empty.daily.length).toBe(0);
  });

  it("cutoffDateより古いレコードは捨てる（大容量ファイル対策）", () => {
    const cut = parseAppleHealthExport(SAMPLE, { cutoffDate: "2026-07-24" });
    expect(cut.daily.every((d) => d.date >= "2026-07-24")).toBe(true);
    expect(cut.workouts.every((w) => w.date >= "2026-07-24")).toBe(true);
  });

  it("取り込み期間を返す", () => {
    expect(r.fromDate).toBe("2026-07-20");
    expect(r.toDate).toBe("2026-07-24");
  });
});

describe("Apple Health → 分析エンジンへの変換", () => {
  const r = parseAppleHealthExport(SAMPLE);

  it("ランニング以外（自転車）はLT推定に使わない", () => {
    expect(isRunning("Cycling")).toBe(false);
    expect(isRunning("Running")).toBe(true);
    const cycling = r.workouts.find((w) => w.activityType === "Cycling")!;
    expect(toFitnessMarker(cycling)).toBeUndefined();
  });

  it("3km未満のランニングは持続走とみなさない", () => {
    const short = r.workouts.find((w) => w.date === "2026-07-20")!;
    expect(toFitnessMarker(short)).toBeUndefined();
  });

  it("11.2km/50分のランニングはFitnessMarkerになる", () => {
    const run = r.workouts.find((w) => w.date === "2026-07-24")!;
    const fm = toFitnessMarker(run)!;
    expect(fm.lapDistancesM![0]).toBeCloseTo(11200, 0);
    expect(fm.resultLapsSec[0]).toBe(3000);
    expect(fm.avgHr).toBe(145);
    expect(fm.type).toBe("workout");
  });

  it("睡眠時間を5段階スコアに変換する", () => {
    expect(sleepHoursToScore(8.5)).toBe(5);
    expect(sleepHoursToScore(7.5)).toBe(4);
    expect(sleepHoursToScore(6.2)).toBe(3);
    expect(sleepHoursToScore(5.1)).toBe(2);
    expect(sleepHoursToScore(4)).toBe(1);
  });

  it("主観入力（脚の疲労・モチベーション）は上書きしない", () => {
    const existing = {
      date: "2026-07-24",
      legFatigue: 4,
      motivation: 2,
      overallFatigue: 3,
    };
    const merged = toDailyCheck(
      { date: "2026-07-24", restingHr: 48, sleepHours: 7.5 },
      existing
    );
    expect(merged.legFatigue).toBe(4);
    expect(merged.motivation).toBe(2);
    expect(merged.overallFatigue).toBe(3);
    expect(merged.restingHr).toBe(48);
    expect(merged.sleepQuality).toBe(4);
  });

  it("センサー値が無い日は既存の値を保持する", () => {
    const merged = toDailyCheck({ date: "2026-07-24" }, { date: "2026-07-24", restingHr: 50 });
    expect(merged.restingHr).toBe(50);
  });
});

describe("HRVのベースライン比較", () => {
  const history = Array.from({ length: 10 }, (_, i) => ({
    date: `2026-07-${String(10 + i).padStart(2, "0")}`,
    hrvSdnnMs: 60,
  }));

  it("ベースラインより20%以上低いと疲労兆候として通知する", () => {
    const r = hrvDeviation(45, history);
    expect(r.deviationPct).toBeCloseTo(-25, 0);
    expect(r.note).toContain("低下");
  });

  it("ベースラインより高ければ回復良好と通知する", () => {
    expect(hrvDeviation(80, history).note).toContain("回復良好");
  });

  it("履歴が7日未満なら判定しない", () => {
    const r = hrvDeviation(45, history.slice(0, 3));
    expect(r.deviationPct).toBeUndefined();
    expect(r.note).toContain("7日以上");
  });

  it("当日のHRVが無ければ何も返さない", () => {
    expect(hrvDeviation(undefined, history).deviationPct).toBeUndefined();
  });
});
