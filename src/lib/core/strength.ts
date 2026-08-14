/**
 * 4-8. 筋力・プライオメトリクスの配置管理（補足機能）
 * 配置ルール自体は rules.ts の RULE-18/19。フェーズ別の内容はこのファイルが唯一の出どころで、
 * periodization.ts の strengthForPhase がそれを読んで実際のセッションを作る。
 */
import type { LoadLevel, Phase, StrengthType } from "./types";

/**
 * 4-8-2. フェーズ別の補強の内容。
 *
 * **ここが唯一の出どころ。** 生成（`periodization.ts` の `strengthForPhase`）も
 * 画面もここを読む。
 *
 * もとは2か所にあった——この表（「UI表示用」と書いてあるが出している画面が無かった）と、
 * `strengthForPhase` の中にある別テーブル（実際に効くほう）。
 * 同じ知識を2か所に置くと、片方を直しても、もう片方は静かに古いままになる。
 * 実際に Build は片方が「moderate〜heavy」、もう片方が `moderate` でずれていた。
 *
 * `load` / `type` / `exercises` が生成に使う値、
 * `strength` / `plyometrics` / `frequency` が画面に出す説明。
 * **説明と値が食い違わないこと**はテストで見張っている
 * （「heavy」と書いてあるのに light を生成する、を弾く）。
 */
export interface StrengthPhaseSpec {
  /** 生成に使う: 補強の重さ */
  load: LoadLevel;
  /** 生成に使う: 補強か体幹か */
  type: StrengthType;
  /** 生成に使う: 種目 */
  exercises: string[];
  /** 画面に出す: 筋力側の狙い */
  strength: string;
  /** 画面に出す: プライオ側の強度 */
  plyometrics: string;
  /** 画面に出す: 頻度の目安 */
  frequency: string;
}

export const STRENGTH_PHASE_TABLE: Record<Phase, StrengthPhaseSpec> = {
  Base: {
    load: "heavy",
    type: "strength",
    exercises: ["スクワット 5×5", "デッドリフト 3×5", "低強度ホッピング 3×20m"],
    strength: "heavy（最大筋力）",
    plyometrics: "低強度（接地系）",
    frequency: "週2",
  },
  Build: {
    load: "moderate",
    type: "strength",
    exercises: ["スクワット(速度重視) 4×4", "ルーマニアンDL 3×6", "ボックスジャンプ 3×5"],
    strength: "moderate（速度へ寄せていく）",
    plyometrics: "中強度",
    frequency: "週2",
  },
  Specific: {
    load: "moderate",
    type: "strength",
    exercises: ["スクワット(速度重視) 3×3", "バウンディング 3×30m", "MBスロー 3×5"],
    strength: "moderate（速度重視）",
    plyometrics: "中〜高強度",
    frequency: "週1〜2",
  },
  Modeling: {
    load: "light",
    type: "strength",
    exercises: ["自重スクワット 2×10", "低強度ホップ 2×15m（維持のみ）"],
    strength: "light（維持のみ）",
    plyometrics: "低強度・少量",
    frequency: "週1",
  },
  Taper: {
    load: "light",
    type: "core",
    exercises: ["体幹サーキット 2周（coreのみ）"],
    strength: "core のみ",
    plyometrics: "なし",
    frequency: "週1以下",
  },
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
