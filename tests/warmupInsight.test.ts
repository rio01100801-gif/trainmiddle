/**
 * アップの分析。
 *
 * ここで守らせたいのは「何を出すか」より **何を出さないか**。
 *
 *   ・1〜2回では傾向を出さない（数字そのものを出さない）
 *   ・3回以上でも暫定と断り、件数を必ず併記する
 *   ・因果として書かない
 *   ・自動で何かを変えない
 *
 * 緩めると、たまたま調子が良かった日を根拠にアップを変えることになる。
 * そのあと記録が悪くなっても、アップのせいなのか他の理由なのか分からない。
 */
import { describe, expect, it } from "vitest";
import {
  WARMUP_MIN_SAMPLES,
  firstRepGapSec,
  segmentBreakdown,
  warmupInsight,
  warmupSampleOf,
  warmupShapeOf,
} from "@/lib/core/warmupInsight";
import type { Session, SessionResult } from "@/lib/core/types";
import type { WarmupRecord } from "@/lib/core/warmup";

function session(id: string, date: string, category = "high_lactate"): Session {
  return { id, date, category, name: "テスト", status: "completed" } as Session;
}

function result(
  id: string,
  date: string,
  warmup: WarmupRecord | undefined,
  over: Partial<SessionResult> = {}
): SessionResult {
  return {
    id,
    sessionId: id,
    date,
    actualLapsSec: [],
    achievement: "achieved",
    rpe: 6,
    subjective: "normal",
    warmup,
    ...over,
  } as SessionResult;
}

const JOG: WarmupRecord = {
  totalDistanceKm: 3,
  segments: [{ kind: "easy_jog", distanceM: 3000 }],
  source: "manual",
};

const STRIDES: WarmupRecord = {
  totalDistanceKm: 3.4,
  segments: [
    { kind: "easy_jog", distanceM: 3000 },
    { kind: "strides", distanceM: 100, reps: 4 },
  ],
  source: "manual",
};

const STIMULUS: WarmupRecord = {
  totalDistanceKm: 3.6,
  segments: [
    { kind: "easy_jog", distanceM: 3000 },
    { kind: "acceleration", distanceM: 150, reps: 2 },
  ],
  source: "manual",
};

/** 1本目のタイムを持つインターバル */
function withFirstRep(timeSec: number, targetSec = 41.4) {
  return {
    interval: {
      reps: 5,
      distanceM: 300,
      targetSec,
      restType: "jog" as const,
      restSec: 300,
      results: [{ index: 1, distanceM: 300, actualSec: timeSec }],
    },
  };
}

describe("アップの内容を3段階に畳む", () => {
  it("ジョグだけ", () => {
    expect(warmupShapeOf(["easy_jog"])).toBe("jog_only");
  });

  it("流しが入れば流しまで", () => {
    expect(warmupShapeOf(["easy_jog", "strides"])).toBe("with_strides");
  });

  it("ビルドアップも流しまでに寄せる", () => {
    expect(warmupShapeOf(["easy_jog", "progressive"])).toBe("with_strides");
  });

  it("加速走が入れば刺激まで", () => {
    expect(warmupShapeOf(["easy_jog", "strides", "acceleration"])).toBe("with_stimulus");
  });

  it("短い刺激も刺激まで", () => {
    expect(warmupShapeOf(["short_stimulus"])).toBe("with_stimulus");
  });

  it("区間が無ければジョグだけとして扱う", () => {
    expect(warmupShapeOf([])).toBe("jog_only");
  });
});

describe("主練習1本目の設定乖離", () => {
  it("設定より遅ければプラス", () => {
    expect(firstRepGapSec(result("a", "2026-08-01", JOG, withFirstRep(42.6)))).toBeCloseTo(1.2);
  });

  it("設定より速ければマイナス", () => {
    expect(firstRepGapSec(result("a", "2026-08-01", JOG, withFirstRep(40.4)))).toBeCloseTo(-1);
  });

  it("設定が無ければ出さない（推測で埋めない）", () => {
    const r = result("a", "2026-08-01", JOG, {
      interval: {
        reps: 5,
        distanceM: 300,
        restType: "jog",
        restSec: 300,
        results: [{ index: 1, distanceM: 300, actualSec: 41 }],
      },
    } as Partial<SessionResult>);
    expect(firstRepGapSec(r)).toBeUndefined();
  });

  it("持続走なら出さない", () => {
    expect(firstRepGapSec(result("a", "2026-08-01", JOG))).toBeUndefined();
  });
});

