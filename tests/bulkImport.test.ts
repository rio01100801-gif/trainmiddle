import { describe, it, expect } from "vitest";
import {
  extractTimes,
  inferCategory,
  categoryFromTarget,
  isHeaderLine,
  looksLikeDate,
  parseBulkText,
  parseLogDate,
  parseRaceRecord,
  parseRepSpec,
  parseResultText,
  parseRow,
  parseSegments,
  representativeDistance,
  resolveBareTime,
  splitDateAndBody,
  stripLabeledNumbers,
  stripPrescription,
} from "@/lib/core/bulkImport";

const TODAY = "2026-07-26";
/** 現在のCFEが 1:53.49 のときのGRP（秒/m） */
const GRP = 113.49 / 800;

/**
 * 実際の練習日誌そのまま。
 * タブは無く半角スペース1個区切り、結果が次の行に来る、
 * 括弧に設定と区間ラップが混在する——という現実の書き方。
 */
const REAL_LOG = `7/4 2kmジョグ 8:40
7/5 オフ
7/6 300(42)＋600(1:26)＋600(1:26) r15min
42 1:26 1:25
7/7 オフ
7/9 5kmジョグ 22min
7/10 300(41-42)×2×2 r100walk R12min
41.6 41.8 40.0 41.8
7/12 ジョグ5km 20min
7/13 レース　800m 1:56.0(56.0-60.0)
7/14 レース　800m 1:53.49(56.7-56.7)
7/16 65minジョグ　11.8km 平均心拍154
7/18 1000(3:15-25)×4 r200jog 3:27 3:26 3:27 3:27 平均心拍180 最大195
7/19 ロングラン　75min 13.7km 平均心拍148
7/21 50minジョグ　10.79km 平均心拍159`;

const rows = parseBulkText(REAL_LOG, TODAY, { grpSecPerM: GRP });
const byDate = (d: string) => rows.find((r) => r.date === d)!;

describe("F-2 行の切り出し", () => {
  it("半角スペース1個でも日付を切り出せる（実際の日誌はこれ）", () => {
    expect(splitDateAndBody("7/4 2kmジョグ 8:40")).toEqual({
      dateToken: "7/4",
      body: "2kmジョグ 8:40",
    });
  });

  it("全角空白・タブでも切り出せる", () => {
    expect(splitDateAndBody("7/13 レース　800m 1:56.0").dateToken).toBe("7/13");
    expect(splitDateAndBody("7/22\tジョグ\t51分").dateToken).toBe("7/22");
  });

  it("日付らしい先頭トークンを判定できる", () => {
    expect(looksLikeDate("7/4")).toBe(true);
    expect(looksLikeDate("2026-07-04")).toBe(true);
    expect(looksLikeDate("41.6")).toBe(false);
    expect(looksLikeDate("42")).toBe(false);
  });

  it("ヘッダー行を飛ばす", () => {
    expect(isHeaderLine("日付\t練習内容\t練習結果")).toBe(true);
    expect(isHeaderLine("7/4 2kmジョグ")).toBe(false);
  });

  it("実施タイムだけの行は前の行の続きとして扱う", () => {
    // 15行の入力から、日付付きの13行ぶんだけが出る
    expect(rows).toHaveLength(13);
    expect(rows.map((r) => r.date)).toContain("2026-07-06");
    expect(byDate("2026-07-06").repTimesSec).toBeDefined();
  });
});

describe("F-2 数値の取り違えを防ぐ", () => {
  it("処方の距離を実施タイムとして拾わない", () => {
    // "300(42)＋600(1:26)" の 300 や 600 は距離であってタイムではない
    const t = extractTimes("300(42)＋600(1:26)＋600(1:26) r15min 42 1:26 1:25");
    expect(t).toEqual([42, 86, 85]);
  });

  it("レストの記述が実施タイムの1本目を飲み込まない", () => {
    // 旧実装は "R12min 41.6" の "R  41" までを消して 41.6 を失っていた
    const t = extractTimes("300(41-42)×2×2 r100walk R12min 41.6 41.8 40.0 41.8");
    expect(t).toEqual([41.6, 41.8, 40, 41.8]);
  });

  it("心拍をタイムとして拾わない", () => {
    const t = extractTimes("1000(3:15-25)×4 r200jog 3:27 3:26 3:27 3:27 平均心拍180 最大195");
    expect(t).toEqual([207, 206, 207, 207]);
  });

  it("処方の除去とラベル除去が独立して機能する", () => {
    expect(stripPrescription("300m×6 r4分").includes("300")).toBe(false);
    expect(stripLabeledNumbers("平均心拍186").includes("186")).toBe(false);
  });
});

