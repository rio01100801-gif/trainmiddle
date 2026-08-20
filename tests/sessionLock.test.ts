import { describe, it, expect } from "vitest";
import { isContentLocked, isSlotFixed } from "@/lib/core/sessionLock";

/*
 * `isFixed` は2つの意味を兼ねていた。
 *   1. チーム練習など、本人が登録した動かせない予定（RULE-15）
 *   2. 曜日設定・周期設定で「この曜日はポイント」と決めた枠
 *
 * 2を1と同じに扱っていたので、火・土をポイントに固定すると
 * その2日が設定ペースの調整からも進め方の2案からも外れ、
 * **調整できるポイント練習が1本も無い週**ができていた。
 */

describe("中身を変えてよいかの判定", () => {
  it("固定でない枠は当然変えられる", () => {
    expect(isContentLocked({ isFixed: false, origin: "generated" })).toBe(false);
  });

  it("曜日設定で置いた枠は、日付が固定なだけで中身は変えられる", () => {
    expect(
      isContentLocked({ isFixed: true, origin: "generated", fixedSource: "火曜の固定設定" })
    ).toBe(false);
  });

  it("周期設定で置いた枠も同じ", () => {
    expect(
      isContentLocked({ isFixed: true, origin: "generated", fixedSource: "周期3日目の固定設定" })
    ).toBe(false);
  });

  it("本人が登録したチーム練習は中身も変えられない", () => {
    expect(
      isContentLocked({ isFixed: true, origin: "manual", fixedSource: "チーム練習" })
    ).toBe(true);
  });

  it("生成された枠でも、出どころが設定でなければ本人のものとして扱う", () => {
    // 生成枠を本人がチーム練習に印を付け替えた場合。勝手に組み替えない
    expect(
      isContentLocked({ isFixed: true, origin: "generated", fixedSource: "チーム練習" })
    ).toBe(true);
  });

  it("出どころが無ければ本人のものとして扱う（推測で開けない）", () => {
    expect(isContentLocked({ isFixed: true, origin: "generated" })).toBe(true);
  });
});

describe("設定で置いた枠かどうか", () => {
  it("生成でなければ設定枠ではない", () => {
    expect(isSlotFixed({ origin: "manual", fixedSource: "火曜の固定設定" })).toBe(false);
  });

  it("生成かつ出どころが設定なら設定枠", () => {
    expect(isSlotFixed({ origin: "generated", fixedSource: "土曜の固定設定" })).toBe(true);
  });
});
