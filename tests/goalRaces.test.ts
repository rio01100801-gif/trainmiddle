/**
 * NEXT-001 目標レースのボーダーが再表示時に消える / 壊れる。
 *
 * 既に `dataFlow.test.ts` が「SQLite での往復」と「exportBackup 往復」を見ている。
 * ここは残っている経路を埋める。
 *
 *  - IndexedDB 側の保存層（MemoryStore）でも同じ値が戻るか
 *  - 通過点レースのボーダーが保存で捨てられないか
 *  - ボーダーを持たない旧データが読めるか（後方互換。無い値を捏造しないこと）
 *  - 保存できない値（0・負・NaN・文字列）を通してしまわないか
 *
 * 最後の1件が要点。`Number.isFinite(0)` は true なので 0 は正規化を素通りする。
 * さらに `planHeatPace` の `race.borderTimeSec ?? goalTargetSec + 2` は
 * 0 を nullish と見なさないため、0 が保存されると予選の通過目安が
 * 「0秒がボーダー」として計算され、画面には値が出たまま中身だけ壊れる。
 * 画面側（app/goal/page.tsx）は入力を検証しているが、
 * API は `await req.json()` の生データを受けるので保存層側でも止める必要がある。
 */
import { describe, expect, it } from "vitest";
import { exportBackup, importBackup, racesForGoal, saveGoalAndRaces } from "@/lib/service";
import { planHeatPace } from "@/lib/core/rounds";
import type { Goal, Race } from "@/lib/core/types";
import type { Store } from "@/lib/db/store";
import { memRepo } from "./sqlite-helper";
import { MemoryStore } from "../pwa/memory-store";
import { makeRace } from "./helpers";

const TARGET_SEC = 108.9; // 1:48.90

function goalFor(targetRaceId: string, subRaceIds: string[] = []): Goal {
  return { targetEvent: "800m", targetTimeSec: TARGET_SEC, targetRaceId, subRaceIds };
}

/** 本命レース（着順とタイムの両方でボーダーがある形） */
function targetRace(overrides: Partial<Race> = {}): Race {
  return makeRace("2026-09-25", {
    id: "race-target-next001",
    advancementRule: "place_and_time",
    borderPlace: 2,
    borderTimeSec: 111, // 1:51.0
    rounds: [
      { type: "heat", datetime: "2026-09-25T10:00:00" },
      { type: "final", datetime: "2026-09-27T15:00:00" },
    ],
    ...overrides,
  });
}

/** SQLite と IndexedDB の両実装で同じ検証を回す */
const stores: [string, () => Store][] = [
  ["SQLite(Repo)", () => memRepo()],
  ["IndexedDB(MemoryStore)", () => new MemoryStore()],
];

