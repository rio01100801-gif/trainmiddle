/**
 * 表記辞書の候補出し。
 *
 * 辞書は一度入ると効き続ける。妙な語が入ると、以降その語を含む行が全部そう読まれ、
 * しかも本人は「なぜこう読まれたのか」を辞書まで遡らないと分からない。
 * だから入口の検査を厳しくしてある。ここで見張るのは
 *   ・**行に書かれていない語を通さない**（言い換え・要約を辞書にしない）
 *   ・どの行にも当たる語（短い・数字だけ）を通さない
 *   ・種類・カテゴリが決められた集合の外なら通さない
 *   ・理由が無ければ通さない（却下する材料を本人に残す）
 */
import { describe, expect, it } from "vitest";
import {
  buildPhraseSuggestionRequest,
  MIN_PHRASE_LENGTH,
  parsePhraseSuggestion,
  PHRASE_SUGGESTION_SYSTEM_PROMPT,
  SUGGESTABLE_CATEGORIES,
  SUGGESTABLE_KINDS,
} from "@/lib/core/phraseSuggestion";

const LINE = "7/9 B-up走 8000m 平均心拍158";

const ok = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    phrase: "B-up走",
    kind: "continuous",
    category: null,
    strengthType: null,
    reason: "8000mを心拍つきで走っており、本数の記載が無いため持続走と読みました",
    ...over,
  });

describe("通る場合", () => {
  it("行に書かれた語・決められた種類・理由がそろえば案になる", () => {
    const r = parsePhraseSuggestion(ok(), LINE);
    expect(r.error).toBeUndefined();
    expect(r.suggestion?.phrase).toBe("B-up走");
    expect(r.suggestion?.kind).toBe("continuous");
    expect(r.suggestion?.reason).toContain("持続走");
  });

  it("コードフェンスで包まれていても読む", () => {
    const r = parsePhraseSuggestion("```json\n" + ok() + "\n```", LINE);
    expect(r.suggestion?.phrase).toBe("B-up走");
  });

  it("全角・大文字小文字の違いは吸収して突き合わせる", () => {
    const r = parsePhraseSuggestion(ok({ phrase: "ｂ-ｕｐ走" }), LINE);
    expect(r.error).toBeUndefined();
  });

  it("ポイント練習ならカテゴリを受け取る", () => {
    const line = "7/6 なわとび坂 300×5 r5min";
    const r = parsePhraseSuggestion(
      ok({ phrase: "なわとび坂", kind: "interval", category: "high_lactate" }),
      line
    );
    expect(r.suggestion?.category).toBe("high_lactate");
  });

  it("補強なら種別を受け取る", () => {
    const line = "7/8 サーキット 40分";
    const r = parsePhraseSuggestion(
      ok({ phrase: "サーキット", kind: "strength", strengthType: "core" }),
      line
    );
    expect(r.suggestion?.strengthType).toBe("core");
  });
});

describe("通さない場合", () => {
  it("行に書かれていない語は通さない（言い換えを辞書にしない）", () => {
    const r = parsePhraseSuggestion(ok({ phrase: "ビルドアップ走" }), LINE);
    expect(r.suggestion).toBeUndefined();
    expect(r.error).toContain("書かれていない");
  });

  it("短すぎる語は通さない", () => {
    const r = parsePhraseSuggestion(ok({ phrase: "走" }), LINE);
    expect(r.error).toContain("短すぎます");
    expect("走".length).toBeLessThan(MIN_PHRASE_LENGTH);
  });

  it("数字・記号だけの語は通さない", () => {
    const r = parsePhraseSuggestion(ok({ phrase: "8000" }), LINE);
    expect(r.error).toContain("辞書にできません");
  });

  it("知らない種類は通さない", () => {
    const r = parsePhraseSuggestion(ok({ kind: "tempo" }), LINE);
    expect(r.error).toContain("判断できませんでした");
  });

  it("種類がnullなら通さない（無理に決めさせない）", () => {
    const r = parsePhraseSuggestion(ok({ kind: null }), LINE);
    expect(r.suggestion).toBeUndefined();
  });

  it("理由が無ければ通さない", () => {
    const r = parsePhraseSuggestion(ok({ reason: "" }), LINE);
    expect(r.error).toContain("根拠");
  });

  it("JSONでなければ通さない", () => {
    expect(parsePhraseSuggestion("この行はビルドアップ走です", LINE).error).toBeDefined();
  });

  it("すでに辞書にある語は通さない", () => {
    const r = parsePhraseSuggestion(ok(), LINE, ["B-up走"]);
    expect(r.error).toContain("すでに辞書");
  });
});

describe("種類と合わない付随情報は捨てる（案そのものは活かす）", () => {
  it("持続走にレース用のカテゴリが付いてきても落とす", () => {
    const r = parsePhraseSuggestion(ok({ kind: "off", category: "high_lactate" }), LINE);
    expect(r.suggestion?.kind).toBe("off");
    expect(r.suggestion?.category).toBeUndefined();
  });

  it("集合の外のカテゴリは落とす", () => {
    const line = "7/6 なわとび坂 300×5";
    const r = parsePhraseSuggestion(
      ok({ phrase: "なわとび坂", kind: "interval", category: "aerobic" }),
      line
    );
    expect(r.suggestion?.kind).toBe("interval");
    expect(r.suggestion?.category).toBeUndefined();
  });

  it("補強でないのに種別が付いてきても落とす", () => {
    const r = parsePhraseSuggestion(ok({ strengthType: "core" }), LINE);
    expect(r.suggestion?.strengthType).toBeUndefined();
  });
});

describe("送る内容", () => {
  it("行と、すでに覚えている語だけを送る", () => {
    const body = buildPhraseSuggestionRequest(LINE, ["ペース走", "WS"]);
    expect(body).toContain(LINE);
    expect(body).toContain("ペース走");
    expect(body).toContain("WS");
  });

  it("覚えている語が無ければ、その部分は付けない", () => {
    const body = buildPhraseSuggestionRequest(LINE);
    expect(body).toContain(LINE);
    expect(body).not.toContain("すでに辞書にある語");
  });
});

describe("指示", () => {
  it("書かれていない語を作らせない", () => {
    expect(PHRASE_SUGGESTION_SYSTEM_PROMPT).toContain("実際に書かれている文字列");
    expect(PHRASE_SUGGESTION_SYSTEM_PROMPT).toContain("書かれていない語を作らない");
  });

  it("分からないときは決めさせない", () => {
    expect(PHRASE_SUGGESTION_SYSTEM_PROMPT).toContain("無理に答えず");
  });

  it("選べる値を全部書いてある（画面の選択肢とずれない）", () => {
    for (const k of SUGGESTABLE_KINDS) expect(PHRASE_SUGGESTION_SYSTEM_PROMPT).toContain(k);
    for (const c of SUGGESTABLE_CATEGORIES) expect(PHRASE_SUGGESTION_SYSTEM_PROMPT).toContain(c);
  });
});
