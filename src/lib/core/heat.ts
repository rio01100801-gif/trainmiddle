/**
 * 4-10. 暑熱順化ブロック
 * 暑熱を「回避すべきリスク」としてだけでなく、計画的に適応を獲得する対象として扱う。
 */
import type { Athlete, HeatBlock, HeatBlockEntry, Race } from "./types";
import { addDays, diffDays } from "./dates";

/**
 * 4-10-2. ブロックの設計:
 * 本命レースの4〜6週前に10〜14日間（順化効果は中断後1〜2週で減衰するため離しすぎない）
 */
export function planHeatBlock(race: Race, blockDays: number = 12): HeatBlock {
  const start = addDays(race.dateStart, -35); // 5週前を中心に
  return {
    id: `hb-${race.id}`,
    startDate: start,
    endDate: addDays(start, blockDays - 1),
    targetRaceId: race.id,
  };
}

export const HEAT_BLOCK_CONTENT = [
  "内容: 低強度(aerobic)を暑い時間帯に実施。1回あたり40〜60分。",
  "禁止: この期間に high_lactate / modeling を配置しない（RULE-22）。",
  "特異的セッションは涼しい時間帯に別途確保する。",
];

// ---------------------------------------------------------------------------
// 4-10-3. 進行管理
// ---------------------------------------------------------------------------

export interface HeatBlockAssessment {
  /** 同一ペース・同一環境でのHRが開始時より5〜10拍低下 → 順化成立 */
  acclimatized: boolean | undefined;
  hrDrop?: number;
  dehydrationErrors: { date: string; lossPct: number }[];
  message: string;
}

export function assessHeatBlock(
  entries: HeatBlockEntry[],
  athleteWeightKg: number
): HeatBlockAssessment {
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));

  // 脱水チェック: 体重減少が3%超 → ERROR、ブロック中断
  const dehydrationErrors = sorted
    .filter(
      (e) =>
        e.weightBeforeKg !== undefined &&
        e.weightAfterKg !== undefined &&
        ((e.weightBeforeKg - e.weightAfterKg) / athleteWeightKg) * 100 > 3
    )
    .map((e) => ({
      date: e.date,
      lossPct: ((e.weightBeforeKg! - e.weightAfterKg!) / athleteWeightKg) * 100,
    }));

  // 順化判定: 同一ペース帯（±5秒/km）でのHR比較
  const withHr = sorted.filter(
    (e) => e.avgHr !== undefined && e.paceSecPerKm !== undefined
  );
  let acclimatized: boolean | undefined;
  let hrDrop: number | undefined;
  if (withHr.length >= 2) {
    const first = withHr[0];
    const comparable = withHr
      .slice(1)
      .filter((e) => Math.abs(e.paceSecPerKm! - first.paceSecPerKm!) <= 5);
    if (comparable.length > 0) {
      const last = comparable[comparable.length - 1];
      hrDrop = first.avgHr! - last.avgHr!;
      acclimatized = hrDrop >= 5;
    }
  }

  let message: string;
  if (dehydrationErrors.length > 0) {
    message = `[ERROR] 体重減少が3%を超えた日があります(${dehydrationErrors.map((d) => `${d.date}: ${d.lossPct.toFixed(1)}%`).join(", ")})。脱水です。以降のブロックを中断し、補水計画を見直してください。`;
  } else if (acclimatized === true) {
    message = `順化成立の指標を満たしています（同一ペースでHRが${hrDrop}拍低下。目標は5〜10拍）。`;
  } else if (acclimatized === false) {
    message = `まだ順化成立の指標(HR5〜10拍低下)に達していません（現在${hrDrop}拍）。継続してください。`;
  } else {
    message = "同一ペースで比較できる記録がまだ不足しています。気温・湿度・HR・体重前後差を毎回記録してください。";
  }

  return { acclimatized, hrDrop, dehydrationErrors, message };
}

// ---------------------------------------------------------------------------
// 4-10-4. レース当日の暑熱対策チェックリスト
// ---------------------------------------------------------------------------

export function raceDayHeatChecklist(
  athlete: Athlete,
  expectedTempC: number | undefined
): string[] | undefined {
  if (athlete.heatTolerance !== "low") return undefined;
  if (expectedTempC !== undefined && expectedTempC < 28) return undefined;
  return [
    "アップの量を通常より削る（体温上昇の先食いを避ける）",
    "プレクーリング（アイススラリー等）の可否を確認する",
    "ラウンド間の冷却と補水の計画を立てる",
    "ペース設定を目標より0.5〜1.0秒遅く見積もる選択肢を持っておく",
  ];
}

/** 順化効果の減衰: ブロック終了からレースまでが2週間超なら警告 */
export function heatBlockTimingCheck(block: HeatBlock, race: Race): string | undefined {
  const gap = diffDays(block.endDate, race.dateStart);
  if (gap > 14) {
    return `暑熱順化ブロック終了からレースまで${gap}日空いています。順化効果は中断後1〜2週で減衰します。ブロックをレースに近づけてください。`;
  }
  if (gap < 0) return "ブロックがレース後に設定されています。";
  return undefined;
}
