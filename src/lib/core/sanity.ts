/**
 * 入力値の妥当性チェック
 *
 * なぜ必要か:
 * 一括入力は「読めなかったもの」には理由を出すが、
 * **読めてしまった間違い**は素通しする。これが一番危ない。
 *
 * 例: 300mの実施タイム 40.0 を 4.00 と打つ。
 * パーサは素直に4秒として受け取り、800m換算は
 *   4.0 ÷ 300 ÷ 0.96 × 800 ≒ 11秒
 * という値を出す。これが現在地の推定に入り、承認した瞬間にCFEが飛ぶ。
 * そしてCFEは全カテゴリの設定ペースの親なので、練習全体が壊れる。
 *
 * 生理学的にありえない値は、登録前に止める。
 * 「ありえないが本当」ということは中距離のトレーニングデータには無いので、
 * 迷ったら止める側に倒してよい。
 */
import type { Athlete, Session, TargetPace } from "./types";
import type { PastEntry } from "./backfill";
import { fmtPaceSecPerKm } from "./inputFormat";

export type SanitySeverity = "error" | "warn";

export interface SanityIssue {
  severity: SanitySeverity;
  field: string;
  message: string;
}

// ---------------------------------------------------------------------------
// 閾値
// ---------------------------------------------------------------------------

/**
 * インターバル1本のペース（秒/m）。
 * 下限0.095は100mを9.5秒に相当し、人類の記録より速い。
 * 上限0.60は10:00/km相当で、これを「インターバル」と呼ぶことはない。
 */
export const REP_PACE_MIN_S_PER_M = 0.095;
export const REP_PACE_MAX_S_PER_M = 0.6;

/** 持続走のペース（秒/km）。2:30/km〜10:00/km */
export const RUN_PACE_MIN_S_PER_KM = 150;
export const RUN_PACE_MAX_S_PER_KM = 600;

export const HR_AVG_MIN = 80;
export const HR_AVG_MAX = 210;
export const HR_MAX_MIN = 110;
export const HR_MAX_MAX = 230;

export const DISTANCE_KM_MIN = 0.4;
export const DISTANCE_KM_MAX = 60;
export const DURATION_MIN_MIN = 3;
export const DURATION_MIN_MAX = 360;

/**
 * 本人の400mPBを基準にした、1本あたりの限界ペース。
 * 200m以上の区間を、400mレースペースより12%以上速い秒/mで走ることはない。
 * （100m単発なら速く走れるので200m未満には適用しない）
 */
export const REP_VS_PB400_RATIO = 0.88;
/** レースの記録がPBをこの割合以上上回っていたら入力ミスを疑う */
export const RACE_VS_PB_RATIO = 0.97;

// ---------------------------------------------------------------------------

function paceOf(distanceM: number, sec: number): number {
  return sec / distanceM;
}

/**
 * 過去データ1件を検査する。
 * error が1つでもあれば登録させない。warn は登録できるが画面に出す。
 */
