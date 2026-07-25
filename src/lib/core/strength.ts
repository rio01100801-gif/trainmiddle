/**
 * 4-8. 筋力・プライオメトリクスの配置管理（補足機能）
 * 配置ルール自体は rules.ts の RULE-18/19、フェーズ別内容は periodization.ts が担う。
 */
import type { Phase } from "./types";

/** 4-8-2. フェーズ別の内容の一覧（UI表示用） */
export const STRENGTH_PHASE_TABLE: Record<
  Phase,
  { strength: string; plyometrics: string; frequency: string }
> = {
  Base: { strength: "heavy（最大筋力）", plyometrics: "低強度（接地系）", frequency: "週2" },
  Build: { strength: "moderate〜heavy", plyometrics: "中強度", frequency: "週2" },
  Specific: { strength: "moderate（速度重視）", plyometrics: "中〜高強度", frequency: "週1〜2" },
  Modeling: { strength: "light（維持のみ）", plyometrics: "低強度・少量", frequency: "週1" },
  Taper: { strength: "core のみ", plyometrics: "なし", frequency: "週1以下" },
};

/**
 * 4-8-3. アキレス腱・腱組織に関する警告。
 * ケア内容の登録テキストに静的ストレッチ+アキレス腱の組み合わせを検出したら警告する。
 */
export function checkAchillesCare(careDescription: string): {
  warn: boolean;
  message?: string;
  recommendations?: string[];
} {
  const text = careDescription.toLowerCase();
  const mentionsAchilles =
    careDescription.includes("アキレス") || text.includes("achilles");
  const mentionsStaticStretch =
    careDescription.includes("静的ストレッチ") ||
    careDescription.includes("スタティックストレッチ") ||
    text.includes("static stretch");

  if (mentionsAchilles && mentionsStaticStretch) {
    return {
      warn: true,
      message:
        "[WARN] アキレス腱の主要ケアとして静的ストレッチが登録されようとしています。アキレス腱はバネ(SSC)として機能し、適度な硬さがランニングエコノミーに寄与します。静的ストレッチで弛緩させることは逆効果になり得ます。",
      recommendations: [
        "カーフレイズ等の腱への漸進的負荷",
        "低強度のホッピング／接地ドリル",
        "アイソメトリック（等尺性）保持",
      ],
    };
  }
  return { warn: false };
}
