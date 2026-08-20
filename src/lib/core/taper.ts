/**
 * M-6 レース前の変則調整（テーパー）
 *
 * 原則は「量を落として強度は維持」。
 * 強度まで落とすとレースペース感覚と神経系の出力が落ちる。
 * 落とすのは量と本数であって、速さではない。
 *
 * 段階:
 *   14日前〜  総量は維持したまま、高乳酸の本数を減らしてレースペースの質を上げる
 *   10日前〜  週の総走行距離を約20%落とす。ポイントは週2回まで
 *    7日前〜  総量を通常の60〜70%まで落とす。高乳酸は入れない
 *              （回復が7日で間に合わない。RULE-07 が最終高乳酸を7〜9日前に置く）
 *    3日前〜  刺激だけ。前日は流しと動き作りのみ
 *
 * 固定セッション（チーム練習）は動かさない。
 * 動かせないものがある前提で、動かせる枠だけを削る。
 *
 * M-2（直近の状態による調整）との関係:
 * テーパー期は「直近の出来が悪いから量を落とす」のではなく「意図的に落とす」期間。
 * 両方を掛けると二重に落ちるので、テーパー期は M-2 の量の調整を止め、
 * 設定ペースの調整だけを残す（shouldSuppressVolumeAdjustment）。
 */
import type { Session, SessionCategory } from "./types";
import { diffDays } from "./dates";

export type TaperStage = "none" | "t14" | "t10" | "t7" | "t3" | "eve";

export const TAPER_STAGE_LABELS: Record<TaperStage, string> = {
  none: "通常期",
  t14: "レース14日前〜（量は維持・質を上げる）",
  t10: "レース10日前〜（量を20%減）",
  t7: "レース7日前〜（量を通常の60〜70%・高乳酸なし）",
  t3: "レース3日前〜（刺激のみ）",
  eve: "レース前日",
};

export function taperStage(date: string, raceDate: string): TaperStage {
  const d = diffDays(date, raceDate);
  if (d < 0) return "none";
  /*
   * レース当日は「テーパーの段階」ではない。
   * 以前は当日も `eve`（レース前日）を返していたので、
   * 当日に何か足すと「レース前日」と表示された。
   * 生成器は当日にセッションを置かないので普段は出ないが、
   * 表示に出る値が事実と違うのは直す。
   */
  if (d === 0) return "none";
  if (d === 1) return "eve";
  if (d <= 3) return "t3";
  if (d <= 7) return "t7";
  if (d <= 10) return "t10";
  if (d <= 14) return "t14";
  return "none";
}

/** その段階での週の総量の目安（通常週に対する割合） */
export const VOLUME_RATIO: Record<TaperStage, number> = {
  none: 1,
  t14: 1,
  t10: 0.8,
  t7: 0.65,
  t3: 0.4,
  eve: 0.2,
};

/** テーパー期は M-2 の量の調整を止める（二重に落とさない） */
export function shouldSuppressVolumeAdjustment(stage: TaperStage): boolean {
  return stage !== "none";
}

export interface TaperAdjustment {
  sessionId: string;
  date: string;
  stage: TaperStage;
  kind: "reduce_reps" | "reduce_volume" | "replace" | "keep";
  before: string;
  after: string;
  reason: string;
  /** 適用後のセッション。keep のときは undefined */
  next?: Session;
}

const HIGH_LACTATE: SessionCategory[] = ["high_lactate", "modeling"];

function reduceRepsInPrescription(prescription: string, ratio: number): { text: string; before?: number; after?: number } {
  const m = /×\s*(\d+)|x\s*(\d+)/.exec(prescription);
  if (!m) return { text: prescription };
  const before = Number(m[1] ?? m[2]);
  const after = Math.max(2, Math.round(before * ratio));
  if (after === before) return { text: prescription, before, after };
  return {
    text: prescription.replace(/(×\s*)\d+|(x\s*)\d+/, (_s, a, b) => `${a ?? b}${after}`),
    before,
    after,
  };
}

/**
 * 予定に対してテーパーの調整を出す。保存はしない。
 * 何をどう変えるかを先に見せて、本人が却下できるようにする。
 */
