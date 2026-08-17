/**
 * 神経系の設定タイム。
 *
 * 以前は**目標800m（GRP）の 0.88〜0.92 倍**で出していた。2つ問題があった。
 *
 *   1. 流しが全力だった。
 *      目標1:48.9 で 150m 18.0〜18.8秒。400mPB 49.0 の150m通過が18.4秒なので、
 *      **400mレースペースそのものを「流し」として処方していた。**
 *
 *   2. 目標を速くすると流しも速くなる逆転があった。
 *      流しは今の走力に紐づくもので、目標に紐づくものではない。
 *
 * 基準を400mPBに移した。
 */
import { describe, expect, it } from "vitest";
import { neuralPace, specificPace } from "@/lib/core/pace";

/** 検証に使う選手: 400mPB 49.0秒 / 目標800m 1:48.9 */
const PB400 = 49.0;
const TARGET800 = 108.9;
const opts = { pb400mSec: PB400, fallbackBase800Sec: TARGET800 };

describe("流し（stride）", () => {
  it("150m は 19.3〜20.6秒", () => {
    const p = neuralPace(150, "stride", opts);
    expect(p.targetSecFast).toBeCloseTo(19.3, 1);
    expect(p.targetSecSlow).toBeCloseTo(20.6, 1);
  });

  it("100m は 12.9〜13.7秒", () => {
    const p = neuralPace(100, "stride", opts);
    expect(p.targetSecFast).toBeCloseTo(12.9, 1);
    expect(p.targetSecSlow).toBeCloseTo(13.7, 1);
  });

  it("400mレースペースより必ず遅い（流しは全力ではない）", () => {
    const racePaceFor150 = (PB400 / 400) * 150; // 18.375秒
    const p = neuralPace(150, "stride", opts);
    expect(p.targetSecFast).toBeGreaterThan(racePaceFor150);
  });

  it("以前の設定（目標基準）より遅い＝速すぎたのが直っている", () => {
    const before = specificPace(TARGET800, "neural", 150);
    const after = neuralPace(150, "stride", opts);
    expect(after.targetSecFast).toBeGreaterThan(before.targetSecFast);
  });
});

describe("レペ（rep）", () => {
  it("200m は 24.0〜25.7秒", () => {
    const p = neuralPace(200, "rep", opts);
    expect(p.targetSecFast).toBeCloseTo(24.0, 1);
    expect(p.targetSecSlow).toBeCloseTo(25.7, 1);
  });

  it("300m は 36.0〜38.6秒", () => {
    const p = neuralPace(300, "rep", opts);
    expect(p.targetSecFast).toBeCloseTo(36.0, 1);
    expect(p.targetSecSlow).toBeCloseTo(38.6, 1);
  });

  it("同じ距離なら流しより速い", () => {
    const stride = neuralPace(150, "stride", opts);
    const rep = neuralPace(150, "rep", opts);
    expect(rep.targetSecFast).toBeLessThan(stride.targetSecFast);
  });
});

describe("目標に紐づかないこと", () => {
  /*
   * ここが元の不具合の本体。
   * 目標タイムを書き換えただけで流しが速くなるのは、根拠の無い変化。
   */
  it("目標800mを速くしても流しは変わらない", () => {
    const a = neuralPace(150, "stride", { pb400mSec: PB400, fallbackBase800Sec: 108.9 });
    const b = neuralPace(150, "stride", { pb400mSec: PB400, fallbackBase800Sec: 105.0 });
    expect(a.targetSecFast).toBe(b.targetSecFast);
    expect(a.targetSecSlow).toBe(b.targetSecSlow);
  });

  it("400mPBが速くなれば流しも速くなる（こちらには紐づく）", () => {
    const slow = neuralPace(150, "stride", { pb400mSec: 52, fallbackBase800Sec: TARGET800 });
    const fast = neuralPace(150, "stride", { pb400mSec: 49, fallbackBase800Sec: TARGET800 });
    expect(fast.targetSecFast).toBeLessThan(slow.targetSecFast);
  });
});

describe("400mPBが無いとき", () => {
  it("これまでどおり目標800m基準に落ちる", () => {
    const fallback = neuralPace(150, "stride", { fallbackBase800Sec: TARGET800 });
    const before = specificPace(TARGET800, "neural", 150);
    expect(fallback.targetSecFast).toBeCloseTo(before.targetSecFast, 5);
    expect(fallback.targetSecSlow).toBeCloseTo(before.targetSecSlow, 5);
  });

  it("推定であることを立てる（画面で断れるように）", () => {
    expect(neuralPace(150, "stride", { fallbackBase800Sec: TARGET800 }).isEstimated).toBe(true);
  });

  it("0以下のPBは無いものとして扱う", () => {
    const p = neuralPace(150, "stride", { pb400mSec: 0, fallbackBase800Sec: TARGET800 });
    expect(p.isEstimated).toBe(true);
  });

  it("400mPBがあるときは推定にしない", () => {
    expect(neuralPace(150, "stride", opts).isEstimated).toBeUndefined();
  });
});
