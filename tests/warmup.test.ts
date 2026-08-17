/**
 * アップの集計。
 *
 * ここで一番大事なのは **二重計上しないこと**。
 * FITを1ファイル丸ごと取り込むと主練習側に既にアップが入っているので、
 * そこへさらに足すと距離が倍になる。
 * 距離が倍になった記録はCFEには流れないが、シューズの交換時期と
 * 週間距離を狂わせるので、あとから「なぜ合わないのか」を追うことになる。
 *
 * 次に大事なのは **読めなかったものを捨てること**。
 * 知らない区間種別を「たぶんジョグ」と埋めると、
 * 実際には流しを入れた日がジョグの日として数えられる。
 */
import { describe, expect, it } from "vitest";
import {
  checkWarmup,
  describeSegment,
  normalizeWarmup,
  segmentDistanceKm,
  summarizeWarmup,
  warmupAddedDistanceKm,
  warmupAddedDurationMin,
  warmupDistanceKm,
  warmupDurationMin,
  warmupLoad,
  warmupFromFitLaps,
  WARMUP_TEMPLATES,
  type WarmupRecord,
} from "@/lib/core/warmup";

function wu(over: Partial<WarmupRecord> = {}): WarmupRecord {
  return { segments: [], source: "manual", ...over };
}

describe("区間の距離", () => {
  it("本数ぶん掛ける", () => {
    expect(segmentDistanceKm({ kind: "strides", distanceM: 100, reps: 4 })).toBeCloseTo(0.4);
  });

  it("本数が無ければ1本として扱う", () => {
    expect(segmentDistanceKm({ kind: "easy_jog", distanceM: 2000 })).toBeCloseTo(2);
  });

  it("距離が分からなければ0（推測で埋めない）", () => {
    expect(segmentDistanceKm({ kind: "easy_jog" })).toBe(0);
  });
});

describe("アップの距離", () => {
  it("合計が入っていればそれを使う", () => {
    expect(warmupDistanceKm(wu({ totalDistanceKm: 3.2 }))).toBe(3.2);
  });

  it("合計が無ければ区間から積み上げる", () => {
    const w = wu({
      segments: [
        { kind: "easy_jog", distanceM: 2000 },
        { kind: "strides", distanceM: 100, reps: 4 },
      ],
    });
    expect(warmupDistanceKm(w)).toBeCloseTo(2.4);
  });

  it("合計を区間で上書きしない（区間はアップの一部しか書かないことがある）", () => {
    const w = wu({
      totalDistanceKm: 3.5,
      segments: [{ kind: "strides", distanceM: 100, reps: 4 }],
    });
    // 区間だけなら0.4kmだが、本人が測った3.5kmのほうが正しい
    expect(warmupDistanceKm(w)).toBe(3.5);
  });

  it("アップが無ければ0", () => {
    expect(warmupDistanceKm(undefined)).toBe(0);
  });
});

describe("二重計上の防止", () => {
  it("主練習側に含まれていれば、合計へは足さない", () => {
    const w = wu({ totalDistanceKm: 3, totalDurationMin: 20, includedInMainTotals: true });
    expect(warmupAddedDistanceKm(w)).toBe(0);
    expect(warmupAddedDurationMin(w)).toBe(0);
  });

  it("含まれていなければ足す", () => {
    const w = wu({ totalDistanceKm: 3, totalDurationMin: 20 });
    expect(warmupAddedDistanceKm(w)).toBe(3);
    expect(warmupAddedDurationMin(w)).toBe(20);
  });

  it("含まれていても、記録としての距離は読める（表示は消さない）", () => {
    const w = wu({ totalDistanceKm: 3, includedInMainTotals: true });
    // 合計に足さないだけで、何をやったかは残す
    expect(warmupDistanceKm(w)).toBe(3);
  });

  it("負荷も二重に足さない", () => {
    const w = wu({ totalDurationMin: 20, includedInMainTotals: true });
    expect(warmupLoad(w)).toBe(0);
  });
});

