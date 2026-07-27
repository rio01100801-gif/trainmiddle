/**
 * S-7 / S-8 / S-9 ポイント練習の組み立てと漸進
 *
 * これまで生成器はカテゴリごとに**固定の文字列**を返していた
 * （高乳酸なら常に `300m × 5 r5分`）。変わるのは設定タイムだけで、
 * 週が進んでも、直近の出来がどうでも、同じ内容が出続けていた。
 *
 * ここでやること:
 *   ・フェーズと週で内容を進める（漸進）
 *   ・直近の実行状況を内容そのものに反映する
 *   ・進め方を2案出し、どちらも成立させたうえで理由を付ける（S-9）
 *
 * 守ること:
 *   ・LLMを使わない。同じ状態からは必ず同じ内容が出る
 *   ・**数値には必ず理由を書く。** あとで動かしていいか判断できなくなるため
 *   ・きつい方を良しとしない。実行できない設定を出さないことを優先する
 *
 * ここに書いた漸進の考え方（出典ではなく、採用した原則）:
 *   1. 量 → 密度 → 強度 の順に上げる。3つを同時に上げない
 *   2. 3週上げて1週落とす（3:1）。ACWRの急上昇を避ける
 *   3. レースに近づくほど特異的にする（距離を短く・設定をレースペースへ）
 *   4. 高乳酸は「深く入る」種目なので、土台期に量を積まない
 */
import type { RestType, SessionCategory, TargetPace } from "./types";
import type { Phase } from "./types";
import { specificPace } from "./pace";
import type { Limiter } from "./limiter";
import type { TrendVerdict } from "./adaptive";

// ---------------------------------------------------------------------------
// 素の組み立て（フェーズ × 週）
// ---------------------------------------------------------------------------

export interface RepBlock {
  distanceM: number;
  reps: number;
}

export interface SessionSpec {
  category: SessionCategory;
  /** 区間。1種類なら1つ、複合（500+300）なら複数 */
  blocks: RepBlock[];
  restSec: number;
  restType: RestType;
  /** 設定タイムの基準にする距離（複合なら最も本数の多い区間） */
  targetPaces: TargetPace[];
  prescription: string;
  durationMin: number;
  distanceKm: number;
  /** この内容にした理由。画面にそのまま出す */
  reasons: string[];
}

/**
 * フェーズごとの素の内容。
 *
 * 距離と本数の根拠:
 *   Base     … 高乳酸は200mまで。土台期に300m以上を積むと、
 *               有酸素の積み上げが乳酸系の疲労で削られる
 *   Build    … 300mへ。まだレストは長め（完全回復に近い）
 *   Specific … 300mのままレストを詰める。レース終盤の状況に近づける
 *   Modeling … 本数を落として複合にする。レースの形そのものを再現する
 */
interface Recipe {
  blocks: RepBlock[];
  restSec: number;
  restType: RestType;
  /** 設定タイムを計算する距離 */
  paceDistanceM: number[];
  durationMin: number;
  distanceKm: number;
}

/*
 * テーパー期（Taper）は載せない。
 * レース前の量はM-6とRULE-09が決めており、ここで別の根拠から本数を動かすと
 * 2つの仕組みが同じ週の量を取り合うことになる。漸進モデルが担当するのは積み上げの期間だけ。
 */
