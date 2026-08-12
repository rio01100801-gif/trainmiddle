/**
 * 2部の午前枠についての助言。
 *
 * 自動では変えない。噛み合っていないときだけ一言出す。
 * いちばん大事なのは**毎回は出さない**こと——常に何か出ていると、
 * 本当に噛み合っていないときに気づけなくなる。
 */
import { describe, expect, it } from "vitest";
import { amSlotAdvice } from "@/lib/core/amSlotAdvice";
import { testAthlete } from "./helpers";
import type { Athlete } from "@/lib/core/types";
import type { WeekTemplate } from "@/lib/core/weekTemplate";

/** 400mが速い＝スピードは足りていて維持が制限（endurance）になりやすい形 */
const enduranceLimited: Athlete = { ...testAthlete(), pb800mSec: 109.51, pb400mSec: 48.0 };
/** 400mが遅い＝スピードが制限（speed）になりやすい形 */
const speedLimited: Athlete = { ...testAthlete(), pb800mSec: 109.51, pb400mSec: 53.5 };

const withAm = (am: WeekTemplate["amSlots"]): WeekTemplate => ({
  enabled: true,
  slots: { 2: "point", 5: "point" },
  modes: { 2: "fixed", 5: "fixed" },
  amSlots: am,
});

describe("出さない場合", () => {
  it("2部にしていなければ何も言わない", () => {
    expect(amSlotAdvice(speedLimited, withAm({}))).toHaveLength(0);
  });

  it("曜日設定が無効なら何も言わない", () => {
    const t = { ...withAm({ 2: "aerobic" }), enabled: false };
    expect(amSlotAdvice(speedLimited, t)).toHaveLength(0);
  });

  it("選手が未登録なら何も言わない", () => {
    expect(amSlotAdvice(undefined, withAm({ 2: "aerobic" }))).toHaveLength(0);
  });

  it("PBが足りず制限因子を判定できないときは黙る（推測で言わない）", () => {
    const noPb: Athlete = { ...testAthlete(), pb800mSec: 109.51 };
    delete (noPb as any).pb400mSec;
    delete (noPb as any).pb1500mSec;
    expect(amSlotAdvice(noPb, withAm({ 2: "aerobic" }))).toHaveLength(0);
  });

  it("既に流しが入っていれば言わない（言うことが無い）", () => {
    expect(amSlotAdvice(speedLimited, withAm({ 2: "aerobic", 5: "neural" }))).toHaveLength(0);
  });

  it("維持が制限のときは午前に足せるものが無いので言わない", () => {
    // 増やしたい側（経済走・モデリング）は高負荷なので午前には置けない
    expect(amSlotAdvice(enduranceLimited, withAm({ 2: "aerobic", 5: "aerobic" }))).toHaveLength(0);
  });
});

describe("出す場合", () => {
  const advice = amSlotAdvice(speedLimited, withAm({ 2: "aerobic", 5: "aerobic" }));

  it("スピードが制限で午前が全部ジョグなら、流しを勧める", () => {
    expect(advice).toHaveLength(1);
    expect(advice[0].message).toContain("流し");
  });

  it("今の設定を具体的に示す（どの曜日が何か）", () => {
    expect(advice[0].message).toContain("火");
    expect(advice[0].message).toContain("金");
  });

  it("断定しない（可能性として言う）", () => {
    expect(advice[0].message).toContain("可能性");
  });

  it("根拠を必ず添える（あとで判断を疑えるように）", () => {
    expect(advice[0].basis.length).toBeGreaterThan(0);
  });

  it("同じ入力からは同じ結果（LLMを使っていない）", () => {
    const a = amSlotAdvice(speedLimited, withAm({ 2: "aerobic", 5: "aerobic" }));
    const b = amSlotAdvice(speedLimited, withAm({ 2: "aerobic", 5: "aerobic" }));
    expect(a).toEqual(b);
  });
});
