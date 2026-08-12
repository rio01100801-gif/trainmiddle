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
import { addPastEntry, assessFitness, processResult, regeneratePlan } from "@/lib/service";
import { makeRace, testAthlete } from "./helpers";

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

/**
 * 記録タブに入れた結果も、現在地の測定の材料にする。
 *
 * 以前は `listPastEntries()` だけを見ていた。実機では過去データが7/26までしか無く、
 * それ以降は記録タブに入れていたので、**直近3週間ぶんが測定から丸ごと落ちていた**。
 * 同じ練習でも入れた画面で扱いが変わるのは、同じ入力から同じ結果が出ることに反する。
 */
describe("記録タブの結果も材料にする", () => {
  function withRecent() {
    const repo = memRepo();
    repo.saveAthlete({ ...testAthlete(), pb800mSec: 109.51, pb400mSec: 49.0 } as any);
    const race = makeRace("2026-11-15");
    repo.saveRace(race);
    repo.saveGoal({
      targetEvent: "800m",
      targetTimeSec: 108.9,
      targetRaceId: race.id,
      subRaceIds: [],
    });
    regeneratePlan(repo, "2026-07-01");
    // 過去データはジョグだけ（800m推定には使えない）
    addPastEntry(repo, {
      id: "j1", date: "2026-07-26", kind: "continuous", distanceKm: 14.2, durationMin: 70,
    } as any);
    const hl = repo
      .listSessions()
      .filter((s) => s.category === "high_lactate" && s.targetPaces.length > 0)[0];
    const tp = hl.targetPaces[0];
    const t = (tp.targetSecFast + tp.targetSecSlow) / 2;
    const laps = [t, t, t];
    processResult(repo, {
      id: "r-recent", sessionId: hl.id, date: "2026-08-10",
      actualLapsSec: laps, lapDistancesM: laps.map(() => tp.distanceM),
      achievement: "achieved", rpe: 8, subjective: "hard",
      interval: {
        reps: 3, distanceM: tp.distanceM, targetSec: t, restType: "jog", restSec: 240,
        results: laps.map((x, i) => ({
          index: i + 1, distanceM: tp.distanceM, targetSec: t, actualSec: x,
        })),
      },
    } as any);
    return repo;
  }

  it("過去データがジョグだけでも、記録タブの高乳酸で測定できる", () => {
    const a = assessFitness(withRecent(), "2026-08-13");
    expect(a.estimated800mSec).toBeDefined();
    expect(a.samples.some((s) => s.date === "2026-08-10")).toBe(true);
  });

  it("過去データ由来の結果を二重に数えない", () => {
    const repo = memRepo();
    repo.saveAthlete({ ...testAthlete(), pb800mSec: 109.51, pb400mSec: 49.0 } as any);
    // addPastEntry は PastEntry と SessionResult の両方を作る
    addPastEntry(repo, {
      id: "p1", date: "2026-08-05", kind: "interval", category: "high_lactate",
      repDistanceM: 300, repTimesSec: [42, 42.5, 43], reps: 3, rpe: 8,
    } as any);
    const a = assessFitness(repo, "2026-08-13");
    expect(a.samples).toHaveLength(1);
  });
});
