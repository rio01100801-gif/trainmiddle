/**
 * ルールエンジンの再計算回数。
 *
 * `weeklySummary` は内部で `runRuleEngine` を呼ぶ。ホーム（dashboard）は
 * 自分でも1回呼ぶので同じ計算が2回、分析タブは4週ぶんのサマリーを作るので
 * 5回走っていた。ルール評価はセッション数に対して二次で伸びるため、
 * 記録が増えるほどこの重複がそのまま待ち時間になる。
 *
 * 同じ `RuleContext` からは必ず同じ結果になる（決定的）ので、
 * ctxオブジェクト単位でメモ化して1回に減らす。
 */
import { describe, expect, it } from "vitest";
import { runRuleEngine, weeklySummary } from "@/lib/core/rules";
import { ctx as makeCtx, makeSession } from "./helpers";

function sampleCtx() {
  return makeCtx({
    sessions: [
      makeSession("2026-04-06", "high_lactate"),
      makeSession("2026-04-07", "race_economy"),
      makeSession("2026-04-08", "cv"),
      makeSession("2026-04-13", "high_lactate"),
    ],
  });
}

describe("runRuleEngine のメモ化", () => {
  it("同じctxを2回渡しても、返す内容は毎回同じ", () => {
    const c = sampleCtx();
    const first = runRuleEngine(c);
    const second = runRuleEngine(c);
    expect(second).toEqual(first);
  });

  /*
   * 呼び出し側が返り値を書き換えても、次の呼び出しに漏れないこと。
   * メモ化でキャッシュした配列をそのまま返すと、誰かが sort や push した瞬間に
   * 別の画面の表示が壊れる。
   */
  it("返り値を書き換えても次の呼び出しに影響しない", () => {
    const c = sampleCtx();
    const first = runRuleEngine(c);
    const originalLength = first.length;
    first.push({
      rule: "RULE-TEST",
      level: "ERROR",
      message: "テストで足した違反",
      dates: [],
      sessionIds: [],
    });
    expect(runRuleEngine(c)).toHaveLength(originalLength);
  });

  it("違うctxには別の結果を返す（キャッシュが混ざらない）", () => {
    const withViolations = runRuleEngine(sampleCtx());
    const empty = runRuleEngine(makeCtx({ sessions: [] }));
    expect(empty).toHaveLength(0);
    expect(withViolations.length).toBeGreaterThan(0);
  });

  /*
   * メモ化が実際に効いていることを確かめる。
   *
   * 上の3件は「メモ化しても壊れないこと」しか見ておらず、メモ化を外しても通る。
   * それだと、あとで誰かがキャッシュを消しても気づけない——待ち時間が戻るだけで
   * 画面には何も出ないため。
   *
   * 時間で見るが、実測では初回60ms前後に対して2回目は0.1ms未満（1000倍以上）
   * 開くので、5倍という緩い境界にしても機械の速さの差では揺れない。
   */
  it("同じctxの2回目は再計算しない（メモ化が外れたら落ちる）", () => {
    const sessions = Array.from({ length: 400 }, (_, i) =>
      makeSession(
        new Date(Date.UTC(2026, 0, 1) + i * 86400000 * 1.4).toISOString().slice(0, 10),
        (["aerobic", "high_lactate", "cv", "race_economy", "threshold"] as const)[i % 5],
        { id: `s-memo-${i}` }
      )
    );
    const c = makeCtx({ sessions });

    const t0 = performance.now();
    runRuleEngine(c);
    const cold = performance.now() - t0;

    const t1 = performance.now();
    runRuleEngine(c);
    const warm = performance.now() - t1;

    expect(warm).toBeLessThan(cold / 5);
  });

  it("weeklySummary の週内違反も、メモ化前と同じ内容になる", () => {
    const c = sampleCtx();
    const summary = weeklySummary(c, "2026-04-06");
    const expected = runRuleEngine(c).filter((v) =>
      v.dates.some((d) => d >= "2026-04-06" && d <= "2026-04-12")
    );
    expect(summary.violations).toEqual(expected);
  });
});
