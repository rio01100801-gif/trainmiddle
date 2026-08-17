/**
 * アップと主練習の相性。
 *
 * ここは**結論を出さない場所**として設計してある。
 *
 * アップの記録は、多くても週2〜3回しか増えない。
 * 条件（主練習のカテゴリ × アップの内容）で割ると、1つの組み合わせは
 * 月に数回にしかならない。その数で「流しを入れたほうが良い」と言うと、
 * たまたま調子が良かった日を根拠にして設定を動かすことになる。
 *
 * だから:
 *   ・3回に満たない組み合わせは **数えるだけで、傾向を出さない**
 *   ・3回以上でも「暫定」と明示し、サンプル数を必ず併記する
 *   ・「〜だから〜になる」とは書かない。**同じ日に他のことも起きている**
 *     （睡眠・気温・前日の練習）ので、アップだけを原因にはできない
 *   ・自動でアップや主練習を変えない。出すのは材料まで
 *
 * 「アップを変えたら良くなる」と読ませないための制約であって、
 * 慎重さの演出ではない。ここを緩めると、CFEと同じ「なぜ下がったか分からない」
 * 状態がアップにも生まれる。
 */
import type { SessionCategory, SessionResult, Session } from "./types";
import {
  WARMUP_LEGS_LABELS,
  WARMUP_SEGMENT_LABELS,
  describeSegment,
  warmupDistanceKm,
  type WarmupLegs,
  type WarmupSegmentKind,
} from "./warmup";

/**
 * 暫定傾向を出し始める件数。
 *
 * 3にしたのは、2回だと「1勝1敗」しか起こらず何も言えないため。
 * 3回あれば少なくとも多数決の形にはなる。
 * それでも**確信ではなく暫定**であることは、表示側で必ず断る。
 */
export const WARMUP_MIN_SAMPLES = 3;

/** アップの内容をひとことで分類する。組み合わせを数えるための鍵 */
export type WarmupShape = "jog_only" | "with_strides" | "with_stimulus";

export const WARMUP_SHAPE_LABELS: Record<WarmupShape, string> = {
  jog_only: "ジョグのみ",
  with_strides: "流しまで",
  with_stimulus: "刺激まで",
};

/**
 * 区間の並びを3つに畳む。
 *
 * 細かく分けるほど1つあたりの件数が減り、いつまでも3回に届かない。
 * 「ジョグだけ」「流しを入れた」「刺激まで入れた」の3段階は、
 * 主練習1本目の入りに効くかどうかを見るのに足りる粗さ。
 */
export function warmupShapeOf(kinds: WarmupSegmentKind[]): WarmupShape {
  if (kinds.includes("acceleration") || kinds.includes("short_stimulus")) return "with_stimulus";
  if (kinds.includes("strides") || kinds.includes("progressive")) return "with_strides";
  return "jog_only";
}

/** 1回ぶんの記録。分析の材料 */
export interface WarmupSample {
  date: string;
  category: SessionCategory;
  shape: WarmupShape;
  segments: string;
  distanceKm: number;
  gapToMainMin?: number;
  legs?: WarmupLegs;
  /** 主練習1本目が設定からどれだけ外れたか（秒。＋は遅い） */
  firstRepGapSec?: number;
  rpe?: number;
  nextDayLegsHeavy?: boolean;
  /** 完遂したか（打ち切っていない） */
  completed: boolean;
}

export interface WarmupGroup {
  category: SessionCategory;
  shape: WarmupShape;
  count: number;
  /** 3回に満たなければ undefined。**足りないときは数字を出さない** */
  avgFirstRepGapSec?: number;
  avgRpe?: number;
  completionRate?: number;
  heavyNextDayRate?: number;
  /** 3回未満のときに出す一文 */
  note?: string;
}

