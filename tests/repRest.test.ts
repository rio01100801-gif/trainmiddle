/**
 * S-2 / S-4 入力まわり
 *
 * S-2: 距離・時間・平均ペースはどれか2つで足りる
 * S-4: レストが本ごとに違うメニュー（300+600+300）を記録できる
 */
import { describe, expect, it } from "vitest";
import { completeRunTriple } from "@/lib/core/inputFormat";
import { buildRepResults, perRepRestNote, summarizeResult } from "@/lib/core/workoutLog";
import type { IntervalDetail, SessionResult } from "@/lib/core/types";

describe("S-2 3値のうち2つで足りる", () => {
  it("時間と平均ペースから距離が出る", () => {
    const out = completeRunTriple({ durationSec: 55 * 60, paceSecPerKm: 300 });
    expect(out.distanceKm).toBe(11);
    expect(out.derived).toBe("distanceKm");
  });

  it("距離と平均ペースから時間が出る", () => {
    const out = completeRunTriple({ distanceKm: 10, paceSecPerKm: 270 });
    expect(out.durationSec).toBe(2700);
    expect(out.derived).toBe("durationSec");
  });

  it("距離と時間から平均ペースが出る（従来の向き）", () => {
    const out = completeRunTriple({ distanceKm: 10, durationSec: 2700 });
    expect(out.paceSecPerKm).toBe(270);
    expect(out.derived).toBe("paceSecPerKm");
  });

  it("3つとも入っていて食い違えば、直さずに知らせる", () => {
    const out = completeRunTriple({ distanceKm: 10, durationSec: 2700, paceSecPerKm: 200 });
    expect(out.mismatch).toBeTruthy();
    // 勝手に上書きしない
    expect(out.paceSecPerKm).toBe(200);
    expect(out.distanceKm).toBe(10);
  });

  it("1つしか無ければ何も補わない", () => {
    const out = completeRunTriple({ distanceKm: 10 });
    expect(out.durationSec).toBeUndefined();
    expect(out.paceSecPerKm).toBeUndefined();
    expect(out.derived).toBeUndefined();
  });
});

describe("S-4 本ごとのレスト", () => {
  it("入れた本にだけ付く", () => {
    const out = buildRepResults(300, [42, 86, 43], 41.5, [], [300, 600, 300], [360, 600, undefined]);
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ distanceM: 300, restAfterSec: 360 });
    expect(out[1]).toMatchObject({ distanceM: 600, restAfterSec: 600 });
    expect(out[2].restAfterSec).toBeUndefined();
  });

  it("実施タイムが空の本があってもレストがずれない", () => {
    const out = buildRepResults(300, [42, 0, 43], undefined, [], [], [360, 600, undefined]);
    expect(out).toHaveLength(2);
    expect(out[0].restAfterSec).toBe(360);
    // 2本目（空）を飛ばして3本目のレストが来る
    expect(out[1].restAfterSec).toBeUndefined();
  });

  it("何も渡さなければ今までどおり（任意項目であること）", () => {
    const out = buildRepResults(300, [42, 42.5], 41.5);
    expect(out[0].restAfterSec).toBeUndefined();
    expect(out[0].distanceM).toBe(300);
    expect("restAfterSec" in out[0]).toBe(false);
  });

  it("区間ごとの距離が違ってもそのまま残る", () => {
    const out = buildRepResults(300, [42, 86, 86], undefined, [], [300, 600, 600]);
    expect(out.map((x) => x.distanceM)).toEqual([300, 600, 600]);
  });
});

describe("S-4 表示", () => {
  const detail = (rests: (number | undefined)[]): IntervalDetail => ({
    reps: 3,
    distanceM: 300,
    restSec: 360,
    results: buildRepResults(300, [42, 86, 43], undefined, [], [300, 600, 300], rests),
  });

  it("本ごとに違うときだけ並べて出す", () => {
    expect(perRepRestNote(detail([360, 600, undefined]))).toContain("6'");
    expect(perRepRestNote(detail([360, 600, undefined]))).toContain("10'");
  });

  it("全部同じなら出さない（セッション共通のレストで足りる）", () => {
    expect(perRepRestNote(detail([360, 360, 360]))).toBeUndefined();
  });

  it("1本も入っていなければ出さない", () => {
    expect(perRepRestNote(detail([undefined, undefined, undefined]))).toBeUndefined();
  });

  it("一覧のサマリーに出る（書きっぱなしにしない）", () => {
    const r = {
      id: "r1",
      sessionId: "s1",
      date: "2026-07-27",
      actualLapsSec: [42, 86, 43],
      interval: detail([360, 600, undefined]),
      achievement: "achieved",
      rpe: 8,
      subjective: "hard",
    } as SessionResult;
    expect(summarizeResult(r)).toContain("レスト");
  });
});
