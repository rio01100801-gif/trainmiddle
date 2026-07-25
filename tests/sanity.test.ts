/**
 * 入力値の妥当性チェック
 *
 * ここで守るのは「読めてしまった間違い」を止めること。
 * 読めなかったものは画面に理由が出るので気づけるが、
 * 読めた間違いは素通しでCFEまで届く。
 */
import { describe, it, expect } from "vitest";
import { checkPastEntry, hasBlockingIssue } from "@/lib/core/sanity";
import { testAthlete } from "./helpers";
import type { PastEntry } from "@/lib/core/backfill";

const A = testAthlete(); // 800m 109.51 / 400m 49.0 / 1500m 236.0

function pe(over: Partial<PastEntry> & Pick<PastEntry, "kind">): PastEntry {
  return { id: "x", date: "2026-07-10", ...over } as PastEntry;
}

describe("インターバルの実施タイム", () => {
  it("正常な値は通る（300m×4を41秒台）", () => {
    const issues = checkPastEntry(
      pe({ kind: "interval", repDistanceM: 300, repTimesSec: [41.6, 41.8, 40.0, 41.8] }),
      A
    );
    expect(hasBlockingIssue(issues)).toBe(false);
  });

  it("40.0 を 4.00 と打ち間違えたら止める", () => {
    // これを通すと 800m換算が11秒になり、承認した瞬間にCFEが飛ぶ
    const issues = checkPastEntry(
      pe({ kind: "interval", repDistanceM: 300, repTimesSec: [41.6, 4.0, 41.8] }),
      A
    );
    expect(hasBlockingIssue(issues)).toBe(true);
    expect(issues[0].message).toContain("速すぎます");
  });

  it("単位を取り違えた遅すぎる値も止める", () => {
    const issues = checkPastEntry(
      pe({ kind: "interval", repDistanceM: 300, repTimesSec: [400] }),
      A
    );
    expect(hasBlockingIssue(issues)).toBe(true);
    expect(issues[0].message).toContain("遅すぎます");
  });

  it("300mを35秒は400mPB49.0なら現実的なので警告しない", () => {
    // 0.1167秒/m。400mPBの0.1225秒/mに対して比0.952。単独の300mならこの程度は出る
    expect(
      checkPastEntry(pe({ kind: "interval", repDistanceM: 300, repTimesSec: [35.0] }), A)
    ).toEqual([]);
  });

  it("400mPBから見て速すぎる値は警告する（止めはしない）", () => {
    // 300mを31秒 = 0.1033秒/m。400mPB 49.0（0.1225秒/m）の比0.843で、
    // 400mを41秒台で走れる計算になる。ありえないが、桁は合っているのでerrorにはしない
    const issues = checkPastEntry(
      pe({ kind: "interval", repDistanceM: 300, repTimesSec: [31.0] }),
      A
    );
    expect(hasBlockingIssue(issues)).toBe(false);
    expect(issues.some((i) => i.severity === "warn")).toBe(true);
  });

  it("100m単発のような短い区間にはPB比較を当てない", () => {
    const issues = checkPastEntry(
      pe({ kind: "interval", repDistanceM: 100, repTimesSec: [11.5] }),
      A
    );
    expect(issues).toEqual([]);
  });

  it("本数と実施タイムの数が合わなければ知らせる", () => {
    // パーサが「300mを4.00秒」のような値を落としたときに、
    // 落ちたこと自体はここでしか分からない
    const issues = checkPastEntry(
      pe({ kind: "interval", repDistanceM: 300, reps: 3, repTimesSec: [41.6, 41.8] }),
      A
    );
    expect(hasBlockingIssue(issues)).toBe(false);
    expect(issues.some((i) => i.message.includes("3本に対して実施タイムが2本"))).toBe(true);
  });

  it("数が合っていれば何も出さない", () => {
    expect(
      checkPastEntry(
        pe({ kind: "interval", repDistanceM: 300, reps: 2, repTimesSec: [41.6, 41.8] }),
        A
      )
    ).toEqual([]);
  });

  it("本数が異常に多い場合は別の数値を拾った疑いを出す", () => {
    const issues = checkPastEntry(
      pe({
        kind: "interval",
        repDistanceM: 300,
        repTimesSec: Array.from({ length: 40 }, () => 42),
      }),
      A
    );
    expect(issues.some((i) => i.message.includes("別の数値"))).toBe(true);
  });
});

describe("持続走", () => {
  it("正常なジョグは通る", () => {
    expect(
      checkPastEntry(pe({ kind: "continuous", distanceKm: 11.8, durationMin: 65 }), A)
    ).toEqual([]);
  });

  it("距離か時間の取り違えで速すぎるペースになったら止める", () => {
    // 2km を 0.87分（52秒）は 26秒/km
    const issues = checkPastEntry(
      pe({ kind: "continuous", distanceKm: 2, durationMin: 0.87 }),
      A
    );
    expect(hasBlockingIssue(issues)).toBe(true);
  });

  it("遅すぎるペースも止める", () => {
    const issues = checkPastEntry(
      pe({ kind: "continuous", distanceKm: 2, durationMin: 40 }),
      A
    );
    expect(hasBlockingIssue(issues)).toBe(true);
    expect(issues.some((i) => i.message.includes("遅すぎます"))).toBe(true);
  });

  it("ありえない距離を止める", () => {
    expect(
      hasBlockingIssue(checkPastEntry(pe({ kind: "continuous", distanceKm: 118 }), A))
    ).toBe(true);
  });
});

describe("心拍", () => {
  it("正常値は通る", () => {
    expect(
      checkPastEntry(pe({ kind: "continuous", distanceKm: 10, durationMin: 50, avgHr: 154 }), A)
    ).toEqual([]);
  });

  it("桁を打ち間違えた心拍を止める", () => {
    const issues = checkPastEntry(
      pe({ kind: "continuous", distanceKm: 10, durationMin: 50, avgHr: 15 }),
      A
    );
    expect(hasBlockingIssue(issues)).toBe(true);
    expect(issues[0].message).toContain("桁");
  });
});

describe("レース", () => {
  it("正常な800mは通る", () => {
    expect(
      checkPastEntry(pe({ kind: "race", distanceM: 800, timeSec: 113.49 }), A)
    ).toEqual([]);
  });

  it("PBを大きく上回る記録は警告する（止めはしない）", () => {
    // PB 109.51 に対して 104秒
    const issues = checkPastEntry(
      pe({ kind: "race", distanceM: 800, timeSec: 104 }),
      A
    );
    expect(hasBlockingIssue(issues)).toBe(false);
    expect(issues[0].message).toContain("PB");
  });

  it("区間ラップの合計が記録と合わなければ警告する", () => {
    const issues = checkPastEntry(
      pe({ kind: "race", distanceM: 800, timeSec: 113.49, lapsSec: [56.7, 50.0] }),
      A
    );
    expect(issues.some((i) => i.message.includes("合いません"))).toBe(true);
  });

  it("合っていれば警告しない", () => {
    const issues = checkPastEntry(
      pe({ kind: "race", distanceM: 800, timeSec: 113.49, lapsSec: [56.7, 56.7] }),
      A
    );
    expect(issues).toEqual([]);
  });
});

describe("休養・補強は検査対象にしない", () => {
  it("オフは何も出さない", () => {
    expect(checkPastEntry(pe({ kind: "off" }), A)).toEqual([]);
  });
  it("補強は何も出さない", () => {
    expect(checkPastEntry(pe({ kind: "strength" }), A)).toEqual([]);
  });
});
