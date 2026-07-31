import { describe, it, expect } from "vitest";
import { groupBySamePrescription } from "@/lib/core/samePrescription";
import { cfeRange } from "@/lib/core/backfill";
import { planRaceSplits, toSplit, MIN_RACE_SAMPLES } from "@/lib/core/racePlan";
import { makeSession, makeResult } from "./helpers";
import type { Session, SessionResult } from "@/lib/core/types";

function interval(
  date: string,
  distanceM: number,
  times: number[],
  overrides: Partial<SessionResult> = {}
): { s: Session; r: SessionResult } {
  const s = makeSession(date, "high_lactate");
  const r = makeResult(s, {
    interval: {
      reps: times.length,
      distanceM,
      restType: "jog",
      restSec: 240,
      results: times.map((t, i) => ({ index: i, distanceM, actualSec: t })),
    },
    ...overrides,
  });
  return { s, r };
}

describe("G 同一処方の経時比較", () => {
  it("カテゴリ・距離・本数が一致したものだけをまとめる", () => {
    const a = interval("2026-06-01", 300, [43, 43.5, 44, 44.5]);
    const b = interval("2026-06-15", 300, [42.8, 43.0, 43.4, 43.6]);
    const c = interval("2026-06-20", 400, [58, 59, 60, 61]); // 距離が違う
    const g = groupBySamePrescription([a.s, b.s, c.s], [a.r, b.r, c.r]);
    expect(g).toHaveLength(1);
    expect(g[0].key.distanceM).toBe(300);
    expect(g[0].occurrences).toHaveLength(2);
  });

  it("1回しかやっていない処方は出さない（推移にならない）", () => {
    const a = interval("2026-06-01", 300, [43, 44]);
    const g = groupBySamePrescription([a.s], [a.r]);
    expect(g).toHaveLength(0);
  });

  it("平均タイムと垂れ幅を別々に判定する", () => {
    // 平均は速くなっているが、垂れ幅は広がっているケース
    const a = interval("2026-06-01", 300, [43.0, 43.2, 43.4, 43.6]); // 平均43.3 垂れ0.6
    const b = interval("2026-06-15", 300, [41.5, 42.5, 43.2, 44.0]); // 平均42.8 垂れ2.5
    const g = groupBySamePrescription([a.s, b.s], [a.r, b.r]);
    expect(g[0].avgTrend.judgement).toBe("improving");
    expect(g[0].fadeTrend.judgement).toBe("worsening");
    // 1本目を突っ込んだだけ、という状態を見逃さない
    expect(g[0].fadeTrend.message).toContain("1本目の入りが速すぎる");
  });

  it("垂れ幅の縮小は800mへの転移が大きいと伝える", () => {
    const a = interval("2026-06-01", 300, [42.0, 43.0, 44.0, 45.0]); // 垂れ3.0
    const b = interval("2026-06-15", 300, [42.5, 42.8, 43.1, 43.4]); // 垂れ0.9
    const g = groupBySamePrescription([a.s, b.s], [a.r, b.r]);
    expect(g[0].fadeTrend.judgement).toBe("improving");
    expect(g[0].fadeTrend.message).toContain("転移");
  });

  it("誤差程度の差は横ばいと判定する", () => {
    const a = interval("2026-06-01", 300, [43.0, 43.2, 43.4, 43.6]);
    const b = interval("2026-06-15", 300, [43.1, 43.3, 43.5, 43.7]);
    const g = groupBySamePrescription([a.s, b.s], [a.r, b.r]);
    expect(g[0].avgTrend.judgement).toBe("flat");
  });

  it("暑熱フラグは除外せず、印だけ残す（比較が目的）", () => {
    const a = interval("2026-06-01", 300, [43, 44, 45, 46], { heatFlagged: true });
    const b = interval("2026-06-15", 300, [43, 43.5, 44, 44.5]);
    const g = groupBySamePrescription([a.s, b.s], [a.r, b.r]);
    expect(g[0].occurrences).toHaveLength(2);
    expect(g[0].occurrences[0].heatFlagged).toBe(true);
  });

  it("翌日の脚の重さが打ち込まれていれば各回に載せる", () => {
    const a = interval("2026-06-01", 300, [43, 44, 45, 46], { nextDayLegs: "heavy" });
    const b = interval("2026-06-15", 300, [43, 43.5, 44, 44.5], { nextDayLegs: "fresh" });
    const g = groupBySamePrescription([a.s, b.s], [a.r, b.r]);
    expect(g[0].occurrences[0].nextDayLegs).toBe("heavy");
    expect(g[0].occurrences[1].nextDayLegs).toBe("fresh");
  });

  it("翌日の脚の重さが未入力なら undefined のまま", () => {
    const a = interval("2026-06-01", 300, [43, 44, 45, 46]);
    const b = interval("2026-06-15", 300, [43, 43.5, 44, 44.5]);
    const g = groupBySamePrescription([a.s, b.s], [a.r, b.r]);
    expect(g[0].occurrences[0].nextDayLegs).toBeUndefined();
  });

  it("実施日順に並ぶ", () => {
    const a = interval("2026-06-15", 300, [43, 44]);
    const b = interval("2026-06-01", 300, [44, 45]);
    const g = groupBySamePrescription([a.s, b.s], [a.r, b.r]);
    expect(g[0].occurrences.map((o) => o.date)).toEqual(["2026-06-01", "2026-06-15"]);
  });
});

