/**
 * FIT取込 Phase 4: サービス層のオーケストレーション。
 * 元ファイル・自動解析・確認済みSession/Resultを1つのトランザクションで保存する。
 */
import { describe, expect, it } from "vitest";
import {
  confirmFitImport,
  importFitFile as stageFitFile,
  rebuildFitDerived,
  trustedResults,
  type ImportFitFileInput,
  type ImportFitFileOutput,
} from "@/lib/service";
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

const CONFIRMATION = {
  category: "high_lactate" as const,
  rpe: 8,
  achievement: "achieved" as const,
  subjective: "hard" as const,
};

/** 既存の変換テストは、本人確認値を明示した1操作完了経路で実行する。 */
function importFitFile(repo: Store, input: ImportFitFileInput) {
  return stageFitFile(repo, { ...input, resultConfirmation: CONFIRMATION });
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

  it("正式結果の保存に失敗しても元FITは確認待ちで残し、不完全なSession/Resultは残さない", () => {
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
    // 元FIT・解析は再入力を失わないため保持する。正式結果側だけがロールバックされる。
    expect(repo.listFitImports()).toHaveLength(1);
    expect(repo.listFitImports()[0].resultConfirmation).toEqual({ status: "pending" });
    expect(repo.listSessions()).toHaveLength(0);
    expect(repo.listResults()).toHaveLength(0);
  });
});

describe("FIT本人確認ゲート", () => {
  it("取込直後は元FITだけを保存し、固定RPE・達成結果・CFE更新を作らない", () => {
    const repo = memRepo();
    repo.saveCfe({ estimated800mSec: 108.9, confidence: 0.8, lastUpdated: "2026-07-01", history: [] });
    const before = repo.getCfe()!.estimated800mSec;

    const staged = stageFitFile(repo, {
      fileName: "pending.fit",
      rawBytesBase64: "PENDING_BYTES",
      parse: parseWithLaps(LAPS),
      autoClassification: autoClassification(),
      confirmedKinds: KINDS,
    });

    expect("needsResultConfirmation" in staged && staged.needsResultConfirmation).toBe(true);
    expect(repo.listFitImports()[0].resultConfirmation).toEqual({ status: "pending" });
    expect(repo.listSessions()).toHaveLength(0);
    expect(repo.listResults()).toHaveLength(0);
    expect(trustedResults(repo)).toHaveLength(0);
    expect(repo.getCfe()!.estimated800mSec).toBe(before);
  });

  it("本人確認後だけ入力したカテゴリ・RPE・達成状態で正式結果を作る", () => {
    const repo = memRepo();
    const staged = stageFitFile(repo, {
      fileName: "confirmed.fit",
      rawBytesBase64: "CONFIRMED_BYTES",
      parse: parseWithLaps(LAPS),
      autoClassification: autoClassification(),
      confirmedKinds: KINDS,
    });
    if (!("needsResultConfirmation" in staged) || !staged.needsResultConfirmation) {
      throw new Error("本人確認待ちになっていません");
    }

    const confirmed = confirmFitImport(repo, {
      fitImportId: staged.record.id,
      category: "race_economy",
      rpe: 6.5,
      achievement: "partial",
      subjective: "moderate",
    });

    expect(confirmed.record.resultConfirmation).toMatchObject({
      status: "confirmed",
      category: "race_economy",
      rpe: 6.5,
      achievement: "partial",
      subjective: "moderate",
    });
    expect(confirmed.record.resultConfirmation).not.toHaveProperty("fitImportId");
    expect(confirmed.session.category).toBe("race_economy");
    expect(confirmed.result).toMatchObject({
      rpe: 6.5,
      achievement: "partial",
      subjective: "moderate",
    });
    expect(trustedResults(repo)).toHaveLength(1);
  });

  it("同じ紐付け済みFITを再確認しても結果・CFE寄与を二重にしない", () => {
    const repo = memRepo();
    repo.saveAthlete(testAthlete());
    repo.saveCfe({ estimated800mSec: 108.9, confidence: 0.8, lastUpdated: "2026-07-01", history: [] });
    repo.saveSession(makeSession("2026-07-20", "threshold", { id: "planned-confirm" }));
    const staged = stageFitFile(repo, {
      fileName: "linked.fit",
      rawBytesBase64: "LINKED_BYTES",
      parse: parseWithLaps(LAPS),
      autoClassification: autoClassification(),
      confirmedKinds: KINDS,
      linkToSessionId: "planned-confirm",
    });
    if (!("needsResultConfirmation" in staged) || !staged.needsResultConfirmation) {
      throw new Error("本人確認待ちになっていません");
    }
    const input = { fitImportId: staged.record.id, ...CONFIRMATION };
    const first = confirmFitImport(repo, input);
    const historyAfterFirst = repo.getCfe()!.history.length;
    const second = confirmFitImport(repo, input);

    expect(second.result.id).toBe(first.result.id);
    expect(second.session.category).toBe("high_lactate");
    expect(repo.listResults()).toHaveLength(1);
    expect(repo.getCfe()!.history.length).toBe(historyAfterFirst);
  });

  it("確認状態のない旧FITは結果を保持したまま分析対象外にする", () => {
    const repo = memRepo();
    const confirmed = importFitFile(repo, {
      fileName: "legacy.fit",
      rawBytesBase64: "LEGACY_BYTES",
      parse: parseWithLaps(LAPS),
      autoClassification: autoClassification(),
      confirmedKinds: KINDS,
    });
    if (!("record" in confirmed) || !("result" in confirmed)) {
      throw new Error("テスト用の正式結果を作れませんでした");
    }
    repo.saveFitImport({ ...confirmed.record, resultConfirmation: undefined });

    expect(repo.listResults()).toHaveLength(1);
    expect(trustedResults(repo)).toHaveLength(0);
    expect(rebuildFitDerived(repo)).toMatchObject({ unconfirmed: 1, rebuilt: 0 });
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
    repo.saveSession({ ...repo.getSession("planned-1")!, category: "threshold" });

    const { imports, rebuilt, orphaned } = rebuildFitDerived(repo);
    expect(imports).toBe(1);
    expect(rebuilt).toBe(1);
    expect(orphaned).toBe(0);
    // 新規のfit-s-*セッションが増えていない。元のplanned-1のままcompleted
    expect(repo.listSessions()).toHaveLength(sessionCountBefore);
    expect(repo.getSession("planned-1")?.status).toBe("completed");
    expect(repo.getSession("planned-1")?.category).toBe(CONFIRMATION.category);
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