describe("F-2 練習の構造", () => {
  it("複合区間を読む", () => {
    expect(parseSegments("300(42)＋600(1:26)＋600(1:26)")).toEqual([
      { distanceM: 300, targetSec: 42 },
      { distanceM: 600, targetSec: 86 },
      { distanceM: 600, targetSec: 86 },
    ]);
  });

  it("代表距離は本数が多いもの（同数なら長い方）", () => {
    expect(
      representativeDistance([
        { distanceM: 300 },
        { distanceM: 600 },
        { distanceM: 600 },
      ])
    ).toBe(600);
    expect(representativeDistance([{ distanceM: 300 }, { distanceM: 600 }])).toBe(600);
  });

  it("セット表記 ×2×2 を総本数4として読む", () => {
    expect(parseRepSpec("300(41-42)×2×2")).toMatchObject({ distanceM: 300, reps: 4 });
  });

  it("mを省いた 1000(3:15-25)×4 も読む", () => {
    expect(parseRepSpec("1000(3:15-25)×4 r200jog")).toMatchObject({
      distanceM: 1000,
      reps: 4,
      targetSec: 195,
    });
  });

  it("レースの記録と区間ラップを分けて読む", () => {
    expect(parseRaceRecord("800m 1:56.0(56.0-60.0)")).toEqual({
      timeSec: 116,
      lapsSec: [56, 60],
    });
  });
});

describe("F-2 設定タイムからカテゴリを決める", () => {
  it("GRP近辺の短い区間は高乳酸", () => {
    // 300mを41秒 → 0.1367秒/m ÷ GRP 0.1419 = 96%
    expect(categoryFromTarget(300, 41, GRP).category).toBe("high_lactate");
  });

  it("GRP近辺でも600m超はモデリング", () => {
    expect(categoryFromTarget(800, 113, GRP).category).toBe("modeling");
  });

  it("GRPより明確に遅い1000mはCV", () => {
    // 1000mを3:15 → 0.195秒/m ÷ 0.1419 = 137%
    expect(categoryFromTarget(1000, 195, GRP).category).toBe("cv");
  });

  it("やや遅い程度なら経済走", () => {
    expect(categoryFromTarget(600, 92, GRP).category).toBe("race_economy");
  });

  it("GRPが分からなければ断定しない（人間に選ばせる）", () => {
    const r = inferCategory("1000(3:15-25)×4 r200jog", {});
    expect(r.certain).toBe(false);
  });
});

describe("練習名から主負荷を分類する", () => {
  it("レースペース練習を実際のレースと誤認しない", () => {
    const r = inferCategory("800mレースペース 600m×3", {});
    expect(r.kind).toBe("interval");
    expect(r.category).toBe("race_economy");
    expect(r.certain).toBe(true);
  });

  it("坂ダッシュ・VO2max・スピード持久を区別する", () => {
    expect(inferCategory("坂ダッシュ 10本", {}).category).toBe("neural");
    expect(inferCategory("100mスプリント 6本", {}).category).toBe("neural");
    expect(inferCategory("VO2max 1000m×5", {}).category).toBe("cv");
    expect(inferCategory("スピード持久 300m×5", {}).category).toBe("high_lactate");
  });
});

describe("F-2 実際の日誌がそのまま通ること", () => {
  it("全13行が登録可能になる（未確定ゼロ）", () => {
    const notReady = rows.filter((r) => !r.ready);
    expect(notReady.map((r) => `${r.date}: ${r.issues.join("/")}`)).toEqual([]);
  });

  it("2kmジョグ 8:40 を所要時間として解釈する（ペースではない）", () => {
    const r = byDate("2026-07-04");
    expect(r.kind).toBe("continuous");
    expect(r.distanceKm).toBe(2);
    expect(r.durationSec).toBe(520);
    expect(r.paceSecPerKm).toBeCloseTo(260, 0); // 4:20/km
  });

  it("オフを休養日として記録する", () => {
    const r = byDate("2026-07-05");
    expect(r.kind).toBe("off");
    expect(r.ready).toBe(true);
  });

  it("複合区間は代表距離ぶんだけを能力推定に使い、混在を明示する", () => {
    const r = byDate("2026-07-06");
    expect(r.kind).toBe("interval");
    expect(r.repDistanceM).toBe(600);
    expect(r.repTimesSec).toEqual([86, 85]);
    expect(r.issues.join("")).toContain("距離の違う区間が混ざって");
    // 代表区間の設定でカテゴリを決めていること（300m/42秒ではない）
    expect(r.issues.join("")).toContain("600m");
  });

  it("×2×2 の4本と実施タイム4本が揃う", () => {
    const r = byDate("2026-07-10");
    expect(r.repDistanceM).toBe(300);
    expect(r.reps).toBe(4);
    expect(r.repTimesSec).toEqual([41.6, 41.8, 40, 41.8]);
    expect(r.category).toBe("high_lactate");
    expect(r.restNote).toContain("100");
  });

  it("レースの区間ラップを取り込む（配分シミュレータの材料になる）", () => {
    const r = byDate("2026-07-14");
    expect(r.kind).toBe("race");
    expect(r.raceDistanceM).toBe(800);
    expect(r.raceTimeSec).toBe(113.49);
    expect(r.lapsSec).toEqual([56.7, 56.7]);
  });

  it("小数の誤差を持ち込まない", () => {
    // 1:53.49 を足すと 113.49000000000001 になる
    expect(String(byDate("2026-07-14").raceTimeSec)).toBe("113.49");
  });

  it("1000m×4 は設定からCVと判定する", () => {
    const r = byDate("2026-07-18");
    expect(r.category).toBe("cv");
    expect(r.repTimesSec).toEqual([207, 206, 207, 207]);
    expect(r.avgHr).toBe(180);
    expect(r.maxHr).toBe(195);
  });

  it("65minジョグ 11.8km のような表記を読む", () => {
    const r = byDate("2026-07-16");
    expect(r.durationSec).toBe(3900);
    expect(r.distanceKm).toBe(11.8);
    expect(r.avgHr).toBe(154);
  });

  it("ロングランも有酸素として扱う", () => {
    const r = byDate("2026-07-19");
    expect(r.category).toBe("aerobic");
    expect(r.durationSec).toBe(4500);
    expect(r.distanceKm).toBe(13.7);
  });
});

