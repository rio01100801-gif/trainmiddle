/**
 * 分析画面の一番上に出す3つ（課題・今週変えること・リスク）。
 *
 * ここで守らせたいのは順番と言い方。
 *
 *   ・判定できないときは「判定できない」と言う（空欄を良い状態にしない）
 *   ・不足データは1つにまとめる（別々の大きなカードにしない）
 *   ・リスクは「危険」と断定しない（ACWRは補助指標）
 *   ・変えることは**回数**で書く（割合にすると基準が画面に出ない）
 */
import { describe, expect, it } from "vitest";
import { analysisHeadline } from "@/lib/core/analysisHeadline";

const LABELS: Record<string, string> = {
  high_lactate: "高乳酸",
  race_economy: "経済走",
  modeling: "モデリング",
  cv: "CV",
};

describe("最大の課題", () => {
  it("判定があればそれを出す", () => {
    expect(analysisHeadline({ limiterLabel: "後半の維持", categoryLabels: LABELS }).problem).toBe(
      "後半の維持"
    );
  });

  it("判定が無ければ、判定できないと言う（空欄にしない）", () => {
    expect(analysisHeadline({ categoryLabels: LABELS }).problem).toMatch(/ありません/);
    expect(analysisHeadline({ limiterLabel: "   ", categoryLabels: LABELS }).problem).toMatch(
      /ありません/
    );
  });
});

describe("今週変えること", () => {
  it("不足が多い順に、回数で出す", () => {
    const out = analysisHeadline({
      categoryLabels: LABELS,
      targets: [
        { category: "cv", shortfall: 1 },
        { category: "race_economy", shortfall: 3 },
        { category: "modeling", shortfall: 2 },
      ],
    });
    expect(out.actions).toEqual(["経済走 あと3回", "モデリング あと2回", "CV あと1回"]);
  });

  it("足りているものは出さない", () => {
    const out = analysisHeadline({
      categoryLabels: LABELS,
      targets: [
        { category: "cv", shortfall: 0 },
        { category: "modeling", shortfall: -2 },
      ],
    });
    expect(out.actions).toEqual([]);
  });

  it("割合では書かない（基準が画面に出ないため）", () => {
    const out = analysisHeadline({
      categoryLabels: LABELS,
      targets: [{ category: "cv", shortfall: 2 }],
    });
    expect(out.actions.join("")).not.toContain("%");
  });

  it("知らないカテゴリでも落ちない", () => {
    const out = analysisHeadline({
      categoryLabels: LABELS,
      targets: [{ category: "unknown_cat" as never, shortfall: 1 }],
    });
    expect(out.actions).toEqual(["unknown_cat あと1回"]);
  });
});

describe("現在のリスク", () => {
  it("記録が足りなければ、出せないと言う", () => {
    const out = analysisHeadline({ categoryLabels: LABELS });
    expect(out.riskLevel).toBe("unknown");
    expect(out.risk).toMatch(/足りず/);
  });

  it("妥当な範囲なら ok", () => {
    const out = analysisHeadline({
      categoryLabels: LABELS,
      acwr: { rating: "optimal", label: "適正" },
    });
    expect(out.riskLevel).toBe("ok");
  });

  it("急に増えていても「危険」とは書かない（補助指標なので断定しない）", () => {
    const out = analysisHeadline({
      categoryLabels: LABELS,
      acwr: { rating: "high_risk", label: "高リスク" },
    });
    expect(out.riskLevel).toBe("high");
    expect(out.risk).not.toContain("危険");
    expect(out.risk).toContain("急に増えて");
  });

  it("知らない評価はそのラベルを出し、判定はしない", () => {
    const out = analysisHeadline({
      categoryLabels: LABELS,
      acwr: { rating: "brand_new", label: "なにか" },
    });
    expect(out.risk).toBe("なにか");
    expect(out.riskLevel).toBe("unknown");
  });
});

describe("不足データは1つにまとめる", () => {
  it("3つとも足りなければ3行になる", () => {
    const out = analysisHeadline({
      categoryLabels: LABELS,
      split: { enough: false, have: 0, need: 2 },
      hasContactSamples: false,
      hasHrMaxReference: false,
    });
    expect(out.missing.map((m) => m.label)).toEqual(["600m通過", "接地時間", "最大心拍"]);
  });

  it("600m通過は「あと何本」で書く", () => {
    const out = analysisHeadline({
      categoryLabels: LABELS,
      split: { enough: false, have: 1, need: 3 },
    });
    expect(out.missing[0].detail).toBe("あと2本");
  });

  it("足りていれば出さない", () => {
    const out = analysisHeadline({
      categoryLabels: LABELS,
      split: { enough: true, have: 4, need: 2 },
      hasContactSamples: true,
      hasHrMaxReference: true,
    });
    expect(out.missing).toEqual([]);
  });

  it("分からないもの（undefined）は「無い」と決めつけない", () => {
    // 取得できていないだけの状態を「未記録」と書くと、直す先が無い指示になる
    const out = analysisHeadline({ categoryLabels: LABELS });
    expect(out.missing).toEqual([]);
  });
});
