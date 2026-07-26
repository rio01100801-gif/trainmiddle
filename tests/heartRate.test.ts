/**
 * R-1 心拍が推定と判断に効いているか
 *
 * 一番大事なのは「心拍が無くても全部動くこと」。
 * 心拍は精度を上げる補助であって、必須項目にしない。
 */
import { describe, expect, it } from "vitest";
import {
  HEAT_HR_EVIDENCE_BPM,
  HR_STEADY_MIN_SEC,
  heatHrEvidence,
  hrMaxReference,
  INTENSITY_BANDS,
  relativeIntensity,
} from "@/lib/core/heartRate";
import { buildRepResults } from "@/lib/core/workoutLog";
import { makeResult, makeSession, testAthlete } from "./helpers";
import type { Session, SessionCategory, SessionResult } from "@/lib/core/types";

function interval(
  date: string,
  category: SessionCategory,
  distanceM: number,
  times: number[],
  hrs?: number[],
  extra: Partial<SessionResult> = {}
): { session: Session; result: SessionResult } {
  const session = makeSession(date, category, { status: "completed" });
  const result = makeResult(session, {
    date,
    actualLapsSec: times,
    interval: {
      reps: times.length,
      distanceM,
      results: buildRepResults(distanceM, times, undefined, hrs ?? []),
    },
    ...extra,
  });
  return { session, result };
}

function jog(
  date: string,
  distanceKm: number,
  durationMin: number,
  avgHr?: number,
  maxHr?: number
): { session: Session; result: SessionResult } {
  const session = makeSession(date, "aerobic", { status: "completed" });
  const result = makeResult(session, {
    date,
    continuous: {
      distanceKm,
      durationMin,
      avgPaceSecPerKm: (durationMin * 60) / distanceKm,
      avgHr,
      maxHr,
    },
  });
  return { session, result };
}

describe("最大心拍の基準", () => {
  it("プロフィールの実測値を最優先する", () => {
    const r = hrMaxReference(testAthlete({ maxHrBpm: 196 }), [], []);
    expect(r?.bpm).toBe(196);
    expect(r?.source).toBe("profile");
  });

  it("未入力なら記録の中の最高値を使い、実測の最高値だと明示する", () => {
    const a = jog("2026-07-01", 10, 55, 150, 178);
    const b = interval("2026-07-05", "cv", 1000, [200, 201], [185, 188]);
    const r = hrMaxReference(testAthlete(), [a.result, b.result], []);
    expect(r?.bpm).toBe(188);
    expect(r?.source).toBe("observed");
    expect(r?.note).toContain("これより高い可能性");
  });

  it("年齢からの推定はしない。材料が無ければ基準を持たない", () => {
    expect(hrMaxReference(testAthlete(), [], [])).toBeUndefined();
  });
});

