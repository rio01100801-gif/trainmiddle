/**
 * S-7 / S-8 / S-9 漸進モデル
 *
 * 一番大事なのは「同じ内容が出続けない」ことと、
 * 「設定を守れていないときに量を増やさない」こと。
 */
import { describe, expect, it } from "vitest";
import {
  buildSessionSpec,
  DENSITY_STEP,
  LOAD_CYCLE_WEEKS,
  MIN_REST_SEC,
  sessionVariants,
  sessionTemplateCandidates,
  weekStep,
} from "@/lib/core/progression";
import type { AerobicProfile } from "@/lib/core/pace";

const CFE = 114.0;
const AEROBIC: AerobicProfile = {
  ltPaceSecPerKm: 220,
  cvPaceSecPerKm: { fast: 205, slow: 210 },
  jogPaceSecPerKm: { fast: 270, slow: 320 },
  longRunPaceSecPerKm: { fast: 280, slow: 330 },
  source: "fallback",
  isEstimated: true,
};

function spec(weekIndex: number, extra: Record<string, unknown> = {}) {
  return buildSessionSpec({
    category: "high_lactate",
    phase: "Specific",
    weekIndex,
    cfeSec: CFE,
    ...extra,
  })!;
}

describe("週ごとの漸進", () => {
  it("3週上げて1週落とす", () => {
    expect(LOAD_CYCLE_WEEKS).toBe(4);
    expect(weekStep(0)).toBe("baseline");
    expect(weekStep(1)).toBe("volume");
    expect(weekStep(2)).toBe("density");
    expect(weekStep(3)).toBe("recovery");
    expect(weekStep(4)).toBe("baseline");
  });

  it("週が変われば内容が変わる（同じものが出続けない）", () => {
    const texts = [0, 1, 2, 3].map((w) => spec(w).prescription);
    expect(new Set(texts).size).toBeGreaterThan(1);
  });

  it("高乳酸は週番号だけで本数を機械的に増やさない", () => {
    const base = spec(0);
    const volume = spec(1);
    const density = spec(2);
    expect(volume.blocks[0].reps).toBe(base.blocks[0].reps);
    expect(volume.restSec).toBe(base.restSec);
    expect(density.blocks[0].reps).toBe(volume.blocks[0].reps);
    expect(density.restSec).toBeLessThan(base.restSec);
    expect(volume.reasons.join()).toContain("機械的に増やさず");
  });

  it("有酸素高強度は先に量、次に密度の順で進める", () => {
    const make = (weekIndex: number) =>
      buildSessionSpec({
        category: "threshold",
        phase: "Base",
        weekIndex,
        cfeSec: CFE,
        aerobicProfile: AEROBIC,
      })!;
    const base = make(0);
    const volume = make(1);
    const density = make(2);
    expect(volume.blocks[0].reps).toBe(base.blocks[0].reps + 1);
    expect(volume.restSec).toBe(base.restSec);
    expect(density.blocks[0].reps).toBe(volume.blocks[0].reps);
    expect(density.restSec).toBeLessThan(base.restSec);
  });

  it("4週目は落とす", () => {
    expect(spec(3).blocks[0].reps).toBeLessThan(spec(1).blocks[0].reps);
    expect(spec(3).reasons.join()).toContain("回復週");
  });

  it("フェーズが進むと特異的になる（土台期は短く少なく）", () => {
    const base = buildSessionSpec({ category: "high_lactate", phase: "Base", weekIndex: 0, cfeSec: CFE })!;
    const specific = buildSessionSpec({ category: "high_lactate", phase: "Specific", weekIndex: 0, cfeSec: CFE })!;
    expect(base.blocks[0].distanceM).toBeLessThan(specific.blocks[0].distanceM);
    // 特異期はレストが短い（レース終盤に近い状況を作る）
    expect(specific.restSec).toBeLessThan(
      buildSessionSpec({ category: "high_lactate", phase: "Build", weekIndex: 0, cfeSec: CFE })!.restSec
    );
  });

  it("テーパー期は扱わない（M-6とRULE-09に任せる）", () => {
    expect(
      buildSessionSpec({ category: "high_lactate", phase: "Taper", weekIndex: 0, cfeSec: CFE })
    ).toBeUndefined();
  });
});

