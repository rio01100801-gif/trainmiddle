/**
 * 靴の性格。
 *
 * 推薦の材料になる項目をここに集める。
 *
 * ---
 *
 * **製品ごとのマスターデータは持たない。**
 *
 * 「ヴェイパーフライ4のクッション性は8」のような数値を、こちらで確かめずに
 * 書くことになるため。推測で埋めた値がそのまま推薦理由になると、
 * **なぜその靴を薦められたのかを本人が検証できない**
 * （読めなかったものを推測で埋めない・CLAUDE.md）。
 *
 * 代わりに出発点にするのは、本人が登録時に選んだ **種類**（スパイク／厚底／
 * 薄底／トレーニング／トレイル）。これは本人が入力した事実であって推測ではない。
 * そこから作った既定値を、**本人がいつでも上書きできる**ようにする。
 * 上書きがあれば必ずそちらを使う。
 */
import type { Shoe, ShoeKind } from "./shoes";

/** 5段階。1が低い、5が高い */
export type ShoeRating = 1 | 2 | 3 | 4 | 5;

export type ShoeSurface = "track" | "road" | "trail" | "treadmill" | "grass" | "hill";

export const SHOE_SURFACE_LABELS: Record<ShoeSurface, string> = {
  track: "トラック",
  road: "ロード",
  trail: "トレイル",
  treadmill: "トレッドミル",
  grass: "芝生",
  hill: "坂",
};

/** 本人が決める「何に使う靴か」。一般的なモデル情報より優先する */
export type ShoePurpose = "race" | "quality" | "daily" | "recovery" | "long" | "any";

export const SHOE_PURPOSE_LABELS: Record<ShoePurpose, string> = {
  race: "レース用",
  quality: "ポイント練習用",
  daily: "普段のジョグ用",
  recovery: "リカバリー用",
  long: "ロングラン用",
  any: "決めていない",
};

export interface ShoeProfile {
  /** クッション性。高いほど脚へのダメージが小さい */
  cushioning: ShoeRating;
  /** 反発性。高いほど設定ペースを維持しやすい */
  responsiveness: ShoeRating;
  /** 安定性。高いほど接地が安定する */
  stability: ShoeRating;
  /** グリップ。高いほど濡れた路面で滑りにくい */
  grip: ShoeRating;
  /** 軽さ。高いほど軽い（重量そのものではなく体感の段階として持つ） */
  lightness: ShoeRating;
  carbonPlate: boolean;
  isSpike: boolean;
  surfaces: ShoeSurface[];
  /**
   * 何に使う靴か。**複数選べる。**
   *
   * 1つしか選べなかったとき、厚底のように「レースにもポイント練習にも履く」靴を
   * 表せなかった。どちらかを選ぶと、選ばなかったほうの練習で加点されない。
   *
   * "any"（決めていない）は他と併用しない——「決めていない」と
   * 「レース用でもある」が同時に立つ状態に意味が無い。
   */
  purposes: ShoePurpose[];
  /** 何kmで履き替えを考えるか。0なら見ない */
  replaceAtKm: number;
}

/**
 * 種類ごとの既定値。
 *
 * **これは「その製品の性能」ではなく「その種類の一般的な傾向」。**
 * 数値そのものに意味があるのではなく、**種類どうしの相対的な並び**に意味がある
 * （厚底はスパイクよりクッションが高い、など）。
 * 個々の靴が既定とずれるのは当たり前なので、本人が直せるようにしてある。
 */
const KIND_DEFAULTS: Record<ShoeKind, ShoeProfile> = {
  spike: {
    cushioning: 1,
    responsiveness: 5,
    stability: 2,
    grip: 5, // ピンがあるのでトラックでは滑らない
    lightness: 5,
    carbonPlate: false,
    isSpike: true,
    surfaces: ["track"],
    purposes: ["race"],
    replaceAtKm: 0, // 距離では測りにくい（ピンの摩耗が先に来る）
  },
  thick: {
    cushioning: 5,
    responsiveness: 5,
    stability: 2,
    grip: 3,
    lightness: 4,
    carbonPlate: true,
    isSpike: false,
    surfaces: ["road", "track"],
    purposes: ["race"],
    replaceAtKm: 500,
  },
  thin: {
    cushioning: 2,
    responsiveness: 4,
    stability: 4,
    grip: 3,
    lightness: 5,
    carbonPlate: false,
    isSpike: false,
    surfaces: ["track", "road", "hill"],
    purposes: ["quality"],
    replaceAtKm: 600,
  },
  trainer: {
    cushioning: 4,
    responsiveness: 2,
    stability: 4,
    grip: 3,
    lightness: 2,
    carbonPlate: false,
    isSpike: false,
    surfaces: ["road", "treadmill", "track"],
    purposes: ["daily"],
    replaceAtKm: 800,
  },
  trail: {
    cushioning: 4,
    responsiveness: 2,
    stability: 5,
    grip: 5,
    lightness: 2,
    carbonPlate: false,
    isSpike: false,
    surfaces: ["trail", "road", "grass"],
    purposes: ["long"],
    replaceAtKm: 800,
  },
};

