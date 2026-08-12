/**
 * 2部練習の午前枠についての助言。
 *
 * **自動では決めない。** 種目を選ぶのは本人のまま。
 *
 * 自動化を採らなかった理由:
 * 制限因子は既に午後（主練習）で効いている——M-7 の `categoryWeights` が
 * 枠を振り替えている。午前にも同じ判定を当てると、1つの信号を二重に数える。
 * さらに午前は低負荷に限定されている（同日2本の高負荷はERROR）ので、
 * 自動化しても出てくる答えはジョグ・流し・補強のどれかに収束する。
 * 決め打ちを増やす割に結果が変わらない。
 *
 * そこで「噛み合っていないときだけ一言出す」に留める。
 * 判定は `assessLimiter` / `categoryWeights` の結果をそのまま使い、
 * ここで別の基準を作らない——同じ制限因子から画面ごとに違う助言が出てはいけない。
 */
import type { Athlete } from "./types";
import { assessLimiter, categoryWeights, LIMITER_LABELS } from "./limiter";
import { amSlotOf, DOW_LABELS, SLOT_LABELS, type Dow, type WeekTemplate } from "./weekTemplate";

export interface AmSlotAdvice {
  /** 画面に出す一文 */
  message: string;
  /** なぜそう言えるのか（制限因子の判定根拠） */
  basis: string;
}

const ALL_DOWS: Dow[] = [0, 1, 2, 3, 4, 5, 6];

/**
 * 午前枠と制限因子が噛み合っているかを見る。
 *
 * 何も言うことが無ければ空で返す。**無理に助言を作らない**
 * ——毎回何か出ていると、本当に噛み合っていないときに気づけなくなる。
 */
export function amSlotAdvice(
  athlete: Athlete | undefined,
  template: WeekTemplate | undefined,
  targetTimeSec?: number
): AmSlotAdvice[] {
  if (!athlete || !template?.enabled) return [];

  const amDows = ALL_DOWS.filter((d) => amSlotOf(template, d) !== undefined);
  if (amDows.length === 0) return []; // 2部にしていないなら言うことは無い

  const assessment = assessLimiter(athlete, targetTimeSec);
  if (assessment.limiter === "unknown" || assessment.limiter === "balanced") return [];

  const weights = categoryWeights(assessment.limiter);
  /** 増やしたい側のうち、午前に置けるもの（低負荷に限る） */
  const wanted = weights
    .filter((w) => w.weight > 1 && w.category === "neural")
    .map((w) => w.category);
  if (wanted.length === 0) return [];

  const used = new Set(amDows.map((d) => amSlotOf(template, d)!));
  if (wanted.some((c) => used.has(c))) return []; // もう入っている

  const label = LIMITER_LABELS[assessment.limiter];
  const slotNames = amDows
    .map((d) => `${DOW_LABELS[d]}=${SLOT_LABELS[amSlotOf(template, d)!] ?? amSlotOf(template, d)}`)
    .join("・");

  return [
    {
      message:
        `制限因子は「${label}」と判定しています。午前は ${slotNames} で、` +
        `神経系（流し）が入っていません。${amDows.length}日のうち1日を流しに替えると転移が上がる可能性があります。`,
      basis: assessment.narrative,
    },
  ];
}
