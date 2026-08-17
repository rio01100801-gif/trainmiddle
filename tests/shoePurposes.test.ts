/**
 * 靴の用途を複数選べるようにした。
 *
 * 1つしか選べなかったとき、厚底のように「レースにもポイント練習にも履く」靴を
 * 表せなかった。どちらかを選ぶと、選ばなかったほうの練習で加点されない。
 *
 * ここで守らせたいのは3つ。
 *   ・**端末に入っている古いデータ（単数）が読めること**
 *   ・「決めていない」は他と併用しないこと
 *   ・1つでも噛み合えば加点し、**加点は1回だけ**（選ぶほど有利にしない）
 */
import { describe, expect, it } from "vitest";
import {
  normalizePurposes,
  profileOf,
  isOverridden,
  type ShoeProfile,
} from "@/lib/core/shoeProfile";
import { recommendShoes } from "@/lib/core/shoeRecommend";
import type { Shoe } from "@/lib/core/shoes";

function shoe(over: Partial<Shoe> = {}): Shoe {
  return { id: "s1", name: "テスト", kind: "thick", ...over } as Shoe;
}

describe("用途の整え方", () => {
  it("知らない値は捨てる", () => {
    expect(normalizePurposes(["race", "sauna", "daily"])).toEqual(["race", "daily"]);
  });

  it("重複はまとめる", () => {
    expect(normalizePurposes(["race", "race"])).toEqual(["race"]);
  });

  it("「決めていない」は単独にする", () => {
    // 「決めていないが、レース用でもある」は読めない設定
    expect(normalizePurposes(["race", "any", "daily"])).toEqual(["any"]);
  });

  it("空なら空を返す（呼ぶ側が既定に寄せる）", () => {
    expect(normalizePurposes([])).toEqual([]);
    expect(normalizePurposes("race")).toEqual([]);
    expect(normalizePurposes(undefined)).toEqual([]);
  });

  it("並びは決まっている（同じ選択から同じ順で出る）", () => {
    expect(normalizePurposes(["daily", "race"])).toEqual(
      normalizePurposes(["race", "daily"])
    );
  });
});

describe("古いデータが読めること", () => {
  /*
   * 端末には単数（`purpose`）で保存された靴が入っている。
   * **読めなくすると、本人が設定した用途が黙って既定に戻る。**
   */
  it("単数で保存されたものを1件の配列として読む", () => {
    const s = shoe({ profile: { purpose: "quality" } as Partial<ShoeProfile> });
    expect(profileOf(s).purposes).toEqual(["quality"]);
  });

  it("複数が入っていればそちらを使う", () => {
    const s = shoe({
      profile: { purpose: "quality", purposes: ["race", "daily"] } as Partial<ShoeProfile>,
    });
    expect(profileOf(s).purposes).toEqual(["race", "daily"]);
  });

  it("どちらも無ければ種類の既定", () => {
    // 厚底の既定はレース用
    expect(profileOf(shoe()).purposes).toEqual(["race"]);
  });

  it("単数で保存されていても「本人が決めた」として扱う", () => {
    const s = shoe({ profile: { purpose: "daily" } as Partial<ShoeProfile> });
    expect(isOverridden(s, "purposes")).toBe(true);
  });

  it("何も設定していなければ既定のまま", () => {
    expect(isOverridden(shoe(), "purposes")).toBe(false);
  });

  it("既定の配列は靴ごとに別（1足直して他が変わらない）", () => {
    const a = profileOf(shoe({ id: "a" }));
    const b = profileOf(shoe({ id: "b" }));
    a.purposes.push("daily");
    expect(b.purposes).toEqual(["race"]);
  });
});

describe("推薦での効き方", () => {
  const base = (id: string, purposes: ShoeProfile["purposes"]): Shoe =>
    shoe({
      id,
      name: id,
      kind: "thick",
      profile: { purposes, surfaces: ["track", "road"] } as Partial<ShoeProfile>,
    });

  it("1つでも噛み合えば加点される", () => {
    // CVでは quality が噛み合う。レース用だけの靴より上に来る
    const out = recommendShoes([base("both", ["race", "quality"]), base("raceOnly", ["long"])], {
      kind: "cv",
      place: "track",
    });
    expect(out.best?.shoe.id).toBe("both");
  });

  it("2つ噛み合っても加点は1回だけ（選ぶほど有利にしない）", () => {
    const two = recommendShoes([base("x", ["quality", "race"])], { kind: "cv", place: "track" });
    const one = recommendShoes([base("x", ["quality"])], { kind: "cv", place: "track" });
    expect(two.best?.score).toBe(one.best?.score);
  });

  it("「決めていない」では加点しない", () => {
    const any = recommendShoes([base("x", ["any"])], { kind: "cv", place: "track" });
    const fit = recommendShoes([base("x", ["quality"])], { kind: "cv", place: "track" });
    expect(fit.best!.score).toBeGreaterThan(any.best!.score);
  });

  it("噛み合わない用途だけなら加点しない", () => {
    const off = recommendShoes([base("x", ["recovery"])], { kind: "cv", place: "track" });
    const fit = recommendShoes([base("x", ["quality"])], { kind: "cv", place: "track" });
    expect(fit.best!.score).toBeGreaterThan(off.best!.score);
  });

  it("レースが近いとき、レース用を含んでいれば理由に出る", () => {
    const out = recommendShoes([base("x", ["race", "quality"])], {
      kind: "specific",
      place: "track",
      daysToRace: 7,
    });
    expect(out.best!.reasons.join("")).toContain("レースが近い");
  });

  it("レース用を含まなければ、その理由は出さない", () => {
    const out = recommendShoes([base("x", ["quality"])], {
      kind: "specific",
      place: "track",
      daysToRace: 7,
    });
    expect(out.best!.reasons.join("")).not.toContain("レースが近い");
  });
});
