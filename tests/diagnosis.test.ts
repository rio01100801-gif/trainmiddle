import { describe, it, expect } from "vitest";
import {
  speedReservePct,
  conversionDiffSec,
  diff8001500Sec,
  requiredSpeedReservePct,
  diagnose,
} from "@/lib/core/diagnosis";
import { testAthlete } from "./helpers";

describe("4-1 選手タイプ判定", () => {
  it("速度予備率: 仕様書の例 1:49.51 / 49.0 → 111.8%", () => {
    expect(speedReservePct(109.51, 49.0)).toBeCloseTo(111.75, 1);
  });

  it("換算差: 仕様書の例 109.51 − 98.0 = 11.5秒", () => {
    expect(conversionDiffSec(109.51, 49.0)).toBeCloseTo(11.51, 2);
  });

  it("800m→1500m差: 仕様書の例 236 − 219.02 = 17.0秒", () => {
    expect(diff8001500Sec(109.51, 236.0)).toBeCloseTo(16.98, 2);
  });

  it("必要速度予備率の逆算: 目標1:48.0 → 110.2%", () => {
    expect(requiredSpeedReservePct(108.0, 49.0)).toBeCloseTo(110.2, 1);
  });

  it("伊藤選手プロフィールの診断: スピード資源を活かしきれていない型", () => {
    const d = diagnose(testAthlete(), 108.0);
    expect(d.speedReservePct).toBeCloseTo(111.75, 1);
    expect(d.athleteType).toBe("lactate_tolerant");
    expect(d.requiredSpeedReservePct).toBeCloseTo(110.2, 1);
    // 必要予備率 < 現状予備率 → 経済性・特異的持久力が必要という診断文
    expect(d.narrative).toContain("経済性・特異的持久力");
  });

  it("純スプリンター型の判定", () => {
    // 400m 47.0 / 800m 112.0 → 予備率119%, 換算差18秒
    const d = diagnose(
      testAthlete({ pb400mSec: 47.0, pb800mSec: 112.0, pb1500mSec: 245.0 })
    );
    expect(d.athleteType).toBe("speed");
    expect(d.primaryGap).toBe("後半維持");
  });

  it("持久型の判定", () => {
    // 400m 52.5 / 800m 110.0 → 予備率104.8%, 換算差5秒
    const d = diagnose(
      testAthlete({ pb400mSec: 52.5, pb800mSec: 110.0, pb1500mSec: 228.0 })
    );
    expect(d.athleteType).toBe("endurance");
    expect(d.primaryGap).toBe("絶対スピード");
  });

  it("400mPBが無い場合も1500mだけで診断できる", () => {
    const d = diagnose(
      testAthlete({ pb400mSec: undefined, pb1500mSec: 240.0 })
    );
    expect(d.speedReservePct).toBeUndefined();
    expect(d.athleteType).toBeDefined();
  });
});