describe("1件ぶんの材料", () => {
  it("アップが無ければ作らない", () => {
    expect(warmupSampleOf(result("a", "2026-08-01", undefined), session("a", "2026-08-01"))).toBeUndefined();
  });

  it("セッションが見つからなければ作らない（カテゴリを推測しない）", () => {
    expect(warmupSampleOf(result("a", "2026-08-01", JOG), undefined)).toBeUndefined();
  });

  it("翌日の脚が未入力なら、重くなかったことにしない", () => {
    const s = warmupSampleOf(result("a", "2026-08-01", JOG), session("a", "2026-08-01"));
    expect(s?.nextDayLegsHeavy).toBeUndefined();
  });

  it("打ち切っていれば完遂ではない", () => {
    const s = warmupSampleOf(
      result("a", "2026-08-01", JOG, { aborted: true }),
      session("a", "2026-08-01")
    );
    expect(s?.completed).toBe(false);
  });
});

describe("件数が足りないとき", () => {
  it("記録がゼロなら案内だけ出す", () => {
    const out = warmupInsight([], []);
    expect(out.emptyNote).toBeDefined();
    expect(out.readouts).toEqual([]);
    expect(out.groups).toEqual([]);
  });

  it("1回では傾向の数字を出さない", () => {
    const rs = [result("a", "2026-08-01", STRIDES, withFirstRep(41.0))];
    const ss = [session("a", "2026-08-01")];
    const out = warmupInsight(rs, ss);
    expect(out.groups[0].count).toBe(1);
    expect(out.groups[0].avgFirstRepGapSec).toBeUndefined();
    expect(out.groups[0].completionRate).toBeUndefined();
    expect(out.groups[0].note).toContain(String(WARMUP_MIN_SAMPLES));
  });

  it("2回でもまだ出さない", () => {
    const rs = [
      result("a", "2026-08-01", STRIDES, withFirstRep(41.0)),
      result("b", "2026-08-04", STRIDES, withFirstRep(41.2)),
    ];
    const ss = [session("a", "2026-08-01"), session("b", "2026-08-04")];
    const out = warmupInsight(rs, ss);
    expect(out.groups[0].avgFirstRepGapSec).toBeUndefined();
    expect(out.readouts).toEqual([]);
  });

  it("それでも記録そのものは並べる（見えなくしない）", () => {
    const rs = [result("a", "2026-08-01", STRIDES, withFirstRep(41.0))];
    const out = warmupInsight(rs, [session("a", "2026-08-01")]);
    expect(out.samples.length).toBe(1);
    expect(out.samples[0].segments).toContain("流し");
  });
});

describe("3回たまったとき", () => {
  const rs = [
    result("a", "2026-08-01", STRIDES, { ...withFirstRep(41.0), nextDayLegs: "normal" }),
    result("b", "2026-08-04", STRIDES, { ...withFirstRep(41.4), nextDayLegs: "normal" }),
    result("c", "2026-08-08", STRIDES, { ...withFirstRep(41.8), nextDayLegs: "heavy" }),
  ];
  const ss = [session("a", "2026-08-01"), session("b", "2026-08-04"), session("c", "2026-08-08")];

  it("平均が出る", () => {
    const g = warmupInsight(rs, ss).groups[0];
    expect(g.count).toBe(3);
    // (-0.4 + 0 + 0.4) / 3 = 0
    expect(g.avgFirstRepGapSec).toBeCloseTo(0);
  });

  it("完遂率と翌日の脚が出る", () => {
    const g = warmupInsight(rs, ss).groups[0];
    expect(g.completionRate).toBe(100);
    expect(g.heavyNextDayRate).toBe(33);
  });

  it("件数と「暫定」を必ず併記する", () => {
    const out = warmupInsight(rs, ss);
    const line = out.readouts.find((x) => x.includes("流しまで"));
    expect(line).toContain("3回");
    expect(line).toContain("暫定");
  });

  it("因果として書かない（「だから」「原因」を出さない）", () => {
    const out = warmupInsight(rs, ss);
    for (const line of out.readouts) {
      expect(line).not.toMatch(/だから|原因|効果があ|すべき|したほうがいい/);
    }
  });

  it("他の要因があることを必ず断る", () => {
    const out = warmupInsight(rs, ss);
    expect(out.readouts.join("")).toMatch(/睡眠|気温|前日/);
    expect(out.readouts.join("")).toMatch(/自分で決めて/);
  });

  it("翌日の脚が全部未入力なら、その率は出さない", () => {
    const noLegs = rs.map((r) => ({ ...r, nextDayLegs: undefined }));
    expect(warmupInsight(noLegs, ss).groups[0].heavyNextDayRate).toBeUndefined();
  });
});

