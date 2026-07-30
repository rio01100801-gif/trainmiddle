/**
 * 対象2: 安全なバックアップ復元
 *
 * 以前は `isBackupFile` が format・version・data の存在しか見ておらず、
 * replace モードは検証前に `resetAll()` していた。壊れたファイルで
 * 「全消去してから壊れたデータで復元を試みる」＝データ消失になりえた。
 */
import { describe, expect, it } from "vitest";
import { BACKUP_MAX_BYTES, validateBackup, validateBackupFileSize } from "@/lib/core/backup";
import { exportBackup, importBackup, saveGoalAndRaces } from "@/lib/service";
import type { Store } from "@/lib/db/store";
import { memRepo } from "./sqlite-helper";
import { MemoryStore } from "../pwa/memory-store";
import { makeRace, makeResult, makeSession, testAthlete } from "./helpers";

const EXPORTED_AT = "2026-07-30T12:00:00.000Z";

describe("validateBackup", () => {
  it("正常なexportBackupの出力は必ず通る（回帰固定）", () => {
    const repo = memRepo();
    repo.saveAthlete(testAthlete());
    const session = makeSession("2026-07-20", "interval", { id: "s-1" });
    repo.saveSession(session);
    repo.saveResult(makeResult(session));
    const target = makeRace("2026-09-25", { id: "race-1" });
    saveGoalAndRaces(
      repo,
      { targetEvent: "800m", targetTimeSec: 108.9, targetRaceId: target.id, subRaceIds: [] },
      [target]
    );

    const file = exportBackup(repo, EXPORTED_AT);
    expect(validateBackup(file)).toMatchObject({ ok: true });
  });

  it("FORGEの書き出しファイルでなければ拒否する", () => {
    expect(validateBackup({ hello: 1 })).toMatchObject({ ok: false });
  });

  it("配列であるべき項目が配列でなければ拒否する", () => {
    const file = {
      format: "forge-backup",
      version: 1,
      exportedAt: EXPORTED_AT,
      counts: {},
      data: { sessions: { not: "an array" } },
    };
    const result = validateBackup(file);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.path === "sessions")).toBe(true);
    }
  });

  it("idが文字列でないレコードを拒否する", () => {
    const file = {
      format: "forge-backup",
      version: 1,
      exportedAt: EXPORTED_AT,
      counts: {},
      data: { sessions: [{ id: 12345, date: "2026-07-20" }] },
    };
    const result = validateBackup(file);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.path === "sessions[0].id")).toBe(true);
    }
  });

  it("新しいversionは拒否せず、importBackup側の警告に任せる", () => {
    const file = {
      format: "forge-backup",
      version: 99,
      exportedAt: EXPORTED_AT,
      counts: {},
      data: {},
    };
    expect(validateBackup(file)).toMatchObject({ ok: true });
  });
});

const stores: [string, () => Store][] = [
  ["SQLite(Repo)", () => memRepo()],
  ["IndexedDB(MemoryStore)", () => new MemoryStore()],
];

describe("importBackup の原子性", () => {
  for (const [label, makeStore] of stores) {
    it(`${label}: 不正なバックアップでreplace復元を試みても、既存データが完全に残る`, () => {
      const repo = makeStore();
      repo.saveAthlete(testAthlete({ name: "既存の選手" }));
      repo.saveSession(makeSession("2026-07-20", "interval", { id: "s-existing" }));

      const broken = {
        format: "forge-backup",
        version: 1,
        exportedAt: EXPORTED_AT,
        counts: {},
        data: { sessions: [{ id: 999, date: "2026-07-21" }] }, // idが数値＝壊れている
      };

      expect(() => importBackup(repo, broken, "replace")).toThrow();

      // resetAll()すら実行されていない（検証が先に走るため）
      expect(repo.getAthlete()?.name).toBe("既存の選手");
      expect(repo.listSessions().map((s) => s.id)).toEqual(["s-existing"]);
    });

    it(`${label}: 不正なバックアップでmerge復元を試みても、既存データが完全に残る`, () => {
      const repo = makeStore();
      repo.saveAthlete(testAthlete({ name: "既存の選手" }));

      const broken = {
        format: "forge-backup",
        version: 1,
        exportedAt: EXPORTED_AT,
        counts: {},
        data: { athlete: testAthlete({ name: "壊れた側" }), races: "not-an-array" },
      };

      expect(() => importBackup(repo, broken, "merge")).toThrow();
      expect(repo.getAthlete()?.name).toBe("既存の選手");
    });

    it(`${label}: 正常なバックアップは検証を通過して復元できる`, () => {
      const source = memRepo();
      source.saveAthlete(testAthlete({ name: "元の選手" }));
      const file = exportBackup(source, EXPORTED_AT);

      const repo = makeStore();
      const report = importBackup(repo, file, "replace");

      expect(repo.getAthlete()?.name).toBe("元の選手");
      expect(report.mode).toBe("replace");
    });
  }
});

describe("validateBackupFileSize（対象7: 依存関係と基本セキュリティ）", () => {
  it("上限以下なら許可する", () => {
    expect(validateBackupFileSize(1024)).toEqual({ ok: true });
    expect(validateBackupFileSize(BACKUP_MAX_BYTES)).toEqual({ ok: true });
  });

  it("上限を超えたら理由つきで拒否する", () => {
    const r = validateBackupFileSize(BACKUP_MAX_BYTES + 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("上限");
  });
});