describe("NEXT-001 目標レースのボーダーの往復", () => {
  for (const [label, makeStore] of stores) {
    it(`${label}: 着順・タイムの両ボーダーが保存→再取得で残る`, () => {
      const repo = makeStore();
      const target = targetRace();
      saveGoalAndRaces(repo, goalFor(target.id), [target]);

      const reloaded = racesForGoal(repo)[0];
      expect(reloaded.borderPlace).toBe(2);
      expect(reloaded.borderTimeSec).toBe(111);
      expect(reloaded.advancementRule).toBe("place_and_time");
    });

    it(`${label}: 通過点レースのボーダーも捨てられない`, () => {
      const repo = makeStore();
      const target = targetRace();
      const checkpoint = makeRace("2026-08-16", {
        id: "race-checkpoint-next001",
        priority: "B",
        advancementRule: "time",
        borderTimeSec: 114.5,
      });
      saveGoalAndRaces(repo, goalFor(target.id, [checkpoint.id]), [target, checkpoint]);

      const reloaded = racesForGoal(repo);
      expect(reloaded.map((r) => r.id)).toEqual([target.id, checkpoint.id]);
      expect(reloaded[1].borderTimeSec).toBe(114.5);
    });

    it(`${label}: ボーダーを持たない旧データを読んでも値を捏造しない`, () => {
      const repo = makeStore();
      // 旧形式相当（border 系のキーがそもそも無い）
      const legacy = makeRace("2026-09-25", { id: "race-legacy-next001" });
      expect("borderPlace" in legacy).toBe(false);
      expect("borderTimeSec" in legacy).toBe(false);

      saveGoalAndRaces(repo, goalFor(legacy.id), [legacy]);

      const reloaded = racesForGoal(repo)[0];
      expect(reloaded.borderPlace).toBeUndefined();
      expect(reloaded.borderTimeSec).toBeUndefined();
    });

    it(`${label}: 保存できない値（0・負・NaN・文字列）をボーダーとして残さない`, () => {
      const repo = makeStore();

      // API は req.json() の生データを受けるので、型を通らない値も届きうる
      const bad = {
        ...targetRace({ id: "race-bad-next001" }),
        borderPlace: 0,
        borderTimeSec: 0,
      } as Race;
      saveGoalAndRaces(repo, goalFor(bad.id), [bad]);
      let reloaded = racesForGoal(repo)[0];
      expect(reloaded.borderPlace).toBeUndefined();
      expect(reloaded.borderTimeSec).toBeUndefined();

      const negative = {
        ...targetRace({ id: "race-bad-next001" }),
        borderPlace: -3,
        borderTimeSec: -111,
      } as Race;
      saveGoalAndRaces(repo, goalFor(negative.id), [negative]);
      reloaded = racesForGoal(repo)[0];
      expect(reloaded.borderPlace).toBeUndefined();
      expect(reloaded.borderTimeSec).toBeUndefined();

      const nan = {
        ...targetRace({ id: "race-bad-next001" }),
        borderPlace: Number.NaN,
        borderTimeSec: Number.NaN,
      } as Race;
      saveGoalAndRaces(repo, goalFor(nan.id), [nan]);
      reloaded = racesForGoal(repo)[0];
      expect(reloaded.borderPlace).toBeUndefined();
      expect(reloaded.borderTimeSec).toBeUndefined();

      const text = {
        ...targetRace({ id: "race-bad-next001" }),
        borderPlace: "2",
        borderTimeSec: "1:51.0",
      } as unknown as Race;
      saveGoalAndRaces(repo, goalFor(text.id), [text]);
      reloaded = racesForGoal(repo)[0];
      expect(reloaded.borderPlace).toBeUndefined();
      expect(reloaded.borderTimeSec).toBeUndefined();
    });

    it(`${label}: 0秒のボーダーが保存されると予選の通過目安が壊れる`, () => {
      const repo = makeStore();
      const zero = { ...targetRace({ id: "race-zero-next001" }), borderTimeSec: 0 } as Race;
      saveGoalAndRaces(repo, goalFor(zero.id), [zero]);

      const reloaded = racesForGoal(repo)[0];
      const heat = planHeatPace(reloaded, TARGET_SEC);
      // ボーダーが読めなかったときは目標タイム基準へ戻る。0秒基準にはしない。
      expect(heat?.expectedTimeSec ?? 0).toBeGreaterThan(TARGET_SEC);
    });
  }

  it("exportBackup → importBackup でボーダーが残る（SQLite → IndexedDB）", () => {
    const source = memRepo();
    const target = targetRace();
    const checkpoint = makeRace("2026-08-16", {
      id: "race-checkpoint-next001",
      priority: "B",
      advancementRule: "time",
      borderTimeSec: 114.5,
    });
    saveGoalAndRaces(source, goalFor(target.id, [checkpoint.id]), [target, checkpoint]);

    // 保存層をまたいでも欠けないこと（Supabase同期は同じ payload を使う）
    const restored = new MemoryStore();
    importBackup(restored, exportBackup(source, "2026-07-30T12:00:00.000Z"), "replace");

    const races = racesForGoal(restored);
    expect(races[0]).toMatchObject({ borderPlace: 2, borderTimeSec: 111 });
    expect(races[1]).toMatchObject({ borderTimeSec: 114.5 });
  });

  it("復元でも保存できない値のボーダーを取り込まない（Supabaseのpullも同じ経路）", () => {
    // 別端末で壊れた値が入った状態のバックアップ。
    // importBackup は saveGoalAndRaces を通らず repo.saveRace を直接呼ぶので、
    // 保存時と同じ規則をここでも通す必要がある。
    const source = memRepo();
    const target = targetRace();
    saveGoalAndRaces(source, goalFor(target.id), [target]);
    const file = exportBackup(source, "2026-07-30T12:00:00.000Z");
    const brokenRace = file.data.races?.[0];
    expect(brokenRace).toBeDefined();
    Object.assign(brokenRace as Race, { borderPlace: 0, borderTimeSec: 0 });

    const restored = new MemoryStore();
    importBackup(restored, file, "replace");

    const reloaded = racesForGoal(restored)[0];
    expect(reloaded.borderPlace).toBeUndefined();
    expect(reloaded.borderTimeSec).toBeUndefined();
    expect(planHeatPace(reloaded, TARGET_SEC)?.expectedTimeSec ?? 0).toBeGreaterThan(
      TARGET_SEC
    );
  });
});
