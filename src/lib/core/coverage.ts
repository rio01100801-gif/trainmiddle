/**
 * Q-2 足りていないカテゴリの提案
 *
 * ルールエンジンは「多すぎる・詰まりすぎ」を検出するが、
 * 「足りていない」側は誰も見ていなかった。
 * 固定曜日設定を使っていると、その枠の中に収まる範囲でしか
 * メニューが出ないので、4週まとめて見ると特定のカテゴリが薄いまま進む。
 *
 * ここでやること:
 *   ・直近4週に実際にやったカテゴリ配分を数える
 *   ・そのフェーズが本来もっている配分（生成器のテンプレートから算出）と比べる
 *   ・制限因子（M-7）で重みを掛ける
 *   ・不足しているものについて、置き換え候補を出す
 *
 * やらないこと:
 *   ・固定曜日設定の書き換え。本人が決めたものを黙って変えない
 *   ・自動適用。M-2 / M-6 と同じで、出すのは提案まで
 */
import type { Session, SessionCategory } from "./types";
import type { Phase } from "./types";
import { addDays, diffDays } from "./dates";
import { categoryCountsPerFourWeeks } from "./periodization";
import { categoryWeights, type Limiter, LIMITER_LABELS } from "./limiter";

/** 見る期間（週）。4週より短いと隔週要素が入らず、長いと今の状態から離れる */
export const COVERAGE_WEEKS = 4;

/**
 * 不足とみなす最小の差（回）。
 * 1回の差は週テンプレートの巡り合わせで普通に出るので提案しない。
 * 2回足りない＝4週のうち半分が抜けている、という状態から出す。
 */
export const COVERAGE_MIN_SHORTFALL = 2;

/** 提案の対象にするカテゴリ。有酸素と休養は「足りない」の対象にしない */
const QUALITY_CATEGORIES: SessionCategory[] = [
  "high_lactate",
  "race_economy",
  "modeling",
  "cv",
  "threshold",
  "neural",
];

export const CATEGORY_JP: Record<SessionCategory, string> = {
  high_lactate: "高乳酸",
  race_economy: "経済走",
  modeling: "モデリング",
  neural: "神経系",
  cv: "CV",
  threshold: "閾値",
  aerobic: "有酸素",
  off: "休養",
};

export interface CoverageTarget {
  category: SessionCategory;
  /** 直近4週の実施回数 */
  actual: number;
  /** この期間に欲しい回数 */
  wanted: number;
  /** 不足回数（0以下なら足りている） */
  shortfall: number;
  /** なぜその回数なのか。必ず数字で書く */
  basis: string;
}

export interface CoverageCandidate {
  sessionId: string;
  date: string;
  from: SessionCategory;
  name: string;
  /** 置き換えたときに失うもの。無ければ undefined */
  cost?: string;
}

export interface CoverageProposal {
  category: SessionCategory;
  shortfall: number;
  reason: string;
  candidates: CoverageCandidate[];
  /** 置き換え先が見つからなかったときの説明 */
  note?: string;
}

export interface CoverageReview {
  weeks: number;
  phase: Phase;
  limiter: Limiter;
  targets: CoverageTarget[];
  proposals: CoverageProposal[];
  narrative: string;
}

export interface CoverageInput {
  /**
   * 判定に使うセッション。
   * **過去データ入力から作られたものも含める。**
   * 実際にやった練習の配分を見たいので、入力経路で数が変わってはいけない。
   */
  sessions: Session[];
  today: string;
  phase: Phase;
  limiter: Limiter;
  /** レースまでの残り週数。表示に使う */
  weeksToRace?: number;
}

/** 直近4週に実施した（予定ではなく行った）カテゴリを数える */
function actualCounts(sessions: Session[], today: string): Record<string, number> {
  const from = addDays(today, -COVERAGE_WEEKS * 7);
  const out: Record<string, number> = {};
  for (const s of sessions) {
    if (s.date < from || s.date > today) continue;
    // 予定のまま実施されていないものは数えない（あるつもりで足りない、を防ぐ）
    if (s.status === "skipped") continue;
    if (s.date < today && s.status !== "completed") continue;
    out[s.category] = (out[s.category] ?? 0) + 1;
  }
  return out;
}

/**
 * 置き換え候補を探す。
 *
 * 有酸素（ジョグ）の枠から選ぶ。ポイント練習を別のポイント練習に替えると、
 * 減らした側が今度は足りなくなる。
 * ただしロングランは有酸素土台そのものなので、他に候補が無いときだけ出し、
 * 代償を必ず文章にする。
 */
