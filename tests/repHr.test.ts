/**
 * Q-1 1本ごとの平均心拍
 *
 * 任意項目。無くても全部そのまま動くことと、
 * 入れたときに比較とM-2の判断材料になることの両方を見る。
 */
import { describe, expect, it } from "vitest";
import { buildRepResults } from "@/lib/core/workoutLog";
import { groupBySamePrescription, TREND_THRESHOLD_BPM } from "@/lib/core/samePrescription";
import {
  dailyAdjustment,
  qualityHrTrend,
  QUALITY_HR_FATIGUE_BPM,
} from "@/lib/core/adaptive";
import { makeResult, makeSession } from "./helpers";
import type { Session, SessionResult } from "@/lib/core/types";

const TODAY = "2026-07-26";

function addDays(s: string, n: number): string {
  const d = new Date(s + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 300m×4 のポイント練習を1本作る */
function quality(
  dayOffset: number,
  times: number[],
  hrs?: (number | undefined)[],
  distanceM = 300
): { session: Session; result: SessionResult } {
  const session = makeSession(addDays(TODAY, dayOffset), "high_lactate", {
    status: "completed",
  });
  const result = makeResult(session, {
    date: session.date,
    actualLapsSec: times,
    interval: {
      reps: times.length,
      distanceM,
      targetSec: 41.5,
      restSec: 300,
      results: buildRepResults(distanceM, times, 41.5, hrs ?? []),
    },
  });
  return { session, result };
}

describe("buildRepResults", () => {
  it("心拍を渡さなくても今までどおり作れる", () => {
    const out = buildRepResults(300, [41.2, 41.5], 41.0);
    expect(out).toHaveLength(2);
    expect(out[0].avgHr).toBeUndefined();
    expect(out[0].actualSec).toBe(41.2);
  });

  it("空の心拍は付けない（0や空欄を心拍として保存しない）", () => {
    const out = buildRepResults(300, [41.2, 41.5], 41.0, [175, undefined]);
    expect(out[0].avgHr).toBe(175);
    expect(out[1].avgHr).toBeUndefined();
    expect("avgHr" in out[1]).toBe(false);
  });

  it("実施タイムが空の本があっても心拍がずれない", () => {
    // 2本目が未入力。3本目の心拍が2本目に付いてはいけない
    const out = buildRepResults(300, [41.2, 0, 42.0], 41.0, [170, undefined, 182]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ index: 1, actualSec: 41.2, avgHr: 170 });
    expect(out[1]).toMatchObject({ index: 2, actualSec: 42.0, avgHr: 182 });
  });
});

describe("同じ処方の比較", () => {
  it("心拍が入っていれば推移が出る", () => {
    const a = quality(-21, [41.5, 41.7, 41.9, 42.1], [168, 170, 172, 174]);
    const b = quality(-7, [41.5, 41.7, 41.9, 42.1], [176, 178, 180, 182]);
    const groups = groupBySamePrescription(
      [a.session, b.session],
      [a.result, b.result]
    );
    expect(groups).toHaveLength(1);
    const g = groups[0];
    expect(g.occurrences[0].avgHr).toBe(171);
    expect(g.occurrences[1].avgHr).toBe(179);
    // タイムは横ばいなのに心拍が上がっている
    expect(g.avgTrend.judgement).toBe("flat");
    expect(g.hrTrend?.judgement).toBe("worsening");
    expect(g.hrTrend?.message).toContain("bpm");
  });

  it("心拍が下がっていれば改善として出す", () => {
    const a = quality(-21, [41.5, 41.7], [180, 182]);
    const b = quality(-7, [41.5, 41.7], [170, 172]);
    const g = groupBySamePrescription([a.session, b.session], [a.result, b.result])[0];
    expect(g.hrTrend?.judgement).toBe("improving");
    expect(g.hrTrend?.message).toContain("楽になっています");
  });

  it("心拍が無くても比較そのものは今までどおり出る", () => {
    const a = quality(-21, [41.5, 41.7]);
    const b = quality(-7, [41.2, 41.4]);
    const g = groupBySamePrescription([a.session, b.session], [a.result, b.result])[0];
    expect(g.occurrences[0].avgHr).toBeUndefined();
    expect(g.avgTrend.judgement).toBe("improving");
    expect(g.hrTrend?.judgement).toBe("insufficient_data");
  });

  it("数bpmの差は横ばいとして扱う（装着位置や気温で動くため）", () => {
    const a = quality(-21, [41.5, 41.7], [175, 175]);
    const b = quality(-7, [41.5, 41.7], [175 + TREND_THRESHOLD_BPM - 1, 175]);
    const g = groupBySamePrescription([a.session, b.session], [a.result, b.result])[0];
    expect(g.hrTrend?.judgement).toBe("flat");
  });
});

describe("M-2 ポイント練習の心拍", () => {
  /** 直近2本の心拍が高く、タイムは同じ */
  const fatiguedSet = [
    quality(-24, [41.5, 41.7, 41.9], [168, 170, 172]),
    quality(-17, [41.5, 41.7, 41.9], [169, 171, 173]),
    quality(-10, [41.5, 41.7, 41.9], [176, 178, 180]),
    quality(-3, [41.5, 41.7, 41.9], [177, 179, 181]),
  ];

  it("同じタイムで心拍が上がっていれば疲労とみなす", () => {
    const t = qualityHrTrend(
      fatiguedSet.map((x) => x.session),
      fatiguedSet.map((x) => x.result),
      "high_lactate",
      TODAY
    );
    expect(t.recentCount).toBe(2);
    expect(t.baselineCount).toBe(2);
    expect(t.deltaBpm).toBeGreaterThanOrEqual(QUALITY_HR_FATIGUE_BPM);
    expect(t.fatigued).toBe(true);
    expect(t.note).toContain("状態は落ちています");
  });

  it("速く走ったぶんの心拍上昇は疲労にしない", () => {
    const faster = [
      quality(-24, [42.5, 42.7, 42.9], [168, 170, 172]),
      quality(-17, [42.5, 42.7, 42.9], [169, 171, 173]),
      quality(-10, [40.5, 40.7, 40.9], [176, 178, 180]),
      quality(-3, [40.5, 40.7, 40.9], [177, 179, 181]),
    ];
    const t = qualityHrTrend(
      faster.map((x) => x.session),
      faster.map((x) => x.result),
      "high_lactate",
      TODAY
    );
    expect(t.deltaBpm).toBeGreaterThanOrEqual(QUALITY_HR_FATIGUE_BPM);
    expect(t.fatigued).toBe(false);
    expect(t.note).toContain("速く走ったぶん");
  });

  it("本数が足りなければ判定しない（黙って0扱いにしない）", () => {
    const few = fatiguedSet.slice(0, 3);
    const t = qualityHrTrend(
      few.map((x) => x.session),
      few.map((x) => x.result),
      "high_lactate",
      TODAY
    );
    expect(t.fatigued).toBe(false);
    expect(t.note).toContain("足りません");
  });

  it("距離が違う練習は混ぜない", () => {
    const mixed = [
      quality(-24, [41.5, 41.7], [168, 170], 300),
      quality(-17, [41.5, 41.7], [169, 171], 300),
      quality(-10, [86.0, 86.4], [176, 178], 600),
      quality(-3, [86.0, 86.4], [177, 179], 600),
    ];
    const t = qualityHrTrend(
      mixed.map((x) => x.session),
      mixed.map((x) => x.result),
      "high_lactate",
      TODAY
    );
    // 300mが2本・600mが2本。どちらも4本に満たないので判定しない
    expect(t.fatigued).toBe(false);
    expect(t.note).toContain("足りません");
  });

  it("その日の調整に材料として入る", () => {
    const t = qualityHrTrend(
      fatiguedSet.map((x) => x.session),
      fatiguedSet.map((x) => x.result),
      "high_lactate",
      TODAY
    );
    const withHr = dailyAdjustment(undefined, "green", undefined, undefined, t);
    const withoutHr = dailyAdjustment(undefined, "green", undefined, undefined, undefined);
    expect(withHr.factor).toBeGreaterThan(withoutHr.factor);
    // なぜ緩めたかが文章で残ること
    expect(withHr.reasons.join(" ")).toContain("bpm");
  });
});