describe("アップの負荷", () => {
  it("時間が分からなければ0（主練習のRPEで代用しない）", () => {
    expect(warmupLoad(wu({ totalDistanceKm: 3 }))).toBe(0);
  });

  it("区間が無ければイージージョグ相当", () => {
    expect(warmupLoad(wu({ totalDurationMin: 20 }))).toBe(3 * 20);
  });

  it("流しを入れた日のほうが重い", () => {
    const jogOnly = wu({
      totalDurationMin: 20,
      segments: [{ kind: "easy_jog", distanceM: 3000 }],
    });
    const withStrides = wu({
      totalDurationMin: 20,
      segments: [
        { kind: "easy_jog", distanceM: 3000 },
        { kind: "strides", distanceM: 100, reps: 4 },
      ],
    });
    expect(warmupLoad(withStrides)).toBeGreaterThan(warmupLoad(jogOnly));
  });

  it("距離が分からない区間は同じ重さで分ける", () => {
    const w = wu({
      totalDurationMin: 20,
      segments: [{ kind: "easy_jog" }, { kind: "strides" }],
    });
    // (3 + 5) / 2 * 20
    expect(warmupLoad(w)).toBeCloseTo(80);
  });

  it("アップが無ければ0", () => {
    expect(warmupLoad(undefined)).toBe(0);
  });
});

describe("時間", () => {
  it("入っていなければ0", () => {
    expect(warmupDurationMin(wu())).toBe(0);
  });

  it("入っていればその値", () => {
    expect(warmupDurationMin(wu({ totalDurationMin: 25 }))).toBe(25);
  });
});

describe("区間の説明", () => {
  it("本数があれば掛ける形で出す", () => {
    expect(describeSegment({ kind: "strides", distanceM: 100, reps: 4 })).toBe("流し 100m×4");
  });

  it("1本なら本数を出さない", () => {
    expect(describeSegment({ kind: "easy_jog", distanceM: 2000 })).toBe("イージージョグ 2km");
  });

  it("距離が無ければ種別だけ（0mと書かない）", () => {
    expect(describeSegment({ kind: "acceleration" })).toBe("加速走");
  });
});

describe("折りたたんだときの1行", () => {
  it("合計と区間の概要が出る", () => {
    const w = wu({
      totalDistanceKm: 3.2,
      totalDurationMin: 22,
      segments: [
        { kind: "easy_jog", distanceM: 2600 },
        { kind: "strides", distanceM: 100, reps: 4 },
      ],
    });
    const s = summarizeWarmup(w);
    expect(s).toContain("3.2km");
    expect(s).toContain("22分");
    expect(s).toContain("流し 100m×4");
  });

  it("何も入っていなければ出さない（空の行を作らない）", () => {
    expect(summarizeWarmup(wu())).toBeUndefined();
    expect(summarizeWarmup(undefined)).toBeUndefined();
  });
});

describe("保存前の確認", () => {
  it("空欄は止めない（アップは任意で、測っていない項目があって当たり前）", () => {
    expect(checkWarmup(wu())).toBeUndefined();
    expect(checkWarmup(undefined)).toBeUndefined();
  });

  it("距離の単位を間違えたら止める", () => {
    // 3200 と打ったらメートルのつもり
    expect(checkWarmup(wu({ totalDistanceKm: 3200 }))).toMatch(/km/);
  });

  it("時間の単位を間違えたら止める", () => {
    expect(checkWarmup(wu({ totalDurationMin: 1200 }))).toMatch(/分/);
  });

  it("平均が最大を超えていたら止める", () => {
    expect(checkWarmup(wu({ avgHr: 180, maxHr: 150 }))).toBeDefined();
  });

  it("平均と最大が同じなら止めない", () => {
    expect(checkWarmup(wu({ avgHr: 150, maxHr: 150 }))).toBeUndefined();
  });

  it("主練習までの時間が長すぎたら止める", () => {
    expect(checkWarmup(wu({ gapToMainMin: 300 }))).toBeDefined();
  });

  it("区間の距離がおかしければ、どの区間かを言う", () => {
    const msg = checkWarmup(wu({ segments: [{ kind: "strides", distanceM: 0 }] }));
    expect(msg).toContain("流し");
  });

  it("区間の本数がおかしければ止める", () => {
    expect(checkWarmup(wu({ segments: [{ kind: "strides", distanceM: 100, reps: 99 }] }))).toBeDefined();
  });
});

