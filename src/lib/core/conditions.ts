/**
 * その日の条件（天候・路面）とシューズ。
 *
 * 狙いは1つ——**「設定は同じなのにRPEが上がった」の理由を、あとから見分けられるようにする**。
 * 雨で滑ったのか、暑かったのか、能力が落ちたのか。
 * 記録が無いと全部「調子が悪かった」に丸められ、設定を下げる判断に紛れ込む。
 *
 * ここは語彙と集計だけ。**判定には使わない。**
 * 暑熱条件フラグ（能力推定から外すかどうか）は今までどおり気温と湿度のWBGTだけで決める
 * （`environment.ts`。風雨を入れない理由もそちらに書いてある）。
 * 条件タグを判定に混ぜると、「タグを付けた日だけ評価が変わる」ことになり、
 * 付け忘れが能力の変化として現れる。
 */
import type { SessionResult } from "./types";

export type ConditionGroup = "weather" | "surface";

export interface ConditionTag {
  id: string;
  label: string;
  group: ConditionGroup;
}

/**
 * タグの一覧。
 *
 * 増やすのは構わないが、**IDは変えない**（過去の記録が指しているため）。
 * 表示名だけ変えたいときは `label` を直す。
 */
export const CONDITION_TAGS: ConditionTag[] = [
  { id: "sunny", label: "晴れ", group: "weather" },
  { id: "cloudy", label: "曇り", group: "weather" },
  { id: "rain", label: "雨", group: "weather" },
  { id: "strong_wind", label: "強風", group: "weather" },
  { id: "hot", label: "暑熱", group: "weather" },
  { id: "cold", label: "寒冷", group: "weather" },
  { id: "track", label: "トラック", group: "surface" },
  { id: "track_wet", label: "トラック濡れ", group: "surface" },
  { id: "slippery", label: "滑りやすい", group: "surface" },
  { id: "road", label: "ロード", group: "surface" },
  { id: "trail", label: "不整地", group: "surface" },
  { id: "indoor", label: "室内", group: "surface" },
];

export const CONDITION_GROUP_LABELS: Record<ConditionGroup, string> = {
  weather: "天候",
  surface: "路面",
};

const BY_ID = new Map(CONDITION_TAGS.map((t) => [t.id, t]));

export function conditionLabel(id: string): string {
  return BY_ID.get(id)?.label ?? id;
}

/** 一覧に無いIDは捨てる。旧データや手書きのJSONが混ざっても壊れない */
export function normalizeConditions(ids: unknown): string[] {
  if (!Array.isArray(ids)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (typeof id !== "string" || !BY_ID.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  // 一覧の並び順にそろえる（入れた順で表示がばらつかないように）
  return CONDITION_TAGS.filter((t) => out.includes(t.id)).map((t) => t.id);
}

export function describeConditions(ids: string[] | undefined): string {
  const normalized = normalizeConditions(ids);
  return normalized.map(conditionLabel).join("・");
}

// ---------------------------------------------------------------------------
// 同じ処方を、条件で分けて見る
// ---------------------------------------------------------------------------

export interface ConditionSplit {
  tag: string;
  label: string;
  /** そのタグが付いた回の平均RPE */
  withRpe: number;
  withCount: number;
  /** 付いていない回の平均RPE */
  withoutRpe: number;
  withoutCount: number;
  /** 付いた回のほうが何点きつかったか（正なら条件が悪い日にきつい） */
  deltaRpe: number;
}

/** 平均を出すのに要る最低件数。1回ずつの比較は偶然と区別できない */
export const MIN_SPLIT_SAMPLES = 2;

/**
 * 同じ処方の記録を条件タグで分け、RPEの差を出す。
 *
 * 「設定は同じでも雨でRPEが上がった」を数字にするためのもの。
 * **これで設定を動かしたりはしない。** 見て本人が判断する材料。
 *
 * 両側が `MIN_SPLIT_SAMPLES` 未満のタグは出さない。
 * 1回ずつを比べても、その日の体調と条件のどちらが効いたのか分けられない。
 */
export function conditionSplits(results: SessionResult[]): ConditionSplit[] {
  const usable = results.filter((r) => typeof r.rpe === "number" && r.rpe > 0);
  if (usable.length < MIN_SPLIT_SAMPLES * 2) return [];

  const out: ConditionSplit[] = [];
  for (const tag of CONDITION_TAGS) {
    const withTag = usable.filter((r) => normalizeConditions(r.conditions).includes(tag.id));
    const without = usable.filter((r) => !normalizeConditions(r.conditions).includes(tag.id));
    if (withTag.length < MIN_SPLIT_SAMPLES || without.length < MIN_SPLIT_SAMPLES) continue;
    const avg = (list: SessionResult[]) =>
      list.reduce((sum, r) => sum + r.rpe, 0) / list.length;
    const withRpe = avg(withTag);
    const withoutRpe = avg(without);
    out.push({
      tag: tag.id,
      label: tag.label,
      withRpe,
      withCount: withTag.length,
      withoutRpe,
      withoutCount: without.length,
      deltaRpe: withRpe - withoutRpe,
    });
  }
  // 差の大きい順。0に近いものは見ても仕方がない
  return out.sort((a, b) => Math.abs(b.deltaRpe) - Math.abs(a.deltaRpe));
}
