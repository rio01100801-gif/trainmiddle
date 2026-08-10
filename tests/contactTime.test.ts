/**
 * M-10 接地時間の疲労指標化。
 *
 * FIT取込は `SessionResult.avgGroundContactTimeMs` を保存しているのに、
 * 判定側はCSV取り込み専用のKVしか見ておらず、アプリの中にある値が使われずに
 * 「時計から書き出してください」と案内されていた。記録から材料を作る経路を確かめる。
 */
import { describe, expect, it } from "vitest";
import { contactSamplesFromResults } from "@/lib/core/contactTime";
import type { SessionResult } from "@/lib/core/types";
import { contactTimeStatus, importContactSamples } from "@/lib/service";
import { memRepo } from "./sqlite-helper";
import { makeSession, makeResult } from "./helpers";

function result(overrides: Partial<SessionResult> & { id: string; date: string }): SessionResult {
  return {
    sessionId: `s-${overrides.id}`,
    actualLapsSec: [],
    achievement: "achieved",
    rpe: 7,
    subjective: "moderate",
    ...overrides,
  };
}

describe("contactSamplesFromResults", () => {
  it("持続走は平均ペースを一緒に持たせる", () => {
    const samples = contactSamplesFromResults([
      result({
        id: "a",
        date: "2026-07-01",
        avgGroundContactTimeMs: 244,
        continuous: { distanceKm: 10, durationMin: 50, avgPaceSecPerKm: 300 },
      }),
    ]);
    expect(samples).toEqual([
      { date: "2026-07-01", contactMs: 244, paceSecPerKm: 300, source: "時計の記録" },
    ]);
  });

  /*
   * ペースを持たせるのが要点。この指標は同じペース帯どうしでしか比べられず、
   * ジョグとインターバルの接地時間を混ぜて平均を取っても何も分からない。
   */
  it("インターバルは疾走部分の合計から1kmあたりのペースを出す", () => {
    const samples = contactSamplesFromResults([
      result({
        id: "b",
        date: "2026-07-02",
        avgGroundContactTimeMs: 156,
        interval: {
          reps: 2,
          distanceM: 400,
          results: [
            { index: 1, distanceM: 400, actualSec: 60 },
            { index: 2, distanceM: 400, actualSec: 62 },
          ],
        },
      }),
    ]);
    // 800m を 122秒 → 152.5秒/km
    expect(samples).toHaveLength(1);
    expect(samples[0].paceSecPerKm).toBeCloseTo(152.5, 1);
    expect(samples[0].contactMs).toBe(156);
  });

  it("接地時間が入っていない記録は材料にしない（推測で埋めない）", () => {
    const samples = contactSamplesFromResults([
      result({ id: "c", date: "2026-07-03" }),
      result({
        id: "d",
        date: "2026-07-04",
        avgGroundContactTimeMs: 240,
        continuous: { distanceKm: 8, durationMin: 40, avgPaceSecPerKm: 300 },
      }),
    ]);
    expect(samples.map((s) => s.date)).toEqual(["2026-07-04"]);
  });

  it("ペースが読めない場合でも接地時間だけは材料にする（帯揃えは判定側が諦める）", () => {
    const samples = contactSamplesFromResults([
      result({ id: "e", date: "2026-07-05", avgGroundContactTimeMs: 250 }),
    ]);
    expect(samples).toHaveLength(1);
    expect(samples[0].paceSecPerKm).toBeUndefined();
  });

  it("日付の古い順に並べて返す", () => {
    const samples = contactSamplesFromResults([
      result({ id: "f", date: "2026-07-10", avgGroundContactTimeMs: 240 }),
      result({ id: "g", date: "2026-07-02", avgGroundContactTimeMs: 241 }),
    ]);
    expect(samples.map((s) => s.date)).toEqual(["2026-07-02", "2026-07-10"]);
  });
});

/**
 * サービス層まで通す。FIT取込の記録が、CSVを書き出さなくても
 * そのまま接地時間の判定に届くこと。
 */
describe("contactTimeStatus（記録からの材料）", () => {
  function repoWithGct(contactMs: number[], startDate = "2026-06-01") {
    const repo = memRepo();
    contactMs.forEach((ms, i) => {
      const date = new Date(new Date(startDate).getTime() + i * 3 * 86400000)
        .toISOString()
        .slice(0, 10);
      const s = makeSession(date, "aerobic", { id: `s-gct-${i}`, status: "completed" });
      repo.saveSession(s);
      repo.saveResult(
        makeResult(s, {
          id: `r-gct-${i}`,
          avgGroundContactTimeMs: ms,
          continuous: { distanceKm: 10, durationMin: 50, avgPaceSecPerKm: 300 },
        })
      );
    });
    return repo;
  }

  it("CSVを入れていなくても、記録の接地時間だけで判定が動く", () => {
    // 6件（判定に必要な最小件数）
    const repo = repoWithGct([240, 241, 239, 240, 242, 241]);
    const out = contactTimeStatus(repo, "2026-06-20");
    expect(out.sampleCount).toBe(6);
    expect(out.narrative).not.toContain("接地時間のデータがありません");
  });

  it("疲労で伸びていれば拾う", () => {
    // 基準240ms前後 → 直近が+5%以上（253ms〜）で3日続く
    const repo = repoWithGct([240, 240, 241, 255, 256, 257]);
    const out = contactTimeStatus(repo, "2026-06-17");
    expect(out.fatigued).toBe(true);
  });

  it("同じ日・同じ値がCSVと記録の両方にあっても二重に数えない", () => {
    const repo = repoWithGct([240, 241, 239, 240, 242, 241]);
    // 記録と同じ日付・同じ値をCSV側にも入れる
    importContactSamples(repo, [
      { date: "2026-06-01", contactMs: 240, paceSecPerKm: 300, source: "CSV取り込み" },
    ]);
    expect(contactTimeStatus(repo, "2026-06-20").sampleCount).toBe(6);
  });
});
