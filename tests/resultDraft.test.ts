/**
 * 記録を保存させるかどうかの判定。
 *
 * ここで止めているのは全部「こちらで埋めてはいけない値が空のまま」。
 * 推測で埋めるとCFEや設定ペースに静かに混ざる。
 *
 * これまで画面の保存処理の中に散らばっていて、単体テストから触れなかった。
 * 実際に、空欄のRPEが `Number("")` で0になってCFEに流れる不具合が
 * ここで一度起きている（forge-v86 で直した）。
 */
import { describe, expect, it } from "vitest";
import { checkResultDraft, type ResultDraftCheck } from "@/lib/core/resultDraft";

function draft(over: Partial<ResultDraftCheck> = {}): ResultDraftCheck {
  return {
    mode: "interval",
    rpe: 7,
    subjective: "moderate",
    shortOfPlan: false,
    ...over,
  };
}

describe("そろっていれば通す", () => {
  it("インターバル", () => {
    expect(checkResultDraft(draft())).toBeUndefined();
  });

  it("持続走は距離と時間があれば通す", () => {
    expect(
      checkResultDraft(draft({ mode: "continuous", distanceKm: 10, durationMin: 50 }))
    ).toBeUndefined();
  });
});

describe("RPE", () => {
  it("未入力なら止める", () => {
    expect(checkResultDraft(draft({ rpe: undefined }))).toContain("RPE");
  });

  it("0は止める（空欄が Number(\"\") で0になる経路があった）", () => {
    expect(checkResultDraft(draft({ rpe: 0 }))).toContain("RPE");
  });

  it("範囲外は止める（旧データの読み込み経路がある）", () => {
    expect(checkResultDraft(draft({ rpe: 11 }))).toContain("RPE");
    expect(checkResultDraft(draft({ rpe: -1 }))).toContain("RPE");
    expect(checkResultDraft(draft({ rpe: 7.5 }))).toContain("RPE");
  });

  it("境界の1と10は通す", () => {
    expect(checkResultDraft(draft({ rpe: 1 }))).toBeUndefined();
    expect(checkResultDraft(draft({ rpe: 10 }))).toBeUndefined();
  });

  it("止める理由に「こちらでは埋めません」と書く", () => {
    // 黙って既定値を入れない、を本人に伝えるための一文
    expect(checkResultDraft(draft({ rpe: undefined }))).toContain("埋めません");
  });
});

describe("主観", () => {
  it("未入力なら止める", () => {
    expect(checkResultDraft(draft({ subjective: undefined }))).toContain("主観");
  });
});

describe("途中でやめた理由", () => {
  it("本数が足りないのに理由が無ければ止める", () => {
    const msg = checkResultDraft(draft({ shortOfPlan: true }));
    expect(msg).toContain("途中でやめた理由");
    expect(msg).toContain("設定ペース");
  });

  it("理由があれば通す", () => {
    expect(
      checkResultDraft(draft({ shortOfPlan: true, abortCause: "condition" }))
    ).toBeUndefined();
  });

  it("本数が足りていれば理由は要らない", () => {
    expect(checkResultDraft(draft({ shortOfPlan: false }))).toBeUndefined();
  });
});

describe("持続走の2値", () => {
  it("距離だけでは止める", () => {
    expect(checkResultDraft(draft({ mode: "continuous", distanceKm: 10 }))).toContain(
      "2つを入力"
    );
  });

  it("時間だけでは止める", () => {
    expect(checkResultDraft(draft({ mode: "continuous", durationMin: 50 }))).toContain(
      "2つを入力"
    );
  });

  it("0は入っていないものとして扱う", () => {
    expect(
      checkResultDraft(draft({ mode: "continuous", distanceKm: 0, durationMin: 50 }))
    ).toContain("2つを入力");
  });

  it("インターバルでは距離と時間を見ない", () => {
    expect(checkResultDraft(draft({ mode: "interval" }))).toBeUndefined();
  });
});

describe("出す順番", () => {
  it("全部空でも一度に1つしか言わない", () => {
    /*
     * まとめて出すと読み飛ばされる。1つずつ直せるようにする。
     * 本人が最後に触る欄（RPE）から出すのが、直す回数が少ない。
     */
    const msg = checkResultDraft({
      mode: "continuous",
      shortOfPlan: true,
    });
    expect(msg).toContain("RPE");
    expect(msg).not.toContain("主観");
    expect(msg).not.toContain("2つを入力");
  });

  it("RPEを直すと次の理由が出る", () => {
    const base: ResultDraftCheck = { mode: "continuous", shortOfPlan: true };
    expect(checkResultDraft({ ...base, rpe: 7 })).toContain("主観");
    expect(checkResultDraft({ ...base, rpe: 7, subjective: "hard" })).toContain(
      "途中でやめた理由"
    );
    expect(
      checkResultDraft({ ...base, rpe: 7, subjective: "hard", abortCause: "pace" })
    ).toContain("2つを入力");
  });
});
