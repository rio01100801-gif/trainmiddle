/**
 * その日の練習にどの靴を履くか。
 *
 * **速い靴を選ぶ仕組みではない。** 「その練習の目的を達しながら、
 * 脚への負担を抑えられるか」で並べる。
 *
 * ここで守るのは、指定された受入条件そのもの。
 * 特に「登録していない靴を出さない」は絶対で、
 * 持っていない靴を薦めても履けないうえ、
 * **こちらが製品を知っているかのような誤解**を生む。
 */
import { describe, expect, it } from "vitest";
import {
  RECOMMEND_MIN_SAMPLES,
  recommendShoes,
  shoeSessionKindOf,
  type ShoeContext,
  type ShoeOutcome,
} from "@/lib/core/shoeRecommend";
import { defaultProfile, profileOf } from "@/lib/core/shoeProfile";
import type { Shoe, ShoeUsage } from "@/lib/core/shoes";

const vaporfly: Shoe = { id: "vf4", name: "ヴェイパーフライ4", kind: "thick" };
const pegasus: Shoe = { id: "peg", name: "ペガサス41", kind: "trainer" };
const spike: Shoe = { id: "spk", name: "エアズームビクトリー", kind: "spike" };
const thin: Shoe = { id: "thn", name: "薄底", kind: "thin" };
const all = [vaporfly, pegasus, spike, thin];

const usageOf = (entries: { id: string; km: number }[]): ShoeUsage[] =>
  entries.map((e) => ({
    shoe: all.find((s) => s.id === e.id)!,
    totalKm: e.km,
    sessions: 1,
  }));

const ctx = (over: Partial<ShoeContext> = {}): ShoeContext => ({ kind: "cv", ...over });

describe("受入条件", () => {
  it("CVでは厚底（ヴェイパーフライ4）が上に来る", () => {
    /*
     * 速いからではなく、設定ペースを維持したまま量を確保でき、
     * 脚へのダメージも抑えられるため。
     */
    const out = recommendShoes(all, ctx({ kind: "cv" }));
    expect(out.best?.shoe.id).toBe("vf4");
    expect(out.best?.reasons.join(" ")).toBeTruthy();
  });

  it("登録していない靴は出さない", () => {
    const out = recommendShoes([pegasus], ctx({ kind: "cv" }));
    expect(out.best?.shoe.id).toBe("peg");
    const ids = [out.best!, ...out.alternatives].map((s) => s.shoe.id);
    expect(ids).toEqual(["peg"]);
    expect(ids).not.toContain("vf4");
  });

  it("引退させた靴も出さない", () => {
    const out = recommendShoes(
      [{ ...vaporfly, retired: true }, pegasus],
      ctx({ kind: "cv" })
    );
    const ids = [out.best!, ...out.alternatives].map((s) => s.shoe.id);
    expect(ids).not.toContain("vf4");
  });

  it("雨のときはグリップの低い靴の順位が下がる", () => {
    const grippy: Shoe = {
      id: "grip",
      name: "グリップ重視",
      kind: "trainer",
      profile: { grip: 5 },
    };
    const slippery: Shoe = {
      id: "slip",
      name: "グリップ低い",
      kind: "trainer",
      profile: { grip: 1 },
    };
    const dry = recommendShoes([slippery, grippy], ctx({ kind: "easy" }));
    const wet = recommendShoes([slippery, grippy], ctx({ kind: "easy", wet: true }));
    // 乾いていれば差は付かない（登録順のまま）
    expect(dry.best?.shoe.id).toBe("slip");
    // 濡れたらグリップのあるほうが上に来る
    expect(wet.best?.shoe.id).toBe("grip");
    const slipEntry = [wet.best!, ...wet.alternatives].find((s) => s.shoe.id === "slip");
    expect(slipEntry?.cautions.join(" ")).toContain("グリップ");
  });

  it("疲労や痛みが強いときはスパイクの順位が下がる", () => {
    /*
     * **スパイクであること自体**で下がることを見る。
     * 硬さ（クッションの低さ）でも下がるので、
     * 比べる相手はクッションを揃えた非スパイクにする——
     * 揃えないと、クッションの減点だけでも順位が動いて
     * スパイクの規則を消しても落ちない検査になる（実際そうなっていた）。
     */
    const hardNonSpike: Shoe = {
      id: "hard",
      name: "硬い薄底",
      kind: "thin",
      profile: { cushioning: 1, responsiveness: 5, stability: 2, lightness: 5, isSpike: false },
    };
    const pair = [spike, hardNonSpike];
    const rankOf = (r: ReturnType<typeof recommendShoes>, id: string) =>
      [r.best!, ...r.alternatives].findIndex((s) => s.shoe.id === id);

    const normal = recommendShoes(pair, ctx({ kind: "specific" }));
    const tired = recommendShoes(pair, ctx({ kind: "specific", fatigueHigh: true, hasPain: true }));
    expect(rankOf(normal, "spk")).toBe(0);
    expect(rankOf(tired, "spk")).toBe(1);
  });

  it("登録が無ければ、登録を促す", () => {
    const out = recommendShoes([], ctx());
    expect(out.best).toBeUndefined();
    expect(out.emptyNote).toContain("登録");
  });

  it("全部引退なら、そう言う（登録しろとは言わない）", () => {
    const out = recommendShoes([{ ...pegasus, retired: true }], ctx());
    expect(out.best).toBeUndefined();
    expect(out.emptyNote).toContain("引退");
  });
});

