/**
 * Q-2 足りていないカテゴリの提案
 *
 * ルールエンジンは「多すぎる」しか見ていなかったので、
 * ここは「足りていない」側だけを見る。
 */
import { describe, expect, it } from "vitest";
import {
  COVERAGE_MIN_SHORTFALL,
  COVERAGE_WEEKS,
  reviewCoverage,
  weeksUntil,
} from "@/lib/core/coverage";
import { categoryCountsPerFourWeeks } from "@/lib/core/periodization";
import { makeSession } from "./helpers";
import type { Session, SessionCategory } from "@/lib/core/types";

const TODAY = "2026-07-26";

/** 直近4週に、指定のカテゴリを指定回数だけ「実施済み」で置く */
function done(category: SessionCategory, count: number, startOffset = -25): Session[] {
  return Array.from({ length: count }, (_, i) =>
    makeSession(addDays(TODAY, startOffset + i * 2), category, { status: "completed" })
  );
}

function addDays(s: string, n: number): string {
  const d = new Date(s + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 今後2週の入れ替え候補になるジョグ枠 */
function futureJogs(count: number, distanceKm = 8): Session[] {
  return Array.from({ length: count }, (_, i) =>
    makeSession(addDays(TODAY, 2 + i * 3), "aerobic", {
      status: "planned",
      name: "ジョグ",
      distanceKm,
    })
  );
}

describe("基準の出どころ", () => {
  it("フェーズの週テンプレートから4週ぶんの回数を数える（別表を持たない）", () => {
    const specific = categoryCountsPerFourWeeks("Specific");
    // Specific は高乳酸週1・経済走週1
    expect(specific.high_lactate).toBe(4);
    expect(specific.race_economy).toBe(4);
    // Base では経済走を使わない
    expect(categoryCountsPerFourWeeks("Base").race_economy).toBe(0);
  });
});

describe("足りているとき", () => {
  it("提案を出さない", () => {
    // Specific 期は高乳酸・経済走・神経系がそれぞれ週1
    const sessions = [
      ...done("high_lactate", 4),
      ...done("race_economy", 4, -24),
      ...done("neural", 4, -23),
    ];
    const r = reviewCoverage({
      sessions,
      today: TODAY,
      phase: "Specific",
      limiter: "balanced",
    });
    expect(r.proposals.length).toBe(0);
    expect(r.narrative).toContain("足りています");
  });
});

describe("足りていないとき", () => {
  const sessions = [
    ...done("high_lactate", 4),
    ...done("race_economy", 1, -20),
    ...futureJogs(2),
  ];

  it("不足しているカテゴリを回数つきで出す", () => {
    const r = reviewCoverage({
      sessions,
      today: TODAY,
      phase: "Specific",
      limiter: "balanced",
      weeksToRace: 6,
    });
    const p = r.proposals.find((x) => x.category === "race_economy");
    expect(p).toBeDefined();
    expect(p!.shortfall).toBe(3);
    // 判断の根拠を必ず数字で出す
    expect(p!.reason).toContain("4週で4回");
    expect(p!.reason).toContain("直近4週は1回");
    expect(p!.reason).toContain("レースまで6週");
  });

  it("1回の差では提案しない（週テンプレートの巡り合わせで普通に出るため）", () => {
    const r = reviewCoverage({
      sessions: [...done("high_lactate", 4), ...done("race_economy", 3, -20), ...futureJogs(2)],
      today: TODAY,
      phase: "Specific",
      limiter: "balanced",
    });
    expect(COVERAGE_MIN_SHORTFALL).toBe(2);
    expect(r.proposals.find((x) => x.category === "race_economy")).toBeUndefined();
  });

  it("制限因子で基準そのものが動く", () => {
    const base = reviewCoverage({
      sessions,
      today: TODAY,
      phase: "Specific",
      limiter: "balanced",
    }).targets.find((t) => t.category === "race_economy")!;
    const endurance = reviewCoverage({
      sessions,
      today: TODAY,
      phase: "Specific",
      limiter: "endurance",
    }).targets.find((t) => t.category === "race_economy")!;
    // 後半の維持が制限なら経済走を増やす（×1.3）
    expect(endurance.wanted).toBeGreaterThan(base.wanted);
    expect(endurance.basis).toContain("後半の維持");
  });

  it("統合監査で修正: 距離は短いが60分以上のジョグもロングラン扱いになる（trainingClassification.isLongRunと基準を統一）", () => {
    // 65分・5kmの「時間は長いが距離は短い」ジョグと、15kmの明確なロングラン。
    // 修正前はここだけ独自のisLongRun（距離基準のみ、時間を見ない）を持っており、
    // 65分ジョグが「ロングランではない普通のジョグ」として警告なしに置き換え候補へ出ていた。
    const longByDuration = makeSession(addDays(TODAY, 3), "aerobic", {
      status: "planned",
      name: "ジョグ",
      distanceKm: 5,
      durationMin: 65,
    });
    const longByDistance = makeSession(addDays(TODAY, 6), "aerobic", {
      status: "planned",
      name: "ジョグ",
      distanceKm: 15,
      durationMin: 90,
    });
    const r = reviewCoverage({
      sessions: [...done("high_lactate", 4), longByDuration, longByDistance],
      today: TODAY,
      phase: "Specific",
      limiter: "balanced",
    });
    const p = r.proposals.find((x) => x.category === "race_economy");
    expect(p).toBeDefined();
    // 通常のジョグ候補が無い（両方ロングラン扱い）ため、両方に代償の注記が付く
    const byDuration = p!.candidates.find((c) => c.sessionId === longByDuration.id);
    expect(byDuration?.cost).toBeDefined();
    expect(byDuration?.cost).toContain("ロングラン");
  });
});

describe("置き換え候補の選び方", () => {
  it("ジョグの枠から選ぶ。固定枠と予定外は対象にしない", () => {
    const r = reviewCoverage({
      sessions: [
        ...done("race_economy", 1, -20),
        ...futureJogs(2),
        makeSession(addDays(TODAY, 3), "aerobic", { status: "planned", isFixed: true }),
        makeSession(addDays(TODAY, 4), "high_lactate", { status: "planned" }),
      ],
      today: TODAY,
      phase: "Specific",
      limiter: "balanced",
    });
    const p = r.proposals.find((x) => x.category === "race_economy")!;
    expect(p.candidates.length).toBeGreaterThan(0);
    expect(p.candidates.every((c) => c.from === "aerobic")).toBe(true);
    // 固定枠・ポイント練習は候補に入らない
    expect(p.candidates.some((c) => c.name.includes("high_lactate"))).toBe(false);
  });

  it("ロングランしか無いときは代償を文章で出す", () => {
    const r = reviewCoverage({
      sessions: [
        ...done("race_economy", 1, -20),
        makeSession(addDays(TODAY, 3), "aerobic", {
          status: "planned",
          name: "ロングラン",
          distanceKm: 18,
        }),
      ],
      today: TODAY,
      phase: "Specific",
      limiter: "balanced",
    });
    const p = r.proposals.find((x) => x.category === "race_economy")!;
    expect(p.candidates.length).toBe(1);
    expect(p.candidates[0].cost).toBeTruthy();
    expect(p.candidates[0].cost).toContain("有酸素の土台");
  });

  it("動かせる枠が無ければ、その旨を出す（黙って空にしない）", () => {
    const r = reviewCoverage({
      sessions: [...done("race_economy", 1, -20)],
      today: TODAY,
      phase: "Specific",
      limiter: "balanced",
    });
    const p = r.proposals.find((x) => x.category === "race_economy")!;
    expect(p.candidates.length).toBe(0);
    expect(p.note).toContain("固定曜日設定");
  });
});

describe("数え方", () => {
  it("実施していない過去の予定は数えない（あるつもりで足りない、を防ぐ）", () => {
    const r = reviewCoverage({
      sessions: [
        ...done("high_lactate", 4),
        // 過去日だが未実施のまま
        makeSession(addDays(TODAY, -10), "race_economy", { status: "planned" }),
        makeSession(addDays(TODAY, -8), "race_economy", { status: "skipped" }),
        ...futureJogs(2),
      ],
      today: TODAY,
      phase: "Specific",
      limiter: "balanced",
    });
    expect(r.targets.find((t) => t.category === "race_economy")!.actual).toBe(0);
  });

  it("4週より古いものは数えない", () => {
    const r = reviewCoverage({
      sessions: [...done("race_economy", 4, -60)],
      today: TODAY,
      phase: "Specific",
      limiter: "balanced",
    });
    expect(COVERAGE_WEEKS).toBe(4);
    expect(r.targets.find((t) => t.category === "race_economy")!.actual).toBe(0);
  });
});

describe("weeksUntil", () => {
  it("レースまでの週数。過ぎていれば undefined", () => {
    expect(weeksUntil(TODAY, "2026-08-09")).toBe(2);
    expect(weeksUntil(TODAY, "2026-07-01")).toBeUndefined();
  });
});
