/**
 * FIT取込 Phase 4: サービス層のオーケストレーション。
 * 元ファイル・自動解析・確認済みSession/Resultを1つのトランザクションで保存する。
 */
import { describe, expect, it } from "vitest";
import { importFitFile, rebuildFitDerived, type ImportFitFileOutput } from "@/lib/service";
import type { Store } from "@/lib/db/store";
import type { FitParseLap, FitParseResult } from "@/lib/core/fitParse";
import type { IntervalClassifyResult, IntervalKind } from "@/lib/core/intervalClassify";
import { memRepo } from "./sqlite-helper";
import { makeSession, testAthlete } from "./helpers";

/** repo.saveResult だけ失敗させ、途中まで書き込んだ分がロールバックされるかを見る */
function withFailingSaveResult(repo: Store): Store {
  return new Proxy(repo, {
    get(target, prop, receiver) {
      if (prop === "saveResult") {
        return () => {
          throw new Error("保存に失敗しました（テスト用）");
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function lap(overrides: Partial<FitParseLap> & { index: number }): FitParseLap {
  return { index: overrides.index, ...overrides };
}

function parseWithLaps(laps: FitParseLap[]): FitParseResult {
  return {
    sessions: [],
    laps,
    records: [],
    eventCount: 0,
    hasDeveloperFields: false,
    warnings: [],
    utcOffsetSec: 9 * 3600,
  };
}

const LAPS: FitParseLap[] = [
  lap({ index: 0, startTimeUtc: "2026-07-20T10:00:00Z", distanceKm: 1, elapsedSec: 360 }),
  lap({ index: 1, startTimeUtc: "2026-07-20T10:06:00Z", distanceKm: 0.3, elapsedSec: 50 }),
  lap({ index: 2, startTimeUtc: "2026-07-20T10:06:50Z", distanceKm: 0.2, elapsedSec: 80 }),
  lap({ index: 3, startTimeUtc: "2026-07-20T10:08:10Z", distanceKm: 0.3, elapsedSec: 51 }),
  lap({ index: 4, startTimeUtc: "2026-07-20T10:09:01Z", distanceKm: 1, elapsedSec: 400 }),
];
const KINDS: IntervalKind[] = ["warmup", "main", "recovery", "main", "cooldown"];

function autoClassification(): IntervalClassifyResult {
  return {
    laps: LAPS.map((l, i) => ({
      index: l.index,
      kind: KINDS[i],
      confidence: 0.8,
      paceSecPerKm: l.elapsedSec && l.distanceKm ? l.elapsedSec / l.distanceKm : undefined,
      note: "test",
    })),
    warnings: [],
  };
}

describe("importFitFile", () => {
  it("元ファイル・自動解析・確認済みSession/Resultを保存する", () => {
    const repo = memRepo();
    const { record, session, result } = importFitFile(repo, {
      fileName: "sample.fit",
      rawBytesBase64: "AAAA",
      parse: parseWithLaps(LAPS),
      autoClassification: autoClassification(),
      confirmedKinds: KINDS,
    });

    expect(repo.listFitImports()).toHaveLength(1);
    expect(repo.listFitImports()[0].id).toBe(record.id);
    expect(repo.getSession(session.id)).toMatchObject({ id: session.id, backfilled: true });
    expect(repo.resultForSession(session.id)).toMatchObject({ id: result.id });
  });

  it("CFE未設定なら距離だけの暫定カテゴリになり警告が出る", () => {
    const repo = memRepo();
    const { warnings } = importFitFile(repo, {
      fileName: "sample.fit",
      rawBytesBase64: "AAAA",
      parse: parseWithLaps(LAPS),
      autoClassification: autoClassification(),
      confirmedKinds: KINDS,
    });
    expect(warnings.some((w) => w.includes("GRP"))).toBe(true);
  });

  it("CFEが設定されていれば設定ペースとの比較でカテゴリを決める（警告なし）", () => {
    const repo = memRepo();
    repo.saveCfe({
      estimated800mSec: 108.9,
      confidence: 0.8,
      lastUpdated: "2026-07-01",
      history: [],
    });
    const { warnings } = importFitFile(repo, {
      fileName: "sample.fit",
      rawBytesBase64: "AAAA",
      parse: parseWithLaps(LAPS),
      autoClassification: autoClassification(),
      confirmedKinds: KINDS,
    });
    expect(warnings.some((w) => w.includes("GRP"))).toBe(false);
  });

  it("確認済みデータが不正なら（変換前に）何も保存しない", () => {
    const repo = memRepo();
    expect(() =>
      importFitFile(repo, {
        fileName: "broken.fit",
        rawBytesBase64: "AAAA",
        parse: parseWithLaps(LAPS),
        autoClassification: autoClassification(),
        confirmedKinds: ["main"], // 件数不一致でfitToSessionAndResultが例外を投げる
      })
    ).toThrow();
    expect(repo.listFitImports()).toHaveLength(0);
    expect(repo.listSessions()).toHaveLength(0);
    expect(repo.listResults()).toHaveLength(0);
  });

  it("保存の途中で失敗したら、先に書き込んだ分もロールバックする（対象2と同じトランザクション保護）", () => {
    const repo = memRepo();
    const failing = withFailingSaveResult(repo);
    expect(() =>
      importFitFile(failing, {
        fileName: "sample.fit",
        rawBytesBase64: "AAAA",
        parse: parseWithLaps(LAPS),
        autoClassification: autoClassification(),
        confirmedKinds: KINDS,
      })
    ).toThrow();
    // saveFitImport・saveSessionは先に成功していたはずだが、
    // saveResultの失敗でトランザクション全体が巻き戻っていること
    expect(repo.listFitImports()).toHaveLength(0);
    expect(repo.listSessions()).toHaveLength(0);
  });
});

describe("importFitFile（Phase 5: 二重登録防止）", () => {
  it("同じ生バイト列を2回登録すると、新規ではなく同じidの上書きになる", () => {
    const repo = memRepo();
    const first = importFitFile(repo, {
      fileName: "sample.fit",
      rawBytesBase64: "SAME_BYTES",
      parse: parseWithLaps(LAPS),
      autoClassification: autoClassification(),
      confirmedKinds: KINDS,
    });
    expect(first.duplicate).toBe(false);

    const second = importFitFile(repo, {
      fileName: "sample.fit",
      rawBytesBase64: "SAME_BYTES",
      parse: parseWithLaps(LAPS),
      autoClassification: autoClassification(),
      confirmedKinds: KINDS,
    });
    expect(second.duplicate).toBe(true);
    expect(second.record.id).toBe(first.record.id);
    expect(second.session.id).toBe(first.session.id);
    expect(second.result.id).toBe(first.result.id);
    // 別の記録が増えているのではなく、同じ1件のまま
    expect(repo.listFitImports()).toHaveLength(1);
    expect(repo.listSessions()).toHaveLength(1);
    expect(repo.listResults()).toHaveLength(1);
  });

  it("2回目に手直しした分類が実際に上書き後の内容へ反映される", () => {
    const repo = memRepo();
    importFitFile(repo, {
      fileName: "sample.fit",
      rawBytesBase64: "SAME_BYTES",
      parse: parseWithLaps(LAPS),
      autoClassification: autoClassification(),
      confirmedKinds: KINDS, // lap1とlap3がメイン。間にリカバリーがあるので2本
    });
    /*
     * 1回目は分類を間違えたので、間のlap2も「メイン」に直して登録し直す。
     * lap1〜lap3は時刻が連続していて間に休みが無いため、3本ではなく
     * 1本（0.3+0.2+0.3=800m）の中の通過としてまとまる。
     * 休み無しで次の本が始まることはありえない、という扱い。
     */
    const fixedKinds: IntervalKind[] = ["warmup", "main", "main", "main", "cooldown"];
    const { result } = importFitFile(repo, {
      fileName: "sample.fit",
      rawBytesBase64: "SAME_BYTES",
      parse: parseWithLaps(LAPS),
      autoClassification: autoClassification(),
      confirmedKinds: fixedKinds,
    });
    expect(result.interval?.reps).toBe(1);
    expect(result.interval?.results[0].distanceM).toBe(800);
    expect(result.interval?.results[0].splitsSec).toEqual([50, 80, 51]);
    expect(repo.listResults()).toHaveLength(1);
    expect(repo.resultForSession(result.sessionId)?.interval?.reps).toBe(1);
  });

  it("生バイト列が違えば別記録として扱う（二重登録とはみなさない）", () => {
    const repo = memRepo();
    const a = importFitFile(repo, {
      fileName: "a.fit",
      rawBytesBase64: "BYTES_A",
      parse: parseWithLaps(LAPS),
      autoClassification: autoClassification(),
      confirmedKinds: KINDS,
    });
    const b = importFitFile(repo, {
      fileName: "b.fit",
      rawBytesBase64: "BYTES_B",
      parse: parseWithLaps(LAPS),
      autoClassification: autoClassification(),
      confirmedKinds: KINDS,
    });
    expect(b.duplicate).toBe(false);
    expect(b.record.id).not.toBe(a.record.id);
    expect(repo.listFitImports()).toHaveLength(2);
    expect(repo.listSessions()).toHaveLength(2);
  });
});

/** 確認待ち応答ではないことを確かめつつ型を絞る */
function expectOk(r: ReturnType<typeof importFitFile>): ImportFitFileOutput {
  if ("needsConfirmation" in r && r.needsConfirmation) {
    throw new Error("確認待ちの応答が返った（テストの想定と違う）");
  }
  return r as ImportFitFileOutput;
}

describe("importFitFile（Phase 6: 既存の計画済みセッションとの紐付け）", () => {
  it("その日に計画済みセッションが無ければ、確認なしで従来通り新規backfilledになる", () => {
    const repo = memRepo();
    const out = expectOk(
      importFitFile(repo, {
        fileName: "sample.fit",
        rawBytesBase64: "AAAA",
        parse: parseWithLaps(LAPS),
        autoClassification: autoClassification(),
        confirmedKinds: KINDS,
      })
    );
    expect(out.linked).toBe(false);
    expect(out.session.backfilled).toBe(true);
  });

  it("計画済みセッションがあれば、保存せずに確認を求める", () => {
    const repo = memRepo();
    const planned = makeSession("2026-07-20", "high_lactate", {
      id: "planned-1",
      name: "300m×5",
      prescription: "300m×5 r3分",
    });
    repo.saveSession(planned);

    const out = importFitFile(repo, {
      fileName: "sample.fit",
      rawBytesBase64: "AAAA",
      parse: parseWithLaps(LAPS),
      autoClassification: autoClassification(),
      confirmedKinds: KINDS,
    });
    expect(out).toMatchObject({
      needsConfirmation: true,
      date: "2026-07-20",
      candidates: [{ id: "planned-1", name: "300m×5" }],
    });
    // 確認するだけで、何も保存されていないこと
    expect(repo.listFitImports()).toHaveLength(0);
    expect(repo.listResults()).toHaveLength(0);
    expect(repo.getSession("planned-1")?.status).toBe("planned");
  });

  it("紐付けを選ぶと、既存セッションへ実測が記録されCFEが更新される（通常の記録経路と同じ）", () => {
    const repo = memRepo();
    repo.saveAthlete(testAthlete());
    repo.saveCfe({ estimated800mSec: 108.9, confidence: 0.8, lastUpdated: "2026-07-01", history: [] });
    const planned = makeSession("2026-07-20", "high_lactate", {
      id: "planned-1",
      name: "300m×5",
      prescription: "300m×5 r3分",
    });
    repo.saveSession(planned);

    const out = expectOk(
      importFitFile(repo, {
        fileName: "sample.fit",
        rawBytesBase64: "AAAA",
        parse: parseWithLaps(LAPS),
        autoClassification: autoClassification(),
        confirmedKinds: KINDS,
        linkToSessionId: "planned-1",
      })
    );
    expect(out.linked).toBe(true);
    expect(out.session.id).toBe("planned-1");
    expect(out.session.status).toBe("completed");
    expect(out.result.sessionId).toBe("planned-1");
    expect(out.result.backfilled).toBeUndefined(); // backfilledではなく通常の記録
    // 通常の記録経路（processResult）を実際に通っていること
    // （cfeApplied自体はRPEの一致次第で変わりうるので、経路が呼ばれた証拠として
    // ProcessResultOutputの形が返っていることだけを見る）
    expect(out.processResult).toMatchObject({ guardrailNotes: expect.any(Array) });
    expect(typeof out.processResult?.cfeBefore).toBe("number");
    // 元のセッションは増えていない（新規のfit-s-*は作られない）
    expect(repo.listSessions()).toHaveLength(1);
    expect(repo.listFitImports()).toHaveLength(1);
    expect(repo.listFitImports()[0].sessionId).toBe("planned-1");
  });

  it("複数の計画済みセッションがあれば、すべて候補として返す", () => {
    const repo = memRepo();
    repo.saveSession(makeSession("2026-07-20", "high_lactate", { id: "am-1", timeOfDay: "am" }));
    repo.saveSession(makeSession("2026-07-20", "aerobic", { id: "pm-1", timeOfDay: "pm" }));

    const out = importFitFile(repo, {
      fileName: "sample.fit",
      rawBytesBase64: "AAAA",
      parse: parseWithLaps(LAPS),
      autoClassification: autoClassification(),
      confirmedKinds: KINDS,
    });
    expect("needsConfirmation" in out && out.needsConfirmation).toBe(true);
    if ("candidates" in out) {
      expect(out.candidates.map((c) => c.id).sort()).toEqual(["am-1", "pm-1"]);
    }
  });

  it("「新しい記録として登録する」を選ぶと、計画済みセッションはそのまま残り別記録になる", () => {
    const repo = memRepo();
    const planned = makeSession("2026-07-20", "high_lactate", { id: "planned-1" });
    repo.saveSession(planned);

    const out = expectOk(
      importFitFile(repo, {
        fileName: "sample.fit",
        rawBytesBase64: "AAAA",
        parse: parseWithLaps(LAPS),
        autoClassification: autoClassification(),
        confirmedKinds: KINDS,
        linkToSessionId: null,
      })
    );
    expect(out.linked).toBe(false);
    expect(out.session.id).not.toBe("planned-1");
    expect(out.session.backfilled).toBe(true);
    // 計画済みセッションは触られていない
    expect(repo.getSession("planned-1")?.status).toBe("planned");
    expect(repo.resultForSession("planned-1")).toBeUndefined();
    expect(repo.listSessions()).toHaveLength(2);
  });
});

describe("rebuildFitDerived", () => {
  it("保存済みのFIT取込からSession/Resultを作り直す", () => {
    const repo = memRepo();
    const { session } = importFitFile(repo, {
      fileName: "sample.fit",
      rawBytesBase64: "AAAA",
      parse: parseWithLaps(LAPS),
      autoClassification: autoClassification(),
      confirmedKinds: KINDS,
    });

    // 導出結果を壊してみる（変換ロジックの修正前の古いデータを模す）
    const corrupted = repo.getSession(session.id)!;
    repo.saveSession({ ...corrupted, category: "off" });
    expect(repo.getSession(session.id)?.category).toBe("off");

    const { imports, rebuilt } = rebuildFitDerived(repo);
    expect(imports).toBe(1);
    expect(rebuilt).toBe(1);
    expect(repo.getSession(session.id)?.category).not.toBe("off");
  });

  /*
   * 統合監査で発覚したバグの回帰テスト: 紐付け済み（Phase 6）のFIT取込を
   * 単純にfitToSessionAndResultで作り直すと、常に新規backfilledセッション
   * （fit-s-*）が作られ、元の計画済みセッションから孤立していた。
   */
  it("紐付け済みのFIT取込を作り直しても、新規セッションを作らず元のセッションのまま更新する", () => {
    const repo = memRepo();
    repo.saveAthlete(testAthlete());
    repo.saveCfe({ estimated800mSec: 108.9, confidence: 0.8, lastUpdated: "2026-07-01", history: [] });
    const planned = makeSession("2026-07-20", "high_lactate", { id: "planned-1" });
    repo.saveSession(planned);

    const first = importFitFile(repo, {
      fileName: "sample.fit",
      rawBytesBase64: "AAAA",
      parse: parseWithLaps(LAPS),
      autoClassification: autoClassification(),
      confirmedKinds: KINDS,
      linkToSessionId: "planned-1",
    });
    expect("linked" in first && first.linked).toBe(true);
    const sessionCountBefore = repo.listSessions().length;

    const { imports, rebuilt, orphaned } = rebuildFitDerived(repo);
    expect(imports).toBe(1);
    expect(rebuilt).toBe(1);
    expect(orphaned).toBe(0);
    // 新規のfit-s-*セッションが増えていない。元のplanned-1のままcompleted
    expect(repo.listSessions()).toHaveLength(sessionCountBefore);
    expect(repo.getSession("planned-1")?.status).toBe("completed");
    expect(repo.getSession(`fit-s-${(first as any).record.id}`)).toBeUndefined();
  });

  it("紐付け先のセッションが削除されていたら、新規作成に化けさせず件数だけ報告する", () => {
    const repo = memRepo();
    repo.saveAthlete(testAthlete());
    repo.saveCfe({ estimated800mSec: 108.9, confidence: 0.8, lastUpdated: "2026-07-01", history: [] });
    const planned = makeSession("2026-07-20", "high_lactate", { id: "planned-1" });
    repo.saveSession(planned);
    importFitFile(repo, {
      fileName: "sample.fit",
      rawBytesBase64: "AAAA",
      parse: parseWithLaps(LAPS),
      autoClassification: autoClassification(),
      confirmedKinds: KINDS,
      linkToSessionId: "planned-1",
    });
    repo.deleteSession("planned-1");

    const sessionCountBefore = repo.listSessions().length;
    const { imports, rebuilt, orphaned } = rebuildFitDerived(repo);
    expect(imports).toBe(1);
    expect(rebuilt).toBe(0);
    expect(orphaned).toBe(1);
    // 何も新規に作られていない
    expect(repo.listSessions()).toHaveLength(sessionCountBefore);
  });
});
