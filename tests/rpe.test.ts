/**
 * RPEの段階と説明。
 *
 * 画面をスライダーにしたが、**保存する値は数値のまま**（1〜10の整数）。
 * 判定・設定ペースの補正（`RPE_ADJUST_SEC_PER_POINT`）・CFEはすべて数値を見ている。
 * ここは「見せ方の表が数値と食い違っていないか」を見る。
 */
import { describe, expect, it } from "vitest";
import {
  PAIN_MAX,
  PAIN_MIN,
  RPE_BAND_COLORS,
  RPE_BAND_LABELS,
  RPE_LEVELS,
  RPE_MAX,
  RPE_MIN,
  isValidRpe,
  painBand,
  painDescription,
  painValueText,
  rpeLevel,
  rpeValueText,
} from "@/lib/core/rpe";

describe("段階の表", () => {
  it("1〜10が抜けなく1つずつある", () => {
    expect(RPE_LEVELS).toHaveLength(10);
    expect(RPE_LEVELS.map((l) => l.value)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(RPE_MIN).toBe(1);
    expect(RPE_MAX).toBe(10);
  });

  it("全部に説明がある（空欄で出さない）", () => {
    for (const l of RPE_LEVELS) {
      expect(l.description.length, `RPE ${l.value}`).toBeGreaterThan(5);
    }
  });

  it("帯の割り当てが指定どおり", () => {
    const band = (v: number) => rpeLevel(v)!.band;
    // 1〜3 青 / 4〜5 緑 / 6〜7 黄 / 8〜9 橙 / 10 赤
    expect([1, 2, 3].map(band)).toEqual(["low", "low", "low"]);
    expect([4, 5].map(band)).toEqual(["moderate", "moderate"]);
    expect([6, 7].map(band)).toEqual(["hard", "hard"]);
    expect([8, 9].map(band)).toEqual(["very_hard", "very_hard"]);
    expect(band(10)).toBe("max");
  });

  it("帯は上がる方向にしか変わらない（途中で戻らない）", () => {
    const order = ["low", "moderate", "hard", "very_hard", "max"];
    let last = -1;
    for (const l of RPE_LEVELS) {
      const rank = order.indexOf(l.band);
      expect(rank, `RPE ${l.value}`).toBeGreaterThanOrEqual(last);
      last = rank;
    }
  });

  it("全部の帯に呼び名と色がある（色だけに頼らないため）", () => {
    for (const l of RPE_LEVELS) {
      expect(RPE_BAND_LABELS[l.band]).toBeTruthy();
      expect(RPE_BAND_COLORS[l.band]).toMatch(/^var\(--/);
    }
  });

  it("色は既存のトークンだけを使う（新しい色を増やさない）", () => {
    const known = [
      "var(--cat-race-economy)",
      "var(--cat-cv)",
      "var(--amber)",
      "var(--cat-high-lactate)",
      "var(--red)",
    ];
    for (const c of Object.values(RPE_BAND_COLORS)) {
      expect(known).toContain(c);
    }
  });
});

describe("値の検証", () => {
  it("1〜10の整数だけを通す", () => {
    for (let v = 1; v <= 10; v++) expect(isValidRpe(v)).toBe(true);
  });

  it("範囲外・小数・空・文字列は弾く", () => {
    for (const bad of [0, 11, 77, -1, 7.5, NaN, Infinity, "", "7", null, undefined, {}]) {
      expect(isValidRpe(bad), String(bad)).toBe(false);
    }
  });

  it("境界のちょうど内と外", () => {
    expect(isValidRpe(1)).toBe(true);
    expect(isValidRpe(10)).toBe(true);
    expect(isValidRpe(0)).toBe(false);
    expect(isValidRpe(11)).toBe(false);
  });
});

describe("読み上げ", () => {
  it("数字と言葉の両方を読ませる", () => {
    const text = rpeValueText(7);
    expect(text).toContain("7");
    expect(text).toContain("きつい");
    expect(text).toContain("余力は少ない");
  });

  it("範囲外は数字だけ返して落ちない", () => {
    expect(rpeValueText(99)).toBe("99");
  });
});

describe("痛みの強さ（0〜10・RPEとは別物）", () => {
  it("0から始まる", () => {
    expect(PAIN_MIN).toBe(0);
    expect(PAIN_MAX).toBe(10);
    expect(painDescription(0)).toBe("痛みなし");
  });

  it("0〜10のどこでも説明が出る", () => {
    for (let v = 0; v <= 10; v++) {
      expect(painDescription(v).length, `痛み ${v}`).toBeGreaterThan(3);
      expect(RPE_BAND_LABELS[painBand(v)]).toBeTruthy();
    }
  });

  it("強くなる方向にしか帯が変わらない", () => {
    const order = ["low", "moderate", "hard", "very_hard", "max"];
    let last = -1;
    for (let v = 0; v <= 10; v++) {
      const rank = order.indexOf(painBand(v));
      expect(rank, `痛み ${v}`).toBeGreaterThanOrEqual(last);
      last = rank;
    }
  });

  it("読み上げに数字と説明が入る", () => {
    expect(painValueText(0)).toContain("痛みなし");
    expect(painValueText(9)).toContain("9");
  });
});
