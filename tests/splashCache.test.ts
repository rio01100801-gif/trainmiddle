/**
 * R-2 ロード画面に出す値
 *
 * 文字列の組み立てはここでやる。index.html 側はDOMに入れるだけにして、
 * テストできない場所にロジックを置かない。
 */
import { describe, expect, it } from "vitest";
import { buildSplashSummary } from "../app/components/splash-cache";

describe("ロード画面の1行", () => {
  it("レースと目標があれば、目標までの距離を出す", () => {
    const s = buildSplashSummary({
      targetRace: { dateStart: "2026-09-20" },
      goal: { targetTimeSec: 108.9 },
      cfe: { estimated800mSec: 114.6 },
    });
    expect(s.raceDate).toBe("2026-09-20");
    expect(s.gapText).toBe("目標 1:48.90 まで −5.7秒");
  });

  it("目標に届いていれば到達と書く（マイナス表記のままにしない）", () => {
    const s = buildSplashSummary({
      targetRace: { dateStart: "2026-09-20" },
      goal: { targetTimeSec: 108.9 },
      cfe: { estimated800mSec: 108.2 },
    });
    expect(s.gapText).toContain("到達");
  });

  it("目標が無ければ現在地を代わりに出す", () => {
    const s = buildSplashSummary({ cfe: { estimated800mSec: 114.6 } });
    expect(s.gapText).toBeUndefined();
    expect(s.fallbackText).toBe("現在地 1:54.60（推定800m）");
  });

  it("初回起動（何も無い）でも落ちない。出す値が無いだけ", () => {
    const s = buildSplashSummary({});
    expect(s.raceDate).toBeUndefined();
    expect(s.gapText).toBeUndefined();
    expect(s.fallbackText).toBeUndefined();
  });

  it("レースだけあって目標が無くても、日数は出せる形で返す", () => {
    const s = buildSplashSummary({ targetRace: { dateStart: "2026-09-20" } });
    expect(s.raceDate).toBe("2026-09-20");
  });
});
