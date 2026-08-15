/**
 * シューズ。
 *
 * 製品ごとに使用距離を貯める。狙いは2つ。
 *   ・履き替えの判断（何kmでソールが落ちるかは製品と本人で違う）
 *   ・「同じ設定なのにきつかった」の材料（スパイクか厚底かで体感が変わる）
 *
 * **合計距離は持たない。** 結果から毎回足し上げる。
 * カウンタを持つと、記録を消したり直したりしたときにずれて、
 * しかも**ずれたことに気づけない**（記録は正しいのに合計だけが違う）。
 * 計算できるものは持たない。
 */
import type { Session, SessionResult } from "./types";

export type ShoeKind = "spike" | "thick" | "thin" | "trainer" | "trail";

export const SHOE_KIND_LABELS: Record<ShoeKind, string> = {
  spike: "スパイク",
  thick: "厚底",
  thin: "薄底",
  trainer: "トレーニング",
  trail: "トレイル",
};

export interface Shoe {
  id: string;
  /** 製品名。「ヴェイパーフライ3」など、本人が見て分かる名前 */
  name: string;
  kind: ShoeKind;
  note?: string;
  /**
   * 引退。記録は残したまま、選択肢から外す。
   * 消さないのは、過去の記録がこの靴を指しているため
   * （消すと「何を履いていたか」が分からなくなる）。
   */
  retired?: boolean;
}

export interface ShoeUsage {
  shoe: Shoe;
  /** 走った距離の合計（km）。結果から毎回足し上げた値 */
  totalKm: number;
  /** 使った回数 */
  sessions: number;
  /** 最後に使った日。候補の並べ替えに使う */
  lastUsed?: string;
}

/**
 * その結果で走った距離（km）。
 *
 * 記録の形が3つある（持続走・インターバル・ラップだけ）ので、
 * 取れるところから取る。**取れなければ0にする**（推測で埋めない）。
 * インターバルは本数×距離。ジョグぶんは別セッションとして記録されるので
 * ここで足すと二重になる。
 */
export function distanceOfResult(result: SessionResult, session?: Session): number {
  if (result.continuous?.distanceKm !== undefined) return result.continuous.distanceKm;
  if (result.interval) {
    /*
     * 1本ずつの実測があればそれを足す。無ければ本数×距離。
     *
     * `results` が空配列のときに `?.length ?? reps` としないこと——
     * 0 は nullish ではないので本数が0のまま計算され、距離が0になる。
     */
    const recorded = result.interval.results ?? [];
    const meters = recorded.length
      ? recorded.reduce((sum, rep) => sum + (rep.distanceM ?? 0), 0)
      : (result.interval.reps ?? 0) * (result.interval.distanceM ?? 0);
    if (meters > 0) return meters / 1000;
  }
  // 予定の距離しか無い場合はそれを使う（走った本数が分からないときの近似）
  return session?.distanceKm ?? 0;
}

/**
 * 靴ごとの使用距離。
 *
 * 引退した靴も返す（履歴として見たいため）。選択肢から外すのは画面側の仕事。
 */
export function shoeUsage(
  shoes: Shoe[],
  results: SessionResult[],
  sessions: Session[] = []
): ShoeUsage[] {
  const sessionById = new Map(sessions.map((s) => [s.id, s]));
  const totals = new Map<string, { km: number; count: number; last?: string }>();

  for (const result of results) {
    const id = result.shoeId;
    if (!id) continue;
    const current = totals.get(id) ?? { km: 0, count: 0, last: undefined };
    current.km += distanceOfResult(result, sessionById.get(result.sessionId));
    current.count += 1;
    if (!current.last || result.date > current.last) current.last = result.date;
    totals.set(id, current);
  }

  return shoes.map((shoe) => {
    const t = totals.get(shoe.id);
    return {
      shoe,
      totalKm: Math.round((t?.km ?? 0) * 10) / 10,
      sessions: t?.count ?? 0,
      lastUsed: t?.last,
    };
  });
}

/**
 * 選択肢の並び。**最後に使ったものが先頭**。
 *
 * 毎回同じ靴を履くことが多いので、直前に使ったものが先にあると1タップで済む。
 * 一度も使っていない靴は、新しく登録したものが上に来るよう最後に並べる（登録順のまま）。
 * 引退した靴は出さない。
 */
export function shoeChoices(usage: ShoeUsage[]): ShoeUsage[] {
  const active = usage.filter((u) => !u.shoe.retired);
  const used = active.filter((u) => u.lastUsed).sort((a, b) => b.lastUsed!.localeCompare(a.lastUsed!));
  const unused = active.filter((u) => !u.lastUsed);
  return [...used, ...unused];
}
