/**
 * 4-5-3. セッション間の波及ルール（非対称: 悪い結果は強く波及、良い結果は慎重に）
 * 4-5-4. 未実施・スキップ・中断の扱い
 * 4-5-5. 優先順位（衝突の解決）
 * 4-5-6. 経済走の特別ルール
 */
import type {
  Athlete,
  Session,
  SessionChange,
  SessionResult,
  SkipReason,
} from "./types";
import { addDays, diffDays, weekStart } from "./dates";
import { isHighLoadSession } from "./trainingClassification";

// ---------------------------------------------------------------------------
// 4-5-3. 波及ルール
// ---------------------------------------------------------------------------

export interface PropagationInput {
  session: Session;
  result: SessionResult;
  /** 未実施の全セッション（date昇順でなくてよい） */
  upcomingSessions: Session[];
  athlete: Athlete;
  /** 直近2結果の next_day_legs（PROP-04用） */
  recentNextDayLegs?: ("fresh" | "normal" | "heavy")[];
  redSignalDate?: string; // PROP-06用
}

const isHard = (r: SessionResult) =>
  r.subjective === "hard" || r.subjective === "very_hard" || r.rpe >= 8;
const isUnderachieved = (r: SessionResult) =>
  r.achievement === "partial" || r.achievement === "failed";

/** recovery_profile="slow" の選手は下げ幅を1.5倍にする */
function downScale(athlete: Athlete): number {
  return athlete.recoveryProfile === "slow" ? 1.5 : 1.0;
}

export function propagate(input: PropagationInput): SessionChange[] {
  const { session, result, upcomingSessions, athlete } = input;
  const changes: SessionChange[] = [];
  const scale = downScale(athlete);
  const upcoming = [...upcomingSessions]
    .filter((s) => s.status === "planned" && s.date > session.date)
    .sort((a, b) => a.date.localeCompare(b.date));

  // PROP-01: race_economy が [未達×きつい] → 同週or翌週の high_lactate を強度-2%かつ本数-1
  if (
    session.category === "race_economy" &&
    isUnderachieved(result) &&
    isHard(result)
  ) {
    const limit = addDays(weekStart(session.date), 13); // 同週+翌週
    const hl = upcoming.find(
      (s) => s.category === "high_lactate" && s.date <= limit && !s.isFixed
    );
    if (hl) {
      const pct = 2 * scale;
      changes.push({
        sessionId: hl.id,
        field: "prescription",
        before: hl.prescription,
        after: `${hl.prescription} → 強度-${pct}% かつ 本数-1`,
        reason: `経済走(${session.date})が未達かつ主観的にきつかったため`,
        triggeredBy: "PROP-01",
        direction: "down",
        action: "modify",
      });
    }
  }

  // PROP-02: high_lactate が [未達] → 次の modeling を1段階軽く or 3日後ろ倒し
  if (session.category === "high_lactate" && isUnderachieved(result)) {
    const mod = upcoming.find((s) => s.category === "modeling" && !s.isFixed);
    if (mod) {
      changes.push({
        sessionId: mod.id,
        field: "prescription",
        before: mod.prescription,
        after: `${mod.prescription} → 1段階軽くする（本数-1または区間短縮）、または3日後ろ倒し(${addDays(mod.date, 3)})`,
        reason: `高乳酸(${session.date})が未達のため`,
        triggeredBy: "PROP-02",
        direction: "down",
        action: "modify",
      });
    }
  }

  // PROP-03: cv / threshold が [未達×きつい] → 有酸素の実測再取得を提案。
  //          特異的セッションは変更しない（有酸素の不調を特異的側に波及させない）
  if (
    (session.category === "cv" || session.category === "threshold") &&
    isUnderachieved(result) &&
    isHard(result)
  ) {
    changes.push({
      sessionId: session.id,
      field: "note",
      before: "",
      after:
        "有酸素系の実測(閾値走+HR)を再取得してください。LT設定が現状と乖離している可能性があります。特異的セッション(high_lactate / race_economy)は変更しません。",
      reason: `${session.category}(${session.date})が未達かつきつかったため`,
      triggeredBy: "PROP-03",
      direction: "neutral",
      action: "modify",
    });
  }

  // PROP-04: next_day_legs="heavy" が2セッション連続 → 翌週の高負荷練習を1本削除しoffに
  const legs = [...(input.recentNextDayLegs ?? []), result.nextDayLegs].filter(Boolean);
  const lastTwo = legs.slice(-2);
  if (lastTwo.length === 2 && lastTwo.every((l) => l === "heavy")) {
    const nextWeekStart = addDays(weekStart(session.date), 7);
    const nextWeekEnd = addDays(nextWeekStart, 6);
    const q = upcoming.find(
      (s) =>
        isHighLoadSession(s) &&
        s.date >= nextWeekStart &&
        s.date <= nextWeekEnd &&
        !s.isFixed
    );
    if (q) {
      changes.push({
        sessionId: q.id,
        field: "category",
        before: q.category,
        after: "off",
        reason: "翌日の脚が重い状態が2セッション連続したため（疲労蓄積の進行）",
        triggeredBy: "PROP-04",
        direction: "down",
        action: "replace_with_off",
      });
    }
  }

  // PROP-05: modeling が [達成×余裕] → テーパーは一切変更しない。CFEのみ更新
  if (
    session.category === "modeling" &&
    result.achievement === "achieved" &&
    (result.subjective === "easy" || result.subjective === "moderate")
  ) {
    changes.push({
      sessionId: session.id,
      field: "note",
      before: "",
      after:
        "仕上がり良好。ただしテーパー内容は一切変更しません（CFEのみ更新）。仕上がりの良さを理由にテーパーを重くすることは禁止されています。",
      reason: "モデリング [達成×余裕]",
      triggeredBy: "PROP-05",
      direction: "neutral",
      action: "modify",
    });
  }

  return changes;
}

