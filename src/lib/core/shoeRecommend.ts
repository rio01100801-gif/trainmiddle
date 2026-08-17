/**
 * その日の練習にどの靴を履くか。
 *
 * **推薦の判断はここだけ。** 練習詳細・記録・カレンダーは、それぞれで
 * 判定を書かずにこの結果を使う。画面ごとに別々の理屈があると、
 * 同じ練習なのに画面によって違う靴が出ることになる。
 *
 * ---
 *
 * **速い靴を選ぶ仕組みではない。**
 *
 * 判断の軸は「その練習の目的を達たしながら、脚への負担を抑えられるか」。
 * CVで厚底を薦めるのは速いからではなく、**設定ペースを維持したまま量を確保でき、
 * 翌日に残りにくい**から。リカバリーで反発を求めないのも同じ理由。
 *
 * ---
 *
 * **登録してある靴しか出さない。** 持っていない靴を薦めても履けない。
 * 引退させた靴も出さない（本人が使わないと決めたもの）。
 */
import type { Shoe, ShoeUsage } from "./shoes";
import { profileOf, type ShoeProfile } from "./shoeProfile";
import type { SessionCategory } from "./types";

/** 練習の狙い。カテゴリよりも粗く、靴の選び方に効く単位でまとめる */
export type ShoeSessionKind =
  | "recovery"
  | "easy"
  | "long"
  | "threshold"
  | "cv"
  | "vo2max"
  | "specific"
  | "glycolytic"
  | "strides"
  | "hill"
  | "race";

export const SHOE_SESSION_LABELS: Record<ShoeSessionKind, string> = {
  recovery: "リカバリージョグ",
  easy: "イージージョグ",
  long: "ロングラン",
  threshold: "LT・閾値",
  cv: "CV",
  vo2max: "VO2max",
  specific: "800m・1500m特異的",
  glycolytic: "解糖系・スピード持久",
  strides: "流し",
  hill: "坂ダッシュ・神経系",
  race: "レース",
};

export interface ShoeContext {
  kind: ShoeSessionKind;
  /** 練習場所。分からなければ undefined（推測しない） */
  place?: "track" | "road" | "treadmill" | "grass" | "hill" | "trail";
  /** 濡れているか。記録の条件タグから来る */
  wet?: boolean;
  slippery?: boolean;
  /** 選手の状態。分からなければ undefined */
  fatigueHigh?: boolean;
  hasPain?: boolean;
  /** レースまでの日数。近いほど本番の靴に寄せる */
  daysToRace?: number;
}

export interface ShoeSuggestion {
  shoe: Shoe;
  score: number;
  /** なぜこの靴か。数値ではなく言葉で残す */
  reasons: string[];
  /** 履くときに気をつけること */
  cautions: string[];
}

export interface ShoeRecommendation {
  /** 一番のおすすめ。登録が無ければ undefined */
  best?: ShoeSuggestion;
  /** 代替候補（2番目以降） */
  alternatives: ShoeSuggestion[];
  /** 登録が無いときの案内。ある場合は undefined */
  emptyNote?: string;
  /** 実績が少ないことを断る一文。**「学習済み」と誤解させない** */
  dataNote?: string;
}

/** セッションのカテゴリから、靴の選び方に効く単位へ寄せる */
export function shoeSessionKindOf(
  category: SessionCategory,
  opts: { isRace?: boolean; aerobicPurpose?: string } = {}
): ShoeSessionKind {
  if (opts.isRace) return "race";
  switch (category) {
    case "high_lactate":
      return "glycolytic";
    case "modeling":
    case "race_economy":
      return "specific";
    case "cv":
      return "cv";
    case "threshold":
      return "threshold";
    case "neural":
      return "hill";
    case "aerobic":
      if (opts.aerobicPurpose === "recovery") return "recovery";
      if (opts.aerobicPurpose === "long_run") return "long";
      return "easy";
    default:
      return "easy";
  }
}

/**
 * 狙いごとに、何を重く見るか。
 *
 * 数字は「その項目を何倍で見るか」であって、靴の良し悪しではない。
 * 合計が同じでも中身が違えば別の靴が出る。
 */
interface Weights {
  cushioning: number;
  responsiveness: number;
  stability: number;
  lightness: number;
  /** その狙いを一言で説明する言葉。理由の文に使う */
  why: string;
}

