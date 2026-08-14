/**
 * 環境条件。風と雨を「どこまで効かせるか」を固定する。
 *
 * 入力欄は前からあったが、効く範囲が決まっていなかった。
 * 決めたのは次のとおり。
 *
 *   ・注意書き（`environmentNote`）には効く
 *   ・**暑熱条件フラグには効かせない**——その練習を能力推定から外すかどうかは、
 *     気温と湿度から出すWBGTだけで決める
 *
 * 効かせないのは根拠が無いから。風雨は「体感が下がるので外すべきでない」方向にも、
 * 「条件が悪いので外すべき」方向にも効きうる。どちらか決められないまま係数を置くと、
 * その数字がどこから来たのか説明できなくなる。
 *
 * このテストは**決めたことを固定するためのもの**。
 * あとで根拠が出て風雨を判定に入れるなら、ここが落ちる。
 * そのときは画面の文言（結果入力の「風雨は入れていません」）も一緒に直すこと。
 */
import { describe, expect, it } from "vitest";
import { evaluateEnvironment, environmentNote } from "@/lib/core/environment";

describe("暑熱条件フラグ", () => {
  it("気温と湿度で決まる", () => {
    const hot = evaluateEnvironment({ tempC: 32, humidityPct: 70 });
    expect(hot?.isHeatFlagged).toBe(true);
    const mild = evaluateEnvironment({ tempC: 18, humidityPct: 50 });
    expect(mild?.isHeatFlagged).toBe(false);
  });

  it("風や雨では変わらない（意図的に入れていない）", () => {
    const base = { tempC: 26, humidityPct: 60 };
    const plain = evaluateEnvironment(base);
    for (const extra of [
      { wind: "strong" as const },
      { wind: "calm" as const },
      { rain: true },
      { wind: "strong" as const, rain: true },
    ]) {
      const withWeather = evaluateEnvironment({ ...base, ...extra });
      expect(withWeather?.isHeatFlagged, JSON.stringify(extra)).toBe(plain?.isHeatFlagged);
      expect(withWeather?.wbgt, JSON.stringify(extra)).toBe(plain?.wbgt);
      expect(withWeather?.level, JSON.stringify(extra)).toBe(plain?.level);
    }
  });

  it("気温が無ければ何も判定しない（推測で埋めない）", () => {
    expect(evaluateEnvironment({ humidityPct: 80, wind: "strong", rain: true })).toBeUndefined();
  });
});

describe("注意書き", () => {
  it("強風と雨はここに出る（達成度を読むときの材料）", () => {
    const notes = environmentNote({ tempC: 18, humidityPct: 50, wind: "strong", rain: true });
    expect(notes.some((n) => n.includes("強風"))).toBe(true);
    expect(notes.some((n) => n.includes("雨"))).toBe(true);
  });

  it("穏やかなら何も言わない（毎回出ると読まれなくなる）", () => {
    expect(environmentNote({ tempC: 18, humidityPct: 50, wind: "calm" })).toEqual([]);
  });

  it("暑熱のときは、外す理由も一緒に出る", () => {
    const notes = environmentNote({ tempC: 33, humidityPct: 75 });
    expect(notes.join("")).toContain("能力推定から除外");
  });
});
