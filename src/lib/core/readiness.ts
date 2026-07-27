/**
 * セッション準備度スコア（0〜100）
 *
 * 仕様書には無い追加指標。UIの「今日のメニュー」に添えるために実装する。
 *
 * 重要な設計上の注意:
 * これは「その練習がどれだけキツいか」でも「どれだけ頑張れるか」でもない。
 * **設定どおりの質を出せる条件が揃っているか** を表す。
 * 仕様書8の「きつい練習＝良い練習という評価軸を一切実装しない」に反しないよう、
 * RPEの高さや達成感は一切加点要素にしていない（減点のみ・上限100の減点方式）。
 *
 * 算出は完全に決定論的で、内訳（breakdown）を必ず返す。
 * ブラックボックスの「82%」を出さないこと自体が要件である。
 */
import type { Athlete, Session, SessionResult, Signal } from "./types";
import { diffDays } from "./dates";
import { isHighLoadSession } from "./trainingClassification";

export interface ReadinessComponent {
  label: string;
  delta: number; // 減点（0 または負）
  detail: string;
}

export interface Readiness {
  score: number; // 0〜100
  level: "high" | "moderate" | "low";
  headline: string;
  breakdown: ReadinessComponent[];
}

export interface ReadinessInput {
  session: Session;
  athlete: Athlete;
  signal: Signal;
  /** 黄信号が3日以上連続して赤扱いになっている場合 true */
  signalEscalated?: boolean;
  acwr?: number;
  /** 直近の高負荷練習からの日数（今回のセッション日基準）。無ければ十分に空いているとみなす */
  daysSinceLastQuality?: number;
  /** 直近の高負荷練習の結果（新しい順で最大3件） */
  recentQualityResults?: SessionResult[];
  /** 当日の予想気温 */
  tempC?: number;
  /** このセッションに紐づく未解決のERROR級ルール違反の件数 */
  errorViolationCount?: number;
}

export function computeReadiness(input: ReadinessInput): Readiness {
  const b: ReadinessComponent[] = [];
  const {
    session,
    athlete,
    signal,
    acwr,
    daysSinceLastQuality,
    recentQualityResults = [],
    tempC,
    errorViolationCount = 0,
  } = input;

  // --- 1. 信号機（最も重い） ---
  if (signal === "red") {
    b.push({
      label: "疲労シグナル",
      delta: -45,
      detail: input.signalEscalated
        ? "赤（黄信号の連続によるエスカレーション）"
        : "赤。完全休養が推奨される状態",
    });
  } else if (signal === "yellow") {
    b.push({ label: "疲労シグナル", delta: -10, detail: "黄。強度は維持し量を30%減" });
  } else {
    b.push({ label: "疲労シグナル", delta: 0, detail: "緑。平常" });
  }

  // --- 2. ACWR（急性:慢性 負荷比） ---
  if (acwr === undefined) {
    b.push({ label: "ACWR", delta: 0, detail: "データ不足のため評価対象外" });
  } else if (acwr > 1.5) {
    b.push({
      label: "ACWR",
      delta: -10,
      detail: `${acwr.toFixed(2)}（直近負荷が大きく増加。単独では可否を決めない）`,
    });
  } else if (acwr > 1.3) {
    b.push({ label: "ACWR", delta: -4, detail: `${acwr.toFixed(2)}（増加側）` });
  } else if (acwr < 0.8) {
    b.push({ label: "ACWR", delta: 0, detail: `${acwr.toFixed(2)}（低め。回復週・欠測も確認）` });
  } else {
    b.push({ label: "ACWR", delta: 0, detail: `${acwr.toFixed(2)}（過去28日平均に近い）` });
  }

  // --- 3. 前回高負荷練習からの回復間隔（高負荷練習のときだけ効く） ---
  if (isHighLoadSession(session)) {
    const d = daysSinceLastQuality;
    if (d === undefined) {
      b.push({ label: "回復間隔", delta: 0, detail: "直近に高負荷練習なし" });
    } else if (d <= 1) {
      b.push({ label: "回復間隔", delta: -15, detail: `前回の高負荷練習から${d}日（中1日未満）` });
    } else if (d === 2) {
      b.push({ label: "回復間隔", delta: -5, detail: "前回の高負荷練習から2日（中1日）" });
    } else {
      b.push({ label: "回復間隔", delta: 0, detail: `前回の高負荷練習から${d}日` });
    }
  }

  // --- 4. 直近の高負荷練習の達成状況（未達が続くと設定が現状と乖離している） ---
  const recent = recentQualityResults.slice(0, 3);
  let achieveDelta = 0;
  for (const r of recent) {
    if (r.achievement === "failed") achieveDelta -= 6;
    else if (r.achievement === "partial") achieveDelta -= 3;
  }
  if (recent.length > 0) {
    b.push({
      label: "直近の達成状況",
      delta: achieveDelta,
      detail:
        achieveDelta === 0
          ? `直近${recent.length}本すべて達成`
          : `直近${recent.length}本に未達あり（設定が現状と乖離している可能性）`,
    });
  }

  // --- 5. 暑熱（heat_tolerance = low のみ） ---
  if (athlete.heatTolerance === "low" && tempC !== undefined && tempC >= 28) {
    b.push({ label: "暑熱", delta: -8, detail: `${tempC}℃。設定を1〜2%緩める前提` });
  }

  // --- 6. 未解決のERROR級ルール違反 ---
  if (errorViolationCount > 0) {
    b.push({
      label: "ルール違反",
      delta: -25,
      detail: `このセッションに関わるERROR級の違反が${errorViolationCount}件`,
    });
  }

  const raw = 100 + b.reduce((a, c) => a + c.delta, 0);
  const score = Math.max(0, Math.min(100, raw));

  let level: Readiness["level"];
  let headline: string;
  // 赤信号はスコアに関わらず「質を入れない」で確定させる。
  // RULE-12 / SKIP-02 と判断が食い違ってはならないため、スコアより優先する。
  if (signal === "red") {
    level = "low";
    headline = "赤信号。この日に質を入れるべきではありません。有酸素か休養に置き換えてください";
  } else if (score >= 75) {
    level = "high";
    headline = "コンディション良好。設定どおり実施できます";
  } else if (score >= 50) {
    level = "moderate";
    headline = "条件が揃っていません。設定は変えず量を減らすか、日をずらす判断を";
  } else {
    level = "low";
    headline = "この日に質を入れるべきではありません。有酸素か休養に置き換えてください";
  }

  return { score, level, headline, breakdown: b };
}