describe("S-7 直近の出来を内容に反映する", () => {
  it("設定を守れていなければ量を増やさず戻す", () => {
    const hold = spec(1);
    const ease = spec(1, { trend: "ease" });
    expect(ease.blocks[0].reps).toBeLessThan(hold.blocks[0].reps);
    expect(ease.restSec).toBeGreaterThan(hold.restSec);
    expect(ease.reasons.join()).toContain("実行できる形に戻します");
  });

  it("高乳酸は余裕があっても本数を機械的に増やさない", () => {
    expect(spec(0, { trend: "tighten" }).blocks[0].reps).toBe(spec(0).blocks[0].reps);
    expect(spec(0, { trend: "tighten" }).reasons.join()).toContain("本数は据え置き");
  });

  it("負荷が高ければ増やさない", () => {
    const normal = spec(1);
    const heavy = spec(1, { loadHigh: true });
    const volume = (s: ReturnType<typeof spec>) =>
      s.blocks.reduce((sum, block) => sum + block.distanceM * block.reps, 0);
    expect(volume(heavy)).toBeLessThanOrEqual(volume(normal));
    expect(heavy.reasons.join()).toContain("ACWR");
  });

  it("本数が0本以下にならない", () => {
    const s = spec(3, { trend: "ease", loadHigh: true });
    expect(s.blocks[0].reps).toBeGreaterThanOrEqual(1);
  });

  /*
   * 「600m反復は翌日疲労が強く残るので、同等の刺激を400m反復で低疲労コストに
   * 得たい」という着想への最小対応。8次元の刺激エンジンは作らず、既存の
   * muscleDamageRisk（Specific期のhigh_lactateでは300m系=3・400m系=4）への
   * 既存のACWRペナルティ（loadHigh）を、ACWRの裏付けが無い「直近の疲労兆候
   * だけ」でも効くように拡張した。athleteType:"balanced"は400m系の
   * athleteTypesボーナス（+1）を意図的に発生させ、疲労信号が無ければ400m系が
   * 選ばれ、疲労信号があれば筋損傷リスクの低い300m系に切り替わることを確認する。
   */
  it("直近の疲労兆候があれば、ACWRの裏付けが無くても筋損傷リスクの低い形式へ切り替わる", () => {
    const withoutSignal = buildSessionSpec({
      category: "high_lactate",
      phase: "Specific",
      weekIndex: 0,
      cfeSec: CFE,
      athleteType: "balanced",
    })!;
    expect(withoutSignal.blocks[0].distanceM).toBe(400); // athleteTypeボーナスで400m系が勝つ

    const withSignal = buildSessionSpec({
      category: "high_lactate",
      phase: "Specific",
      weekIndex: 0,
      cfeSec: CFE,
      athleteType: "balanced",
      recentFatigueSignal: true,
    })!;
    expect(withSignal.blocks[0].distanceM).toBe(300); // 疲労兆候で300m系（リスク3）へ切り替わる
    expect(withSignal.reasons.join()).toContain("直近の疲労兆候があるため、筋損傷リスクの高い");
    expect(withSignal.reasons.join()).toContain("高乳酸セッション（400m特異的）"); // 避けた候補名を明記
  });

  it("ACWR裏付けありのloadHighは既存どおり働き、理由がloadHighとrecentFatigueSignalで異なる", () => {
    const loadHighOnly = buildSessionSpec({
      category: "high_lactate",
      phase: "Specific",
      weekIndex: 0,
      cfeSec: CFE,
      athleteType: "balanced",
      loadHigh: true,
    })!;
    expect(loadHighOnly.blocks[0].distanceM).toBe(300);
    expect(loadHighOnly.reasons.join()).toContain("直近の負荷増加と疲労兆候があるため");
  });
});