/** PROP-06: 赤信号発生 → 直後3日間の高負荷練習を aerobic/off に置換 */
export function propagateRedSignal(
  redDate: string,
  upcomingSessions: Session[]
): SessionChange[] {
  const changes: SessionChange[] = [];
  const window = upcomingSessions.filter(
    (s) =>
      s.status === "planned" &&
      diffDays(redDate, s.date) >= 0 &&
      diffDays(redDate, s.date) <= 3 &&
      isHighLoadSession(s)
  );
  for (const s of window) {
    changes.push({
      sessionId: s.id,
      field: "category",
      before: s.category,
      after: "aerobic",
      reason: `赤信号(${redDate})直後3日間のため`,
      triggeredBy: "PROP-06",
      direction: "down",
      action: "replace_with_aerobic",
    });
  }
  return changes;
}

/**
 * 良い結果を反映する場合の制限:
 * [達成×余裕] による強度引き上げはCFE更新経由のみ。
 * 同一フェーズ内で連続3回までは適用しない（2回目までは据え置き）。
 */
export function shouldApplyUpwardRevision(
  consecutiveGoodResultsInPhase: number
): { apply: boolean; reason: string } {
  if (consecutiveGoodResultsInPhase < 3) {
    return {
      apply: false,
      reason: `同一フェーズ内の[達成×余裕]は${consecutiveGoodResultsInPhase}回目。2回目までは据え置き、反復を優先します（強度引き上げはCFE更新経由のみ）。`,
    };
  }
  return {
    apply: true,
    reason: "同一フェーズで3回連続の[達成×余裕]。CFE更新経由での引き上げを許可します。",
  };
}

// ---------------------------------------------------------------------------
// 4-5-4. スキップ処理
// ---------------------------------------------------------------------------

export interface SkipDecision {
  action: "none" | "delete" | "postpone" | "delete_recommended";
  maxPostponeDays?: number;
  message: string;
  phaseRollbackSuggested?: boolean;
  triggeredBy: string;
}

export function handleSkip(
  session: Session,
  reason: SkipReason,
  opts: {
    /** 直前の質練習もスキップだったか（SKIP-04） */
    previousQualitySkipped?: boolean;
    /** 14日以内に迫ったレースがあるか（SKIP-05） */
    daysToNearestRace?: number;
  } = {}
): SkipDecision {
  // SKIP-01: off / aerobic のスキップ → 何もしない。再配置しない
  if (session.category === "off" || session.category === "aerobic") {
    return {
      action: "none",
      message: "off / aerobic のスキップは何もしません。再配置もしません。",
      triggeredBy: "SKIP-01",
    };
  }

  const highLoadSession = isHighLoadSession(session);

  // SKIP-05: レース14日以内のスキップ → 理由を問わず後ろ倒ししない。削除のみ
  if (
    highLoadSession &&
    opts.daysToNearestRace !== undefined &&
    opts.daysToNearestRace <= 14
  ) {
    return {
      action: "delete",
      message:
        "レース14日以内のスキップは理由を問わず後ろ倒ししません。削除のみ行います。",
      triggeredBy: "SKIP-05",
      phaseRollbackSuggested: opts.previousQualitySkipped,
    };
  }

  if (highLoadSession) {
    // SKIP-02: fatigue / red_signal / injury → 後ろ倒ししない。削除する
    if (reason === "fatigue" || reason === "red_signal" || reason === "injury") {
      return {
        action: "delete",
        message:
          "疲労・赤信号・故障によるスキップは後ろ倒しせず削除します。疲労で飛ばした練習を後日埋め合わせると負債が二重になります。",
        triggeredBy: "SKIP-02",
        phaseRollbackSuggested: opts.previousQualitySkipped, // SKIP-04
      };
    }
    // SKIP-03: schedule / weather → 最大2日まで後ろ倒し可。
    //          後ろ倒し後にルールエンジン再実行、違反が出るなら削除推奨
    if (reason === "schedule" || reason === "weather") {
      return {
        action: "postpone",
        maxPostponeDays: 2,
        message:
          "予定・天候によるスキップは最大2日まで後ろ倒し可能です。後ろ倒し後に必ずルールエンジンを再実行し、違反が出る場合は削除を推奨します。",
        triggeredBy: "SKIP-03",
        phaseRollbackSuggested: opts.previousQualitySkipped,
      };
    }
  }

  // neural その他
  return {
    action: highLoadSession ? "delete" : "none",
    message: highLoadSession
      ? "その他理由の質練習スキップは削除します。"
      : "neural のスキップは補填不要です。",
    triggeredBy: highLoadSession ? "SKIP-02" : "SKIP-01",
    phaseRollbackSuggested: highLoadSession && opts.previousQualitySkipped,
  };
}