export interface WarmupInsight {
  samples: WarmupSample[];
  groups: WarmupGroup[];
  /** アップ後の脚ごとの、主練習1本目の設定乖離 */
  byLegs: { legs: WarmupLegs; count: number; avgFirstRepGapSec?: number }[];
  /** 画面にそのまま出す文。断定しない書き方に揃えてある */
  readouts: string[];
  /** 記録がまだ足りないときの案内 */
  emptyNote?: string;
}

function avg(xs: number[]): number | undefined {
  if (xs.length === 0) return undefined;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

/**
 * 主練習1本目が設定からどれだけ外れたか。
 *
 * 1本目を見るのは、**アップの効きが一番出る場所**だから。
 * 3本目以降はその日の状態や本数の疲労が混ざる。
 */
export function firstRepGapSec(r: SessionResult): number | undefined {
  const first = r.interval?.results?.[0];
  if (!first) return undefined;
  /*
   * 本ごとの設定を優先する。距離が短縮された本では、
   * セッション全体の設定ではなく、その本に換算された設定が入っている。
   */
  const target = first.targetSec ?? r.interval?.targetSec;
  if (target === undefined) return undefined;
  return round1(first.actualSec - target);
}

/** 記録からアップの材料を1件作る。アップが無ければ undefined */
export function warmupSampleOf(
  r: SessionResult,
  session: Session | undefined
): WarmupSample | undefined {
  const w = r.warmup;
  if (!w || !session) return undefined;
  return {
    date: r.date,
    category: session.category,
    shape: warmupShapeOf(w.segments.map((s) => s.kind)),
    segments: w.segments.length > 0 ? w.segments.map(describeSegment).join("・") : "—",
    distanceKm: round1(warmupDistanceKm(w)),
    gapToMainMin: w.gapToMainMin,
    legs: w.legs,
    firstRepGapSec: firstRepGapSec(r),
    rpe: r.rpe,
    nextDayLegsHeavy: r.nextDayLegs === undefined ? undefined : r.nextDayLegs === "heavy",
    completed: !r.aborted,
  };
}

/**
 * アップの傾向。
 *
 * **ここで設定は動かない。** 返すのは読むための材料だけで、
 * 呼び出し側にも自動で何かを変える口を用意していない。
 */
export function warmupInsight(results: SessionResult[], sessions: Session[]): WarmupInsight {
  const sessionById = new Map(sessions.map((s) => [s.id, s]));
  const samples = results
    .map((r) => warmupSampleOf(r, sessionById.get(r.sessionId)))
    .filter((s): s is WarmupSample => !!s)
    .sort((a, b) => b.date.localeCompare(a.date));

  if (samples.length === 0) {
    return {
      samples,
      groups: [],
      byLegs: [],
      readouts: [],
      emptyNote: "アップの記録がまだありません。記録すると、主練習との相性を並べて見られます。",
    };
  }

  // --- 主練習カテゴリ × アップの内容 ---
  const key = (s: WarmupSample) => `${s.category}::${s.shape}`;
  const buckets = new Map<string, WarmupSample[]>();
  for (const s of samples) {
    const k = key(s);
    buckets.set(k, [...(buckets.get(k) ?? []), s]);
  }

  const groups: WarmupGroup[] = [...buckets.entries()]
    .map(([k, list]) => {
      const [category, shape] = k.split("::") as [SessionCategory, WarmupShape];
      const enough = list.length >= WARMUP_MIN_SAMPLES;
      if (!enough) {
        return {
          category,
          shape,
          count: list.length,
          note: `${list.length}回。傾向を出すには${WARMUP_MIN_SAMPLES}回必要です。いまは記録だけしています。`,
        };
      }
      const gaps = list.map((s) => s.firstRepGapSec).filter((x): x is number => x !== undefined);
      const rpes = list.map((s) => s.rpe).filter((x): x is number => x !== undefined);
      const legsKnown = list.filter((s) => s.nextDayLegsHeavy !== undefined);
      return {
        category,
        shape,
        count: list.length,
        avgFirstRepGapSec: gaps.length > 0 ? round1(avg(gaps)!) : undefined,
        avgRpe: rpes.length > 0 ? round1(avg(rpes)!) : undefined,
        completionRate: Math.round((list.filter((s) => s.completed).length / list.length) * 100),
        heavyNextDayRate:
          legsKnown.length > 0
            ? Math.round((legsKnown.filter((s) => s.nextDayLegsHeavy).length / legsKnown.length) * 100)
            : undefined,
      };
    })
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));

  // --- アップ後の脚 × 1本目の設定乖離 ---
  const legsOrder: WarmupLegs[] = ["heavy", "normal", "bouncy"];
  const byLegs = legsOrder
    .map((legs) => {
      const list = samples.filter((s) => s.legs === legs);
      const gaps = list.map((s) => s.firstRepGapSec).filter((x): x is number => x !== undefined);
      return {
        legs,
        count: list.length,
        avgFirstRepGapSec:
          list.length >= WARMUP_MIN_SAMPLES && gaps.length > 0 ? round1(avg(gaps)!) : undefined,
      };
    })
    .filter((x) => x.count > 0);

  return { samples, groups, byLegs, readouts: buildReadouts(groups, byLegs) };
}

