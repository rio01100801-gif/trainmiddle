/**
 * 生成した処方を、自分で読み直せること。
 *
 * `describeSpec` のコメントは「一括入力が読み取れる書き方に揃える（同じ解釈を通すため）」
 * と書いてあるが、**実際には成立していなかった**。
 *
 *   生成: `300m × 3 @300m 38.7〜39.5秒 r207秒（jog）`
 *   解釈: 設定 300秒/300m（＝GRPの721%）→ カテゴリ CV
 *
 * `@` の直後の `300m` を設定タイムとして読んでいた。
 * 結果として、結果入力の「設定(秒)」に300が入り、高乳酸の日がCVと判定されていた。
 * 画面には「高乳酸」と「設定300秒」が同時に出て、どちらが本当か分からない状態だった。
 *
 * 片方だけのテスト（生成器のテスト／パーサのテスト）では、この食い違いは見つからない。
 * **両方を突き合わせる**ここが要る。
 */
import { describe, expect, it } from "vitest";
import { memRepo } from "./sqlite-helper";
import { regeneratePlan } from "@/lib/service";
import { parsePrescription } from "@/lib/core/prescription";
import { describeSpec, roundRestSec } from "@/lib/core/progression";
import { makeRace, testAthlete } from "./helpers";

const TODAY = "2026-08-13";

function planned() {
  const repo = memRepo();
  repo.saveAthlete(testAthlete());
  const race = makeRace("2026-11-15");
  repo.saveRace(race);
  repo.saveGoal({
    targetEvent: "800m",
    targetTimeSec: 108.9,
    targetRaceId: race.id,
    subRaceIds: [],
  });
  regeneratePlan(repo, TODAY);
  const cfe = repo.getCfe()!;
  return { repo, grpSecPerM: cfe.estimated800mSec / 800 };
}

describe("生成した処方をパーサが同じ意味に読む", () => {
  /**
   * カテゴリの食い違い。
   *
   * パーサは設定ペースがGRPの何%かでカテゴリを決めるので、
   * **書かれていないものは判定できない**（流しは設定が無いので certain=false になる。
   * これは正しい振る舞いなので、確信していないものは対象外にする）。
   *
   * 残る食い違いは既知の1件だけ。ここは「文面が読めない」ではなく
   * **パーサの帯と生成器の意図がズレている**（下の別テストで固定してある）。
   * 新しい食い違いが増えたらここが落ちる。
   */
  it("設定が書かれている処方は、パーサも同じカテゴリに読む（既知の1件を除く）", () => {
    const { repo, grpSecPerM } = planned();
    const targets = repo
      .listSessions()
      .filter((s) => s.targetPaces.length > 0 && s.prescription);
    expect(targets.length).toBeGreaterThan(5);

    const mismatched: string[] = [];
    for (const s of targets) {
      const p = parsePrescription(s.prescription, { grpSecPerM });
      // 確信していない判定は「分からない」であって、間違いではない
      if (!p.categoryCertain) continue;
      if (p.category && p.category !== s.category) {
        mismatched.push(`${s.category}→${p.category}`);
      }
    }
    /*
     * 既知の2件。どちらも「文面が読めない」ではなく、
     * **設定ペースだけからは元のカテゴリを復元できない**という性質の話。
     *   threshold→cv       … 閾値の設定がパーサのCV帯（GRPの160%）に入る
     *   modeling→high_lactate … モデリングは「レースの形を再現する」構造で決まる種目で、
     *                            区間ペースの比率からは高乳酸と区別がつかない
     */
    expect([...new Set(mismatched)].sort()).toEqual(
      ["modeling→high_lactate", "threshold→cv"].sort()
    );
  });

  it("設定タイムが処方の幅の中に入る（距離を設定として読まない）", () => {
    const { repo, grpSecPerM } = planned();
    const off: string[] = [];
    for (const s of repo.listSessions()) {
      if (s.targetPaces.length === 0 || !s.prescription) continue;
      const p = parsePrescription(s.prescription, { grpSecPerM });
      const target = p.slots[0]?.targetSec;
      if (target === undefined) continue;
      const pace = s.targetPaces.find((tp) => tp.distanceM === p.slots[0].distanceM);
      if (!pace) continue;
      // 幅の速い側〜遅い側に収まっていること（丸め分の余裕だけ見る）
      if (target < pace.targetSecFast - 0.2 || target > pace.targetSecSlow + 0.2) {
        off.push(`${s.date} ${target}秒 ∉ [${pace.targetSecFast}, ${pace.targetSecSlow}]`);
      }
    }
    expect(off).toEqual([]);
  });

  it("反復距離が一致する", () => {
    const { repo, grpSecPerM } = planned();
    const off: string[] = [];
    for (const s of repo.listSessions()) {
      if (s.targetPaces.length !== 1 || !s.prescription) continue;
      const p = parsePrescription(s.prescription, { grpSecPerM });
      if (p.repDistanceM !== undefined && p.repDistanceM !== s.targetPaces[0].distanceM) {
        off.push(`${s.date} ${s.targetPaces[0].distanceM}m → ${p.repDistanceM}m`);
      }
    }
    expect(off).toEqual([]);
  });

  /**
   * 複合（モデリング）が区間に割れること。
   *
   * ここが割れないと、モデリングの日に結果入力の欄が組み上がらない
   * （持続走として読まれ、距離と設定の欄が出ない）。
   */
  it("複合の処方が区間に割れる（モデリングの日に欄が出る）", () => {
    const { repo, grpSecPerM } = planned();
    const compounds = repo
      .listSessions()
      .filter((s) => s.category === "modeling" && s.prescription);
    expect(compounds.length).toBeGreaterThan(0);

    for (const s of compounds) {
      const p = parsePrescription(s.prescription, { grpSecPerM });
      expect(p.kind, s.prescription).toBe("interval");
      // 区間数が targetPaces の数と合っていること
      expect(p.slots.length, s.prescription).toBe(s.targetPaces.length);
      for (const pace of s.targetPaces) {
        const slot = p.slots.find((x) => x.distanceM === pace.distanceM);
        expect(slot, `${pace.distanceM}m が区間に無い（${s.prescription}）`).toBeDefined();
        expect(slot!.targetSec).toBeCloseTo(pace.targetSecFast, 1);
      }
      // レストも読めること
      expect(p.restSec ?? p.restDistanceM, s.prescription).toBeDefined();
    }
  });

  it("単一区間のレストは読み取れて、端数になっていない", () => {
    const { repo, grpSecPerM } = planned();
    const odd: string[] = [];
    for (const s of repo.listSessions()) {
      if (!s.prescription || !/[rR]\d/.test(s.prescription)) continue;
      const p = parsePrescription(s.prescription, { grpSecPerM });
      // 複合（500m + 300m）は別テストで固定している既知の穴
      if (p.kind !== "interval") continue;
      if (p.restSec === undefined && p.restDistanceM === undefined) {
        odd.push(`${s.date} レストを読めない（${s.prescription}）`);
        continue;
      }
      // 5秒刻み。207秒のような「なぜその数字か説明できない値」を処方に出さない
      if (p.restSec !== undefined && p.restSec % 5 !== 0) {
        odd.push(`${s.date} レスト${p.restSec}秒が5秒刻みでない`);
      }
    }
    expect(odd).toEqual([]);
  });
});

