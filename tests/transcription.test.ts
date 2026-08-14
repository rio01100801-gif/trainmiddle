/**
 * 写真からの転記。
 *
 * 見張るのはひとつ。**文字起こしが解釈に化けていないこと。**
 * 整形・並べ替え・単位の補完はどれも解釈で、ここでやると
 * `parseRow` が唯一の解釈という前提が崩れる。崩れると、
 * あとで数値を疑ったときにどこで曲がったのか追えなくなる。
 */
import { describe, expect, it } from "vitest";
import {
  ACCEPTED_IMAGE_TYPES,
  cleanTranscription,
  fitWithin,
  isAcceptedImageType,
  MAX_IMAGE_EDGE,
  NOTHING_TO_READ,
  TRANSCRIPTION_SYSTEM_PROMPT,
  UNREADABLE_MARK,
} from "@/lib/core/transcription";
import { parseBulkText } from "@/lib/core/bulkImport";

describe("指示", () => {
  it("推測で埋めさせない", () => {
    expect(TRANSCRIPTION_SYSTEM_PROMPT).toContain("推測で埋めない");
    expect(TRANSCRIPTION_SYSTEM_PROMPT).toContain(UNREADABLE_MARK);
  });

  it("解釈させない（整形・判定を禁じている）", () => {
    expect(TRANSCRIPTION_SYSTEM_PROMPT).toContain("表記を整えないでください");
    expect(TRANSCRIPTION_SYSTEM_PROMPT).toContain("練習の種類を判定したり");
  });

  it("並び順を変えさせない", () => {
    expect(TRANSCRIPTION_SYSTEM_PROMPT).toContain("順序を変えないでください");
  });
});

describe("応答の受け取り", () => {
  it("そのままの本文は触らない", () => {
    const raw = "7/4 2kmジョグ 8:40\n7/5 オフ";
    expect(cleanTranscription(raw).text).toBe(raw);
  });

  it("コードフェンスは外す", () => {
    const r = cleanTranscription("```\n7/4 2kmジョグ 8:40\n7/5 オフ\n```");
    expect(r.text).toBe("7/4 2kmジョグ 8:40\n7/5 オフ");
  });

  it("言語つきのフェンスも外す", () => {
    expect(cleanTranscription("```text\n7/6 300(42)×3\n```").text).toBe("7/6 300(42)×3");
  });

  it("片側だけの ``` は本文として残す（勝手に削らない）", () => {
    const raw = "```\n7/4 ジョグ";
    expect(cleanTranscription(raw).text).toBe(raw);
  });

  it("前後の空行だけを落とす（行内の空白は残す）", () => {
    const r = cleanTranscription("\n\n7/6 300(42)  ＋600(1:26)\n\n");
    expect(r.text).toBe("7/6 300(42)  ＋600(1:26)");
  });

  it("読めなかった箇所を数える", () => {
    const r = cleanTranscription(`7/6 300(${UNREADABLE_MARK})×3\n7/7 ${UNREADABLE_MARK}`);
    expect(r.unreadableCount).toBe(2);
  });

  it("読めた場合は0件", () => {
    expect(cleanTranscription("7/4 2kmジョグ 8:40").unreadableCount).toBe(0);
  });

  it("文字が写っていない応答は本文にしない", () => {
    const r = cleanTranscription(NOTHING_TO_READ);
    expect(r.text).toBe("");
    expect(r.rejected).toContain("読み取れませんでした");
  });

  it("同じ言葉が本文中に出てきただけなら拒否にしない", () => {
    /*
     * 合図の文字列そのものを本文に含めておく。
     * 含めないと「合図が無いから拒否されない」を確かめるだけの空テストになる
     * （実際、合図を NOTHING_TO_READ へ変えたときに一度そうなった）。
     */
    const long = `7/4 2kmジョグ 8:40\n7/5 メモに「${NOTHING_TO_READ}」と書いてあったので撮り直した\n7/6 オフ`;
    expect(long).toContain(NOTHING_TO_READ);
    expect(long.length).toBeGreaterThanOrEqual(40);
    const r = cleanTranscription(long);
    expect(r.rejected).toBeUndefined();
    expect(r.text).toBe(long);
  });
});

/**
 * ここが本題。
 * 文字起こしの出力を、これまでと同じ `parseRow`（previewRows）がそのまま解釈できること。
 * できなければ「写真 → 一括入力」の受け渡しが成立していない。
 */
describe("文字起こしの出力を既存のパーサがそのまま読める", () => {
  it("普通の日誌がこれまでどおり解釈される", () => {
    const transcribed = cleanTranscription(
      "```\n7/4 2kmジョグ 8:40\n7/6 300(42)＋600(1:26)＋600(1:26) r15min\n```"
    );
    const rows = parseBulkText(transcribed.text, "2026-08-13");
    expect(rows.length).toBe(2);
    expect(rows.every((r) => r.date)).toBe(true);
  });

  it("読めなかった印が残っていても、その行だけが未確定になる（他の行を巻き込まない）", () => {
    const transcribed = cleanTranscription(
      `7/4 2kmジョグ 8:40\n7/6 300(${UNREADABLE_MARK})×3 r15min`
    );
    const rows = parseBulkText(transcribed.text, "2026-08-13");
    expect(rows.length).toBe(2);
    // 1行目は読めているので日付が取れている
    expect(rows[0].date).toBeTruthy();
  });
});

describe("送る前の縮小（大きさの計算）", () => {
  it("上限より小さい写真は拡大しない", () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it("長辺を上限に合わせ、縦横比を保つ", () => {
    const r = fitWithin(4032, 3024);
    expect(Math.max(r.width, r.height)).toBe(MAX_IMAGE_EDGE);
    expect(r.width / r.height).toBeCloseTo(4032 / 3024, 2);
  });

  it("縦長でも長辺を見る", () => {
    const r = fitWithin(3024, 4032);
    expect(r.height).toBe(MAX_IMAGE_EDGE);
    expect(r.width).toBeLessThan(r.height);
  });

  it("ちょうど上限なら変えない", () => {
    expect(fitWithin(MAX_IMAGE_EDGE, 100)).toEqual({ width: MAX_IMAGE_EDGE, height: 100 });
  });

  it("大きさが取れない場合は0を返す（呼び出し側が止められるように）", () => {
    expect(fitWithin(0, 0)).toEqual({ width: 0, height: 0 });
  });

  it("極端に細長くても1px未満にしない", () => {
    const r = fitWithin(10000, 3);
    expect(r.height).toBeGreaterThanOrEqual(1);
  });
});

describe("受け取る画像形式", () => {
  it("Anthropicが受ける形式だけを通す", () => {
    for (const t of ACCEPTED_IMAGE_TYPES) expect(isAcceptedImageType(t)).toBe(true);
    expect(isAcceptedImageType("image/heic")).toBe(false);
    expect(isAcceptedImageType("application/pdf")).toBe(false);
  });
});
