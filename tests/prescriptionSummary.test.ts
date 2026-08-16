/**
 * カレンダーの1行に出す、処方の短い形。
 *
 * これまでは原文をCSSで切っていた。生成される原文は
 * `300m × 5 @300m 41.2〜41.6秒 r5分（ジョグ）` の形なので、
 * **文字数で切ると一番見たい設定タイムが真っ先に消える**。
 *
 * ここで一番大事なのは2つ。
 *   1. `describeSpec`（原文を組む側）の実物を通して確かめること。
 *      形が変わったら黙って劣化するので、文字列を手で書いたテストにしない
 *   2. **読めなければ返さない**こと。中途半端に組み立てた文字列を出すと、
 *      原文と食い違っていても気づけない。返さなければ呼ぶ側が原文を出す
 */
import { describe, expect, it } from "vitest";
import { shortPrescription } from "@/lib/core/prescriptionSummary";
import { describeSpec } from "@/lib/core/progression";
import type { TargetPace } from "@/lib/core/types";

const pace = (distanceM: number, fast: number, slow: number): TargetPace => ({
  distanceM,
  targetSecFast: fast,
  targetSecSlow: slow,
});

describe("生成された処方をそのまま通す", () => {
  it("単一区間: 距離×本数と設定が残り、レストは落ちる", () => {
    const text = describeSpec([{ distanceM: 300, reps: 5 }], 300, "jog", [pace(300, 41.2, 41.6)]);
    const short = shortPrescription(text);
    expect(short).toContain("300m");
    expect(short).toContain("5");
    // ここが本題。原文を頭から切ると消えていた
    expect(short).toContain("41.2〜41.6");
    expect(short).not.toContain("r5分");
    expect(short!.length).toBeLessThan(text.length);
  });

  it("複合: 区間ごとの設定が残り、レストは落ちる", () => {
    const text = describeSpec(
      [
        { distanceM: 500, reps: 1 },
        { distanceM: 300, reps: 1 },
      ],
      60,
      "walk",
      [pace(500, 68.7, 69.4), pace(300, 41.2, 41.6)]
    );
    const short = shortPrescription(text);
    expect(short).toContain("500m");
    expect(short).toContain("300m");
    expect(short).toContain("68.7");
    expect(short).not.toContain("r1分");
  });

  it("推定値の注記は落とす（行が狭いので数字を優先する）", () => {
    const text = describeSpec([{ distanceM: 300, reps: 5 }], 300, "jog", [
      { ...pace(300, 41.2, 41.6), isEstimated: true },
    ]);
    expect(shortPrescription(text)).not.toContain("推定");
  });

  it("必ず原文より短い", () => {
    for (const blocks of [
      [{ distanceM: 1000, reps: 4 }],
      [{ distanceM: 200, reps: 8 }],
    ]) {
      const text = describeSpec(blocks, 300, "jog", [pace(blocks[0].distanceM, 41.2, 41.6)]);
      expect(shortPrescription(text)!.length).toBeLessThan(text.length);
    }
  });
});

describe("読めなければ返さない", () => {
  it("空なら返さない", () => {
    expect(shortPrescription("")).toBeUndefined();
    expect(shortPrescription("   ")).toBeUndefined();
  });

  it("設定タイムの形が無ければ返さない（原文を出させる）", () => {
    expect(shortPrescription("ジョグ 60分")).toBeUndefined();
    expect(shortPrescription("休養")).toBeUndefined();
  });

  it("推測で数字を作らない", () => {
    expect(shortPrescription("流し 速めに")).toBeUndefined();
  });
});

describe("同じ入力からは同じ結果", () => {
  it("何度呼んでも変わらない", () => {
    const text = describeSpec([{ distanceM: 300, reps: 5 }], 300, "jog", [pace(300, 41.2, 41.6)]);
    expect(shortPrescription(text)).toBe(shortPrescription(text));
  });
});

describe("ジョグ・持続走", () => {
  it("1kmあたりのペースを落とさない", () => {
    /*
     * ここは一度落とした。秒の形（41.2〜41.6秒）だけを見ていたので、
     * ジョグ行から設定ペースがまるごと消えた。
     * ジョグは本数より**ペースのほうが本体**なので、これは実害がある。
     */
    const short = shortPrescription("40分有酸素ジョグ @5:05/km〜5:25/km（会話可能な呼吸・RPE 3）");
    expect(short).toContain("5:05");
    expect(short).toContain("5:25");
    expect(short).toContain("/km");
    expect(short).not.toContain("RPE");
  });

  it("片側だけのペースも拾う", () => {
    expect(shortPrescription("60分ジョグ @5:15/km")).toContain("5:15/km");
  });
});