describe("複数テンプレート選択", () => {
  it("主要カテゴリに複数候補がある", () => {
    expect(sessionTemplateCandidates("threshold", "Base").length).toBeGreaterThan(1);
    expect(sessionTemplateCandidates("cv", "Build").length).toBeGreaterThan(1);
    expect(sessionTemplateCandidates("race_economy", "Specific").length).toBeGreaterThan(1);
    expect(sessionTemplateCandidates("high_lactate", "Specific").length).toBeGreaterThan(1);
    expect(sessionTemplateCandidates("modeling", "Modeling").length).toBeGreaterThan(1);
  });

  it("同じ入力からは同じ候補を選ぶ", () => {
    const input = {
      category: "race_economy" as const,
      phase: "Specific" as const,
      weekIndex: 0,
      cfeSec: CFE,
      athleteType: "balanced" as const,
      onDate: "2026-07-28",
    };
    expect(buildSessionSpec(input)!.templateId).toBe(buildSessionSpec(input)!.templateId);
  });

  it("直近14日の同一テンプレートを理由なく連続選択しない", () => {
    const first = buildSessionSpec({
      category: "race_economy",
      phase: "Specific",
      weekIndex: 0,
      cfeSec: CFE,
      athleteType: "balanced",
      onDate: "2026-07-14",
    })!;
    const next = buildSessionSpec({
      category: "race_economy",
      phase: "Specific",
      weekIndex: 1,
      cfeSec: CFE,
      athleteType: "balanced",
      onDate: "2026-07-21",
      templateHistory: [
        {
          date: "2026-07-14",
          category: "race_economy",
          templateId: first.templateId,
          variationGroup: first.variationGroup,
          progressionStage: first.progressionStage,
        },
      ],
    })!;
    expect(next.templateId).not.toBe(first.templateId);
    expect(next.selectionReasons.join()).toContain("同時に進めない");
  });

  it("同形式で未達・高負担が続けば別形式を選ぶ", () => {
    const initial = buildSessionSpec({
      category: "high_lactate",
      phase: "Specific",
      weekIndex: 0,
      cfeSec: CFE,
      athleteType: "balanced",
      onDate: "2026-07-01",
    })!;
    const history = ["2026-07-08", "2026-07-15"].map((date) => ({
      date,
      category: "high_lactate" as const,
      templateId: initial.templateId,
      variationGroup: initial.variationGroup,
      progressionStage: initial.progressionStage,
      achievement: "partial" as const,
      rpe: 9,
      nextDayLegs: "heavy" as const,
    }));
    const next = buildSessionSpec({
      category: "high_lactate",
      phase: "Specific",
      weekIndex: 0,
      cfeSec: CFE,
      athleteType: "balanced",
      onDate: "2026-07-22",
      templateHistory: history,
    })!;
    expect(next.templateId).not.toBe(initial.templateId);
    expect(next.selectionReasons.join()).toContain("未達・高負担");
  });
});

describe("処方の文面", () => {
  it("一括入力が読み取れる書き方になっている", () => {
    const s = spec(0);
    expect(s.prescription).toMatch(/\d+m × \d+/);
    expect(s.prescription).toContain("@");
    expect(s.prescription).toMatch(/r\d+分|r\d+秒/);
  });

  it("設定タイムがCFEから決まる", () => {
    const fast = buildSessionSpec({ category: "high_lactate", phase: "Specific", weekIndex: 0, cfeSec: 108 })!;
    const slow = buildSessionSpec({ category: "high_lactate", phase: "Specific", weekIndex: 0, cfeSec: 120 })!;
    expect(fast.targetPaces[0].targetSecFast).toBeLessThan(slow.targetPaces[0].targetSecFast);
  });
});

describe("S-9 2案", () => {
  it("必ず2案で、どちらか一方だけがおすすめ", () => {
    const vs = sessionVariants(spec(0), { limiter: "endurance" });
    expect(vs).toHaveLength(2);
    expect(vs.filter((v) => v.recommended)).toHaveLength(1);
  });

  it("2案は中身が違う（選ぶ意味がある）", () => {
    const vs = sessionVariants(spec(0), { limiter: "balanced" });
    expect(vs[0].spec.prescription).not.toBe(vs[1].spec.prescription);
  });

  it("どちらにも理由が付く", () => {
    for (const v of sessionVariants(spec(0), { limiter: "balanced" })) {
      expect(v.why.length).toBeGreaterThan(10);
    }
  });

  it("後半の維持が制限なら密度側を勧める", () => {
    const vs = sessionVariants(spec(0), { limiter: "endurance" });
    expect(vs.find((v) => v.recommended)!.key).toBe("density");
  });

  it("守れていないときは2案とも引く方向になる", () => {
    const base = spec(1, { trend: "ease" });
    const vs = sessionVariants(base, { trend: "ease", limiter: "balanced" });
    for (const v of vs) {
      const heavier =
        v.spec.blocks[0].reps > base.blocks[0].reps || v.spec.restSec < base.restSec;
      expect(heavier).toBe(false);
    }
  });

  it("レストを詰めても下限を割らない", () => {
    const vs = sessionVariants(spec(2), { trend: "tighten", limiter: "endurance" });
    for (const v of vs) expect(v.spec.restSec).toBeGreaterThanOrEqual(MIN_REST_SEC);
  });

  it("密度を上げる幅は決めた値どおり", () => {
    expect(DENSITY_STEP).toBe(0.2);
  });
});