function findCandidates(
  sessions: Session[],
  today: string,
  horizonDays: number
): CoverageCandidate[] {
  const to = addDays(today, horizonDays);
  const inRange = sessions.filter(
    (s) =>
      s.date > today &&
      s.date <= to &&
      s.status === "planned" &&
      !s.isFixed &&
      s.category === "aerobic"
  );

  // ロングランかどうかは距離で見る。週内で最も長いジョグを土台とみなす
  const longest = Math.max(0, ...inRange.map((s) => s.distanceKm ?? 0));
  const isLongRun = (s: Session) =>
    (s.distanceKm ?? 0) >= 12 || ((s.distanceKm ?? 0) > 0 && (s.distanceKm ?? 0) === longest);

  const ordinary = inRange.filter((s) => !isLongRun(s));
  const longRuns = inRange.filter(isLongRun);

  const toCandidate = (s: Session, cost?: string): CoverageCandidate => ({
    sessionId: s.id,
    date: s.date,
    from: s.category,
    name: s.name,
    cost,
  });

  const out = ordinary.slice(0, 3).map((s) => toCandidate(s));
  if (out.length === 0) {
    // 通常のジョグ枠が無いときだけロングランを出す。代償を明記する
    out.push(
      ...longRuns
        .slice(0, 2)
        .map((s) =>
          toCandidate(
            s,
            `${s.distanceKm ?? "?"}kmのロングランが無くなります。有酸素の土台は数週間かけて落ちるので、` +
              `置き換えるなら次の週で戻してください。連続で潰さないこと`
          )
        )
    );
  }
  return out;
}

/**
 * 直近4週の配分を見て、足りていないカテゴリの提案を作る。
 */
export function reviewCoverage(input: CoverageInput): CoverageReview {
  const { sessions, today, phase, limiter, weeksToRace } = input;
  const base = categoryCountsPerFourWeeks(phase);
  const weights = new Map(categoryWeights(limiter).map((w) => [w.category, w]));
  const actual = actualCounts(sessions, today);

  const targets: CoverageTarget[] = [];
  for (const category of QUALITY_CATEGORIES) {
    const baseCount = base[category] ?? 0;
    const w = weights.get(category);
    // 制限因子の重みを掛ける。掛けても基準が0のものは0のまま（そのフェーズで使わない種目）
    const wanted = Math.round(baseCount * (w?.weight ?? 1));
    if (wanted === 0) continue;
    const got = actual[category] ?? 0;
    targets.push({
      category,
      actual: got,
      wanted,
      shortfall: wanted - got,
      basis:
        `${phase}期の基準は4週で${baseCount}回` +
        (w && w.weight !== 1
          ? `、制限因子が${LIMITER_LABELS[limiter]}なので×${w.weight.toFixed(1)}で${wanted}回`
          : "") +
        `。直近4週は${got}回`,
    });
  }
  targets.sort((a, b) => b.shortfall - a.shortfall);

  const proposals: CoverageProposal[] = [];
  for (const t of targets) {
    if (t.shortfall < COVERAGE_MIN_SHORTFALL) continue;
    const candidates = findCandidates(sessions, today, 14);
    const w = weights.get(t.category);
    proposals.push({
      category: t.category,
      shortfall: t.shortfall,
      reason:
        `${CATEGORY_JP[t.category]}が${t.shortfall}回不足しています。${t.basis}` +
        (w && w.weight > 1 ? `。${w.note}` : "") +
        (weeksToRace !== undefined ? `。レースまで${weeksToRace}週` : ""),
      candidates,
      note:
        candidates.length === 0
          ? "今後2週に動かせるジョグの枠がありません（固定枠か、既に予定が埋まっています）。固定曜日設定を見直すか、週を跨いで調整してください"
          : undefined,
    });
  }

  const narrative =
    proposals.length === 0
      ? `直近${COVERAGE_WEEKS}週のカテゴリ配分は${phase}期の基準に対して足りています。`
      : `直近${COVERAGE_WEEKS}週で${proposals
          .map((p) => `${CATEGORY_JP[p.category]}が${p.shortfall}回`)
          .join("、")}足りていません。固定曜日の設定はそのままにしてあるので、` +
        `入れ替えるかどうかは選んでください。`;

  return { weeks: COVERAGE_WEEKS, phase, limiter, targets, proposals, narrative };
}

/** 週数（表示用）。レース当日を含む週まで数える */
export function weeksUntil(today: string, raceDate: string): number | undefined {
  const d = diffDays(today, raceDate);
  if (d < 0) return undefined;
  return Math.ceil(d / 7);
}
