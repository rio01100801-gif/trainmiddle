/**
 * 変更履歴（changeLog）が書き出しと復元で往復すること。
 *
 * これが抜けていると、iOSがストレージを消して書き出しから復元したときに
 * **「いつ・何を・なぜ自動で変えたか」だけが消える**。
 * 結果もCFEの値も残るので、**失われたことに気づけない**のがいちばん危ない。
 * 設定ペースが下がった理由も、CFEが動いた理由も、復元後は追えなくなる。
 *
 * 「自動で変えたことは理由とセットで出し、本人が却下できるようにする」が
 * 復元経路でだけ切れていた。ここはその経路を見張る。
 */
import { describe, expect, it } from "vitest";
import { memRepo } from "./sqlite-helper";
import { MemoryStore } from "../pwa/memory-store";
import type { Store } from "@/lib/db/store";
import { exportBackup, importBackup } from "@/lib/service";
import { BACKUP_CHANGE_LOG_LIMIT } from "@/lib/core/backup";
import { testAthlete } from "./helpers";
import type { SessionChange } from "@/lib/core/types";

const NOW = "2026-08-15T09:00:00.000Z";

function change(n: number): SessionChange {
  return {
    sessionId: `s-plan-2026-08-${String(10 + (n % 10)).padStart(2, "0")}-pm`,
    field: "targetPaces",
    before: 41.5 + n / 10,
    after: 41.2 + n / 10,
    reason: `CFEが更新されたため設定を引き直した（${n}件目）`,
    triggeredBy: "CFE",
  };
}

/*
 * 保存層は2つある（SQLite の Repo と IndexedDB の MemoryStore）。
 * 端末で動いているのは MemoryStore のほうなので、
 * **両方で同じ往復ができること**を見ないと、テストだけ通って実機で消える。
 */
const stores: [string, () => Store][] = [
  ["SQLite(Repo)", () => memRepo()],
  ["IndexedDB(MemoryStore)", () => new MemoryStore()],
];

function seeded(count: number, make: () => Store = memRepo) {
  const repo = make();
  repo.saveAthlete(testAthlete());
  for (let i = 0; i < count; i++) repo.logChange(change(i));
  return repo;
}

describe("書き出し", () => {
  it("変更履歴が入る", () => {
    const repo = seeded(3);
    const file = exportBackup(repo, NOW);
    const log = (file.data as Record<string, unknown>).changeLog as unknown[];
    expect(Array.isArray(log)).toBe(true);
    expect(log).toHaveLength(3);
    expect(file.counts.changeLog).toBe(3);
  });

  it("件数が多いときは新しい方から上限まで（古い方から捨てる）", () => {
    const repo = seeded(BACKUP_CHANGE_LOG_LIMIT + 50);
    const file = exportBackup(repo, NOW);
    const log = (file.data as Record<string, unknown>).changeLog as { reason: string }[];
    expect(log).toHaveLength(BACKUP_CHANGE_LOG_LIMIT);
    // 直近のものが残っていること（いちばん最後に入れた件が含まれる）
    expect(log.some((x) => x.reason.includes(`${BACKUP_CHANGE_LOG_LIMIT + 49}件目`))).toBe(true);
    // いちばん古いものは落ちていること
    expect(log.some((x) => x.reason.includes("（0件目）"))).toBe(false);
  });
});

