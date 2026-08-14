/**
 * 登録したレースを消す。
 *
 * 保存層には前から `deleteRace` があったのに、呼ぶ側が無かった。
 * 間違えて登録したレースが残り続け、目標から外しても記録としては消えなかった。
 *
 * 消せることより、**消せないことのほう**が大事。
 * 走った記録は現在地の根拠（有酸素マーカー）になっているので、
 * 消すと設定ペースの出どころが欠ける。
 */
import { describe, expect, it } from "vitest";
import { memRepo } from "./sqlite-helper";
import { deleteRace, processRaceResult, setupCfeIfNeeded } from "@/lib/service";
import { makeRace, testAthlete } from "./helpers";
import type { Store } from "@/lib/db/store";

function seed(): { repo: Store; targetId: string; subId: string } {
  const repo = memRepo();
  repo.saveAthlete(testAthlete());
  const target = makeRace("2026-11-15");
  const sub = makeRace("2026-09-20", { priority: "B" });
  repo.saveRace(target);
  repo.saveRace(sub);
  repo.saveGoal({
    targetEvent: "800m",
    targetTimeSec: 108.9,
    targetRaceId: target.id,
    subRaceIds: [sub.id],
  });
  // レース結果の取り込みはCFEがある前提（無いと更新の比較先が無い）
  setupCfeIfNeeded(repo, "2026-08-15");
  return { repo, targetId: target.id, subId: sub.id };
}

describe("消せるもの", () => {
  it("通過点レースは消せる", () => {
    const { repo, subId } = seed();
    expect(deleteRace(repo, subId).deleted).toBe(true);
    expect(repo.listRaces().some((r) => r.id === subId)).toBe(false);
  });

  it("目標の通過点一覧からも外れる（IDだけ残さない）", () => {
    const { repo, subId } = seed();
    deleteRace(repo, subId);
    expect(repo.getGoal()?.subRaceIds).not.toContain(subId);
  });
});

describe("消せないもの", () => {
  it("本命レースは消せない（目標が指す先が無くなる）", () => {
    const { repo, targetId } = seed();
    const out = deleteRace(repo, targetId);
    expect(out.deleted).toBe(false);
    expect(out.reason).toContain("本命レース");
    // 理由だけでなく、次にどうすればよいかまで出す
    expect(out.reason).toContain("レース未定");
    expect(repo.listRaces().some((r) => r.id === targetId)).toBe(true);
  });

  it("結果を入力済みのレースは消せない（現在地の根拠になっている）", () => {
    const { repo, subId } = seed();
    processRaceResult(
      repo,
      subId,
      [
        {
          roundType: "final",
          timeSec: 111.5,
          front400Sec: 54.5,
          back400Sec: 57.0,
          laps: [54.5, 57.0],
          rpe: 9,
        },
      ],
      "2026-09-20"
    );
    const out = deleteRace(repo, subId);
    expect(out.deleted).toBe(false);
    expect(out.reason).toContain("現在地の根拠");
    expect(repo.listRaces().some((r) => r.id === subId)).toBe(true);
  });

  it("消せなかったとき、通過点一覧も触らない", () => {
    const { repo, targetId } = seed();
    const before = repo.getGoal()?.subRaceIds;
    deleteRace(repo, targetId);
    expect(repo.getGoal()?.subRaceIds).toEqual(before);
  });
});