export function checkPastEntry(e: PastEntry, athlete?: Athlete): SanityIssue[] {
  const out: SanityIssue[] = [];

  // --- 心拍 ---
  if (e.avgHr !== undefined && (e.avgHr < HR_AVG_MIN || e.avgHr > HR_AVG_MAX)) {
    out.push({
      severity: "error",
      field: "avgHr",
      message: `平均心拍 ${e.avgHr} は範囲外です（${HR_AVG_MIN}〜${HR_AVG_MAX}）。桁の打ち間違いではありませんか`,
    });
  }

  // --- インターバル ---
  if (e.kind === "interval" && e.repDistanceM && e.repTimesSec?.length) {
    for (const t of e.repTimesSec) {
      const p = paceOf(e.repDistanceM, t);
      if (p < REP_PACE_MIN_S_PER_M) {
        out.push({
          severity: "error",
          field: "repTimesSec",
          message: `${e.repDistanceM}m を ${t}秒（${fmtPaceSecPerKm(
            p * 1000
          )}/km）は速すぎます。小数点の位置が違いませんか`,
        });
        break;
      }
      if (p > REP_PACE_MAX_S_PER_M) {
        out.push({
          severity: "error",
          field: "repTimesSec",
          message: `${e.repDistanceM}m を ${t}秒（${fmtPaceSecPerKm(
            p * 1000
          )}/km）は遅すぎます。単位が違いませんか`,
        });
        break;
      }
      if (
        athlete?.pb400mSec &&
        e.repDistanceM >= 200 &&
        p < (athlete.pb400mSec / 400) * REP_VS_PB400_RATIO
      ) {
        out.push({
          severity: "warn",
          field: "repTimesSec",
          message: `${e.repDistanceM}m ${t}秒 は400mPB（${athlete.pb400mSec}秒）から見て速すぎます。本当なら大きな進歩ですが、入力ミスの可能性も確認してください`,
        });
        break;
      }
    }
    /*
     * 本数と実施タイムの数が合わない。
     * パーサは明らかに時間として不自然な数値（300mの4.00秒など）を
     * 落としてから渡してくるので、落ちた事実はここでしか分からない。
     * 黙って本数が減ると、平均も垂れ幅も別のセッションの数字になる。
     */
    if (e.reps && e.reps !== e.repTimesSec.length) {
      out.push({
        severity: "warn",
        field: "repTimesSec",
        message: `${e.reps}本に対して実施タイムが${e.repTimesSec.length}本です。読み取れなかった値があります（本数か実施タイムを直してください）`,
      });
    }
    if (e.repTimesSec.length > 30) {
      out.push({
        severity: "warn",
        field: "repTimesSec",
        message: `実施タイムが${e.repTimesSec.length}本あります。別の数値を拾っている可能性があります`,
      });
    }
  }

  // --- 持続走 ---
  if (e.kind === "continuous") {
    if (e.distanceKm !== undefined && (e.distanceKm < DISTANCE_KM_MIN || e.distanceKm > DISTANCE_KM_MAX)) {
      out.push({
        severity: "error",
        field: "distanceKm",
        message: `距離 ${e.distanceKm}km は範囲外です（${DISTANCE_KM_MIN}〜${DISTANCE_KM_MAX}km）`,
      });
    }
    if (
      e.durationMin !== undefined &&
      (e.durationMin < DURATION_MIN_MIN || e.durationMin > DURATION_MIN_MAX)
    ) {
      out.push({
        severity: "error",
        field: "durationMin",
        message: `時間 ${e.durationMin}分 は範囲外です（${DURATION_MIN_MIN}〜${DURATION_MIN_MAX}分）`,
      });
    }
    if (e.distanceKm && e.durationMin) {
      const pace = (e.durationMin * 60) / e.distanceKm;
      if (pace < RUN_PACE_MIN_S_PER_KM) {
        out.push({
          severity: "error",
          field: "pace",
          message: `${e.distanceKm}km を ${e.durationMin}分（${fmtPaceSecPerKm(
            pace
          )}/km）は速すぎます。距離か時間が違いませんか`,
        });
      } else if (pace > RUN_PACE_MAX_S_PER_KM) {
        out.push({
          severity: "error",
          field: "pace",
          message: `${e.distanceKm}km を ${e.durationMin}分（${fmtPaceSecPerKm(
            pace
          )}/km）は遅すぎます。距離か時間が違いませんか`,
        });
      }
    }
  }

  // --- レース / TT ---
  if ((e.kind === "race" || e.kind === "timetrial") && e.distanceM && e.timeSec) {
    const p = paceOf(e.distanceM, e.timeSec);
    if (p < REP_PACE_MIN_S_PER_M) {
      out.push({
        severity: "error",
        field: "timeSec",
        message: `${e.distanceM}m ${e.timeSec}秒 は速すぎます。単位か小数点を確認してください`,
      });
    } else if (p > REP_PACE_MAX_S_PER_M) {
      out.push({
        severity: "error",
        field: "timeSec",
        message: `${e.distanceM}m ${e.timeSec}秒 は遅すぎます。単位を確認してください`,
      });
    } else if (athlete) {
      const pb =
        e.distanceM === 800
          ? athlete.pb800mSec
          : e.distanceM === 400
          ? athlete.pb400mSec
          : e.distanceM === 1500
          ? athlete.pb1500mSec
          : undefined;
      if (pb && e.timeSec < pb * RACE_VS_PB_RATIO) {
        out.push({
          severity: "warn",
          field: "timeSec",
          message: `${e.distanceM}m ${e.timeSec}秒 はPB（${pb}秒）を大きく上回っています。正しければPBの更新を、違えば入力を直してください`,
        });
      }
    }
    // 区間ラップの合計が記録と大きくずれていないか
    if (e.lapsSec && e.lapsSec.length >= 2) {
      const sum = e.lapsSec.reduce((a, b) => a + b, 0);
      if (Math.abs(sum - e.timeSec) > Math.max(1.5, e.timeSec * 0.02)) {
        out.push({
          severity: "warn",
          field: "lapsSec",
          message: `区間ラップの合計 ${sum.toFixed(2)}秒 が記録 ${e.timeSec}秒 と合いません`,
        });
      }
    }
  }

  return out;
}