describe("練習の狙いごとの重み", () => {
  it("リカバリーではクッションのある靴が上に来る（反発ではない）", () => {
    const out = recommendShoes(all, ctx({ kind: "recovery" }));
    // 厚底とトレーニングはどちらもクッションがあるが、スパイク・薄底は下
    const ids = [out.best!, ...out.alternatives].map((s) => s.shoe.id);
    expect(ids.indexOf("peg")).toBeLessThan(ids.indexOf("thn"));
    expect(ids.indexOf("spk")).toBe(ids.length - 1);
  });

  it("坂ダッシュでは安定と軽さ。スパイクは履かない", () => {
    const out = recommendShoes(all, ctx({ kind: "hill" }));
    const spikeEntry = [out.best!, ...out.alternatives].find((s) => s.shoe.id === "spk");
    expect(spikeEntry?.cautions.join(" ")).toContain("スパイクは履きません");
    expect(out.best?.shoe.id).not.toBe("spk");
  });

  it("レースではスパイクが候補に戻る", () => {
    const out = recommendShoes(all, ctx({ kind: "race" }));
    const spikeEntry = [out.best!, ...out.alternatives].find((s) => s.shoe.id === "spk");
    expect(spikeEntry?.cautions.join(" ")).not.toContain("スパイクは履きません");
  });
});

describe("場所と劣化", () => {
  it("その場所向きでなければ下げて、理由も言う", () => {
    const out = recommendShoes(all, ctx({ kind: "easy", place: "trail" }));
    const vf = [out.best!, ...out.alternatives].find((s) => s.shoe.id === "vf4");
    expect(vf?.cautions.join(" ")).toContain("その場所向き");
  });

  it("使用距離が多い靴には履き替えの注意を出す", () => {
    const out = recommendShoes(all, ctx({ kind: "easy" }), usageOf([{ id: "peg", km: 900 }]));
    const peg = [out.best!, ...out.alternatives].find((s) => s.shoe.id === "peg");
    expect(peg?.cautions.join(" ")).toContain("履き替え");
  });

  it("使用距離が少なければ注意は出さない", () => {
    const out = recommendShoes(all, ctx({ kind: "easy" }), usageOf([{ id: "peg", km: 100 }]));
    const peg = [out.best!, ...out.alternatives].find((s) => s.shoe.id === "peg");
    expect(peg?.cautions.join(" ")).not.toContain("履き替え");
  });
});

