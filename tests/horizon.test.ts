/**
 * 確定範囲。
 *
 * 見張っているのは「2か月先の設定ペースを決定事項として出さない」こと。
 * 保存フラグではなく日付から毎回計算していること（日が進めば素案は自動で確定になる）。
 */
import { describe, expect, it } from "vitest";
import {
  CONFIRM_HORIZON_DAYS,
  PROVISIONAL_NOTE,
  isConfirmed,
  sessionView,
} from "@/lib/core/horizon";
import { makeSession } from "./helpers";

const TODAY = "2026-08-11";

describe("確定範囲の境界", () => {
  it("今日・境界日ちょうどまでは確定", () => {
    expect(isConfirmed(TODAY, TODAY)).toBe(true);
    expect(isConfirmed("2026-08-25", TODAY)).toBe(true); // 14日後ちょうど
  });

  it("境界の1日先からは素案", () => {
    expect(isConfirmed("2026-08-26", TODAY)).toBe(false);
  });

  it("過去は確定として扱う（すでに起きたこと）", () => {
    expect(isConfirmed("2026-07-01", TODAY)).toBe(true);
  });

  it("M-2の適応窓と同じ日数（片方だけ伸ばすと誰も更新しない範囲ができる）", () => {
    expect(CONFIRM_HORIZON_DAYS).toBe(14);
  });
});

describe("画面に出す処方", () => {
  const withPace = (date: string) =>
    makeSession(date, "high_lactate", {
      prescription: "400m × 3 @400m 52.5〜53.6秒 r6分（完全休息）",
      targetPaces: [{ distanceM: 400, targetSecFast: 52.5, targetSecSlow: 53.6 }],
    });

  it("確定範囲なら処方をそのまま出す", () => {
    const v = sessionView(withPace("2026-08-20"), TODAY);
    expect(v.confirmed).toBe(true);
    expect(v.prescription).toContain("52.5");
    expect(v.badge).toBeUndefined();
  });

  it("素案では設定ペースを出さない（文章側に埋まった数字も消える）", () => {
    const v = sessionView(withPace("2026-10-01"), TODAY);
    expect(v.confirmed).toBe(false);
    expect(v.badge).toBe("素案");
    // 処方本文に埋まっていた秒数が残っていないこと
    expect(v.prescription).not.toContain("52.5");
    expect(v.prescription).not.toContain("53.6");
    expect(v.prescription).not.toContain("400m");
  });

  it("素案でも狙いといつ決まるかは出す（「未定」だけでは行動できない）", () => {
    const v = sessionView(withPace("2026-10-01"), TODAY);
    expect(v.prescription).toContain("解糖系"); // high_lactate の purpose
    expect(v.prescription).toContain(PROVISIONAL_NOTE);
  });

  it("狙いを持たないカテゴリ（off）でも、いつ決まるかは出す", () => {
    const v = sessionView(
      makeSession("2026-10-01", "off", { prescription: "完全休養" }),
      TODAY
    );
    expect(v.prescription).toBe(PROVISIONAL_NOTE);
  });

  it("本人が編集した予定は、どれだけ先でも素案にしない（書いた内容が消えたように見える）", () => {
    const s = makeSession("2026-12-01", "high_lactate", {
      prescription: "自分で書いた 400m × 5",
      userEdited: true,
    });
    const v = sessionView(s, TODAY);
    expect(v.confirmed).toBe(true);
    expect(v.prescription).toBe("自分で書いた 400m × 5");
  });

  it("手で足した予定も素案にしない（origin が generated でない）", () => {
    const s = makeSession("2026-12-01", "aerobic", {
      prescription: "自分で足したジョグ",
      origin: "manual",
    });
    expect(sessionView(s, TODAY).confirmed).toBe(true);
  });

  it("同じセッションでも日が進めば素案から確定に変わる（保存フラグを持たない）", () => {
    const s = withPace("2026-08-26");
    expect(sessionView(s, TODAY).confirmed).toBe(false);
    expect(sessionView(s, "2026-08-12").confirmed).toBe(true);
  });
});