/** SKIP-04: 質練習を2回連続スキップ → フェーズを1段階戻す提案 */
export function phaseRollback(
  phase: "Base" | "Build" | "Specific" | "Modeling" | "Taper"
): "Base" | "Build" | "Specific" | "Modeling" | "Taper" {
  const order = ["Base", "Build", "Specific", "Modeling", "Taper"] as const;
  const i = order.indexOf(phase);
  return order[Math.max(0, i - 1)];
}

// ---------------------------------------------------------------------------
// 4-5-5. 優先順位（衝突の解決）
// ---------------------------------------------------------------------------

/**
 * 補正・波及・ルールが同時に別の指示を出した場合の解決順:
 * 1. ERROR級ルール ← 絶対
 * 2. スキップ再配置ルール
 * 3. 波及ルール（下げ方向）
 * 4. CFE更新に伴う再計算（下げ方向）
 * 5. CFE更新に伴う再計算（上げ方向）
 * 6. WARN級ルール
 * 原則: 下げる方向は常に上げる方向に優先する。
 */
export function priorityRank(change: SessionChange): number {
  const t = change.triggeredBy;
  if (/^RULE-(01|03|07|08|09|12|15|18|19|20)/.test(t)) return 1; // ERROR級ルール
  if (/^SKIP-/.test(t)) return 2;
  if (/^PROP-/.test(t) && change.direction === "down") return 3;
  if (t === "CFE" && change.direction === "down") return 4;
  if (t === "CFE" && change.direction === "up") return 5;
  if (/^RULE-/.test(t)) return 6; // WARN級ルール
  return 7;
}

/**
 * 同一セッション・同一フィールドに競合する変更がある場合、優先順位で1つに解決する。
 * 同順位なら「下げ方向」が「上げ方向」に勝つ。
 */
export function resolveConflicts(changes: SessionChange[]): SessionChange[] {
  const byKey = new Map<string, SessionChange[]>();
  for (const c of changes) {
    const key = `${c.sessionId}::${c.field}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(c);
  }
  const out: SessionChange[] = [];
  const dirRank = { down: 0, neutral: 1, up: 2 };
  for (const list of byKey.values()) {
    list.sort(
      (a, b) =>
        priorityRank(a) - priorityRank(b) || dirRank[a.direction] - dirRank[b.direction]
    );
    out.push(list[0]);
  }
  return out.sort((a, b) => priorityRank(a) - priorityRank(b));
}

// ---------------------------------------------------------------------------
// 4-5-6. 経済走の特別ルール
// ---------------------------------------------------------------------------

export interface EconomyTrendPoint {
  date: string;
  rpe: number;
  prescription: string;
}

export type EconomyTrendJudgement =
  | "progress" // 同設定でRPE低下 → 適応が進んでいる。次段階へ
  | "repeat" // 同設定でRPE不変 → 据え置いて反復
  | "fatigue" // 同設定でRPE上昇 → 疲労蓄積。回復を優先
  | "insufficient_data";

/**
 * 経済走は「きつさ」で評価しない。「同じ設定でより楽に感じるか」で評価する。
 * このRPE低下はCFE更新において最も重要なシグナル（経済性改善＝前半余裕度改善）。
 */
export function judgeEconomyTrend(points: EconomyTrendPoint[]): {
  judgement: EconomyTrendJudgement;
  message: string;
} {
  // 同一設定のセッションのみ比較する
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length < 2) {
    return {
      judgement: "insufficient_data",
      message: "比較には同一設定の経済走が2回以上必要です。",
    };
  }
  const samePrescription = sorted.filter(
    (p) => p.prescription === sorted[sorted.length - 1].prescription
  );
  if (samePrescription.length < 2) {
    return {
      judgement: "insufficient_data",
      message: "設定が変わっているため比較できません。同一設定で反復してください。",
    };
  }
  const recent = samePrescription.slice(-3);
  const first = recent[0].rpe;
  const last = recent[recent.length - 1].rpe;
  if (last < first) {
    return {
      judgement: "progress",
      message:
        "同設定でRPEが低下しています。経済性の適応が進んでいます（＝800m前半の余裕度改善）。次段階（ペース104%側へ/距離延長）に進めます。CFE改善の最重要シグナルです。",
    };
  }
  if (last > first) {
    return {
      judgement: "fatigue",
      message: "同設定でRPEが上昇しています。疲労蓄積の兆候です。回復を優先してください。",
    };
  }
  return {
    judgement: "repeat",
    message: "同設定でRPEが変わっていません。据え置いて反復してください。",
  };
}
