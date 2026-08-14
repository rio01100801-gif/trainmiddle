/**
 * N-2 / N-3 メニュー本文の解釈。
 *
 * 一番大事なのは「一括入力と同じ解釈になること」。
 * 同じ文字列が画面によって違う意味になると、どちらの数字を信じるのか分からなくなる。
 */
import { describe, it, expect } from "vitest";
import {
  MAX_SLOTS,
  parsePrescription,
  resizeValues,
  shapeOf,
} from "@/lib/core/prescription";
import { parseBulkText } from "@/lib/core/bulkImport";

// 1:54.6 相当のGRP（秒/m）。カテゴリ判定に使う
const GRP = 114.6 / 800;

describe("インターバル", () => {
  it("本数ぶんの欄を作る", () => {
    const s = parsePrescription("300m×5 @41.5秒 r5分", { grpSecPerM: GRP });
    expect(s.kind).toBe("interval");
    expect(s.slots).toHaveLength(5);
    expect(s.slots[0]).toMatchObject({ index: 1, distanceM: 300 });
    expect(s.restNote).toContain("r5");
    expect(s.recognized).toBe(true);
  });

  it("括弧の設定つきでも同じ", () => {
    const s = parsePrescription("1000(3:15-25)×4 r200jog", { grpSecPerM: GRP });
    expect(s.slots).toHaveLength(4);
    expect(s.slots[0].distanceM).toBe(1000);
    expect(s.slots[0].targetSec).toBeCloseTo(195, 0);
    expect(s.basis).toContain("GRP");
    /*
     * GRPの137%はCVと閾値のどちらもありうる帯なので断定しない（forge-v84）。
     * 候補（cv）は出すが、選ぶのは本人。根拠と理由は両方出す。
     */
    expect(s.categoryCertain).toBe(false);
    expect(s.category).toBe("cv");
  });

  it("複合は区間ごとに欄を出す", () => {
    const s = parsePrescription("300(42)＋600(1:26)＋600(1:26) r15min", { grpSecPerM: GRP });
    expect(s.slots.map((x) => x.distanceM)).toEqual([300, 600, 600]);
    expect(s.slots[1].targetSec).toBeCloseTo(86, 1);
    expect(s.mixed).toBe(true);
  });

  it("次の距離walkは各区間の直後へ対応する距離レストとして展開する", () => {
    const s = parsePrescription("400(56)＋300(42)＋200(24) r次の距離walk", {
      grpSecPerM: GRP,
    });
    expect(s.slots.map((slot) => slot.distanceM)).toEqual([400, 300, 200]);
    expect(s.slots.map((slot) => slot.targetSec)).toEqual([56, 42, 24]);
    expect(s.slots.map((slot) => slot.restAfterDistanceM)).toEqual([300, 200, undefined]);
    expect(s.slots.slice(0, 2).map((slot) => slot.restType)).toEqual(["walk", "walk"]);
  });

  it("2セット表記は総本数になる", () => {
    const s = parsePrescription("300(41-42)×2×2 r100walk", { grpSecPerM: GRP });
    expect(s.slots).toHaveLength(4);
  });

  it("本数が異常に多くても欄を作りすぎない", () => {
    const s = parsePrescription("300m×99 r3分", { grpSecPerM: GRP });
    expect(s.slots.length).toBeLessThanOrEqual(MAX_SLOTS);
  });

  it("生成した処方の @設定 を読む（自分が出したメニューを未確定にしない）", () => {
    const s = parsePrescription("300m × 5 @40.9〜41.7秒 r5分", { grpSecPerM: GRP });
    expect(s.slots).toHaveLength(5);
    expect(s.slots[0].targetSec).toBeCloseTo(40.9, 1);
    expect(s.categoryCertain).toBe(true);
    expect(s.category).toBe("high_lactate");
    expect(s.basis).toContain("GRP");
  });

  it("CVの処方も同じように読む", () => {
    const s = parsePrescription("1000m × 4 @3:10〜3:15 r2分", { grpSecPerM: GRP });
    expect(s.slots).toHaveLength(4);
    expect(s.category).toBe("cv");
  });

  it("ジョグのペース表記を1本の設定と読み違えない", () => {
    const s = parsePrescription("40分ジョグ @5:00〜5:20/km");
    expect(s.kind).toBe("continuous");
    expect(s.slots).toHaveLength(0);
  });

  it("設定が無ければカテゴリを断定しない", () => {
    const s = parsePrescription("1000m×4 r2分", { grpSecPerM: GRP });
    expect(s.kind).toBe("interval");
    expect(s.categoryCertain).toBe(false);
  });
});