const RECIPES: Partial<Record<SessionCategory, Partial<Record<Phase, Recipe>>>> = {
  high_lactate: {
    // 土台期は短く少なく。深く入らない
    Base: { blocks: [{ distanceM: 200, reps: 5 }], restSec: 180, restType: "jog", paceDistanceM: [200], durationMin: 50, distanceKm: 7 },
    Build: { blocks: [{ distanceM: 300, reps: 5 }], restSec: 300, restType: "jog", paceDistanceM: [300], durationMin: 60, distanceKm: 8 },
    // レストを詰める＝レース終盤の状況に近づける
    Specific: { blocks: [{ distanceM: 300, reps: 5 }], restSec: 240, restType: "jog", paceDistanceM: [300], durationMin: 60, distanceKm: 8 },
    Modeling: { blocks: [{ distanceM: 300, reps: 4 }], restSec: 180, restType: "jog", paceDistanceM: [300], durationMin: 55, distanceKm: 7 },
  },
  race_economy: {
    Build: { blocks: [{ distanceM: 600, reps: 3 }], restSec: 420, restType: "full", paceDistanceM: [600], durationMin: 60, distanceKm: 8 },
    Specific: { blocks: [{ distanceM: 600, reps: 3 }], restSec: 360, restType: "full", paceDistanceM: [600], durationMin: 60, distanceKm: 8 },
    Modeling: { blocks: [{ distanceM: 600, reps: 2 }], restSec: 420, restType: "full", paceDistanceM: [600], durationMin: 50, distanceKm: 7 },
  },
  modeling: {
    // レースの形。前半を作って終盤に入る流れを再現する
    Specific: { blocks: [{ distanceM: 500, reps: 1 }, { distanceM: 300, reps: 1 }], restSec: 60, restType: "walk", paceDistanceM: [500, 300], durationMin: 55, distanceKm: 7 },
    Modeling: { blocks: [{ distanceM: 600, reps: 1 }, { distanceM: 200, reps: 1 }], restSec: 60, restType: "walk", paceDistanceM: [600, 200], durationMin: 55, distanceKm: 7 },
  },
  neural: {
    Base: { blocks: [{ distanceM: 100, reps: 6 }], restSec: 180, restType: "full", paceDistanceM: [100], durationMin: 45, distanceKm: 7 },
    Build: { blocks: [{ distanceM: 120, reps: 6 }], restSec: 180, restType: "full", paceDistanceM: [120], durationMin: 45, distanceKm: 7 },
    Specific: { blocks: [{ distanceM: 150, reps: 5 }], restSec: 240, restType: "full", paceDistanceM: [150], durationMin: 45, distanceKm: 7 },
    Modeling: { blocks: [{ distanceM: 150, reps: 4 }], restSec: 240, restType: "full", paceDistanceM: [150], durationMin: 40, distanceKm: 6 },
  },
};

/** 週内の漸進。3週上げて1週落とす（3:1） */
export const LOAD_CYCLE_WEEKS = 4;

/**
 * 週の位置による調整。
 *   0週目 … 素のまま（そのブロックの入り口）
 *   1週目 … 量（本数+1）
 *   2週目 … 密度（レスト−20%）
 *   3週目 … 回復（本数−1・レストは素に戻す）
 *
 * 量→密度の順にするのは、同時に上げると「何が効いたのか」も
 * 「何がきつかったのか」も分からなくなるため。
 */
export function weekStep(weekIndex: number): "baseline" | "volume" | "density" | "recovery" {
  const w = ((weekIndex % LOAD_CYCLE_WEEKS) + LOAD_CYCLE_WEEKS) % LOAD_CYCLE_WEEKS;
  return (["baseline", "volume", "density", "recovery"] as const)[w];
}

/** レストを詰める割合。1回で25%以上詰めると別の練習になる */
export const DENSITY_STEP = 0.2;
/** レストの下限（秒）。これ以下は回復が成立せず、狙った設定で走れない */
export const MIN_REST_SEC = 90;

export interface BuildSpecInput {
  category: SessionCategory;
  phase: Phase;
  /** そのフェーズに入ってからの週数（0始まり） */
  weekIndex: number;
  /** CFE（推定800mタイム秒）。設定タイムの基準 */
  cfeSec: number;
  /** 直近の同カテゴリの実行状況（M-2と同じ判定） */
  trend?: TrendVerdict;
  /** ACWRが高い（急に増やさない） */
  loadHigh?: boolean;
  /** 経済走の導入週（既存の漸進をそのまま使う） */
  economyWeek?: number;
}

/**
 * そのカテゴリ・フェーズ・週の内容を組み立てる。
 *
 * 直近の出来を**内容そのもの**に反映する（S-7）。
 * M-2 は設定タイムだけを動かすが、こちらは本数とレストを動かす。
 * 設定が守れていないときに量を増やしても、守れない練習が増えるだけ。
 */