/**
 * 見つけたが今回直していない食い違い。
 *
 * 直さなかったのは、どちらも**今回報告された不具合とは別の判断が要る**ため。
 * 黙って落とすと忘れるので、現状をここで固定しておく。
 * 直したときはこのテストが落ちるので、そのとき消すこと。
 */
describe("既知の食い違い（未修正・現状を固定する）", () => {
  it("閾値の設定がパーサのCV帯に入る（帯の再調整が要る。競技的な判断を含む）", () => {
    const p = parsePrescription("1000m × 4 @1000m 222.0〜227.0秒 r75秒（jog）", {
      grpSecPerM: 111 / 800,
    });
    expect(p.category).toBe("cv");
    expect(p.basis).toContain("160%");
  });

  /*
   * forge-v83 で直したぶん。
   * 旧形式（`500m + 300m @500m ... / 300m ...`）は今も読めないままだが、
   * 生成器がその形を出さなくなったので実害は無い。
   * **すでに端末に入っている旧形式の予定は読めない**ので、それが分かる形で残す。
   */
  it("旧形式の複合はいまも持続走として読む（生成器はもう出さない）", () => {
    const p = parsePrescription(
      "500m + 300m @500m 68.7〜69.4秒 / 300m 41.2〜41.6秒 r1分（walk）",
      { grpSecPerM: 111 / 800 }
    );
    expect(p.kind).toBe("continuous");
    expect(p.slots).toEqual([]);
  });
});

describe("この不具合そのもの（回帰）", () => {
  it("@300m 38.7〜39.5秒 を設定300秒と読まない", () => {
    const p = parsePrescription("300m × 3 @300m 38.7〜39.5秒 r205秒（jog）", {
      grpSecPerM: 111 / 800,
    });
    expect(p.slots[0].targetSec).toBeCloseTo(38.7, 1);
    expect(p.category).toBe("high_lactate");
    expect(p.restSec).toBe(205);
    expect(p.restType).toBe("jog");
  });

  it("距離ラベルが無い書き方はこれまでどおり読む", () => {
    const p = parsePrescription("300m × 5 @40.9〜41.7秒 r5分", { grpSecPerM: 111 / 800 });
    expect(p.slots[0].targetSec).toBeCloseTo(40.9, 1);
    expect(p.restSec).toBe(300);
  });

  it("@300（mが無い）は300秒のままにする（長い区間の設定を壊さない）", () => {
    const p = parsePrescription("1000m × 3 @300 r5分", { grpSecPerM: 111 / 800 });
    expect(p.slots[0].targetSec).toBe(300);
  });

  it("完全休息をjogと読まない", () => {
    const p = parsePrescription("600m × 3 @1:26.0〜1:27.0秒 r8分（完全休息）", {
      grpSecPerM: 111 / 800,
    });
    expect(p.restType).toBe("full");
  });
});

describe("レストの丸め", () => {
  it("5秒刻みにする", () => {
    expect(roundRestSec(207)).toBe(205);
    expect(roundRestSec(240)).toBe(240);
    expect(roundRestSec(238)).toBe(240);
  });

  it("0や負にしない", () => {
    expect(roundRestSec(1)).toBe(5);
    expect(roundRestSec(0)).toBe(5);
  });

  it("丸めた値が処方の文面にもそのまま出る（値と文面がズレない）", () => {
    const text = describeSpec(
      [{ distanceM: 300, reps: 3 }],
      roundRestSec(207),
      "jog",
      [{ distanceM: 300, targetSecFast: 38.7, targetSecSlow: 39.5 }]
    );
    expect(text).toContain("r205秒");
    expect(text).not.toContain("207");
  });
});