describe("F-2 推測で埋めないことは維持する", () => {
  it("距離も時間も読めないジョグは登録させない", () => {
    const r = parseRow("7/20 ジョグ 気持ちよかった", 1, TODAY, { grpSecPerM: GRP });
    expect(r.ready).toBe(false);
    expect(r.distanceKm).toBeUndefined();
  });

  it("時間が所要時間かペースか決まらない場合は埋めない", () => {
    // 10km に対する 5:00 は、所要時間としても（30秒/km）ペースとしても
    // 妥当な範囲に収まらない／収まるので判定が割れるケース
    const r = resolveBareTime(300, 1);
    expect(r.ambiguous).toBe(true);
  });

  it("GRPが無ければ距離だけの練習は未確定のまま", () => {
    const r = parseRow("7/20 400×6 r90秒", 1, TODAY, {});
    expect(r.categoryUncertain).toBe(true);
    expect(r.ready).toBe(false);
  });

  it("日付が読めない行は他を解釈しない", () => {
    const r = parseRow("あした ジョグ40分", 1, TODAY);
    expect(r.ready).toBe(false);
    expect(r.kind).toBeUndefined();
  });

  it("同じテキストは何度解釈しても同じ結果になる", () => {
    const a = JSON.stringify(parseBulkText(REAL_LOG, TODAY, { grpSecPerM: GRP }));
    const b = JSON.stringify(parseBulkText(REAL_LOG, TODAY, { grpSecPerM: GRP }));
    expect(a).toBe(b);
  });
});

describe("F-2 日付の解釈", () => {
  it("m/d を直近12週に収まる年で解釈する", () => {
    expect(parseLogDate("7/22", TODAY)).toBe("2026-07-22");
  });

  it("曜日が付いていても読める", () => {
    expect(parseLogDate("7/25土曜", TODAY)).toBe("2026-07-25");
  });

  it("年をまたぐ場合は前年として解釈する", () => {
    expect(parseLogDate("12/20", "2027-01-10")).toBe("2026-12-20");
  });

  it("読めない日付は undefined", () => {
    expect(parseLogDate("あした", TODAY)).toBeUndefined();
  });
});

describe("F-2 旧形式（タブ3列）も引き続き読める", () => {
  const TAB_LOG = `日付\t練習内容\t練習結果
7/22\t8000mペース走（3:50/km）＋流し4本\t平均3:50 平均心拍186
7/23\tジョグ40〜50分（4:50〜5:10/km）\t51分　平均4:40 平均心拍154`;
  const tabRows = parseBulkText(TAB_LOG, TODAY, { grpSecPerM: GRP });

  it("ヘッダーを飛ばして2行を読む", () => {
    expect(tabRows).toHaveLength(2);
  });

  it("ペース走を距離と平均ペースから補完する", () => {
    const r = tabRows[0];
    expect(r.category).toBe("threshold");
    expect(r.distanceKm).toBeCloseTo(8, 1);
    expect(r.durationSec).toBe(1840);
    expect(r.avgHr).toBe(186);
    expect(r.supplementNote).toContain("流し");
  });

  it("距離が書かれていないジョグを時間とペースから補完する", () => {
    const r = tabRows[1];
    expect(r.durationSec).toBe(3060);
    expect(r.distanceKm).toBeCloseTo(10.93, 1);
  });
});

describe("F-2 結果テキストの抽出", () => {
  it("平均ペース・心拍・時間・距離", () => {
    const r = parseResultText("65minジョグ 11.8km 平均心拍154");
    expect(r.durationSec).toBe(3900);
    expect(r.distanceKm).toBe(11.8);
    expect(r.avgHr).toBe(154);
  });

  it("最大心拍も取る", () => {
    expect(parseResultText("平均心拍180 最大195").maxHr).toBe(195);
  });
});