describe("主練習カテゴリ別に分ける", () => {
  it("カテゴリが違えば別の組み合わせとして数える", () => {
    const rs = [
      result("a", "2026-08-01", STRIDES, withFirstRep(41)),
      result("b", "2026-08-04", STRIDES, withFirstRep(41)),
      result("c", "2026-08-08", STRIDES, withFirstRep(41)),
    ];
    const ss = [
      session("a", "2026-08-01", "high_lactate"),
      session("b", "2026-08-04", "high_lactate"),
      session("c", "2026-08-08", "cv"),
    ];
    const out = warmupInsight(rs, ss);
    // 2回のhigh_lactateと1回のcv。どちらも3回に届かないので傾向は出ない
    expect(out.groups.length).toBe(2);
    expect(out.groups.every((g) => g.avgFirstRepGapSec === undefined)).toBe(true);
  });

  it("アップの内容が違えば別の組み合わせとして数える", () => {
    const rs = [
      result("a", "2026-08-01", JOG, withFirstRep(41)),
      result("b", "2026-08-04", STRIDES, withFirstRep(41)),
      result("c", "2026-08-08", STIMULUS, withFirstRep(41)),
    ];
    const ss = [session("a", "2026-08-01"), session("b", "2026-08-04"), session("c", "2026-08-08")];
    expect(warmupInsight(rs, ss).groups.length).toBe(3);
  });
});

describe("アップ後の脚と1本目", () => {
  it("3回に満たない脚の平均は出さない", () => {
    const rs = [
      result("a", "2026-08-01", { ...JOG, legs: "heavy" }, withFirstRep(42.4)),
      result("b", "2026-08-04", { ...JOG, legs: "bouncy" }, withFirstRep(40.8)),
    ];
    const ss = [session("a", "2026-08-01"), session("b", "2026-08-04")];
    const out = warmupInsight(rs, ss);
    expect(out.byLegs.every((l) => l.avgFirstRepGapSec === undefined)).toBe(true);
  });

  it("件数は足りなくても、何回あったかは出す", () => {
    const rs = [result("a", "2026-08-01", { ...JOG, legs: "heavy" }, withFirstRep(42.4))];
    const out = warmupInsight(rs, [session("a", "2026-08-01")]);
    expect(out.byLegs.find((l) => l.legs === "heavy")?.count).toBe(1);
  });

  it("脚を入力していない記録は、脚の集計に入れない", () => {
    const rs = [result("a", "2026-08-01", JOG, withFirstRep(42.4))];
    expect(warmupInsight(rs, [session("a", "2026-08-01")]).byLegs).toEqual([]);
  });

  it("2種類が3回ずつたまれば、並べて出す", () => {
    const rs = [
      ...[1, 2, 3].map((i) =>
        result(`h${i}`, `2026-08-0${i}`, { ...JOG, legs: "heavy" as const }, withFirstRep(42.4))
      ),
      ...[4, 5, 6].map((i) =>
        result(`b${i}`, `2026-08-0${i}`, { ...JOG, legs: "bouncy" as const }, withFirstRep(40.8))
      ),
    ];
    const ss = rs.map((r) => session(r.id, r.date));
    const out = warmupInsight(rs, ss);
    const line = out.readouts.find((x) => x.includes("アップ後の脚"));
    expect(line).toContain("重い");
    expect(line).toContain("弾む");
    expect(line).toContain("暫定");
  });
});

describe("記録の内訳", () => {
  it("多い順に並ぶ", () => {
    const rs = [
      result("a", "2026-08-01", STRIDES),
      result("b", "2026-08-04", STRIDES),
      result("c", "2026-08-08", JOG),
    ];
    const ss = rs.map((r) => session(r.id, r.date));
    const out = segmentBreakdown(warmupInsight(rs, ss).samples);
    expect(out[0]).toEqual({ label: "流しまで", count: 2 });
  });
});

describe("新しい順に並ぶ", () => {
  it("最近の記録が先頭", () => {
    const rs = [result("a", "2026-08-01", JOG), result("b", "2026-08-08", JOG)];
    const ss = rs.map((r) => session(r.id, r.date));
    expect(warmupInsight(rs, ss).samples[0].date).toBe("2026-08-08");
  });
});
