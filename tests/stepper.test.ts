/**
 * ＋／− を押したあとの値。
 *
 * `2.3 - 0.1` が `2.1999999999999997` になり、入力欄に `2.19999` と出ていた。
 * **表示だけ丸めると保存される値と食い違う**ので、値そのものを丸める。
 */
import { describe, expect, it } from "vitest";
import { stepperNext } from "@/lib/core/inputFormat";

describe("刻みの桁で丸める", () => {
  it("0.1刻みで減らしても桁が増えない", () => {
    expect(stepperNext(2.3, -0.1, 0, 9999, 0.1)).toBe(2.2);
  });

  it("0.1刻みで増やしても桁が増えない", () => {
    expect(stepperNext(0.7, 0.1, 0, 9999, 0.1)).toBe(0.8);
  });

  it("何回押しても桁が増えない", () => {
    let v = 3;
    for (let i = 0; i < 12; i++) v = stepperNext(v, -0.1, 0, 9999, 0.1);
    expect(v).toBe(1.8);
    expect(String(v).length).toBeLessThan(5);
  });

  it("整数刻みはそのまま", () => {
    expect(stepperNext(5, 1, 0, 9999, 1)).toBe(6);
    expect(stepperNext(5, -1, 0, 9999, 1)).toBe(4);
  });

  it("50刻みもそのまま", () => {
    expect(stepperNext(3000, 50, 0, 20000, 50)).toBe(3050);
  });

  it("下限より下に行かない", () => {
    expect(stepperNext(0.05, -0.1, 0, 9999, 0.1)).toBe(0);
  });

  it("上限より上に行かない", () => {
    expect(stepperNext(9998.95, 0.1, 0, 9999, 0.1)).toBe(9999);
  });
});