describe("外から来た値の正規化", () => {
  it("知らない区間種別は捨てる（推測で埋めない）", () => {
    const w = normalizeWarmup({
      segments: [{ kind: "sauna", distanceM: 100 }, { kind: "strides", distanceM: 100, reps: 4 }],
    });
    expect(w?.segments.map((s) => s.kind)).toEqual(["strides"]);
  });

  it("知らない脚・呼吸は捨てる", () => {
    const w = normalizeWarmup({ totalDistanceKm: 3, legs: "excellent", breathing: "great" });
    expect(w?.legs).toBeUndefined();
    expect(w?.breathing).toBeUndefined();
  });

  it("数値でないものは捨てる（文字列を数値として残さない）", () => {
    const w = normalizeWarmup({ totalDistanceKm: "3.2", totalDurationMin: 20 });
    expect(w?.totalDistanceKm).toBeUndefined();
    expect(w?.totalDurationMin).toBe(20);
  });

  it("NaN や Infinity は捨てる", () => {
    const w = normalizeWarmup({ totalDistanceKm: NaN, totalDurationMin: Infinity, avgHr: 140 });
    expect(w?.totalDistanceKm).toBeUndefined();
    expect(w?.totalDurationMin).toBeUndefined();
    expect(w?.avgHr).toBe(140);
  });

  it("中身が空なら記録として残さない（アップをした日として数えない）", () => {
    expect(normalizeWarmup({ segments: [], source: "manual" })).toBeUndefined();
    expect(normalizeWarmup({})).toBeUndefined();
    expect(normalizeWarmup(null)).toBeUndefined();
    expect(normalizeWarmup("3km")).toBeUndefined();
  });

  it("入力元は fit か手入力だけ。知らない値は手入力に寄せる", () => {
    expect(normalizeWarmup({ totalDistanceKm: 3, source: "fit" })?.source).toBe("fit");
    expect(normalizeWarmup({ totalDistanceKm: 3, source: "garmin" })?.source).toBe("manual");
    expect(normalizeWarmup({ totalDistanceKm: 3 })?.source).toBe("manual");
  });

  it("二重計上の印は true のときだけ立てる", () => {
    expect(normalizeWarmup({ totalDistanceKm: 3, includedInMainTotals: true })?.includedInMainTotals).toBe(true);
    expect(normalizeWarmup({ totalDistanceKm: 3, includedInMainTotals: "yes" })?.includedInMainTotals).toBeUndefined();
    expect(normalizeWarmup({ totalDistanceKm: 3 })?.includedInMainTotals).toBeUndefined();
  });

  it("タイムは数値だけ残し、空になったら持たない", () => {
    const w = normalizeWarmup({
      segments: [{ kind: "strides", distanceM: 100, reps: 2, timesSec: [14.2, "x", null] }],
    });
    expect(w?.segments[0].timesSec).toEqual([14.2]);
    const none = normalizeWarmup({
      segments: [{ kind: "strides", distanceM: 100, timesSec: ["x"] }],
    });
    expect(none?.segments[0].timesSec).toBeUndefined();
  });

  it("空白だけのメモは残さない", () => {
    expect(normalizeWarmup({ totalDistanceKm: 3, note: "   " })?.note).toBeUndefined();
    expect(normalizeWarmup({ totalDistanceKm: 3, note: " 脚が重い " })?.note).toBe("脚が重い");
  });

  it("区間だけでも記録として残す（合計を測っていない日がある）", () => {
    const w = normalizeWarmup({ segments: [{ kind: "strides", distanceM: 100, reps: 4 }] });
    expect(w?.segments.length).toBe(1);
  });
});

