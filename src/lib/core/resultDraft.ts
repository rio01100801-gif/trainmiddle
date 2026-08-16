/**
 * 記録画面で「保存させるかどうか」を決める。
 *
 * これまで画面の保存処理の中に `alert` と `return` で散らばっていた。
 * 散らばっていると2つ困る。
 *
 *   ・**何を止めているのか一覧できない。** 増やすときに既存の条件と重ならないか
 *     確かめられず、条件を足すたびに読み直すことになる
 *   ・**テストできない。** 画面の中なので単体テストから触れず、
 *     E2Eで1経路ずつ叩くしかなかった
 *
 * ここで止めているのは全部「こちらで埋めてはいけない値が空のまま」。
 * 推測で埋めるとCFEや設定ペースに静かに混ざるので、
 * **埋めずに止めて、なぜ止めたかを本人に見せる**（CLAUDE.md の原則）。
 *
 * 画面の状態そのものは持たない。値を受け取って、止める理由を返すだけ。
 */
import { isValidRpe } from "./rpe";
import type { AbortCause } from "./abortCause";
import type { Subjective } from "./types";

export interface ResultDraftCheck {
  /** 記録の種類。スキップは別経路なのでここに来ない */
  mode: "continuous" | "interval";
  rpe?: number;
  subjective?: Subjective;
  /** 処方より本数が少ない。理由を必須にするかどうかがこれで決まる */
  shortOfPlan: boolean;
  abortCause?: AbortCause;
  /** 持続走のとき: 距離(km)。2つ揃っていないと保存させない */
  distanceKm?: number;
  /** 持続走のとき: 時間(分) */
  durationMin?: number;
}

/**
 * 止める理由を返す。止めないなら undefined。
 *
 * **順番に意味がある。** 上から順に、直すのが簡単なものから出す。
 * 3つ同時に空でも一度に1つしか言わないので、
 * 「直したのにまた止められた」を減らすには、
 * 本人が最後に触る欄（RPE・主観）を先に出すのが効く。
 */
export function checkResultDraft(draft: ResultDraftCheck): string | undefined {
  /*
   * RPEは本人にしか分からない値なので、こちらで埋めない。
   *
   * 以前は新規入力でも 7 が入っていた。数字が入っている欄は「入力済み」に見えるので、
   * そのまま保存されうる。RPEはCFEの補正に効く（RPE_ADJUST_SEC_PER_POINT）ため、
   * こちらが置いた既定値が能力の推定に混ざることになる。
   *
   * スライダーは範囲外を作れないが、旧データの読み込み経路もあるので確かめる。
   */
  if (!isValidRpe(draft.rpe)) {
    return "RPEを選んでください。きつさの感じ方は本人にしか分からないので、こちらでは埋めません。";
  }
  if (draft.subjective === undefined) {
    return "主観を選んでください。";
  }
  /*
   * 途中でやめた理由。空のまま送ると「設定が高すぎた」として数えられ、
   * 実力は落ちていないのに設定だけが下がり続ける（abortCause.ts）。
   */
  if (draft.shortOfPlan && draft.abortCause === undefined) {
    return "途中でやめた理由を選んでください。理由によって設定ペースの扱いが変わります。";
  }
  /*
   * 持続走は S-2 のとおり3つのうち2つ入っていれば足りる。
   * 呼ぶ側が補ったあとの値を渡してくるので、ここでは結果だけを見る。
   */
  if (draft.mode === "continuous" && (!draft.distanceKm || !draft.durationMin)) {
    return "距離・時間・平均ペースのうち2つを入力してください";
  }
  return undefined;
}
