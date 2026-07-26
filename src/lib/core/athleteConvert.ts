/**
 * S-6 他の選手のメニューを、自分の設定タイムに換算する
 *
 * トップ選手のメニューをそのまま真似ると、**構造は正しいのに設定だけ速すぎる**という
 * 一番まずい形になる。設定が守れない練習を繰り返しても、狙った刺激は入らない。
 *
 * 換算の考え方:
 *   その選手がその練習を「自分の800mに対して何%の強度でやっていたか」を出し、
 *   同じ相対強度を自分のCFEに当てる。
 *
 *     自分の設定 = 相手の設定 × (自分のCFE ÷ 相手の800mPB)
 *
 * カテゴリの標準比（GRP_RATIOS）を使わないのはなぜか:
 *   標準比は「そのカテゴリなら普通このくらい」という一般値で、
 *   その選手が実際にどの強度でやっていたかは分からない。
 *   トップ選手のメニューを取り込む目的は**その人の組み立てを借りること**なので、
 *   実際にやっていた相対強度を保つほうが目的に合う。
 *
 * 限界（画面に出すこと）:
 *   ・800mから離れた距離ほど誤差が大きい。持久型と瞬発型で比が変わるため
 *   ・換算値は実測ではない。実際にやってみて合わなければ動かす前提の値
 */
import { parsePrescription, type PrescriptionStructure } from "./prescription";
import type { BulkParseOptions } from "./bulkImport";

/** 換算の信頼が落ちる距離。これを外れたら画面に注意を出す */
export const CONVERT_TRUSTED_MIN_M = 100;
export const CONVERT_TRUSTED_MAX_M = 1200;

/**
 * 800mPBの差がこれを超えると、そのまま比で伸ばすのは無理がある。
 * 10秒差（1:46 と 1:56）はタイプも練習の意味も変わってくる。
 */
export const CONVERT_WARN_GAP_SEC = 10;

export interface ConvertedRep {
  index: number;
  distanceM: number;
  /** 相手の設定（本文から読めたもの） */
  theirSec?: number;
  /** 自分に換算した設定 */
  mySec?: number;
}

export interface ConvertedMenu {
  /** 解釈できた構造。読めなければ recognized=false */
  structure: PrescriptionStructure;
  ratio: number;
  reps: ConvertedRep[];
  /** 代表の換算後設定（1本の距離が1種類のとき） */
  targetSec?: number;
  /** 換算にあたっての注意。空でないなら必ず画面に出す */
  notes: string[];
}

export interface ConvertInput {
  /** 相手のメニュー本文（そのまま貼る） */
  prescription: string;
  /** 相手の800mPB（秒） */
  theirPb800Sec: number;
  /** 自分のCFE（推定800mタイム・秒） */
  myCfeSec: number;
  /** 解釈のオプション。表記辞書などをそのまま渡す */
  parseOptions?: BulkParseOptions;
}

/**
 * 他選手のメニューを自分向けに換算する。
 *
 * 解釈は `parsePrescription`（＝一括入力と同じ `parseRow`）に任せる。
 * ここで独自に読み直さない。同じ本文が画面によって違う意味になってはいけない。
 */
export function convertMenu(input: ConvertInput): ConvertedMenu {
  const structure = parsePrescription(input.prescription, input.parseOptions ?? {});
  const notes: string[] = [];

  const ratio =
    input.theirPb800Sec > 0 ? input.myCfeSec / input.theirPb800Sec : 1;

  if (!(input.theirPb800Sec > 0)) {
    notes.push("相手の800mPBが無いので換算できません。設定は自分で入れてください");
  }

  const gap = input.myCfeSec - input.theirPb800Sec;
  if (input.theirPb800Sec > 0 && Math.abs(gap) > CONVERT_WARN_GAP_SEC) {
    notes.push(
      `800mPBの差が${Math.abs(gap).toFixed(1)}秒あります。` +
        `比でそのまま伸ばすと実態から離れることがあるので、1回やってみて合わなければ動かしてください`
    );
  }

  const reps: ConvertedRep[] = (structure.slots ?? []).map((s) => ({
    index: s.index,
    distanceM: s.distanceM,
    theirSec: s.targetSec,
    mySec:
      s.targetSec !== undefined && input.theirPb800Sec > 0
        ? Math.round(s.targetSec * ratio * 10) / 10
        : undefined,
  }));

  const outOfRange = reps.filter(
    (r) => r.distanceM < CONVERT_TRUSTED_MIN_M || r.distanceM > CONVERT_TRUSTED_MAX_M
  );
  if (outOfRange.length > 0) {
    notes.push(
      `${outOfRange.map((r) => `${r.distanceM}m`).join("・")}は800mから離れているため、換算の誤差が大きくなります`
    );
  }

  if (structure.recognized && reps.every((r) => r.theirSec === undefined)) {
    notes.push(
      "本文に設定タイムが書かれていないので、換算するものがありません。構造（距離・本数・レスト）だけを取り込みます"
    );
  }

  // 距離が1種類なら代表値を出す（生成側が使う）
  const distances = new Set(reps.map((r) => r.distanceM));
  const targetSec =
    distances.size === 1 ? reps.find((r) => r.mySec !== undefined)?.mySec : undefined;

  return { structure, ratio: Math.round(ratio * 1000) / 1000, reps, targetSec, notes };
}

/** 換算後の内容を、そのまま読める1行にする */
export function describeConverted(c: ConvertedMenu): string {
  if (!c.structure.recognized) return "本文を読み取れませんでした";
  const first = c.reps[0];
  if (!first) return c.structure.kind;
  const body =
    new Set(c.reps.map((r) => r.distanceM)).size === 1
      ? `${first.distanceM}m × ${c.reps.length}`
      : c.reps.map((r) => `${r.distanceM}m`).join(" + ");
  const target =
    c.targetSec !== undefined
      ? ` @${c.targetSec.toFixed(1)}秒（相手 ${first.theirSec?.toFixed(1)}秒）`
      : "";
  const rest = c.structure.restNote ? ` ${c.structure.restNote}` : "";
  return `${body}${target}${rest}`;
}
