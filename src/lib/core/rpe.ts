/**
 * RPE（自覚的運動強度）の段階と、その説明。
 *
 * 画面のスライダーと読み上げの両方がここを見る。
 * 説明文を画面側に直書きすると、設定ペースの補正（`RPE_ADJUST_SEC_PER_POINT`）が
 * 効く数字と、本人が読んでいる言葉が別々に動く。
 *
 * **保存する値は数値のまま**（1〜10の整数）。ここは見せ方だけを決める。
 * 判定・補正・CFEはすべて数値を見ている。
 */

export const RPE_MIN = 1;
export const RPE_MAX = 10;

/**
 * 帯。色はここから引く。
 *
 * **色だけに頼らない**——帯の呼び名（`short`）も必ず一緒に出す。
 * 色覚特性や、屋外で画面が見づらいときに数字と色だけでは読めない。
 */
export type RpeBand = "low" | "moderate" | "hard" | "very_hard" | "max";

export const RPE_BAND_LABELS: Record<RpeBand, string> = {
  low: "楽",
  moderate: "普通",
  hard: "きつい",
  very_hard: "かなりきつい",
  max: "最大",
};

/**
 * 帯ごとの色。既存のトークンだけを使う（新しい色を増やさない）。
 * 1〜3 青 → 4〜5 緑 → 6〜7 黄 → 8〜9 橙 → 10 赤。
 */
export const RPE_BAND_COLORS: Record<RpeBand, string> = {
  low: "var(--cat-race-economy)",
  moderate: "var(--cat-cv)",
  hard: "var(--amber)",
  very_hard: "var(--cat-high-lactate)",
  max: "var(--red)",
};

export interface RpeLevel {
  value: number;
  band: RpeBand;
  /** その段階の説明。スライダーを動かしている間ずっと出す */
  description: string;
}

export const RPE_LEVELS: RpeLevel[] = [
  { value: 1, band: "low", description: "非常に楽。ほぼ負荷を感じない" },
  { value: 2, band: "low", description: "かなり楽。余裕が非常に大きい" },
  { value: 3, band: "low", description: "楽。長時間続けられる" },
  { value: 4, band: "moderate", description: "やや楽。軽いジョグ程度" },
  { value: 5, band: "moderate", description: "普通。負荷はあるが十分コントロール可能" },
  { value: 6, band: "hard", description: "ややきつい。集中すれば維持できる" },
  { value: 7, band: "hard", description: "きつい。余力は少ないが設定どおり完遂可能" },
  { value: 8, band: "very_hard", description: "かなりきつい。終盤に強く粘る必要がある" },
  { value: 9, band: "very_hard", description: "非常にきつい。ほぼ限界で、あと少ししかできない" },
  { value: 10, band: "max", description: "最大努力。これ以上は不可能" },
];

/** 1〜10の整数か。範囲外・小数・空文字はすべて false */
export function isValidRpe(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= RPE_MIN &&
    value <= RPE_MAX
  );
}

export function rpeLevel(value: number): RpeLevel | undefined {
  return RPE_LEVELS.find((l) => l.value === value);
}

/** 読み上げ用。「7、きつい。余力は少ないが…」のように数字と言葉を両方読ませる */
export function rpeValueText(value: number): string {
  const level = rpeLevel(value);
  if (!level) return String(value);
  return `${value}。${RPE_BAND_LABELS[level.band]}。${level.description}`;
}

// ---------------------------------------------------------------------------
// 痛みの強さ（0〜10）
// ---------------------------------------------------------------------------

/**
 * 痛みはRPEと別物。0（痛みなし）から始まり、「頑張れた度合い」ではない。
 * 同じスライダー部品を使うが、段階の意味は分ける。
 */
export const PAIN_MIN = 0;
export const PAIN_MAX = 10;

export function painBand(value: number): RpeBand {
  if (value === 0) return "low";
  if (value <= 3) return "low";
  if (value <= 5) return "moderate";
  if (value <= 7) return "hard";
  if (value <= 9) return "very_hard";
  return "max";
}

export function painDescription(value: number): string {
  if (value === 0) return "痛みなし";
  if (value <= 2) return "気になる程度。動きは変わらない";
  if (value <= 4) return "痛むが、フォームを変えずに走れる";
  if (value <= 6) return "かばって走っている。練習は続けられる";
  if (value <= 8) return "走ると強く痛む。中止を考える段階";
  return "歩行でも痛む。走らない";
}

export function painValueText(value: number): string {
  return `${value}。${painDescription(value)}`;
}
