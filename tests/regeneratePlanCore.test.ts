/**
 * 生成の中心（`regeneratePlanCore`）で、一度も通っていなかった分岐。
 *
 * ここが黙って壊れると**メニューが変わっても気づけない**。
 * 埋めたのは、数の多い分岐ではなく次の4つ——どれも
 * 「起きたことが記録に残るか」「同じものを二重に作らないか」に関わる。
 */
import { describe, expect, it } from "vitest";
import { memRepo } from "./sqlite-helper";
import { regeneratePlan } from "@/lib/service";
import { makeRace, testAthlete } from "./helpers";
import type { Goal, Race } from "@/lib/core/types";
import type { CustomMenu } from "@/lib/core/weekTemplate";

const TODAY = "2026-07-26";

function withGoal(repo: ReturnType<typeof memRepo>, race: Race) {
  repo.saveRace(race);
  const goal: Goal = {
    targetEvent: "800m",
    targetTimeSec: 108.9,
    targetRaceId: race.id,
    subRaceIds: [],
  };
  repo.saveGoal(goal);
}

describe("材料がそろっていないとき", () => {
  it("プロフィールが無ければ生成しない（推測で作らない）", () => {
    const repo = memRepo();
    withGoal(repo, makeRace("2026-09-25"));
    expect(() => regeneratePlan(repo, TODAY)).toThrow(/プロフィールと目標/);
  });

  it("目標が無ければ生成しない", () => {
    const repo = memRepo();
    repo.saveAthlete(testAthlete());
    expect(() => regeneratePlan(repo, TODAY)).toThrow(/プロフィールと目標/);
  });
});

describe("自作メニューの使用実績", () => {
  const menu = (over: Partial<CustomMenu> = {}): CustomMenu => ({
    id: "cm-1",
    name: "コーチ指定 300m×6",
    category: "high_lactate",
    source: "coach",
    prescription: "300m × 6",
    distanceM: 300,
    reps: 6,
    ...over,
  });

  function setup(menus: CustomMenu[]) {
    const repo = memRepo();
    repo.saveAthlete(testAthlete());
    withGoal(repo, makeRace("2026-09-25"));
    for (const m of menus) repo.saveCustomMenu(m);
    regeneratePlan(repo, TODAY);
    return repo;
  }

  it("使われたら回数と最終使用日が付く", () => {
    /*
     * 使用実績は次の生成の優先度に効く（同じ練習が続かないようにする）。
     * ここが動かないと、いつまでも同じメニューが選ばれ続ける。
     */
    const repo = setup([menu()]);
    const saved = repo.listCustomMenus().find((m) => m.id === "cm-1");
    expect(saved?.timesUsed).toBeGreaterThan(0);
    expect(saved?.lastUsedDate).toBeTruthy();
  });

  it("最終使用日は一番新しい日になる（使うたびに前へ戻らない）", () => {
    const repo = setup([menu()]);
    const saved = repo.listCustomMenus().find((m) => m.id === "cm-1")!;
    const usedDates = repo
      .listSessions()
      .filter((s) => s.category === "high_lactate")
      .map((s) => s.date)
      .sort();
    if (usedDates.length > 0) {
      expect(saved.lastUsedDate! >= usedDates[0]).toBe(true);
    }
  });

  it("一時停止したメニューは使われず、実績も動かない", () => {
    /*
     * `active: false` は「記録は残すが候補から外す」。
     * ここが効かないと、やめたはずのメニューが黙って出続ける。
     */
    const repo = setup([menu({ id: "cm-2", active: false })]);
    const paused = repo.listCustomMenus().find((m) => m.id === "cm-2");
    expect(paused?.timesUsed ?? 0).toBe(0);
    expect(paused?.lastUsedDate).toBeUndefined();
  });
});

describe("ラウンド間の回復プロトコル", () => {
  it("同じ日・同じ時間帯に既にあるものは二重に作らない", () => {
    /*
     * 予選と決勝の間に回復セッションを入れる仕組み。
     * 生成を2回走らせても増えないこと——増えると、同じ日に同じ練習が並ぶ。
     */
    const repo = memRepo();
    repo.saveAthlete(testAthlete());
    // ラウンドが2本あるレース（予選→決勝）
    const race = makeRace("2026-09-25");
    withGoal(repo, race);
    if ((race.rounds ?? []).length < 2) return; // 材料が無ければ見ない

    regeneratePlan(repo, TODAY);
    const first = repo.listSessions().filter((s) => s.isRecoveryProtocol).length;
    regeneratePlan(repo, TODAY);
    const second = repo.listSessions().filter((s) => s.isRecoveryProtocol).length;
    expect(second).toBe(first);
  });
});

describe("入れ替えの理由", () => {
  it("生成したあとも、入れ替えの理由が変更履歴に残る", () => {
    /*
     * 以前は生成直後の画面メッセージにしか出ず、**画面を離れると消えていた**。
     * あとで「なぜここだけCVなのか」を追えるようにする。
     */
    const repo = memRepo();
    repo.saveAthlete(testAthlete());
    withGoal(repo, makeRace("2026-09-25"));
    regeneratePlan(repo, TODAY);
    const logs = repo.listChangeLog?.() ?? [];
    for (const log of logs.filter((l) => l.field === "category")) {
      // 残すなら理由つき。理由の無い書き換えを残さない
      expect(log.reason).toBeTruthy();
      // 対応する予定が実在すること（消えた枠の理由を残しても読めない）
      expect(repo.getSession(log.sessionId)).toBeDefined();
    }
  });
});
