/**
 * 機能検索。
 *
 * 見張るのは「本人の言葉で引けること」。
 * 画面名を知っている人しか辿り着けないなら、探せないという問題は解けていない。
 */
import { describe, expect, it } from "vitest";
import { FEATURES, normalizeQuery, searchFeatures } from "@/lib/core/featureSearch";

const idsFor = (q: string) => searchFeatures(q).map((h) => h.feature.id);

describe("表記ゆれを吸収する", () => {
  it("大文字小文字・全角・カタカナひらがなを同じに扱う", () => {
    expect(normalizeQuery("ＣＦＥ")).toBe(normalizeQuery("cfe"));
    expect(normalizeQuery("ペース")).toBe(normalizeQuery("ぺーす"));
    expect(normalizeQuery("バック アップ")).toBe(normalizeQuery("バックアップ"));
  });
});

describe("本人の言葉で引ける", () => {
  it("「cfe」で現在地の測定が出る", () => {
    expect(idsFor("cfe")).toContain("refit-cfe");
  });

  it("「ずれてる」でも現在地の測定が出る（症状で引ける）", () => {
    expect(idsFor("ずれてる")).toContain("refit-cfe");
  });

  it("「バックアップ」でデータ管理が出る（画面名を知らなくてよい）", () => {
    expect(idsFor("バックアップ")).toContain("data");
  });

  it("「ガーミン」でFIT取込のあるデータ管理が出る", () => {
    expect(idsFor("ガーミン")).toContain("data");
  });

  it("「コーチに見せる」で週次レビューが出る", () => {
    expect(idsFor("コーチ")).toContain("weekly-review");
  });

  it("「暑い」で暑熱順化が出る", () => {
    expect(idsFor("暑い")).toContain("heat");
  });

  it("「足りない」で4週間のバランスが出る", () => {
    expect(idsFor("足りない")).toContain("coverage");
  });
});

describe("結果の並びと再現性", () => {
  it("同じ入力からは必ず同じ結果が出る（LLMを使っていない）", () => {
    const a = searchFeatures("記録");
    const b = searchFeatures("記録");
    expect(a.map((h) => h.feature.id)).toEqual(b.map((h) => h.feature.id));
  });

  it("名前が一致したものが、言い換え一致より上に来る", () => {
    const hits = searchFeatures("暑熱順化");
    expect(hits[0].feature.id).toBe("heat");
    expect(hits[0].matchedOn).toBe("label");
  });

  it("空の入力では何も返さない（打ち始める前に一覧を出さない）", () => {
    expect(searchFeatures("")).toHaveLength(0);
    expect(searchFeatures("   ")).toHaveLength(0);
  });

  it("該当が無ければ空で返す（無理に何かを出さない）", () => {
    expect(searchFeatures("ぬるぽ")).toHaveLength(0);
  });

  it("なぜ一致したかを返す（あとで結果を疑えるように）", () => {
    for (const h of searchFeatures("cfe")) {
      expect(["label", "keyword", "description"]).toContain(h.matchedOn);
    }
  });
});

describe("カタログの健全性", () => {
  it("idが重複していない", () => {
    const ids = FEATURES.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("行き先が必ず / で始まる（ハッシュルーティングに載る形）", () => {
    for (const f of FEATURES) expect(f.href.startsWith("/")).toBe(true);
  });

  it("すべての機能が自分の名前で引ける", () => {
    for (const f of FEATURES) {
      expect(idsFor(f.label)).toContain(f.id);
    }
  });
});
