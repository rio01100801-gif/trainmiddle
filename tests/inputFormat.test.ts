import { describe, it, expect } from "vitest";
import {
  completeRunTriple,
  fmtDuration,
  fmtPaceSecPerKm,
  formatTimeInput,
  parseDurationToSec,
  parsePaceToSecPerKm,
  parseTimeToSec,
} from "@/lib/core/inputFormat";

describe("D-3 タイム入力の自動整形", () => {
  it("指示書の例どおりに整形する", () => {
    expect(formatTimeInput("13530")).toBe("1:35.30");
    expect(formatTimeInput("3040")).toBe("30:40");
  });

  it("桁数ごとの規則", () => {
    expect(formatTimeInput("9")).toBe("9");
    expect(formatTimeInput("43")).toBe("43");
    expect(formatTimeInput("940")).toBe("9:40");
    expect(formatTimeInput("103530")).toBe("10:35.30");
  });

  it("すでにコロンやピリオドを手入力している場合は触らない", () => {
    expect(formatTimeInput("1:49.51")).toBe("1:49.51");
    expect(formatTimeInput("43.2")).toBe("43.2");
  });

  it("7桁以上は判断できないのでそのまま返す", () => {
    expect(formatTimeInput("1234567")).toBe("1234567");
  });

  it("整形結果は秒に戻せる（往復して壊れない）", () => {
    expect(parseTimeToSec(formatTimeInput("13530"))).toBeCloseTo(95.3, 5);
    expect(parseTimeToSec(formatTimeInput("3040"))).toBeCloseTo(1840, 5);
  });

  it("空文字や不正値は undefined", () => {
    expect(parseTimeToSec("")).toBeUndefined();
    expect(parseTimeToSec("abc")).toBeUndefined();
  });
});

describe("F-1 所要時間の表記", () => {
  it("単位なしの数値は「分」として読む（練習日誌の実態に合わせる）", () => {
    expect(parseDurationToSec("51")).toBe(51 * 60);
    expect(parseDurationToSec("30")).toBe(1800);
  });

  it("分:秒 と 時:分:秒 を読む", () => {
    expect(parseDurationToSec("51:30")).toBe(51 * 60 + 30);
    expect(parseDurationToSec("1:05:00")).toBe(3900);
  });

  it("和文表記も読む", () => {
    expect(parseDurationToSec("51分")).toBe(3060);
    expect(parseDurationToSec("1時間5分")).toBe(3900);
    expect(parseDurationToSec("5分30秒")).toBe(330);
  });

  it("読めないものは undefined", () => {
    expect(parseDurationToSec("")).toBeUndefined();
    expect(parseDurationToSec("あとで")).toBeUndefined();
  });

  it("往復して壊れない", () => {
    expect(fmtDuration(parseDurationToSec("51:30")!)).toBe("51:30");
    expect(fmtDuration(parseDurationToSec("1:05:00")!)).toBe("1:05:00");
  });
});

describe("F-1 ペースの表記", () => {
  it("分:秒/km を読む", () => {
    expect(parsePaceToSecPerKm("4:40")).toBe(280);
    expect(parsePaceToSecPerKm("4:40/km")).toBe(280);
    expect(parsePaceToSecPerKm("@3:50")).toBe(230);
  });

  it("単位なしの数値は「秒/km」として読む（所要時間とは規則が違う）", () => {
    expect(parsePaceToSecPerKm("280")).toBe(280);
    // 同じ "280" でも所要時間なら280分になる
    expect(parseDurationToSec("280")).toBe(280 * 60);
  });

  it("往復して壊れない", () => {
    expect(fmtPaceSecPerKm(parsePaceToSecPerKm("4:40")!)).toBe("4:40");
    expect(fmtPaceSecPerKm(280)).toBe("4:40");
  });

  it("59.6秒が 4:60 にならない", () => {
    expect(fmtPaceSecPerKm(299.6)).toBe("5:00");
  });
});

describe("F-1 距離・時間・ペースの相互補完", () => {
  it("時間とペースから距離を出す（日誌に距離が書かれていないケース）", () => {
    // 51分 @4:40/km → 10.93km
    const r = completeRunTriple({ durationSec: 3060, paceSecPerKm: 280 });
    expect(r.derived).toBe("distanceKm");
    expect(r.distanceKm).toBeCloseTo(10.93, 1);
  });

  it("距離とペースから時間を出す", () => {
    const r = completeRunTriple({ distanceKm: 8, paceSecPerKm: 230 });
    expect(r.derived).toBe("durationSec");
    expect(r.durationSec).toBe(1840);
  });

  it("距離と時間からペースを出す", () => {
    const r = completeRunTriple({ distanceKm: 8, durationSec: 1840 });
    expect(r.derived).toBe("paceSecPerKm");
    expect(r.paceSecPerKm).toBeCloseTo(230, 1);
  });

  it("3つとも入っていれば上書きしない（どれが正かは判断できない）", () => {
    const r = completeRunTriple({ distanceKm: 8, durationSec: 1840, paceSecPerKm: 230 });
    expect(r.derived).toBeUndefined();
    expect(r.distanceKm).toBe(8);
    expect(r.mismatch).toBeUndefined();
  });

  it("3つとも入っていて食い違えば警告を出す（登録は妨げない）", () => {
    // 8km 30:40 なら 3:50/km のはずが 4:40 と入力されている
    const r = completeRunTriple({ distanceKm: 8, durationSec: 1840, paceSecPerKm: 280 });
    expect(r.mismatch).toBeDefined();
    expect(r.mismatch).toContain("ずれています");
    // 値は勝手に直さない
    expect(r.paceSecPerKm).toBe(280);
  });

  it("1つしか無ければ何も埋めない", () => {
    const r = completeRunTriple({ distanceKm: 8 });
    expect(r.durationSec).toBeUndefined();
    expect(r.paceSecPerKm).toBeUndefined();
  });
});