const WEIGHTS: Record<ShoeSessionKind, Weights> = {
  // 反発より、脚を回復させること
  recovery: { cushioning: 3, responsiveness: -1, stability: 2, lightness: 0, why: "脚を休めるのが目的なので、反発よりクッションと安定を優先します" },
  easy: { cushioning: 2, responsiveness: 0, stability: 2, lightness: 0, why: "量を積む日なので、脚に残らないことを優先します" },
  long: { cushioning: 3, responsiveness: 0, stability: 2, lightness: 0, why: "距離が長いので、終盤まで脚がもつことを優先します" },
  // 設定を維持したまま量を確保する
  threshold: { cushioning: 2, responsiveness: 2, stability: 1, lightness: 1, why: "設定ペースを無理なく維持でき、量を確保しやすいこと" },
  cv: { cushioning: 2, responsiveness: 3, stability: 1, lightness: 1, why: "設定ペースを維持しやすく、脚へのダメージも抑えられること" },
  vo2max: { cushioning: 1, responsiveness: 3, stability: 1, lightness: 2, why: "速い接地でも失速しないこと" },
  // レースへの近さで変わる
  specific: { cushioning: 1, responsiveness: 3, stability: 1, lightness: 3, why: "レースの動きに近いこと" },
  glycolytic: { cushioning: 1, responsiveness: 3, stability: 1, lightness: 3, why: "本数を通して同じ動きを保てること" },
  // 接地感と安定
  strides: { cushioning: 0, responsiveness: 2, stability: 3, lightness: 3, why: "短い距離なので、接地感と安定を優先します" },
  hill: { cushioning: 0, responsiveness: 1, stability: 4, lightness: 3, why: "接地が安定することを最優先します" },
  race: { cushioning: 0, responsiveness: 4, stability: 1, lightness: 4, why: "本番なので、出せる出力を最大にします" },
};

/** その狙いでスパイクが選択肢に入るか */
const SPIKE_KINDS: ShoeSessionKind[] = ["race", "specific", "glycolytic", "vo2max"];

export const RECOMMEND_MIN_SAMPLES = 3;

/**
 * 登録してある靴を、その日の練習に合う順に並べる。
 *
 * @param shoes 登録してある靴（引退したものも渡してよい。ここで外す）
 * @param usage 使用距離。劣化の注意に使う
 */
export interface ShoeOutcome {
  shoeId: string;
  kind: ShoeSessionKind;
  rpe: number;
  /** 翌日の脚。重ければその靴での負担が大きかった合図 */
  legsHeavy: boolean;
}

/**
 * その靴を、その狙いで実際に履いたときどうだったか。
 *
 * **少ないうちは使わない。** 1〜2回の結果で順位を変えると、
 * たまたま調子が悪かった日が「その靴が合わない」になる。
 * `RECOMMEND_MIN_SAMPLES` 以上たまってから初めて効かせる。
 *
 * そして**「学習済み」とは言わない。** 効かせているのはごく小さな加減で、
 * 何回ぶんの結果から出したかを必ず添える。
 */
function outcomeAdjust(
  outcomes: ShoeOutcome[],
  shoeId: string,
  kind: ShoeSessionKind
): { delta: number; note?: string } {
  const mine = outcomes.filter((o) => o.shoeId === shoeId && o.kind === kind);
  if (mine.length < RECOMMEND_MIN_SAMPLES) return { delta: 0 };
  const meanRpe = mine.reduce((a, o) => a + o.rpe, 0) / mine.length;
  const heavyRate = mine.filter((o) => o.legsHeavy).length / mine.length;
  /*
   * 同じ狙いの練習で、RPEが低め・翌日の脚が軽いほど上げる。
   * 幅は小さく保つ——実績は材料のひとつであって、
   * 練習の目的そのものを覆すものではない。
   */
  const delta = (7 - meanRpe) * 1.5 - heavyRate * 4;
  return {
    delta,
    note: `この靴でこの練習を${mine.length}回やった結果も少し見ています（まだ回数は多くありません）`,
  };
}