export function buildSessionSpec(input: BuildSpecInput): SessionSpec | undefined {
  const recipe = RECIPES[input.category]?.[input.phase];
  if (!recipe) return undefined;

  let blocks = recipe.blocks.map((b) => ({ ...b }));
  let restSec = recipe.restSec;
  const reasons: string[] = [];
  const step = weekStep(input.weekIndex);

  // --- 週による漸進 ---
  if (step === "volume") {
    blocks = bumpReps(blocks, 1);
    reasons.push(`${input.phase}期の2週目。まず量を増やします（本数 +1）`);
  } else if (step === "density") {
    blocks = bumpReps(blocks, 1);
    restSec = Math.max(MIN_REST_SEC, Math.round(restSec * (1 - DENSITY_STEP)));
    reasons.push(
      `${input.phase}期の3週目。量は保ったままレストを${Math.round(DENSITY_STEP * 100)}%詰めます`
    );
  } else if (step === "recovery") {
    blocks = bumpReps(blocks, -1);
    reasons.push("4週目は回復週。3週上げたぶんを落として、次の入り口に備えます");
  } else {
    reasons.push(`${input.phase}期の入り口の内容です`);
  }

  // --- 直近の出来を反映（S-7）---
  if (input.trend === "ease") {
    // 設定を守れていない。量を増やす前に、守れる形へ戻す
    blocks = bumpReps(blocks, -1);
    restSec = Math.round(restSec * 1.15);
    reasons.push(
      "直近3回が設定より遅いので、量を増やさず実行できる形に戻します（本数 −1・レストを15%長く）"
    );
  } else if (input.trend === "tighten") {
    blocks = bumpReps(blocks, 1);
    reasons.push("直近3回とも設定より速いので、1本増やします");
  }

  if (input.loadHigh) {
    blocks = bumpReps(blocks, -1);
    reasons.push("直近の負荷（ACWR）が高いので、本数を戻します");
  }

  // 本数は最低1本。0本にすると練習が消える
  blocks = blocks.map((b) => ({ ...b, reps: Math.max(1, b.reps) }));

  const targetPaces = recipe.paceDistanceM.map((d) =>
    specificPace(
      input.cfeSec,
      input.category,
      d,
      input.category === "race_economy" ? input.economyWeek : undefined
    )
  );

  return {
    category: input.category,
    blocks,
    restSec,
    restType: recipe.restType,
    targetPaces,
    prescription: describeSpec(blocks, restSec, recipe.restType, targetPaces),
    durationMin: recipe.durationMin,
    distanceKm: recipe.distanceKm,
    reasons,
  };
}

function bumpReps(blocks: RepBlock[], delta: number): RepBlock[] {
  // 複合（500+300）は本数を増やさない。形が壊れる
  if (blocks.length > 1) return blocks;
  return blocks.map((b) => ({ ...b, reps: b.reps + delta }));
}

const REST_JP: Record<RestType, string> = { jog: "jog", walk: "walk", full: "完全休息" };

/** 処方の文面。一括入力が読み取れる書き方に揃える（同じ解釈を通すため） */
export function describeSpec(
  blocks: RepBlock[],
  restSec: number,
  restType: RestType,
  paces: TargetPace[]
): string {
  const body =
    blocks.length === 1
      ? `${blocks[0].distanceM}m × ${blocks[0].reps}`
      : blocks.map((b) => `${b.distanceM}m`).join(" + ");
  const pace = paces
    .map((p) => `${p.distanceM}m ${p.targetSecFast.toFixed(1)}〜${p.targetSecSlow.toFixed(1)}秒`)
    .join(" / ");
  const rest = restSec % 60 === 0 ? `${restSec / 60}分` : `${restSec}秒`;
  return `${body} @${pace} r${rest}（${REST_JP[restType]}）`;
}

// ---------------------------------------------------------------------------
// S-9 2案
// ---------------------------------------------------------------------------

export interface SessionVariant {
  key: "volume" | "density" | "hold" | "quality";
  label: string;
  spec: SessionSpec;
  /** なぜこの案が成り立つのか */
  why: string;
  /** どちらを勧めるか。両方とも良い案なので、勧めない側も出す */
  recommended: boolean;
  /** false の場合、選択日の高負荷量は変えず将来の安全なメニューへ反映する */
  appliesToCurrent?: boolean;
}

/**
 * 進め方を2案作る。
 *
 * **どちらも成立する案にする。** 片方が明らかに劣る案だと、選ぶ意味が無く
 * 「推奨」を押すだけの操作になる。
 * 状態によって2案の中身そのものを変える:
 *   守れていない → 「本数を減らす」か「レストを伸ばす」（どちらも引く方向）
 *   ちょうど良い → 「量を増やす」か「レストを詰める」（伸ばす方向の2択）
 *   余裕がある   → 「本数を増やす」か「設定を上げる」
 *
 * 推奨は制限因子（M-7）で決める。後半の維持が課題なら密度、
 * 絶対スピードが課題なら量より質を選ぶ。
 */
