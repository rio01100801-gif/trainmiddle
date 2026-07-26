/**
 * S-6 他の選手のメニューを自分の設定に換算する
 *
 * 一番避けたいのは「構造は正しいのに設定だけ速すぎる」形。
 * 換算値は実測ではないので、そのことも必ず出す。
 */
import { describe, expect, it } from "vitest";
import {
  CONVERT_WARN_GAP_SEC,
  convertMenu,
  describeConverted,
} from "@/lib/core/athleteConvert";

/** 相手 1:46.0（106秒）／自分 1:54.0（114秒） */
const THEIR = 106;
const MINE = 114;

describe("換算", () => {
  it("相手の相対強度をそのまま自分に当てる", () => {
    const c = convertMenu({
      prescription: "300m×5 @39.0秒 r5分",
      theirPb800Sec: THEIR,
      myCfeSec: MINE,
    });
    // 39.0 × (114/106) = 41.94
    expect(c.targetSec).toBeCloseTo(41.9, 1);
    expect(c.reps).toHaveLength(5);
    expect(c.reps[0].theirSec).toBe(39);
  });

  it("自分の方が速ければ設定も速くなる", () => {
    const c = convertMenu({
      prescription: "300m×5 @42.0秒 r5分",
      theirPb800Sec: 120,
      myCfeSec: 110,
    });
    expect(c.targetSec!).toBeLessThan(42);
  });

  it("構造（距離・本数・レスト）はそのまま取り込む", () => {
    const c = convertMenu({
      prescription: "600m×3 @1:22.0 r7分",
      theirPb800Sec: THEIR,
      myCfeSec: MINE,
    });
    expect(c.reps).toHaveLength(3);
    expect(c.reps[0].distanceM).toBe(600);
    expect(c.structure.restNote).toContain("7");
  });

  it("設定が書かれていなければ換算しない。構造だけ取り込むと出す", () => {
    const c = convertMenu({
      prescription: "300m×5 r5分",
      theirPb800Sec: THEIR,
      myCfeSec: MINE,
    });
    expect(c.targetSec).toBeUndefined();
    expect(c.notes.join()).toContain("構造");
  });

  it("相手のPBが無ければ換算しない（推測で埋めない）", () => {
    const c = convertMenu({
      prescription: "300m×5 @39.0秒 r5分",
      theirPb800Sec: 0,
      myCfeSec: MINE,
    });
    expect(c.targetSec).toBeUndefined();
    expect(c.notes.join()).toContain("換算できません");
  });
});

describe("限界を隠さない", () => {
  it("PB差が大きければ注意を出す", () => {
    const c = convertMenu({
      prescription: "300m×5 @37.0秒 r5分",
      theirPb800Sec: 100,
      myCfeSec: 100 + CONVERT_WARN_GAP_SEC + 5,
    });
    expect(c.notes.join()).toContain("比でそのまま伸ばすと");
  });

  it("差が小さければ余計な注意を出さない", () => {
    const c = convertMenu({
      prescription: "300m×5 @40.0秒 r5分",
      theirPb800Sec: 110,
      myCfeSec: 114,
    });
    expect(c.notes.join()).not.toContain("比でそのまま伸ばすと");
  });

  it("800mから離れた距離は誤差が大きいと出す", () => {
    const c = convertMenu({
      prescription: "2000m×3 @6:00 r5分",
      theirPb800Sec: THEIR,
      myCfeSec: MINE,
    });
    expect(c.notes.join()).toContain("誤差");
  });

  it("読み取れない本文でも落ちない", () => {
    const c = convertMenu({ prescription: "あああ", theirPb800Sec: THEIR, myCfeSec: MINE });
    expect(c.structure.recognized).toBe(false);
    expect(describeConverted(c)).toContain("読み取れませんでした");
  });
});

describe("表示", () => {
  it("相手の設定と自分の設定を並べて出す", () => {
    const c = convertMenu({
      prescription: "300m×5 @39.0秒 r5分",
      theirPb800Sec: THEIR,
      myCfeSec: MINE,
    });
    const t = describeConverted(c);
    expect(t).toContain("300m × 5");
    expect(t).toContain("相手 39.0秒");
  });
});