describe("ジョグ・持続走", () => {
  it("時間だけでも読む", () => {
    const s = parsePrescription("ジョグ40分");
    expect(s.kind).toBe("continuous");
    expect(s.category).toBe("aerobic");
    expect(s.durationMin).toBeCloseTo(40, 1);
    expect(s.slots).toHaveLength(0);
    expect(s.recognized).toBe(true);
  });

  it("ロングランも有酸素として読む", () => {
    const s = parsePrescription("70分ロングラン");
    expect(s.kind).toBe("continuous");
    expect(s.category).toBe("aerobic");
    expect(s.durationMin).toBeCloseTo(70, 1);
  });

  it("ペース走は閾値になる", () => {
    const s = parsePrescription("8000mペース走 3:50/km");
    expect(s.kind).toBe("continuous");
    expect(s.category).toBe("threshold");
  });
});

describe("その他の種別", () => {
  it("レース", () => {
    const s = parsePrescription("レース 800m 1:53.49(56.7-56.7)");
    expect(s.kind).toBe("race");
    expect(s.raceDistanceM).toBe(800);
    expect(s.raceTimeSec).toBeCloseTo(113.49, 2);
    expect(s.lapsSec).toEqual([56.7, 56.7]);
  });

  it("補強", () => {
    const s = parsePrescription("プライオ 接地120回");
    expect(s.kind).toBe("strength");
    expect(s.strengthType).toBe("plyometrics");
    expect(s.contactCount).toBe(120);
  });

  it("オフ", () => {
    expect(parsePrescription("完全休養").kind).toBe("off");
  });
});

describe("読み取れないとき", () => {
  it("空なら認識しない", () => {
    const s = parsePrescription("   ");
    expect(s.recognized).toBe(false);
    expect(s.kind).toBe("unknown");
  });

  it("意味の取れない文字列では欄を変えない", () => {
    const s = parsePrescription("あああ");
    expect(s.recognized).toBe(false);
    expect(s.issues.length).toBeGreaterThan(0);
  });

  it("打ちかけの本文でも落ちない", () => {
    for (const t of ["3", "30", "300", "300m", "300m×", "300m×5"]) {
      expect(() => parsePrescription(t, { grpSecPerM: GRP })).not.toThrow();
    }
  });
});

describe("一括入力と同じ解釈になること", () => {
  const cases = [
    "300(42)＋600(1:26)＋600(1:26) r15min",
    "400(56)＋300(42)＋200(24) r次の距離walk",
    "1000(3:15-25)×4 r200jog",
    "ジョグ40分",
    "レース 800m 1:56.0(56.0-60.0)",
    "プライオ 接地120回",
  ];
  it.each(cases)("%s", (text) => {
    const one = parsePrescription(text, { grpSecPerM: GRP });
    const bulk = parseBulkText(`7/20 ${text}`, "2026-07-26", { grpSecPerM: GRP })[0];
    expect(one.kind).toBe(bulk.kind);
    expect(one.category).toBe(bulk.category);
    expect(one.repDistanceM).toBe(bulk.repDistanceM);
  });
});

describe("入力欄の作り直し判定", () => {
  it("設定タイムだけ変わっても構造は同じ", () => {
    const a = parsePrescription("300m×5 @41.5秒 r5分", { grpSecPerM: GRP });
    const b = parsePrescription("300m×5 @42.5秒 r5分", { grpSecPerM: GRP });
    expect(shapeOf(a)).toBe(shapeOf(b));
  });

  it("本数が変われば構造も変わる", () => {
    const a = parsePrescription("300m×5 r5分", { grpSecPerM: GRP });
    const b = parsePrescription("300m×6 r5分", { grpSecPerM: GRP });
    expect(shapeOf(a)).not.toBe(shapeOf(b));
  });

  it("種別が変われば構造も変わる", () => {
    const a = parsePrescription("300m×5 r5分", { grpSecPerM: GRP });
    const b = parsePrescription("ジョグ40分");
    expect(shapeOf(a)).not.toBe(shapeOf(b));
  });
});

describe("値の引き継ぎ", () => {
  it("増えたぶんは空欄を足すだけ", () => {
    expect(resizeValues(["41.6", "41.8"], 4, "")).toEqual(["41.6", "41.8", "", ""]);
  });

  it("減っても捨てない（打ち間違いで消えると入れ直しになる）", () => {
    expect(resizeValues(["41.6", "41.8", "42.0"], 2, "")).toEqual(["41.6", "41.8", "42.0"]);
  });
});
