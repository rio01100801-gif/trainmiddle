/**
 * 表記辞書。
 *
 * 一括入力が読めない語は必ず出る。所属チーム固有の呼び方があるからで、
 * 組み込みルールをいくら足しても追いつかない。
 * 一度「この語はこれ」と教えたら次から通す、という形にする。
 *
 * 本人の語彙は組み込みルールより優先する。
 * 「セット走」を閾値走と呼ぶチームもCV走と呼ぶチームもあるので、
 * こちらが決めてはいけない。
 */
import { describe, it, expect } from "vitest";
import { memRepo } from "./sqlite-helper";
import { listPhrases, savePhrase, deletePhrase, previewBulkText, regeneratePlan } from "@/lib/service";
import { inferCategory, type PhraseRule } from "@/lib/core/bulkImport";
import { makeRace, testAthlete } from "./helpers";
import type { Goal } from "@/lib/core/types";

const TODAY = "2026-07-26";

function setup() {
  const repo = memRepo();
  repo.saveAthlete(testAthlete());
  const race = makeRace("2026-09-25");
  repo.saveRace(race);
  const goal: Goal = {
    targetEvent: "800m",
    targetTimeSec: 108.9,
    targetRaceId: race.id,
    subRaceIds: [],
  };
  repo.saveGoal(goal);
  regeneratePlan(repo, TODAY);
  return repo;
}

const SET_RUN: PhraseRule = {
  id: "p1",
  phrase: "セット走",
  kind: "interval",
  category: "cv",
};

describe("辞書の照合", () => {
  it("登録した語でカテゴリが決まる", () => {
    const r = inferCategory("セット走 1000×5", { phrases: [SET_RUN] });
    expect(r.kind).toBe("interval");
    expect(r.category).toBe("cv");
    expect(r.certain).toBe(true);
    expect(r.basis).toContain("セット走");
  });

  it("辞書がなければ未確定のまま", () => {
    const r = inferCategory("セット走 1000×5");
    expect(r.certain).toBe(false);
  });

  it("大文字小文字は区別しない", () => {
    const r = inferCategory("Hill Sprint 10本", {
      phrases: [{ id: "p2", phrase: "hill sprint", kind: "interval", category: "neural" }],
    });
    expect(r.category).toBe("neural");
  });

  it("本人の登録を組み込みルールより優先する", () => {
    // 組み込みでは「ペース走」は閾値。本人がCVとして使っているなら本人が正しい
    const r = inferCategory("ペース走 3000×3", {
      phrases: [{ id: "p3", phrase: "ペース走", kind: "interval", category: "cv" }],
    });
    expect(r.kind).toBe("interval");
    expect(r.category).toBe("cv");
  });

  it("補強も辞書で登録できる", () => {
    const r = inferCategory("サーキットA", {
      phrases: [{ id: "p4", phrase: "サーキットA", kind: "strength", strengthType: "core" }],
    });
    expect(r.kind).toBe("strength");
  });
});

describe("辞書の保存", () => {
  it("保存・一覧・削除ができる", () => {
    const repo = memRepo();
    expect(listPhrases(repo)).toEqual([]);
    savePhrase(repo, SET_RUN);
    expect(listPhrases(repo)).toHaveLength(1);
    savePhrase(repo, { ...SET_RUN, category: "threshold" }); // 同じidは上書き
    expect(listPhrases(repo)).toHaveLength(1);
    expect(listPhrases(repo)[0].category).toBe("threshold");
    deletePhrase(repo, SET_RUN.id);
    expect(listPhrases(repo)).toEqual([]);
  });

  it("保存した語が次の解釈から効く", () => {
    const repo = setup();
    const text = `7/20\tセット走 1000m×5 r200mjog\t3:05 3:04 3:06 3:05 3:03`;

    const before = previewBulkText(repo, text, TODAY);
    expect(before[0].ready).toBe(false);

    savePhrase(repo, SET_RUN);

    const after = previewBulkText(repo, text, TODAY);
    expect(after[0].ready).toBe(true);
    expect(after[0].category).toBe("cv");
  });
});
