/**
 * 確定範囲（どこまでの設定ペースに責任を持つか）
 *
 * 解こうとしている問題:
 * 生成はレース日まで全週を一度に作る（`periodization.ts` の `while (w <= raceDate)`）。
 * そのとき設定ペースは**生成した瞬間のCFE**で焼き込まれる。
 * ところが更新は M-2 が14日先までしか届かず、再生成は手動なので、
 * 2か月先のセッションは古いCFEで作った数字を持ったまま残る。
 * それが明日の練習とまったく同じ顔で表示されていた。
 *
 * これは「読めなかったものを推測で埋めない」に反する。
 * 2か月先の設定ペースは推測なのに、決定事項として出ていた。
 *
 * 解き方として「生成そのものを1〜2週ずつにする」も考えたが、採らなかった。
 * 未来の予定が存在することを前提に動いている機能が実際に効いているため。
 *   - ルールエンジンの事前警告（「次の高乳酸は間隔を空け」は未来の予定を見ている）
 *   - Q-2 の入れ替え候補（未来のジョグ枠から選ぶ）
 *   - テーパー計画は21日先、統合タイムラインは28日先を読む
 * 生成を短く切るとこれらが材料切れで黙る。レース直前ほど効く機能なので、
 * **切るのは生成範囲ではなく「確定範囲」**にした。骨組みは長いまま残す。
 *
 * したがってここでやるのは判定だけで、保存はしない。
 * 「今日から何日先までを確定とみなすか」は日付から毎回計算する。
 * 保存フラグにすると、日が進んで確定範囲に入っても古い印が残り、
 * 明日の練習が素案のまま表示される事故が起きる。
 */
import type { Session } from "./types";
import { diffDays } from "./dates";
import { rationaleFor } from "./rationale";

/**
 * ここまでを「確定」とみなす日数。
 *
 * 14日にしたのは M-2（`adaptiveProposals` の既定 days=14）と揃えるため。
 * M-2 は直近の実行状況とその日の状態から設定ペースを調整する仕組みで、
 * つまり**14日先までは設定に手を入れられる**。手を入れられない範囲の数字に
 * 責任を持つと言えないので、責任範囲＝調整できる範囲にする。
 *
 * ここを動かすときは `adaptiveProposals` の既定日数も一緒に見ること。
 * 片方だけ伸ばすと「確定と言っているのに誰も更新しない範囲」が生まれる。
 */
export const CONFIRM_HORIZON_DAYS = 14;

/** 確定範囲に入っているか。過去日は確定（すでに起きたこと） */
export function isConfirmed(sessionDate: string, today: string): boolean {
  return diffDays(today, sessionDate) <= CONFIRM_HORIZON_DAYS;
}

/** 素案であることの説明。いつ決まるのかまで書く（「未定」だけでは行動できない） */
export const PROVISIONAL_NOTE = `設定ペースは${CONFIRM_HORIZON_DAYS}日前に入ってから、そのときのCFEで決まります`;

export interface SessionView {
  /** 確定範囲か。false なら設定ペースを出さない */
  confirmed: boolean;
  /** 画面に出す処方。素案なら狙いと「いつ決まるか」に差し替わる */
  prescription: string;
  /** 素案のときだけ付ける短い印 */
  badge?: string;
}

/**
 * 画面に出す処方を決める唯一の実装。
 *
 * 素案のときに処方本文を出さないのは、本文に設定ペースが埋まっているため
 * （例: `400m × 3 @400m 52.5〜53.6秒 r6分`）。`targetPaces` を隠すだけでは
 * 数字が文章側に残る。
 *
 * 本数やレストも一緒に落としているのは、これらが `buildSessionSpec` で
 * 直近の実行状況・疲労（trend / loadHigh / recentFatigueSignal）から決まるため。
 * つまり2か月先の「400m × 3」も同じく推測であって、確定した構成ではない。
 * 半分だけ本当の文章を出すと、どこまでが決まっているのか分からなくなる。
 *
 * 残すのは種目・狙い・volume（distanceKm / durationMin）。
 * これらは週テンプレートとフェーズから決まるので、CFEが動いても変わらない。
 */
export function sessionView(session: Session, today: string): SessionView {
  /*
   * 本人が書いたもの・手で足したものは、どれだけ先でも素案にしない。
   * 確定範囲が守っているのは「生成が推測で置いた数字を決定事項として見せない」ことで、
   * 本人が決めた内容はそもそも推測ではない。
   * ここを分けないと、2か月先の予定に自分でメニューを書いても
   * 画面では定型文に差し替わって消えたように見える。
   *
   * 判定材料は再生成が「置き換えてよいか」を見るときと同じ（userEdited / origin）。
   * 片方を直したらもう片方も確認すること。
   */
  if (session.userEdited || (session.origin !== undefined && session.origin !== "generated")) {
    return { confirmed: true, prescription: session.prescription };
  }
  if (isConfirmed(session.date, today)) {
    return { confirmed: true, prescription: session.prescription };
  }
  const purpose = rationaleFor(session.category)?.purpose;
  return {
    confirmed: false,
    badge: "素案",
    prescription: purpose ? `${purpose}。${PROVISIONAL_NOTE}` : PROVISIONAL_NOTE,
  };
}
