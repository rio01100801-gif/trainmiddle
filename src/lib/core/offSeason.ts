/**
 * 冬季・基礎構築モード（目標レースが決まっていない期間）。
 *
 * 期分けそのものは前からある——目標レース日から逆算して
 * Base（基礎期）→ Build（準備期）→ Specific（専門期）→ Modeling（試合期）→ Taper（調整期）。
 * 足りていなかったのは**レースが決まっていない期間**で、
 * 目標レースが見つからないと生成が例外で止まっていた。
 *
 * ここでやらないこと:
 *
 * **ピーキングしない。** レースが無いのにテーパーを組むと、
 * 落とす理由の無い量を落として、戻すきっかけも無いまま次の期に入る。
 * 設定ペースの土台も目標タイムを混ぜない（Base の `PHASE_GOAL_WEIGHT` は 0.0）。
 * 冬に「1:48.5で走れる前提のペース」を出しても、実行できないだけ。
 *
 * ここでやること:
 *
 * 冬は**同じ4週間を延々と繰り返す期間ではない**。
 * 有酸素の量 → 筋力と坂 → 閾値・CVの量 → スピードの土台、と重心を移す。
 * 16週で一巡し、以降は繰り返す。
 * 1ブロック（4週）の中は既存の `weekStep`（入り口→量→密度→回復）がそのまま効くので、
 * ブロックの長さを4週にそろえてある——ずらすと「量を増やす週」と
 * 「重心が変わる週」が別々に来て、何が効いたのか分からなくなる。
 */
import type { Goal, Race } from "./types";
import { LOAD_CYCLE_WEEKS } from "./progression";

/**
 * 1ブロックの週数。
 *
 * 負荷サイクル（入り口 → 量 → 密度 → 回復）と**同じ値でなければならない**ので、
 * 数字を書かずにそちらを参照する。別々に持っていたときは
 * 「そろえる前提」とコメントに書いてあるだけで、片方を変えると静かにずれた。
 * ずれると「量を増やす週」と「重心が変わる週」が別々に来て、何が効いたのか分からなくなる。
 */
export const OFF_SEASON_BLOCK_WEEKS = LOAD_CYCLE_WEEKS;

/**
 * 一度に作る週数。4ブロックぶん。
 *
 * レースが無いので終わりが無い。無限には作れないので区切りが要る。
 * 16週は「重心が一巡する長さ」で、これより短いと一巡を見せられず、
 * 長くしても先の予定ほど実際の状態から外れていくだけ（`horizon.ts` の考え方と同じ）。
 * 足りなくなったら作り直す。
 */
export const OFF_SEASON_HORIZON_WEEKS = 16;

export type OffSeasonEmphasis =
  | "aerobic_volume"
  | "strength_hills"
  | "aerobic_high"
  | "speed_base";

/** ブロックの並び。この順に重心を移す */
export const OFF_SEASON_BLOCKS: OffSeasonEmphasis[] = [
  "aerobic_volume",
  "strength_hills",
  "aerobic_high",
  "speed_base",
];

export const OFF_SEASON_LABELS: Record<OffSeasonEmphasis, string> = {
  aerobic_volume: "有酸素の土台",
  strength_hills: "筋力・坂",
  aerobic_high: "閾値・CVの量",
  speed_base: "スピードの土台",
};

/**
 * なぜその重心なのか。処方の根拠として画面に出す。
 *
 * 800mで効くのは量ではない、というのがこのアプリの前提なので、
 * 冬に量を積む理由は「土台を上げてから特異的な練習に耐えられるようにする」ことに限る。
 * 量そのものが目的だと読めないよう、理由まで書く。
 */
export const OFF_SEASON_REASONS: Record<OffSeasonEmphasis, string> = {
  aerobic_volume:
    "有酸素の土台を上げる期間です。あとで高乳酸を週1で回せるかは、ここでのジョグとロングランの積み上げで決まります。",
  strength_hills:
    "坂と筋力の期間です。接地で押せる力を作ります。ここを飛ばすと、春に本数を増やしたときにフォームが先に崩れます。",
  aerobic_high:
    "閾値・CVの量を増やす期間です。乳酸を処理する側を上げておくと、専門期の高乳酸から戻るのが速くなります。",
  speed_base:
    "スピードの土台の期間です。流しと坂で神経系を戻します。長く量だけを積むと、速い動きが出なくなるため。",
};

/**
 * 目標レースが決まっていないか。
 *
 * 「目標が無い」ではなく「目標**レース**が無い」。
 * 目標タイムは冬でも使う（制限因子の判定・タイプ診断の土台になる）。
 */
export function isOffSeason(goal: Goal | undefined, races: Race[]): boolean {
  if (!goal) return false;
  return !races.some((race) => race.id === goal.targetRaceId);
}

/** 開始から数えて何週目か → その週の重心 */
export function offSeasonEmphasis(weekIndex: number): OffSeasonEmphasis {
  const block = Math.floor(weekIndex / OFF_SEASON_BLOCK_WEEKS);
  const wrapped = ((block % OFF_SEASON_BLOCKS.length) + OFF_SEASON_BLOCKS.length) %
    OFF_SEASON_BLOCKS.length;
  return OFF_SEASON_BLOCKS[wrapped];
}

/** 何ブロック目か（1始まり・画面表示用） */
export function offSeasonBlockNumber(weekIndex: number): number {
  return Math.floor(weekIndex / OFF_SEASON_BLOCK_WEEKS) + 1;
}

/** 「第2ブロック 筋力・坂（5〜8週目）」のような見出し */
export function describeOffSeasonBlock(weekIndex: number): string {
  const n = offSeasonBlockNumber(weekIndex);
  const from = (n - 1) * OFF_SEASON_BLOCK_WEEKS + 1;
  const to = n * OFF_SEASON_BLOCK_WEEKS;
  return `第${n}ブロック ${OFF_SEASON_LABELS[offSeasonEmphasis(weekIndex)]}（${from}〜${to}週目）`;
}