describe("相対強度", () => {
  const hrMax = { bpm: 196, source: "profile" as const, note: "" };

  it("狙いの帯に入っていれば、そう出す", () => {
    // CV は 86〜93%。196 の 88% = 172
    const x = interval("2026-07-10", "cv", 1000, [200, 201, 202], [171, 172, 173]);
    const out = relativeIntensity(x.session, x.result, hrMax);
    expect(out.verdict).toBe("in_band");
    expect(out.pct).toBeGreaterThanOrEqual(INTENSITY_BANDS.cv!.min);
  });

  it("帯より低ければ、強度が上がりきっていないと出す", () => {
    const x = interval("2026-07-10", "cv", 1000, [200, 201], [150, 152]);
    const out = relativeIntensity(x.session, x.result, hrMax);
    expect(out.verdict).toBe("below");
    expect(out.note).toContain("上がりきっていません");
  });

  it("1本が短い練習では判定しない（心拍が定常に達しないため）", () => {
    const x = interval("2026-07-10", "cv", 300, [42, 42.3], [150, 155]);
    expect(42).toBeLessThan(HR_STEADY_MIN_SEC);
    const out = relativeIntensity(x.session, x.result, hrMax);
    expect(out.verdict).toBe("not_applicable");
    expect(out.note).toContain("定常");
  });

  it("高乳酸は心拍から強度を判定しない", () => {
    const x = interval("2026-07-10", "high_lactate", 300, [42], [180]);
    expect(relativeIntensity(x.session, x.result, hrMax).verdict).toBe("not_applicable");
  });

  it("基準が無ければ判定しない（推測で埋めない）", () => {
    const x = interval("2026-07-10", "cv", 1000, [200, 201], [171, 172]);
    const out = relativeIntensity(x.session, x.result, undefined);
    expect(out.verdict).toBe("no_data");
    expect(out.pct).toBeUndefined();
  });

  it("心拍が無くても落ちない。判定できないと返すだけ", () => {
    const x = interval("2026-07-10", "cv", 1000, [200, 201]);
    const out = relativeIntensity(x.session, x.result, hrMax);
    expect(out.verdict).toBe("no_data");
    expect(out.note).toContain("心拍が入っていません");
  });

  it("ジョグでも出る", () => {
    const x = jog("2026-07-10", 10, 55, 140);
    // 196 の 71% = 139。有酸素の帯は 65〜78%
    expect(relativeIntensity(x.session, x.result, hrMax).verdict).toBe("in_band");
  });
});

describe("暑熱の切り分け", () => {
  const cool = [
    interval("2026-07-01", "cv", 1000, [200, 201], [170, 172]),
    interval("2026-07-08", "cv", 1000, [200, 201], [171, 173]),
  ];

  it("同じ設定で心拍が高く、タイムが速くなっていなければ環境要因として裏づける", () => {
    const hot = interval("2026-07-20", "cv", 1000, [203, 204], [180, 182], {
      heatFlagged: true,
    });
    const ev = heatHrEvidence(
      [...cool.map((x) => x.session), hot.session],
      [...cool.map((x) => x.result), hot.result],
      hot.result
    );
    expect(ev.deltaBpm).toBeGreaterThanOrEqual(HEAT_HR_EVIDENCE_BPM);
    expect(ev.supported).toBe(true);
    expect(ev.note).toContain("能力が落ちたわけではありません");
  });

  it("心拍が平常と変わらなければ、暑さのせいだと言い切らない", () => {
    const hot = interval("2026-07-20", "cv", 1000, [206, 207], [172, 173], {
      heatFlagged: true,
    });
    const ev = heatHrEvidence(
      [...cool.map((x) => x.session), hot.session],
      [...cool.map((x) => x.result), hot.result],
      hot.result
    );
    expect(ev.supported).toBe(false);
    expect(ev.note).toContain("言い切る材料はありません");
  });

  it("速く走ったことによる上昇は裏づけにしない", () => {
    const hot = interval("2026-07-20", "cv", 1000, [193, 194], [181, 183], {
      heatFlagged: true,
    });
    const ev = heatHrEvidence(
      [...cool.map((x) => x.session), hot.session],
      [...cool.map((x) => x.result), hot.result],
      hot.result
    );
    expect(ev.supported).toBe(false);
    expect(ev.note).toContain("速く走ったぶん");
  });

  it("比較できる記録が無ければ、その旨を出す", () => {
    const hot = interval("2026-07-20", "cv", 1000, [203], [180], { heatFlagged: true });
    const ev = heatHrEvidence([hot.session], [hot.result], hot.result);
    expect(ev.baselineCount).toBe(0);
    expect(ev.supported).toBe(false);
    expect(ev.note).toContain("まだありません");
  });

  it("心拍が無い日は心拍からは判断できないと出す", () => {
    const hot = interval("2026-07-20", "cv", 1000, [203], undefined, { heatFlagged: true });
    const ev = heatHrEvidence(
      [...cool.map((x) => x.session), hot.session],
      [...cool.map((x) => x.result), hot.result],
      hot.result
    );
    expect(ev.supported).toBe(false);
    expect(ev.note).toContain("心拍からは判断できません");
  });
});