export function sessionVariants(
  base: SessionSpec,
  opts: { trend?: TrendVerdict; limiter?: Limiter }
): SessionVariant[] {
  const { trend, limiter } = opts;
  const protectSpecificVolume = ["high_lactate", "modeling", "race_economy"].includes(
    base.category
  );
  const clone = (s: SessionSpec, blocks: RepBlock[], restSec: number, reasons: string[]): SessionSpec => ({
    ...s,
    blocks,
    restSec,
    prescription: describeSpec(blocks, restSec, s.restType, s.targetPaces),
    reasons,
  });

  if (trend === "ease") {
    // どちらも引く方向。設定を守れる形にするのが目的
    const a = clone(
      base,
      bumpReps(base.blocks, -1),
      base.restSec,
      [...base.reasons, "本数を1本減らして、設定どおりの質で終える"]
    );
    const b = clone(
      base,
      base.blocks,
      Math.round(base.restSec * 1.25),
      [...base.reasons, "本数は保ち、レストを25%伸ばして設定を守る"]
    );
    return [
      {
        key: "hold",
        label: "本数を減らす",
        spec: a,
        why: "1本あたりの質を落とさずに終えられます。設定タイムの意味を保てるのはこちらです。",
        recommended: limiter !== "endurance",
      },
      {
        key: "density",
        label: "レストを伸ばす",
        spec: b,
        why: "本数を保つので、こなす総量は落ちません。回復を長く取るぶん、後半の維持を鍛える効果は薄れます。",
        recommended: limiter === "endurance",
      },
    ];
  }

  if (trend === "tighten") {
    const a = clone(base, protectSpecificVolume ? base.blocks : bumpReps(base.blocks, 1), base.restSec, [
      ...base.reasons,
      protectSpecificVolume
        ? "高乳酸・中距離特異的の本数は増やさず、次の2週の有酸素量で積み上げる"
        : "余裕があるので1本増やす",
    ]);
    const b = clone(base, base.blocks, Math.max(MIN_REST_SEC, Math.round(base.restSec * 0.85)), [
      ...base.reasons,
      "本数は保ち、レストを15%詰めて密度を上げる",
    ]);
    return [
      {
        key: "volume",
        label: protectSpecificVolume ? "次の2週で量を増やす" : "1本増やす",
        spec: a,
        why: protectSpecificVolume
          ? "この高負荷メニューの本数は増やしません。今後14日のジョグ時間など、安全な量だけを増やします。"
          : "同じ設定のまま総量を増やします。積み上げとしては安全側で、失敗しにくい進め方です。",
        recommended: limiter !== "endurance",
        appliesToCurrent: !protectSpecificVolume,
      },
      {
        key: "density",
        label: "レストを詰める",
        spec: b,
        why: "回復を減らすので、後半の維持に直接効きます。総量は変わらないぶん、失敗したときの傷は浅く済みます。",
        recommended: limiter === "endurance",
      },
    ];
  }

  // 据え置き（hold）
  const a = clone(base, protectSpecificVolume ? base.blocks : bumpReps(base.blocks, 1), base.restSec, [
    ...base.reasons,
    protectSpecificVolume
      ? "高乳酸・中距離特異的の本数は据え置き、次の2週の有酸素量で積み上げる"
      : "量を1本ぶん増やす",
  ]);
  const b = clone(base, base.blocks, Math.max(MIN_REST_SEC, Math.round(base.restSec * (1 - DENSITY_STEP))), [
    ...base.reasons,
    `レストを${Math.round(DENSITY_STEP * 100)}%詰める`,
  ]);
  return [
    {
      key: "volume",
      label: protectSpecificVolume ? "次の2週で量を増やす" : "量を増やす",
      spec: a,
      why: protectSpecificVolume
        ? "高乳酸・中距離特異的の本数は機械的に増やさず、今後14日のジョグ・ロング走などから安全な対象だけを増やします。"
        : "本数を増やして総量を積みます。設定タイムは変わらないので、達成できるかどうかの見通しが立てやすい進め方です。",
      recommended: limiter !== "endurance",
      appliesToCurrent: !protectSpecificVolume,
    },
    {
      key: "density",
      label: "密度を上げる",
      spec: b,
      why: "レストを詰めて、回復しきらないまま次に入ります。800mの終盤に近い状況を作れます。",
      recommended: limiter === "endurance",
    },
  ];
}