export function planTaper(
  sessions: Session[],
  raceDate: string,
  today: string
): TaperAdjustment[] {
  const out: TaperAdjustment[] = [];
  for (const s of sessions) {
    if (s.date < today || s.date > raceDate) continue;
    if (s.status === "completed" || s.status === "skipped") continue;
    const stage = taperStage(s.date, raceDate);
    if (stage === "none") continue;

    // 固定セッションは動かさない。動かせない前提で他を削る
    if (s.isFixed) {
      out.push({
        sessionId: s.id,
        date: s.date,
        stage,
        kind: "keep",
        before: s.name,
        after: s.name,
        reason: "固定セッション（チーム練習等）のため変更しません。前後の自由枠で調整します",
      });
      continue;
    }

    // 7日前以降の高乳酸は外す。回復が間に合わない
    if (stage === "t7" && HIGH_LACTATE.includes(s.category)) {
      out.push({
        sessionId: s.id,
        date: s.date,
        stage,
        kind: "replace",
        before: `${s.name}（${s.category}）`,
        after: "流し 100m×4（完全休息）",
        reason:
          "レース7日前以降の高乳酸は回復が間に合いません。最終高乳酸は7〜9日前に1回だけ置きます",
        next: {
          ...s,
          category: "neural",
          name: "刺激入れ（流し）",
          prescription: "ジョグ20分 + 100m流し × 4本（完全休息）",
          durationMin: 30,
          distanceKm: 4,
          status: "modified",
        },
      });
      continue;
    }

    // 14日前: 高乳酸の本数を減らす。設定は変えない（強度は維持）
    if (stage === "t14" && HIGH_LACTATE.includes(s.category)) {
      const r = reduceRepsInPrescription(s.prescription, 0.75);
      if (r.before !== undefined && r.after !== undefined && r.after !== r.before) {
        out.push({
          sessionId: s.id,
          date: s.date,
          stage,
          kind: "reduce_reps",
          before: `${r.before}本`,
          after: `${r.after}本`,
          reason: "設定はそのままで本数だけ減らします。落とすのは量であって速さではありません",
          next: { ...s, prescription: r.text, status: "modified" },
        });
      }
      continue;
    }

    /*
     * **生成器が既にテーパーの形で置いた枠は、もう一度削らない。**
     *
     * 生成器はテーパー期の週の形（jog30/jog20/流し/休養）を置くだけでなく、
     * **3日前以降は日ごとに中身を決めている**（3日前=調整ジョグ20分・
     * 2日前=完全休養・前日=刺激入れ）。そこへ段階の比率を重ねると
     * 同じ意図の削減が2回かかる。実際、3日前は生成器が20分に削った上へ
     * さらに15分の案が出ていた（同じ日に2つの答えがある状態）。
     *
     * 14〜7日前は生成器が比率を持っていないので、ここで段階の比率を当てる。
     * 重なるのは3日前以降だけなので、止めるのもそこだけにする。
     *
     * M-2 の量調整を `shouldSuppressVolumeAdjustment` で止めているのと同じ理由。
     */
    if (s.origin === "generated" && (stage === "t3" || stage === "eve")) continue;

    // 10日前以降: 有酸素の量を段階的に落とす
    if (s.category === "aerobic" && s.durationMin) {
      const ratio = VOLUME_RATIO[stage];
      const after = Math.max(15, Math.round(s.durationMin * ratio));
      if (after < s.durationMin) {
        out.push({
          sessionId: s.id,
          date: s.date,
          stage,
          kind: "reduce_volume",
          before: `${s.durationMin}分`,
          after: `${after}分`,
          reason: `${TAPER_STAGE_LABELS[stage]}。ジョグの時間を落とします`,
          next: {
            ...s,
            durationMin: after,
            distanceKm: s.paceSecPerKm
              ? Math.round(((after * 60) / s.paceSecPerKm) * 10) / 10
              : s.distanceKm,
            prescription: s.prescription.replace(/\d+\s*分/, `${after}分`),
            status: "modified",
          },
        });
      }
      continue;
    }
  }
  return out;
}

/** 予告に出す一文 */
export function taperNotice(stage: TaperStage, daysToRace: number): string {
  if (stage === "none") return "";
  return `レースまで${daysToRace}日。${TAPER_STAGE_LABELS[stage]}に入ります。変更内容を確認してください`;
}
