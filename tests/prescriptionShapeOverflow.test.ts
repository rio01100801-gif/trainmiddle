import { describe, it, expect } from "vitest";
import { prescriptionParts } from "../src/lib/core/prescriptionSummary";
import { PROVISIONAL_NOTE, sessionView } from "../src/lib/core/horizon";

/*
 * `shape` は画面が**縮めずに置く**場所。
 * ここに文章が入ると切れない塊になり、行が横にはみ出す。
 *
 * 素案の処方は「回復促進と有酸素土台の維持。設定ペースは14日前に…」という文章で、
 * これがそのまま `shape` に入っていた（カレンダーで実際にはみ出した）。
 *
 * ここで固定するのは「文章を形として扱わない」こと。
 * 読めなければ返さない——呼ぶ側が原文を切ってよい場所に出す。
 */

describe("shapeに文章を入れない", () => {
  it("素案の処方は形として扱わない（画面が縮められないため）", () => {
    const draft = `回復促進と有酸素土台の維持。${PROVISIONAL_NOTE}`;
    const p = prescriptionParts(draft);
    expect(p.shape).toBeUndefined();
    // 設定も無いので、呼ぶ側は原文を切ってよい場所に出せる
    expect(p.target).toBeUndefined();
  });

  it("狙いが無い素案（注記だけ）も形にしない", () => {
    expect(prescriptionParts(PROVISIONAL_NOTE).shape).toBeUndefined();
  });

  it("句点を含むものは長さによらず形ではない", () => {
    expect(prescriptionParts("休養。無理はしない").shape).toBeUndefined();
  });

  it("読点を含むものも形ではない", () => {
    expect(prescriptionParts("ジョグ、流し").shape).toBeUndefined();
  });

  it("句読点が無くても長すぎれば形ではない", () => {
    const long = "ゆっくり走って体をほぐしてから流しを入れる";
    expect(long.length).toBeGreaterThan(14);
    expect(prescriptionParts(long).shape).toBeUndefined();
  });
});

describe("文章でも先頭の量は残す", () => {
  /*
   * 文章だからと丸ごと捨てると、一番見たい量まで消える。
   * 回復ジョグの処方は「先頭に量・後ろは文章」という形をしている。
   */
  it("回復ジョグ（実物の文言）から量を取り出す", () => {
    const p = prescriptionParts(
      "20〜30分・会話可能・RPE 2以下。痛みが増す、走動作が変わる場合は中止して完全休養。"
    );
    expect(p.shape).toBe("20〜30分");
  });

  it("幅の無い時間も取れる", () => {
    expect(prescriptionParts("30分・会話可能。無理はしない").shape).toBe("30分");
  });

  it("距離でも取れる", () => {
    expect(prescriptionParts("8km・会話可能。無理はしない").shape).toBe("8km");
  });

  it("先頭が量でなければ形は無い（無いものを作らない）", () => {
    expect(
      prescriptionParts("回復促進と有酸素土台の維持。設定ペースは14日前に決まります").shape
    ).toBeUndefined();
  });

  it("取り出した量は短い（縮めない場所に置くため）", () => {
    const p = prescriptionParts(
      "20〜30分・会話可能・RPE 2以下。痛みが増す、走動作が変わる場合は中止して完全休養。"
    );
    expect(p.shape.length).toBeLessThanOrEqual(14);
  });
});

describe("短い形はこれまでどおり出す", () => {
  it("休養", () => {
    expect(prescriptionParts("休養").shape).toBe("休養");
  });

  it("補強", () => {
    expect(prescriptionParts("補強").shape).toBe("補強");
  });

  it("固定枠のチーム練習", () => {
    expect(prescriptionParts("チーム練習").shape).toBe("チーム練習");
  });

  it("インターバル（設定つき）", () => {
    const p = prescriptionParts("300m × 5 @300m 41.2〜41.6秒 r5分（jog）");
    expect(p.shape).toBe("300m×5");
    expect(p.target).toBe("41.2〜41.6秒");
    expect(p.rest).toBe("r5分");
  });

  it("ジョグ（設定つき）", () => {
    const p = prescriptionParts("40分有酸素ジョグ @5:05/km〜5:25/km");
    expect(p.shape).toBe("ジョグ40分");
    expect(p.target).toBe("5:05〜5:25/km");
  });

  it("複合", () => {
    const p = prescriptionParts("500m(68.7〜69.4)＋300m(41.2〜41.6) r5分（jog）");
    expect(p.shape).toBe("500m＋300m");
    expect(p.targets).toEqual(["68.7〜69.4秒", "41.2〜41.6秒"]);
  });

  it("本数に幅があるインターバル（形の regex に合わない経路）", () => {
    // `1000m × 4〜5` は `^(\d+)m×(\d+)$` に合わないが、短いので形として通る
    const p = prescriptionParts("1000m × 4〜5 @1000m 3:22/km r60秒");
    expect(p.shape).toBe("1000m × 4〜5");
  });
});

describe("素案の生成物を実物で通す", () => {
  /*
   * 文字列を手で書いた検査は、生成側の文言が変わると素通りする。
   * 実物（`sessionView`）を通して確かめる。
   */
  const categories = ["aerobic", "neural", "threshold", "high_lactate", "rest"] as const;

  for (const category of categories) {
    it(`${category} の素案は形として出てこない`, () => {
      const session = {
        id: "s1",
        date: "2026-12-01", // 確定範囲の外
        category,
        name: "ジョグ",
        prescription: "40分有酸素ジョグ @5:05/km〜5:25/km",
        status: "planned",
        origin: "generated",
      };
      const view = sessionView(session as never, "2026-09-02");
      expect(view.confirmed).toBe(false);
      expect(prescriptionParts(view.prescription).shape).toBeUndefined();
    });
  }
});
