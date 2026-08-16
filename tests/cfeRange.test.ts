/**
 * CFEを幅で示す（`cfeRange`）と、推定のばらつき（`spreadOf`）。
 *
 * 「1:51.0、信頼度0.48」と出しても、人はその0.48を使って判断できない。
 * 「1:50.2〜1:51.8」なら、目標との距離が直感的に分かる。
 *
 * **表示専用。** プラン生成にも設定ペースの計算にも使わない
 * （計算に使うと「幅のどこを採るか」という新しい恣意性が入る）。
 * ここが崩れると、幅の広い＝自信の無い推定が、
 * 幅の狭い推定と同じ顔をして画面に出る。
 */
import { describe, expect, it } from "vitest";
import {
  CFE_RANGE_BASE_SEC,
  CFE_RANGE_MAX_SEC,
  cfeRange,
  spreadOf,
  type BackfillSample,
  type FitnessAssessment,
} from "@/lib/core/backfill";

describe("幅の出し方", () => {
  it("信頼度が高いほど狭い", () => {
    const high = cfeRange(110, 1.0);
    const low = cfeRange(110, 0.3);
    expect(high.marginSec).toBeLessThan(low.marginSec);
    expect(high.marginSec).toBeCloseTo(CFE_RANGE_BASE_SEC, 1);
  });

  it("中心は動かさない（幅を付けても推定そのものは変えない）", () => {
    for (const conf of [0.05, 0.5, 1]) {
      expect(cfeRange(110, conf).centerSec).toBe(110);
    }
  });

  it("上下は中心から等距離", () => {
    const r = cfeRange(110, 0.5);
    expect(r.centerSec - r.lowSec).toBeCloseTo(r.marginSec, 5);
    expect(r.highSec - r.centerSec).toBeCloseTo(r.marginSec, 5);
  });

  it("どれだけ信頼度が低くても、上限を超えて広げない", () => {
    /*
     * 際限なく広げると「1:45〜1:57」のような、見ても何も決められない幅になる。
     * そこまで広いなら、幅ではなく**推定を出さない**という判断が要る。
     */
    expect(cfeRange(110, 0.001).marginSec).toBeLessThanOrEqual(CFE_RANGE_MAX_SEC);
    expect(cfeRange(110, -5).marginSec).toBeLessThanOrEqual(CFE_RANGE_MAX_SEC);
  });

  it("信頼度が1を超えても、基準より狭くしない", () => {
    expect(cfeRange(110, 5).marginSec).toBeCloseTo(CFE_RANGE_BASE_SEC, 1);
  });

  it("実測どうしのばらつきが大きければ、そちらで広げる", () => {
    // 信頼度が高くても、材料が食い違っているなら狭く見せない
    const narrow = cfeRange(110, 1.0, 0);
    const wide = cfeRange(110, 1.0, 3);
    expect(wide.marginSec).toBeGreaterThan(narrow.marginSec);
    expect(wide.marginSec).toBeCloseTo(3, 1);
  });

  it("ばらつきも上限で頭打ちにする", () => {
    expect(cfeRange(110, 1.0, 99).marginSec).toBe(CFE_RANGE_MAX_SEC);
  });

  it("表示のため0.1秒に丸める", () => {
    const r = cfeRange(110, 0.37);
    expect(r.marginSec).toBeCloseTo(Math.round(r.marginSec * 10) / 10, 10);
  });
});

describe("推定のばらつき", () => {
  const sample = (over: Partial<BackfillSample> = {}): BackfillSample => ({
    entryId: "e1",
    date: "2026-08-01",
    label: "800mレース",
    implied800mSec: 110,
    weight: 1,
    reliability: 1,
    recencyWeight: 1,
    heatFlagged: false,
    note: "",
    ...over,
  });

  const assessment = (over: Partial<FitnessAssessment> = {}): FitnessAssessment => ({
    estimated800mSec: 110,
    confidence: 0.8,
    samples: [],
    excluded: [],
    notes: [],
    ...over,
  });

  it("推定が無ければ0（無いものからばらつきを作らない）", () => {
    expect(spreadOf(assessment({ estimated800mSec: undefined }))).toBe(0);
  });

  it("材料が1本ならばらつきは出さない", () => {
    expect(spreadOf(assessment({ samples: [sample()] }))).toBe(0);
  });

  it("重みの合計が0なら0（0で割らない）", () => {
    expect(
      spreadOf(assessment({ samples: [sample({ weight: 0 }), sample({ weight: 0 })] }))
    ).toBe(0);
  });

  it("材料がそろっていれば、推定からの散らばりを返す", () => {
    const s = spreadOf(
      assessment({
        estimated800mSec: 110,
        samples: [sample({ implied800mSec: 108 }), sample({ implied800mSec: 112 })],
      })
    );
    expect(s).toBeCloseTo(2, 5);
  });

  it("全部同じ値ならばらつきは0", () => {
    expect(
      spreadOf(assessment({ samples: [sample(), sample()] }))
    ).toBeCloseTo(0, 10);
  });

  it("重みの大きい材料のほうが強く効く", () => {
    const even = spreadOf(
      assessment({
        samples: [sample({ implied800mSec: 106 }), sample({ implied800mSec: 114 })],
      })
    );
    const leaning = spreadOf(
      assessment({
        samples: [
          sample({ implied800mSec: 106, weight: 0.1 }),
          sample({ implied800mSec: 114, weight: 0.1 }),
          sample({ implied800mSec: 110, weight: 5 }),
        ],
      })
    );
    // 推定に近い材料が重いぶん、散らばりは小さく出る
    expect(leaning).toBeLessThan(even);
  });
});

describe("幅とばらつきを繋いだとき", () => {
  it("材料が食い違っているほど広い幅になる", () => {
    const base = { confidence: 1, samples: [], excluded: [], notes: [] };
    const tight: FitnessAssessment = {
      ...base,
      estimated800mSec: 110,
      samples: [
        { entryId: "a", date: "2026-08-01", label: "", implied800mSec: 110, weight: 1, reliability: 1, recencyWeight: 1, heatFlagged: false, note: "" },
        { entryId: "b", date: "2026-08-02", label: "", implied800mSec: 110, weight: 1, reliability: 1, recencyWeight: 1, heatFlagged: false, note: "" },
      ],
    };
    const loose: FitnessAssessment = {
      ...tight,
      samples: tight.samples.map((s, i) => ({ ...s, implied800mSec: i === 0 ? 106 : 114 })),
    };
    const a = cfeRange(110, tight.confidence, spreadOf(tight));
    const b = cfeRange(110, loose.confidence, spreadOf(loose));
    expect(b.marginSec).toBeGreaterThan(a.marginSec);
  });
});
