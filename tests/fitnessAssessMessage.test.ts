/**
 * 現在地の測定で「測れない」ときの説明。
 *
 * 実機で、ジョグ22件＋CV1件の23件が入っているのに材料0件になった。
 * そのとき出ていたのは「カテゴリ・距離・タイムのいずれかが不足」で、
 * **入れ方が悪いように読める**。実際は入力は揃っていて、
 * CVには800m相当への換算比率が無いから使えないだけだった。
 * 何を足せば測れるようになるのかが分からないと、同じ入力を増やし続けることになる。
 */
import { describe, expect, it } from "vitest";
import { memRepo } from "./sqlite-helper";
import { addPastEntry, assessFitness } from "@/lib/service";
import { testAthlete } from "./helpers";

function setup() {
  const repo = memRepo();
  repo.saveAthlete({ ...testAthlete(), pb800mSec: 109.51, pb400mSec: 49.0 } as any);
  addPastEntry(repo, {
    id: "j1", date: "2026-07-26", kind: "continuous", distanceKm: 14.2, durationMin: 70,
  } as any);
  addPastEntry(repo, {
    id: "p1", date: "2026-07-18", kind: "interval", category: "cv",
    repDistanceM: 1000, repTimesSec: [207, 206, 207, 207], reps: 4, rpe: 7,
  } as any);
  return assessFitness(repo, "2026-08-13");
}

describe("落ちた理由を取り違えない", () => {
  it("CVは「入力が足りない」ではなく「換算比率が無い」と言う", () => {
    const reasons = setup().excluded.map((e) => e.reason);
    const cv = reasons.find((r) => r.includes("cv"));
    expect(cv).toBeDefined();
    expect(cv).toContain("換算比率");
    expect(cv).not.toContain("不足");
  });

  it("CFEに使えなくても負荷とLT推定には入ることを添える", () => {
    const cv = setup().excluded.map((e) => e.reason).find((r) => r.includes("cv"))!;
    expect(cv).toContain("負荷とLT推定には算入");
  });
});

describe("何を足せば測れるようになるかを出す", () => {
  const notes = setup().notes.join(" ");

  it("使える種類を名指しする", () => {
    expect(notes).toContain("800m");
    expect(notes).toContain("タイムトライアル");
    expect(notes).toContain("高乳酸");
  });

  it("使えない種類も名指しする（同じ入力を増やし続けないため）", () => {
    expect(notes).toContain("ジョグ");
    expect(notes).toContain("CV");
  });
});