/**
 * 画面に出す文。
 *
 * **「〜だから〜になる」と書かない。**
 * 同じ日に睡眠も気温も前日の練習も違うので、アップだけを原因にはできない。
 * 「〜のとき、〜だった」までにとどめ、判断は本人に残す。
 */
function buildReadouts(
  groups: WarmupGroup[],
  byLegs: { legs: WarmupLegs; count: number; avgFirstRepGapSec?: number }[]
): string[] {
  const out: string[] = [];

  for (const g of groups) {
    if (g.count < WARMUP_MIN_SAMPLES) continue;
    const parts: string[] = [];
    if (g.avgFirstRepGapSec !== undefined) {
      const sign = g.avgFirstRepGapSec > 0 ? "遅い" : "速い";
      parts.push(`1本目は設定より平均${Math.abs(g.avgFirstRepGapSec)}秒${sign}`);
    }
    if (g.completionRate !== undefined) parts.push(`完遂${g.completionRate}%`);
    if (g.avgRpe !== undefined) parts.push(`RPE平均${g.avgRpe}`);
    if (parts.length === 0) continue;
    out.push(
      `${WARMUP_SHAPE_LABELS[g.shape]}のとき、${parts.join("・")}（${g.count}回・暫定）`
    );
  }

  const enoughLegs = byLegs.filter((l) => l.avgFirstRepGapSec !== undefined);
  if (enoughLegs.length >= 2) {
    const desc = enoughLegs
      .map((l) => `${WARMUP_LEGS_LABELS[l.legs]}=${l.avgFirstRepGapSec}秒（${l.count}回）`)
      .join(" / ");
    out.push(`アップ後の脚と1本目の設定乖離: ${desc}（暫定）`);
  }

  if (out.length > 0) {
    /*
     * 最後に必ず断る。
     * 上の行だけを読んで「流しを増やせばいい」と判断されると、
     * 同じ日に効いていた他の要因（睡眠・気温）が見えなくなる。
     */
    out.push(
      "同じ日に睡眠・気温・前日の練習も違います。アップだけが理由とは言えません。変えるかどうかは自分で決めてください。"
    );
  }
  return out;
}

/** 区間種別の内訳（記録の一覧に出す） */
export function segmentBreakdown(samples: WarmupSample[]): { label: string; count: number }[] {
  const counts = new Map<WarmupShape, number>();
  for (const s of samples) counts.set(s.shape, (counts.get(s.shape) ?? 0) + 1);
  return [...counts.entries()]
    .map(([shape, count]) => ({ label: WARMUP_SHAPE_LABELS[shape], count }))
    .sort((a, b) => b.count - a.count);
}

/** 使っていない語彙を型として固定しておく（区間種別の追加漏れを型で止める） */
export const WARMUP_SEGMENT_LABEL_KEYS = Object.keys(WARMUP_SEGMENT_LABELS) as WarmupSegmentKind[];