/** 種類だけから作った既定の性格。本人が何も設定していないときの出発点 */
export function defaultProfile(kind: ShoeKind): ShoeProfile {
  return {
    ...KIND_DEFAULTS[kind],
    // 配列は複製する。共有すると1足を直したときに他の靴の既定まで変わる
    surfaces: [...KIND_DEFAULTS[kind].surfaces],
    purposes: [...KIND_DEFAULTS[kind].purposes],
  };
}

function clampRating(v: unknown, fallback: ShoeRating): ShoeRating {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < 1 || n > 5) return fallback;
  return n as ShoeRating;
}

/**
 * 用途を整える。
 *
 * **"any"（決めていない）は単独にする。** 他と併用できる状態にすると、
 * 「決めていないが、レース用でもある」という読めない設定が保存できてしまう。
 * 空になったら「決めていない」に寄せる（無指定と区別する意味が無い）。
 */
export function normalizePurposes(list: unknown): ShoePurpose[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<ShoePurpose>();
  for (const x of list) {
    if (typeof x === "string" && x in SHOE_PURPOSE_LABELS) seen.add(x as ShoePurpose);
  }
  if (seen.size === 0) return [];
  if (seen.has("any")) return ["any"];
  return (Object.keys(SHOE_PURPOSE_LABELS) as ShoePurpose[]).filter((k) => seen.has(k));
}

/**
 * 保存された用途を読む。
 *
 * 複数選べるようにする前は単数（`purpose`）で保存していた。
 * **古いデータを読めなくしない。** 1つだけ入っていたものは1件の配列として扱う。
 */
function readPurposes(
  o: Partial<ShoeProfile> & { purpose?: unknown },
  fallback: ShoeProfile["purposes"]
): ShoePurpose[] {
  const many = normalizePurposes(o.purposes);
  if (many.length > 0) return many;
  const single = o.purpose;
  if (typeof single === "string" && single in SHOE_PURPOSE_LABELS) return [single as ShoePurpose];
  return [...fallback];
}

/**
 * その靴の性格を決める。
 *
 * **本人の設定が常に勝つ。** 一般的な傾向は、設定していない項目を埋めるだけ。
 * どこが本人の設定でどこが既定なのかは `profileOverrides` を見れば分かる
 * （画面で「既定」と出し分けるため）。
 */
export function profileOf(shoe: Shoe): ShoeProfile {
  const base = defaultProfile(shoe.kind);
  const o = shoe.profile;
  if (!o) return base;
  return {
    cushioning: clampRating(o.cushioning, base.cushioning),
    responsiveness: clampRating(o.responsiveness, base.responsiveness),
    stability: clampRating(o.stability, base.stability),
    grip: clampRating(o.grip, base.grip),
    lightness: clampRating(o.lightness, base.lightness),
    carbonPlate: typeof o.carbonPlate === "boolean" ? o.carbonPlate : base.carbonPlate,
    isSpike: typeof o.isSpike === "boolean" ? o.isSpike : base.isSpike,
    surfaces: Array.isArray(o.surfaces) && o.surfaces.length > 0
      ? o.surfaces.filter((s): s is ShoeSurface => s in SHOE_SURFACE_LABELS)
      : base.surfaces,
    purposes: readPurposes(o, base.purposes),
    replaceAtKm:
      typeof o.replaceAtKm === "number" && o.replaceAtKm >= 0
        ? o.replaceAtKm
        : base.replaceAtKm,
  };
}

/** 本人が触った項目かどうか。画面で「既定」と出し分けるために使う */
export function isOverridden(shoe: Shoe, key: keyof ShoeProfile): boolean {
  if (key === "purposes") {
    // 単数で保存された古いデータも「本人が決めた」ものとして扱う
    const legacy = (shoe.profile as { purpose?: unknown } | undefined)?.purpose;
    return shoe.profile?.purposes !== undefined || legacy !== undefined;
  }
  return shoe.profile?.[key] !== undefined;
}
