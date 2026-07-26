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
  weekStep,
} from "@/lib/core/progression";

const CFE = 114.0;

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

  it("先に量、次に密度の順で上げる", () => {
    const base = spec(0);
    const volume = spec(1);
    const density = spec(2);
    // 2週目は本数だけ増える。レストは変えない
    expect(volume.blocks[0].reps).toBe(base.blocks[0].reps + 1);
    expect(volume.restSec).toBe(base.restSec);
    // 3週目は本数を保ったままレストを詰める
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

  it("余裕があれば1本増やす", () => {
    expect(spec(0, { trend: "tighten" }).blocks[0].reps).toBeGreaterThan(spec(0).blocks[0].reps);
  });

  it("負荷が高ければ増やさない", () => {
    const normal = spec(1);
    const heavy = spec(1, { loadHigh: true });
    expect(heavy.blocks[0].reps).toBeLessThan(normal.blocks[0].reps);
    expect(heavy.reasons.join()).toContain("ACWR");
  });

  it("本数が0本以下にならない", () => {
    const s = spec(3, { trend: "ease", loadHigh: true });
    expect(s.blocks[0].reps).toBeGreaterThanOrEqual(1);
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