export function hasBlockingIssue(issues: SanityIssue[]): boolean {
  return issues.some((i) => i.severity === "error");
}

// ---------------------------------------------------------------------------
// 対象6: 危険なトレーニング提案の防止
//
// checkPastEntry は「実測」（過去にやったこと）を検査するが、
// 「これから提案する設定ペース」（自動生成・手入力どちらの経路も含む）には
// 同種のチェックがどこにも無かった。物理的にありえない値の境界は
// 実測でも設定でも変わらないため、同じ閾値（REP_PACE_MIN/MAX_S_PER_M）を使う。
// ---------------------------------------------------------------------------

/**
 * 設定ペース（`Session.targetPaces`）の妥当性チェック。
 * 自動生成（`periodization.ts`）・手入力（`addSession`/`editSession`）の
 * どちらの経路もここを通す。
 */
export function checkTargetPaces(targetPaces: TargetPace[]): SanityIssue[] {
  const out: SanityIssue[] = [];
  for (const tp of targetPaces) {
    if (!(tp.distanceM > 0)) {
      out.push({
        severity: "error",
        field: "targetPaces",
        message: `設定の距離 ${tp.distanceM}m は不正です`,
      });
      continue;
    }
    for (const [label, sec] of [
      ["速い側", tp.targetSecFast],
      ["遅い側", tp.targetSecSlow],
    ] as const) {
      if (!(sec > 0)) {
        out.push({
          severity: "error",
          field: "targetPaces",
          message: `${tp.distanceM}mの設定タイム（${label}）が不正です: ${sec}秒`,
        });
        continue;
      }
      const p = paceOf(tp.distanceM, sec);
      if (p < REP_PACE_MIN_S_PER_M) {
        out.push({
          severity: "error",
          field: "targetPaces",
          message: `${tp.distanceM}mの設定（${label}）${sec}秒（${fmtPaceSecPerKm(
            p * 1000
          )}/km）は人類の記録を超える速さです。小数点や単位を確認してください`,
        });
      } else if (p > REP_PACE_MAX_S_PER_M) {
        out.push({
          severity: "error",
          field: "targetPaces",
          message: `${tp.distanceM}mの設定（${label}）${sec}秒（${fmtPaceSecPerKm(
            p * 1000
          )}/km）は遅すぎます。単位を確認してください`,
        });
      }
    }
  }
  return out;
}

export function checkSessionPlausibility(session: Session): SanityIssue[] {
  return checkTargetPaces(session.targetPaces);
}