describe("よく使う型", () => {
  it("中身は固定で、実績から作らない（毎回同じものが出る）", () => {
    const a = WARMUP_TEMPLATES.map((t) => JSON.stringify(t.build()));
    const b = WARMUP_TEMPLATES.map((t) => JSON.stringify(t.build()));
    expect(a).toEqual(b);
  });

  it("どれも保存できる形になっている", () => {
    for (const t of WARMUP_TEMPLATES) {
      expect(checkWarmup(t.build())).toBeUndefined();
      expect(normalizeWarmup(t.build())).toBeDefined();
    }
  });

  it("型は入力元を手入力にする（選んだだけでFIT由来にしない）", () => {
    for (const t of WARMUP_TEMPLATES) expect(t.build().source).toBe("manual");
  });
});

describe("FITのアップ区間から組み立てる", () => {
  const laps = [
    { index: 0, distanceKm: 2, timerSec: 720, avgHr: 130, maxHr: 145 },
    { index: 1, distanceKm: 1, timerSec: 360, avgHr: 140, maxHr: 160 },
    { index: 2, distanceKm: 0.3, timerSec: 42, avgHr: 175, maxHr: 185 },
  ];

  it("アップと判定された周だけを足す", () => {
    const w = warmupFromFitLaps(laps, ["warmup", "warmup", "main"], { mainIsContinuous: false });
    expect(w?.totalDistanceKm).toBeCloseTo(3);
    expect(w?.totalDurationMin).toBeCloseTo(18);
  });

  it("アップの周が無ければ作らない", () => {
    expect(warmupFromFitLaps(laps, ["main", "main", "main"], { mainIsContinuous: false })).toBeUndefined();
  });

  it("入力元はFITになる", () => {
    expect(warmupFromFitLaps(laps, ["warmup", "main", "main"], { mainIsContinuous: false })?.source).toBe("fit");
  });

  /*
   * ここが二重計上の分かれ目。
   * 持続走として取り込むと主練習の距離はファイル全体なので、アップは既に入っている。
   * インターバルとして取り込むと主練習の距離はメインの周だけなので、入っていない。
   */
  it("持続走として取り込んだら、合計には足さない印を付ける", () => {
    const w = warmupFromFitLaps(laps, ["warmup", "warmup", "main"], { mainIsContinuous: true });
    expect(w?.includedInMainTotals).toBe(true);
    expect(warmupAddedDistanceKm(w)).toBe(0);
  });

  it("インターバルとして取り込んだら、合計に足す", () => {
    const w = warmupFromFitLaps(laps, ["warmup", "warmup", "main"], { mainIsContinuous: false });
    expect(w?.includedInMainTotals).toBeUndefined();
    expect(warmupAddedDistanceKm(w)).toBeCloseTo(3);
  });

  it("区間の中身は決めない（どれが流しかはFITから分からない）", () => {
    const w = warmupFromFitLaps(laps, ["warmup", "warmup", "main"], { mainIsContinuous: false });
    expect(w?.segments).toEqual([]);
  });

  it("心拍が測れていない周を0として混ぜない", () => {
    const mixed = [
      { index: 0, distanceKm: 2, timerSec: 720, avgHr: 130 },
      { index: 1, distanceKm: 1, timerSec: 360 },
    ];
    const w = warmupFromFitLaps(mixed, ["warmup", "warmup"], { mainIsContinuous: false });
    expect(w?.avgHr).toBe(130);
  });

  it("心拍がどこにも無ければ持たない", () => {
    const none = [{ index: 0, distanceKm: 2, timerSec: 720 }];
    const w = warmupFromFitLaps(none, ["warmup"], { mainIsContinuous: false });
    expect(w?.avgHr).toBeUndefined();
    expect(w?.maxHr).toBeUndefined();
  });

  it("実動時間が無ければ経過時間を使う", () => {
    const w = warmupFromFitLaps(
      [{ index: 0, distanceKm: 2, elapsedSec: 600 }],
      ["warmup"],
      { mainIsContinuous: false }
    );
    expect(w?.totalDurationMin).toBeCloseTo(10);
  });
});
