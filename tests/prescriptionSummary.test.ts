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
import {
  isRedundantName,
  prescriptionParts,
  shortPrescription,
} from "@/lib/core/prescriptionSummary";
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

/**
 * 切ってよい部分と切ってはいけない部分に分ける。
 *
 * 画面は2段に組む。1段目「種目｜距離×本数」、2段目「設定｜レスト」。
 * **この3つを1本の文字列にして CSS で切らせない**のがこの関数の目的。
 * 1本にすると前から残るので、設定タイムが真っ先に消える。
 */
describe("切ってよい部分と切ってはいけない部分", () => {
  it("単一区間: 形・設定・レストが別々に取れる", () => {
    const text = describeSpec([{ distanceM: 400, reps: 3 }], 300, "jog", [pace(400, 52.7, 53.3)]);
    const p = prescriptionParts(text);
    expect(p.shape).toBe("400m×3");
    expect(p.target).toBe("52.7〜53.3秒");
    expect(p.rest).toBe("r5分");
  });

  it("形の中に空白を残さない（ここで折り返されたくない）", () => {
    const text = describeSpec([{ distanceM: 300, reps: 5 }], 300, "jog", [pace(300, 41.2, 41.6)]);
    expect(prescriptionParts(text).shape).not.toMatch(/\s/);
  });

  it("複合: 同じ距離が続いたらまとめる", () => {
    const text = describeSpec(
      [
        { distanceM: 300, reps: 1 },
        { distanceM: 600, reps: 2 },
      ],
      300,
      "jog",
      [pace(300, 42, 42.5), pace(600, 86, 87)]
    );
    const p = prescriptionParts(text);
    expect(p.shape).toBe("300m＋600m×2");
    // 区間ごとに設定が違うので両方出す
    expect(p.target).toContain("42.0〜42.5秒");
    expect(p.target).toContain("86.0〜87.0秒");
    expect(p.rest).toBe("r5分");
  });

  it("秒のレストも読む", () => {
    const text = describeSpec([{ distanceM: 200, reps: 6 }], 90, "jog", [pace(200, 26, 26.5)]);
    expect(prescriptionParts(text).rest).toBe("r90秒");
  });

  it("ジョグ: 時間を後ろに回し、カテゴリと重複する「有酸素」を落とす", () => {
    const p = prescriptionParts(
      "40分有酸素ジョグ @4:42/km〜5:02/km（会話可能な呼吸・RPE 3〜4を優先。暑熱時はペースを強制しない）"
    );
    expect(p.shape).toBe("ジョグ40分");
    expect(p.target).toBe("4:42〜5:02/km");
  });

  it("ジョグ: 狙いのRPEと暑さの扱いを結論だけ取る", () => {
    const p = prescriptionParts(
      "40分有酸素ジョグ @4:42/km〜5:02/km（会話可能な呼吸・RPE 3〜4を優先。暑熱時はペースを強制しない）"
    );
    expect(p.rpe).toBe("3〜4");
    expect(p.heatNote).toBe("暑熱時：感覚優先");
    // 原文も残す（奥で全部読める）
    expect(p.note).toContain("会話可能");
  });

  it("RPEが書かれていなければ作らない", () => {
    const p = prescriptionParts("40分有酸素ジョグ @4:42/km〜5:02/km（会話可能な呼吸を優先）");
    expect(p.rpe).toBeUndefined();
    expect(p.heatNote).toBeUndefined();
  });

  it("設定が無い処方でも形は出す（休養・固定枠）", () => {
    const p = prescriptionParts("チーム練習（内容は当日）");
    expect(p.shape).toBe("チーム練習");
    expect(p.target).toBeUndefined();
  });

  it("読めない複合は組み立てない（原文を出させる）", () => {
    const p = prescriptionParts("なんとか＋かんとか(適当) r5分");
    expect(p.shape).toBeUndefined();
  });

  it("空文字なら何も返さない", () => {
    expect(prescriptionParts("")).toEqual({});
  });
});

describe("重複する名称の省略", () => {
  it("カテゴリ名を含む名前は省く", () => {
    expect(isRedundantName("高乳酸セッション（300m）", "高乳酸")).toBe(true);
    expect(isRedundantName("CVインターバル", "CV")).toBe(true);
    expect(isRedundantName("レースペース経済走（600m）", "経済走")).toBe(true);
    expect(isRedundantName("モデリング（500m＋300m）", "モデリング")).toBe(true);
  });

  it("他に出ないところが無い名前は残す", () => {
    // 固定枠のチーム練習・自作メニュー。名前を落とすと何の練習か分からなくなる
    expect(isRedundantName("チーム練習", "高乳酸")).toBe(false);
    expect(isRedundantName("ジョグ", "有酸素")).toBe(false);
  });

  it("名前が無ければ省いたものとして扱う", () => {
    expect(isRedundantName(undefined, "高乳酸")).toBe(true);
    expect(isRedundantName("   ", "高乳酸")).toBe(true);
  });
});

describe("形は短いことを作りで保証する", () => {
  /*
   * 形（距離×本数・時間）は「絶対に切らない」場所なので、
   * **長くなりようがない**ことを関数の側で保証する必要がある。
   * ここが崩れると、切れない長い塊が行を横にはみ出させる
   * （実際に320px幅で32px超過した）。
   */
  it("途中の括弧を形に混ぜない", () => {
    const p = prescriptionParts("40分ジョグ （カレンダー反映テスト） @4:42/km〜5:02/km");
    expect(p.shape).toBe("ジョグ40分");
    expect(p.shape!.length).toBeLessThan(12);
  });

  it("呼び名が長ければ時間だけにする（名前は名前の欄に出る）", () => {
    const p = prescriptionParts("40分とても長い名前のメニュー @4:42/km〜5:02/km");
    expect(p.shape).toBe("40分");
  });

  it("半角の括弧も落とす", () => {
    expect(prescriptionParts("30分ジョグ (テスト) @5:00/km").shape).toBe("ジョグ30分");
  });

  it("インターバルの形も短い", () => {
    const text = describeSpec([{ distanceM: 1000, reps: 5 }], 300, "jog", [pace(1000, 170, 172)]);
    expect(prescriptionParts(text).shape!.length).toBeLessThan(12);
  });
});
