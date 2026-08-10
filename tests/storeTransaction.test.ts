/**
 * 対象2: バックアップ復元の原子性（基盤）
 *
 * `Store.transaction` は、一連の書き込み中に例外が起きたら、
 * 実行前の状態へ戻す。SQLite（Repo）は実際のBEGIN/COMMIT/ROLLBACKで、
 * IndexedDB（MemoryStore）はJSでは単一スレッドであることを利用し、
 * 実行前の状態をスナップショットして例外時に差し戻す方式で実現する。
 *
 * これが無いと、復元処理の途中で1件でも壊れたレコードがあると、
 * それより前に書き込んだぶんだけが中途半端に残ってしまう。
 */
import { describe, expect, it } from "vitest";
import type { Store } from "@/lib/db/store";
import { memRepo } from "./sqlite-helper";
import { MemoryStore } from "../pwa/memory-store";
import { testAthlete } from "./helpers";

const stores: [string, () => Store][] = [
  ["SQLite(Repo)", () => memRepo()],
  ["IndexedDB(MemoryStore)", () => new MemoryStore()],
];

describe("Store.transaction", () => {
  for (const [label, makeStore] of stores) {
    it(`${label}: 成功時は書き込みがそのまま残る`, () => {
      const repo = makeStore();
      repo.transaction(() => {
        repo.saveAthlete(testAthlete());
      });
      expect(repo.getAthlete()?.id).toBe("ath-1");
    });

    it(`${label}: 途中で例外が起きたら、それ以前の書き込みも差し戻す`, () => {
      const repo = makeStore();
      // トランザクション開始前からあったデータ（差し戻し後も残るべき）
      repo.saveAthlete(testAthlete({ name: "既存" }));

      expect(() =>
        repo.transaction(() => {
          repo.saveAthlete(testAthlete({ name: "書き込み中" }));
          throw new Error("boom");
        })
      ).toThrow("boom");

      // 例外前の書き込み（name: "書き込み中"）も差し戻され、トランザクション開始前の状態に戻る
      expect(repo.getAthlete()?.name).toBe("既存");
    });

    it(`${label}: 例外を投げ直す（握りつぶさない）`, () => {
      const repo = makeStore();
      expect(() =>
        repo.transaction(() => {
          throw new Error("識別可能なメッセージ");
        })
      ).toThrow("識別可能なメッセージ");
    });
}

describe("Storeの1セッション1結果制約", () => {
  for (const [label, makeStore] of stores) {
    it(`${label}: 異なる結果IDでも同じsessionIdなら上書きする`, () => {
      const repo = makeStore();
      const first = {
        id: "result-a",
        sessionId: "session-a",
        date: "2026-07-01",
        actualLapsSec: [],
        rpe: 5,
        achievement: "achieved" as const,
        subjective: "moderate" as const,
      };
      repo.saveResult(first);
      repo.saveResult({ ...first, id: "result-b", rpe: 8 });
      expect(repo.listResults()).toHaveLength(1);
      expect(repo.listResults()[0]).toMatchObject({ id: "result-a", rpe: 8 });
    });
  }
});
});