describe("復元", () => {
  it("書き出し → 別の端末に復元 で内容が一致する", () => {
    const from = seeded(5);
    const file = exportBackup(from, NOW);

    const to = memRepo();
    importBackup(to, file, "replace");

    const before = from.listChangeLog(1000);
    const after = to.listChangeLog(1000);
    expect(after).toHaveLength(before.length);
    expect(after.map((x) => `${x.createdAt}|${x.sessionId}|${x.reason}`)).toEqual(
      before.map((x) => `${x.createdAt}|${x.sessionId}|${x.reason}`)
    );
  });

  it("記録した日時をそのまま持ち越す（復元した日時で上書きしない）", () => {
    const from = seeded(2);
    const original = from.listChangeLog(10).map((x) => x.createdAt);
    const to = memRepo();
    importBackup(to, exportBackup(from, NOW), "replace");
    expect(to.listChangeLog(10).map((x) => x.createdAt)).toEqual(original);
  });

  it("新しい順で返る（並びが逆にならない）", () => {
    const from = seeded(4);
    const to = memRepo();
    importBackup(to, exportBackup(from, NOW), "replace");
    const reasons = to.listChangeLog(10).map((x) => x.reason);
    // logChange は0→3の順に入れたので、新しい順＝3件目が先頭
    expect(reasons[0]).toContain("3件目");
    expect(reasons[reasons.length - 1]).toContain("0件目");
  });

  it("却下した記録も、却下したことごと戻る", () => {
    const from = memRepo();
    from.saveAthlete(testAthlete());
    from.logChange(change(0), false, "暑かったので設定は下げない");
    const to = memRepo();
    importBackup(to, exportBackup(from, NOW), "replace");
    const [entry] = to.listChangeLog(10);
    expect(entry.accepted).toBe(false);
    expect(entry.rejectReason).toBe("暑かったので設定は下げない");
  });

  /*
   * 同じ内容でも、別々に記録したものは別物として扱う（日時が違う）。
   * 同一とみなすのは「同じ日時に同じセッションの同じ項目を同じ理由で変えた」もの——
   * つまり**同じ1回の変更が2経路で入ってきたとき**だけ。
   * ここを緩めると、同じ日に2回引き直した記録が片方消える。
   */
  it("同じファイルを2回 merge しても二重にならない", () => {
    const from = seeded(3);
    const file = exportBackup(from, NOW);
    const to = memRepo();
    importBackup(to, file, "merge");
    importBackup(to, file, "merge");
    expect(to.listChangeLog(1000)).toHaveLength(3);
  });

  it("merge で手元だけにある記録は消さない", () => {
    const from = seeded(2);
    const file = exportBackup(from, NOW);
    const to = memRepo();
    importBackup(to, file, "merge");
    to.logChange(change(99)); // 復元後に手元で起きた変更
    importBackup(to, file, "merge"); // もう一度同じファイルを取り込む
    const reasons = to.listChangeLog(1000).map((x) => x.reason);
    expect(reasons.some((r) => r.includes("99件目"))).toBe(true);
    expect(to.listChangeLog(1000)).toHaveLength(3);
  });

  it("同じ日に同じ枠を2回引き直した記録は、両方残る", () => {
    const from = memRepo();
    from.saveAthlete(testAthlete());
    from.logChange(change(0));
    from.logChange({ ...change(0), reason: "暑熱でさらに引き直した" });
    const to = memRepo();
    importBackup(to, exportBackup(from, NOW), "replace");
    expect(to.listChangeLog(1000)).toHaveLength(2);
  });

  it("変更履歴が入っていない古い書き出しでも落ちない", () => {
    const from = seeded(2);
    const file = exportBackup(from, NOW);
    delete (file.data as Record<string, unknown>).changeLog;
    const to = memRepo();
    expect(() => importBackup(to, file, "replace")).not.toThrow();
    expect(to.listChangeLog(10)).toEqual([]);
  });
});

/**
 * 保存層は2つある。
 *
 * 端末で実際に動いているのは IndexedDB 側（MemoryStore）なので、
 * SQLite でしか確かめていないと、**テストは通るのに実機では消える**。
 * `Store` にメソッドを足したら両方に実装する、という決まりの見張り。
 *
 * 端末をまたぐ復元（iPhoneの書き出し → PCで開く、その逆）も同じ経路なので、
 * 保存層の組み合わせを全部通す。
 */
describe("保存層をまたいでも往復する", () => {
  for (const [fromLabel, makeFrom] of stores) {
    for (const [toLabel, makeTo] of stores) {
      it(`${fromLabel} → ${toLabel}`, () => {
        const from = seeded(4, makeFrom);
        from.logChange(change(50), false, "この日は暑かったので受けない");
        const to = makeTo();
        importBackup(to, exportBackup(from, NOW), "replace");

        const before = from.listChangeLog(1000);
        const after = to.listChangeLog(1000);
        expect(after).toHaveLength(5);
        // 日時・内容・却下の記録まで一致すること
        expect(after.map((x) => `${x.createdAt}|${x.reason}|${x.accepted ?? "-"}`)).toEqual(
          before.map((x) => `${x.createdAt}|${x.reason}|${x.accepted ?? "-"}`)
        );
        // 新しい順で返ること（並びが逆にならない）。最後に入れたのが却下の記録
        expect(after[0].rejectReason).toBe("この日は暑かったので受けない");
        expect(after[0].accepted).toBe(false);
      });
    }
  }
});