describe("H CFEの予測レンジ", () => {
  it("信頼度が低いほど幅が広い", () => {
    const high = cfeRange(110, 1.0);
    const low = cfeRange(110, 0.3);
    expect(low.marginSec).toBeGreaterThan(high.marginSec);
    expect(high.lowSec).toBeLessThan(110);
    expect(high.highSec).toBeGreaterThan(110);
  });

  it("実測のばらつきが大きければ、その幅まで広げる", () => {
    const narrow = cfeRange(110, 1.0, 0);
    const wide = cfeRange(110, 1.0, 3.0);
    expect(wide.marginSec).toBeGreaterThan(narrow.marginSec);
    expect(wide.marginSec).toBeCloseTo(3.0, 1);
  });

  it("上限を超えて広がらない（幅が無意味になるのを防ぐ）", () => {
    expect(cfeRange(110, 0.01, 99).marginSec).toBeLessThanOrEqual(4.0);
  });

  it("中心は必ず現在のCFE（勝手にずらさない）", () => {
    expect(cfeRange(110.5, 0.5).centerSec).toBe(110.5);
  });
});

describe("I レース配分シミュレータ", () => {
  const s1 = { date: "2026-05-01", distanceM: 800, lapsSec: [52.8, 56.7] };
  const s2 = { date: "2026-06-01", distanceM: 800, lapsSec: [26.0, 26.5, 27.5, 29.0] };

  it("2分割・4分割どちらのラップからも前後半を作れる", () => {
    expect(toSplit([52.8, 56.7], 800)!.fadeSec).toBeCloseTo(3.9, 2);
    const four = toSplit([26.0, 26.5, 27.5, 29.0], 800)!;
    expect(four.firstSec).toBeCloseTo(52.5, 2);
    expect(four.secondSec).toBeCloseTo(56.5, 2);
  });

  it("ラップが足りなければ案を出さず、必要本数と入れ方を伝える", () => {
    const r = planRaceSplits(108.9, [s1]);
    expect(r.options).toHaveLength(0);
    expect(r.blockedReason).toContain(String(MIN_RACE_SAMPLES));
    expect(r.blockedReason).toContain("区間ラップ");
    // 一般論で埋めないこと
    expect(r.measuredFadeSec).toBeUndefined();
  });

  it("実測の落ち幅を基準に3案を出す", () => {
    const r = planRaceSplits(108.9, [s1, s2]);
    expect(r.options).toHaveLength(3);
    // 実測平均の落ち幅 = (3.9 + 4.0) / 2 = 3.95
    expect(r.measuredFadeSec).toBeCloseTo(4.0, 1);
    const base = r.options[0];
    expect(base.firstSec + base.secondSec).toBeCloseTo(108.9, 1);
    expect(base.fadeSec).toBeCloseTo(4.0, 1);
  });

  it("後半維持案は落ち幅が小さく、前半重視案は大きい", () => {
    const r = planRaceSplits(108.9, [s1, s2]);
    const [base, hold, push] = r.options;
    expect(hold.fadeSec).toBeLessThan(base.fadeSec);
    expect(push.fadeSec).toBeGreaterThan(base.fadeSec);
    // 落ち幅が小さい案ほど前半は遅い（＝抑えて入る）
    expect(hold.firstSec).toBeGreaterThan(push.firstSec);
  });

  it("どの案も合計が目標タイムに一致する", () => {
    const r = planRaceSplits(108.9, [s1, s2]);
    for (const o of r.options) {
      expect(o.firstSec + o.secondSec).toBeCloseTo(108.9, 1);
    }
  });

  it("200m通過の目安が単調増加する", () => {
    const r = planRaceSplits(108.9, [s1, s2]);
    const p = r.options[0].passing200;
    expect(p).toHaveLength(4);
    for (let i = 1; i < p.length; i++) expect(p[i]).toBeGreaterThan(p[i - 1]);
    expect(p[3]).toBeCloseTo(108.9, 1);
  });
});
