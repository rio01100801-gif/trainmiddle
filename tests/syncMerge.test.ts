/**
 * NEXT-002 統合（merge）で本人のデータを黙って上書きしない。
 *
 * `/sync` の pull は `importBackup(..., "merge")` を呼ぶ（app/sync/page.tsx:160）。
 * 競合時の選択肢でも「両方を残す（統合）」が同じ merge を使う。
 * ところが `mergeById` は同じIDを**無条件で上書き**していたので、
 * クラウド側の古い予定が、この端末の完了済み・本人編集・固定枠を消していた。
 *
 * これは AGENTS.md の「完了済み・手動編集・固定予定を上書きしない」に反する。
 * 「両方を残す」と書いてあるボタンが片方を消すのは、表示と挙動の食い違いでもある。
 *
 * クラウドを本当に優先したいときは、本人が「クラウドを優先」を選ぶ経路があり、
 * そちらは replace なので保護しない（本人の明示的な選択を尊重する）。
 */
import { describe, expect, it } from "vitest";
import { exportBackup, importBackup } from "@/lib/service";
import type { Store } from "@/lib/db/store";
import { memRepo } from "./sqlite-helper";
import { MemoryStore } from "../pwa/memory-store";
import { makeSession, testAthlete } from "./helpers";

const EXPORTED_AT = "2026-07-30T12:00:00.000Z";

/** クラウド側のスナップショットを、指定した予定だけ持つ形で作る */
function snapshotWith(sessions: ReturnType<typeof makeSession>[]) {
  const source = memRepo();
  source.saveAthlete(testAthlete());
  for (const s of sessions) source.saveSession(s);
  return exportBackup(source, EXPORTED_AT);
}

const stores: [string, () => Store][] = [
  ["SQLite(Repo)", () => memRepo()],
  ["IndexedDB(MemoryStore)", () => new MemoryStore()],
];

describe("NEXT-002 統合で本人のデータを上書きしない", () => {
  for (const [label, makeStore] of stores) {
    /** 同じIDで、ローカル側だけが「本人のもの」になっている状況を作る */
    const setup = (localOverrides: Parameters<typeof makeSession>[2]) => {
      const repo = makeStore();
      repo.saveAthlete(testAthlete());
      const local = makeSession("2026-07-20", "interval", {
        id: "s-conflict",
        name: "この端末の内容",
        ...localOverrides,
      });
      repo.saveSession(local);

      // クラウド側は同じIDだが、まだ自動生成の予定のまま
      const remote = makeSession("2026-07-20", "interval", {
        id: "s-conflict",
        name: "クラウドの内容",
        origin: "generated",
        status: "planned",
      });
      return { repo, file: snapshotWith([remote]) };
    };

    it(`${label}: 完了済みの予定は統合で上書きされない`, () => {
      const { repo, file } = setup({ status: "completed" });
      const report = importBackup(repo, file, "merge");

      const saved = repo.listSessions().find((s) => s.id === "s-conflict");
      expect(saved?.name).toBe("この端末の内容");
      expect(saved?.status).toBe("completed");
      expect(report.kept.sessions).toBe(1);
      expect(report.updated.sessions ?? 0).toBe(0);
    });

    it(`${label}: 本人が編集した予定は統合で上書きされない`, () => {
      const { repo, file } = setup({ origin: "generated", userEdited: true });
      importBackup(repo, file, "merge");
      expect(repo.listSessions().find((s) => s.id === "s-conflict")?.name).toBe(
        "この端末の内容"
      );
    });

    it(`${label}: 固定枠は統合で上書きされない`, () => {
      const { repo, file } = setup({ isFixed: true, fixedSource: "チーム練習" });
      importBackup(repo, file, "merge");
      const saved = repo.listSessions().find((s) => s.id === "s-conflict");
      expect(saved?.name).toBe("この端末の内容");
      expect(saved?.isFixed).toBe(true);
    });

    it(`${label}: 手動追加（s-user-*）は統合で上書きされない`, () => {
      const repo = makeStore();
      repo.saveAthlete(testAthlete());
      repo.saveSession(
        makeSession("2026-07-20", "interval", { id: "s-user-x", name: "この端末の内容" })
      );
      const file = snapshotWith([
        makeSession("2026-07-20", "interval", {
          id: "s-user-x",
          name: "クラウドの内容",
          origin: "generated",
        }),
      ]);
      importBackup(repo, file, "merge");
      expect(repo.listSessions().find((s) => s.id === "s-user-x")?.name).toBe(
        "この端末の内容"
      );
    });

    it(`${label}: 遡り入力（backfilled）は統合で上書きされない`, () => {
      const { repo, file } = setup({ backfilled: true, status: "completed" });
      importBackup(repo, file, "merge");
      expect(repo.listSessions().find((s) => s.id === "s-conflict")?.name).toBe(
        "この端末の内容"
      );
    });

    it(`${label}: 保護対象でない自動生成の未実施予定は、これまでどおり更新される`, () => {
      const { repo, file } = setup({ origin: "generated", status: "planned" });
      const report = importBackup(repo, file, "merge");

      expect(repo.listSessions().find((s) => s.id === "s-conflict")?.name).toBe(
        "クラウドの内容"
      );
      expect(report.updated.sessions).toBe(1);
      expect(report.kept.sessions ?? 0).toBe(0);
    });

    it(`${label}: この端末に無いIDは普通に取り込む`, () => {
      const repo = makeStore();
      repo.saveAthlete(testAthlete());
      const file = snapshotWith([
        makeSession("2026-07-21", "interval", { id: "s-new", name: "クラウドの内容" }),
      ]);
      const report = importBackup(repo, file, "merge");

      expect(repo.listSessions().find((s) => s.id === "s-new")?.name).toBe("クラウドの内容");
      expect(report.added.sessions).toBe(1);
    });

    it(`${label}: 「クラウドを優先」(replace) は本人の明示的な選択なので保護しない`, () => {
      const { repo, file } = setup({ status: "completed" });
      const report = importBackup(repo, file, "replace");

      expect(repo.listSessions().find((s) => s.id === "s-conflict")?.name).toBe(
        "クラウドの内容"
      );
      expect(report.kept.sessions ?? 0).toBe(0);
    });

    it(`${label}: 残した件数を黙らずに報告する`, () => {
      const repo = makeStore();
      repo.saveAthlete(testAthlete());
      repo.saveSession(
        makeSession("2026-07-20", "interval", { id: "s-a", status: "completed" })
      );
      repo.saveSession(
        makeSession("2026-07-21", "interval", { id: "s-b", isFixed: true })
      );
      const file = snapshotWith([
        makeSession("2026-07-20", "interval", { id: "s-a", origin: "generated" }),
        makeSession("2026-07-21", "interval", { id: "s-b", origin: "generated" }),
      ]);

      const report = importBackup(repo, file, "merge");
      expect(report.kept.sessions).toBe(2);
      expect(report.warnings.join("\n")).toMatch(/2件/);
    });
  }
});