export function recommendShoes(
  shoes: Shoe[],
  ctx: ShoeContext,
  usage: ShoeUsage[] = [],
  outcomes: ShoeOutcome[] = []
): ShoeRecommendation {
  const active = shoes.filter((s) => !s.retired);
  if (active.length === 0) {
    return {
      alternatives: [],
      emptyNote:
        shoes.length === 0
          ? "シューズが登録されていません。設定から登録すると、その日の練習に合うものを出します。"
          : "使える靴がありません（登録したものが全部引退になっています）。",
    };
  }

  const w = WEIGHTS[ctx.kind];
  const kmById = new Map(usage.map((u) => [u.shoe.id, u.totalKm]));

  const scored = active.map((shoe) => {
    const p = profileOf(shoe);
    const reasons: string[] = [];
    const cautions: string[] = [];
    let score = 0;

    score += p.cushioning * w.cushioning;
    score += p.responsiveness * w.responsiveness;
    score += p.stability * w.stability;
    score += p.lightness * w.lightness;

    // --- 場所が合っているか ---
    if (ctx.place && !p.surfaces.includes(ctx.place)) {
      score -= 8;
      cautions.push("その場所向きの靴ではありません");
    }

    /*
     * スパイクは狙いを選ぶ。
     * ジョグでスパイクを履くことはないので、候補から実質外す。
     */
    if (p.isSpike && !SPIKE_KINDS.includes(ctx.kind)) {
      score -= 20;
      cautions.push("この練習でスパイクは履きません");
    }

    /*
     * トレッドミルはポイント練習でもスパイクを外す。
     * 場所違いの −8 では、ポイント練習の加点に負けて1番に出てしまう。
     * ベルトを切るので、狙いが合っていても履く場面が無い。
     */
    if (p.isSpike && ctx.place === "treadmill") {
      score -= 20;
      cautions.push("トレッドミルでスパイクは履きません");
    }

    // --- 濡れた路面 ---
    if (ctx.wet || ctx.slippery) {
      /*
       * 雨のときは反発よりグリップ。
       * 滑って転ぶ risk のほうが、0.1秒の反発より重い。
       */
      score += (p.grip - 3) * 4;
      if (p.grip <= 2) cautions.push("濡れた路面ではグリップに注意");
    }

    // --- 疲労と痛み ---
    if (ctx.fatigueHigh || ctx.hasPain) {
      /*
       * 疲労や痛みがあるときは、硬い靴とスパイクの順位を下げる。
       * 「今日は無理をしない」を靴の側でも支える。
       */
      if (p.isSpike) score -= 10;
      if (p.cushioning <= 2) score -= 6;
      score += (p.cushioning - 3) * 2;
      if (p.isSpike || p.cushioning <= 2) {
        cautions.push(ctx.hasPain ? "痛みがあるので硬い靴は避けます" : "疲労が残っているので脚に優しいほうへ");
      } else if (p.cushioning >= 3) {
        /*
         * 選ばれた側にも理由を残す。
         * 注意書きは順位を下げた靴に付くので、それだけだと
         * **なぜ今日はこの靴なのか**が画面に出ない。
         * いつもと違う靴が出た日に、理由が読めないのが一番困る。
         */
        reasons.push(
          ctx.hasPain
            ? "痛みがあるので、脚に負担の少ない靴を選びました"
            : "疲労が残っているので、脚に負担の少ない靴を選びました"
        );
      }
    }

    // --- レースまでの日数 ---
    if (ctx.daysToRace !== undefined && ctx.daysToRace <= 14 && p.purposes.includes("race")) {
      // 本番が近いなら、本番の靴に慣れておく価値がある
      score += 4;
      reasons.push("レースが近いので、本番で履く靴に慣れておけます");
    }

    // --- 本人が決めた用途は、一般的な傾向より優先する ---
    const purposeFit: Partial<Record<ShoeSessionKind, ShoeProfile["purposes"]>> = {
      recovery: ["recovery", "daily"],
      easy: ["daily", "recovery"],
      long: ["long", "daily"],
      threshold: ["quality", "daily"],
      cv: ["quality", "race"],
      vo2max: ["quality", "race"],
      specific: ["race", "quality"],
      glycolytic: ["race", "quality"],
      strides: ["quality", "race"],
      hill: ["quality", "daily"],
      race: ["race"],
    };
    /*
     * 用途は複数選べる。**1つでも噛み合っていれば加点する。**
     *
     * 全部が噛み合うことを求めると、「レース用でもポイント練習用でもある」靴が
     * どちらの日にも加点されなくなる（選択を増やすほど不利になる）。
     * 加点は1回だけ——2つ噛み合ったからといって2倍良いわけではない。
     */
    const fit = purposeFit[ctx.kind] ?? [];
    if (!p.purposes.includes("any") && p.purposes.some((x) => fit.includes(x))) {
      score += 6;
      reasons.push("この用途に使うと決めてある靴です");
    }

    // --- 劣化 ---
    const km = kmById.get(shoe.id) ?? 0;
    if (p.replaceAtKm > 0 && km >= p.replaceAtKm) {
      score -= 5;
      cautions.push(`${Math.round(km)}km 走っています。履き替えを考える時期です`);
    }

    // --- 自分の結果 ---
    const own = outcomeAdjust(outcomes, shoe.id, ctx.kind);
    score += own.delta;
    if (own.note) reasons.push(own.note);

    if (reasons.length === 0) reasons.push(w.why);
    return { shoe, score, reasons, cautions };
  });

  /*
   * 同点のときは登録順のまま（毎回同じ結果が出る）。
   * 乱数で散らすと「なぜ今日はこっちなのか」が説明できなくなる。
   */
  const sorted = scored
    .map((s, i) => ({ s, i }))
    .sort((a, b) => (b.s.score - a.s.score) || a.i - b.i)
    .map((x) => x.s);

  /*
   * 実績が少ないことを断る。
   * 「学習済み」と受け取られると、まだ根拠の薄い順位を信用させてしまう。
   */
  const used = outcomes.filter((o) => o.kind === ctx.kind).length;
  const dataNote =
    used < RECOMMEND_MIN_SAMPLES
      ? "この練習でのあなた自身の実績はまだ足りません。いまは靴の性格だけで並べています。"
      : undefined;

  return {
    best: sorted[0],
    alternatives: sorted.slice(1),
    dataNote,
  };
}