describe("本人の設定が一般的な傾向より優先される", () => {
  it("種類の既定は出発点にすぎない", () => {
    expect(profileOf(vaporfly).cushioning).toBe(defaultProfile("thick").cushioning);
    const custom: Shoe = { ...vaporfly, profile: { cushioning: 1 } };
    expect(profileOf(custom).cushioning).toBe(1);
  });

  it("用途を決めてあれば、その練習で上がる", () => {
    const marked: Shoe = { ...pegasus, profile: { purpose: "recovery" } };
    const out = recommendShoes([vaporfly, marked], ctx({ kind: "recovery" }));
    expect(out.best?.shoe.id).toBe("peg");
    expect(out.best?.reasons.join(" ")).toContain("決めてある");
  });

  it("範囲外の値は既定に落とす（壊れた設定で推薦が飛ばない）", () => {
    const broken: Shoe = { ...pegasus, profile: { cushioning: 99 as never } };
    expect(profileOf(broken).cushioning).toBe(defaultProfile("trainer").cushioning);
  });
});

describe("自分の実績の使い方", () => {
  const outcome = (over: Partial<ShoeOutcome> = {}): ShoeOutcome => ({
    shoeId: "peg",
    kind: "cv",
    rpe: 5,
    legsHeavy: false,
    ...over,
  });

  it("回数が足りないうちは順位を動かさない", () => {
    /*
     * 1〜2回の結果で順位を変えると、たまたま調子が悪かった日が
     * 「その靴が合わない」になる。
     */
    const few = Array.from({ length: RECOMMEND_MIN_SAMPLES - 1 }, () => outcome());
    const withoutData = recommendShoes([vaporfly, pegasus], ctx({ kind: "cv" }));
    const withFew = recommendShoes([vaporfly, pegasus], ctx({ kind: "cv" }), [], few);
    expect(withFew.best?.shoe.id).toBe(withoutData.best?.shoe.id);
  });

  it("回数が足りないことを必ず断る（「学習済み」と誤解させない）", () => {
    const out = recommendShoes([vaporfly, pegasus], ctx({ kind: "cv" }));
    expect(out.dataNote).toContain("足りません");
  });

  it("たまったら少しだけ効かせ、何回ぶんかを添える", () => {
    const enough = Array.from({ length: RECOMMEND_MIN_SAMPLES }, () =>
      outcome({ rpe: 3, legsHeavy: false })
    );
    const out = recommendShoes([vaporfly, pegasus], ctx({ kind: "cv" }), [], enough);
    const peg = [out.best!, ...out.alternatives].find((s) => s.shoe.id === "peg");
    expect(peg?.reasons.join(" ")).toContain(`${RECOMMEND_MIN_SAMPLES}回`);
    expect(out.dataNote).toBeUndefined();
  });

  it("別の練習での実績は持ち込まない", () => {
    const otherKind = Array.from({ length: RECOMMEND_MIN_SAMPLES }, () =>
      outcome({ kind: "recovery", rpe: 2 })
    );
    const out = recommendShoes([vaporfly, pegasus], ctx({ kind: "cv" }), [], otherKind);
    expect(out.best?.shoe.id).toBe("vf4");
  });
});

describe("同じ入力からは同じ順番", () => {
  it("何度呼んでも変わらない（乱数で散らさない）", () => {
    const a = recommendShoes(all, ctx({ kind: "cv" }));
    const b = recommendShoes(all, ctx({ kind: "cv" }));
    expect([a.best!, ...a.alternatives].map((s) => s.shoe.id)).toEqual(
      [b.best!, ...b.alternatives].map((s) => s.shoe.id)
    );
  });
});

describe("カテゴリから狙いへ", () => {
  it("見た目の名前ではなくカテゴリで決める", () => {
    expect(shoeSessionKindOf("cv")).toBe("cv");
    expect(shoeSessionKindOf("high_lactate")).toBe("glycolytic");
    expect(shoeSessionKindOf("neural")).toBe("hill");
    expect(shoeSessionKindOf("aerobic", { aerobicPurpose: "recovery" })).toBe("recovery");
    expect(shoeSessionKindOf("aerobic", { aerobicPurpose: "long_run" })).toBe("long");
    expect(shoeSessionKindOf("aerobic")).toBe("easy");
  });

  it("レースはカテゴリより優先する", () => {
    expect(shoeSessionKindOf("high_lactate", { isRace: true })).toBe("race");
  });
});
