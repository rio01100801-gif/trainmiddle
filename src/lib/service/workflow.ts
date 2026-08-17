/**
 * サービス層: API/CLI から呼ばれるワークフロー。
 * 4-5 の処理フローを固定順で実行する:
 *   ① CFE更新 → ② 全未実施セッションのペース再計算 → ③ 波及（下げ方向のみ）
 *   → ④ ルールエンジン再検証（常に最後。ルールが最終権限） → ⑤ 変更差分の提示
 */
import type {
  DailyCheck,
  FitnessMarker,
  Goal,
  Phase,
  Race,
  RuleViolation,
  Session,
  SessionCategory,
  SessionChange,
  SessionResult,
  SkipReason,
} from "../core/types";
import type { ChangeLogEntry, Store } from "../db/store";
import { addDays, diffDays, fmtTime, weekStart } from "../core/dates";
import { CONFIRM_HORIZON_DAYS } from "../core/horizon";
import { buildResultAudit, type ResultAudit } from "../core/resultAudit";
import {
  buildAssistantContext,
  UPCOMING_DAYS,
  type AssistantContext,
  type AssistantResultInput,
  type AssistantSessionInput,
} from "../core/assistantContext";
import {
  applyStaleness,
  guardedBaseTime,
  goalFeasibility,
  updateCfeFromResult,
  initCfe,
  revertCfeForSession,
} from "../core/cfe";
import { buildAerobicProfile, GRP_RATIOS, specificPace } from "../core/pace";
import { activeInjuriesAt, runRuleEngine, weeklySummary, RuleContext } from "../core/rules";
import { isHighLoadSession } from "../core/trainingClassification";
import { generatePlan, phaseForDate } from "../core/periodization";
import {
  reviewCoverage,
  weeksUntil,
  type CoverageReview,
} from "../core/coverage";
import {
  heatHrEvidence,
  hrMaxReference,
  relativeIntensity,
  type HrMaxReference,
} from "../core/heartRate";
import {
  buildSessionSpec,
  sessionVariants,
  type SessionVariant,
  type TemplateHistoryEntry,
} from "../core/progression";
import {
  convertMenu,
  describeConverted,
  type ConvertedMenu,
} from "../core/athleteConvert";
import { assignExpectedPaces, diagnoseRounds, generateRecoverySessions, RoundResult } from "../core/rounds";
import {
  handleSkip,
  propagate,
  propagateRedSignal,
  resolveConflicts,
} from "../core/propagation";
import { effectiveSignal, judgeSignal } from "../core/signal";
import { computeReadiness, type Readiness } from "../core/readiness";
import { acwr, dailyLoads } from "../core/load";
import { diagnose } from "../core/diagnosis";
import { evaluateEnvironment } from "../core/environment";
import {
  assessCurrentFitness,
  toSessionAndResult,
  toFitnessMarker as pastToMarker,
  type FitnessAssessment,
  type PastEntry,
} from "../core/backfill";
import {
  computeReady,
  parseBulkText,
  type ParsedRow,
  type PhraseRule,
} from "../core/bulkImport";
import {
  checkPastEntry,
  checkSessionPlausibility,
  hasBlockingIssue,
  type SanityIssue,
} from "../core/sanity";
import { cfeRange, spreadOf } from "../core/backfill";
import { groupBySamePrescription } from "../core/samePrescription";
import { periodSummary, type PeriodKind } from "../core/periodSummary";
import { planRaceSplits, type RaceLapSample } from "../core/racePlan";
import {
  findPreviousEntry,
  inferAchievement,
  REP_DISTANCE_TOLERANCE_M,
  type PreviousEntry,
} from "../core/workoutLog";
import {
  hrvDeviation,
  parseAppleHealthExport,
  toDailyCheck,
  toFitnessMarker,
  type HealthProvider,
  type SyncRecord,
} from "../core/healthImport";
import { analyzeRace, RaceAnalysisOutput } from "../core/raceAnalysis";
import { conditionSplits, type ConditionSplit } from "../core/conditions";
import { shoeUsage, type Shoe, type ShoeUsage } from "../core/shoes";
import { abortSummary, type AbortSummary } from "../core/abortSummary";
import {
  recommendShoes,
  shoeSessionKindOf,
  type ShoeOutcome,
  type ShoeRecommendation,
} from "../core/shoeRecommend";
import {
  checkWarmup,
  normalizeWarmup,
  warmupAddedDistanceKm,
  warmupAddedDurationMin,
  warmupFromFitLaps,
  WARMUP_TEMPLATES,
  type WarmupRecord,
} from "../core/warmup";
import { warmupInsight, type WarmupInsight } from "../core/warmupInsight";
import {
  abortCauseLabel,
  describeAbortCause,
  needsInjuryLog,
  normalizeAbortCause,
  type AbortCause,
} from "../core/abortCause";
import { buildFourWeekBalance, type FourWeekBalance } from "../core/trainingBalance";
import { cycleOf, cyclePositionFor, validateWeekTemplate } from "../core/weekTemplate";
import {
  OFF_SEASON_LABELS,
  OFF_SEASON_REASONS,
  type OffSeasonEmphasis,
} from "../core/offSeason";
import {
  planVolumeProgression,
  VOLUME_HORIZON_DAYS,
  type VolumeProgressionChange,
} from "../core/volumeProgression";
import {
  adjustPrescription,
  dailyAdjustment,
  executionSamples,
  executionTrend,
  jogEfficiency,
  qualityHrTrend,
  type QualityHrTrend,
  type TrendVerdict,
  repsOf,
  type DailyAdjustment,
  type ExecutionTrend,
  type JogEfficiency,
  type PrescriptionProposal,
} from "../core/adaptive";
import { heatPaceAdjustment, type HeatPaceAdjustment } from "../core/heatPace";
import { parsePrescription, type PrescriptionStructure } from "../core/prescription";
import {
  assessLimiter,
  categoryWeights,
  LIMITER_LABELS,
  type CategoryWeight,
  type LimiterAssessment,
} from "../core/limiter";
import {
  splitSamplesFromMarkers,
  splitSamplesFromPast,
  splitTrend,
  type SplitTrend,
} from "../core/split600";
import {
  assessContactTime,
  contactSamplesFromResults,
  type ContactAssessment,
  type ContactSample,
} from "../core/contactTime";
import { buildWeeklyReview, type WeeklyReview } from "../core/weeklyReview";
import {
  BACKUP_CHANGE_LOG_LIMIT,
  BACKUP_FORMAT,
  BACKUP_VERSION,
  mergeByDate,
  mergeById,
  shouldRemindBackup,
  validateBackup,
  type BackupFile,
  type RestoreMode,
  type RestoreReport,
} from "../core/backup";
import {
  buildBackfilledSessionAndResult,
  buildLinkedResult,
  deriveFitActuals,
  fitToSessionAndResult,
  type FitImportRecord,
  type FitResultConfirmation,
  isFitResultConfirmed,
} from "../core/fitToSession";
import type { FitParseResult } from "../core/fitParse";
import type { IntervalClassifyResult, IntervalKind } from "../core/intervalClassify";
import {
  planTaper,
  shouldSuppressVolumeAdjustment,
  taperNotice,
  taperStage,
  TAPER_STAGE_LABELS,
  type TaperAdjustment,
  type TaperStage,
} from "../core/taper";
import {
  abortCriteria,
  evaluateReps,
  prescriptionWithCriteria,
  type AbortCriteria,
  type RepEvaluation,
} from "../core/abort";

// ---------------------------------------------------------------------------

/**
 * 2-1. 暑熱条件フラグが立っている日付の集合。
 * この日の実測は能力推定（LT・CFE）から除外される。
 */
export function heatFlaggedDates(repo: Store): Set<string> {
  const set = new Set<string>();
  for (const r of trustedResults(repo)) {
    if (r.heatFlagged) {
      set.add(r.date);
      continue;
    }
    const env = evaluateEnvironment({
      tempC: r.weatherTempC,
      humidityPct: r.humidityPct,
    });
    if (env?.isHeatFlagged) set.add(r.date);
  }
  return set;
}

/** 日付ごとの気温マップ（RULE-10 の判定に使う） */
function dayTempsFromResults(repo: Store): Record<string, number> {
  const map: Record<string, number> = {};
  for (const r of trustedResults(repo)) {
    if (r.weatherTempC !== undefined) map[r.date] = r.weatherTempC;
  }
  return map;
}

/**
 * ACWRの増加を計画へ反映する前に、本人の回復・実施記録で裏付ける。
 * 比率単独では、回復週明けや記録漏れまで「危険」と誤判定するため。
 */
function hasRecentLoadConcern(repo: Store, onDate: string): boolean {
  const checkStart = addDays(onDate, -6);
  const checkConcern = repo.listDailyChecks().some(
    (check) =>
      check.date >= checkStart &&
      check.date <= onDate &&
      (check.signal === "yellow" ||
        check.signal === "red" ||
        (check.overallFatigue ?? 0) >= 4 ||
        (check.legFatigue ?? 0) >= 4 ||
        (check.sleepQuality ?? 5) <= 2)
  );
  const resultStart = addDays(onDate, -13);
  const resultConcern = trustedResults(repo).some(
    (result) =>
      result.date >= resultStart &&
      result.date <= onDate &&
      (result.aborted === true ||
        result.achievement === "partial" ||
        result.achievement === "failed" ||
        result.nextDayLegs === "heavy")
  );
  return checkConcern || resultConcern;
}

export function buildRuleContext(repo: Store, evaluationDate: string): RuleContext {
  const athlete = repo.getAthlete();
  if (!athlete) throw new Error("選手プロフィールが未登録です");
  const allSessions = repo.listSessions();
  // 過去データから作られたセッションは負荷計算には使うが、
  // ルールの評価対象からは外す（過ぎた日の構成は今から直せないため。
  // 過去の構成そのものの診断は diagnosePastStructure が別に行う）。
  const sessions = allSessions.filter((s) => !s.backfilled);
  const results = trustedResults(repo);
  const resultsMap = new Map(results.map((r) => [r.sessionId, r]));
  const loads = dailyLoads({
    sessions: allSessions,
    resultsBySessionId: resultsMap,
    strengthSessions: repo.listStrengths(),
  });
  const currentLoad = acwr(loads, evaluationDate);
  const markers = aerobicEvidenceMarkers(repo);
  const aerobic = buildAerobicProfile(
    markers,
    evaluationDate,
    repo.getCfe()?.estimated800mSec,
    heatFlaggedDates(repo),
    repo.getAthlete()?.pb1500mSec
  );
  return {
    sessions,
    allSessions,
    strengthSessions: repo.listStrengths(),
    races: repo.listRaces(),
    goal: repo.getGoal(),
    athlete,
    dailyChecks: repo.listDailyChecks(),
    resultsBySessionId: resultsMap,
    heatBlocks: repo.listHeatBlocks(),
    ltPaceSecPerKm: aerobic.isEstimated ? undefined : aerobic.ltPaceSecPerKm,
    dayTempsC: dayTempsFromResults(repo),
    evaluationDate,
    currentAcwr: currentLoad.acwr,
    currentAcwrConfidence: currentLoad.confidence,
    injuries: repo.listInjuries(),
  };
}

/**
 * 手入力マーカーに、正式な練習結果から得られるCV/閾値の実測を加える。
 * 予定の設定値ではなく、完遂・非暑熱・過大負担なしの実測だけを採用する。
 * Session/Resultから毎回再構成するため、結果後にカテゴリを直すと即時に反映される。
 */
export function aerobicEvidenceMarkers(repo: Store): FitnessMarker[] {
  const saved = repo.listMarkers();
  const sessionsById = new Map(repo.listSessions().map((session) => [session.id, session]));
  const derived = trustedResults(repo).flatMap((result): FitnessMarker[] => {
    const session = sessionsById.get(result.sessionId);
    if (
      !session ||
      session.status !== "completed" ||
      (session.category !== "cv" && session.category !== "threshold")
    ) {
      return [];
    }
    if (
      result.heatFlagged ||
      result.aborted ||
      result.achievement !== "achieved" ||
      result.rpe > 8 ||
      (result.nextDayLegs !== "fresh" && result.nextDayLegs !== "normal")
    ) {
      return [];
    }
    if (result.interval) {
      const reps = result.interval.results.filter(
        (rep) => rep.actualSec > 0 && rep.distanceM > 0
      );
      if (reps.length === 0) return [];
      return [
        {
          id: `result-fm-${session.id}`,
          date: result.date,
          type: "workout",
          purpose: session.category,
          description: `${session.name}（正式結果）`,
          resultLapsSec: reps.map((rep) => rep.actualSec),
          lapDistancesM: reps.map((rep) => rep.distanceM),
          rpe: result.rpe,
        },
      ];
    }
    if (result.continuous?.distanceKm && result.continuous.durationMin) {
      return [
        {
          id: `result-fm-${session.id}`,
          date: result.date,
          type: "workout",
          purpose: session.category,
          description: `${session.name}（正式結果）`,
          resultLapsSec: [result.continuous.durationMin * 60],
          lapDistancesM: [result.continuous.distanceKm * 1000],
          avgHr: result.continuous.avgHr,
          maxHr: result.continuous.maxHr,
          rpe: result.rpe,
        },
      ];
    }
    // 旧形式はactualLapsSec/lapDistancesMだけを持つ。読める実測を捨てず、
    // 距離が各ラップに対応すると確認できる場合だけ互換採用する。
    if (
      result.actualLapsSec.length > 0 &&
      result.lapDistancesM?.length === result.actualLapsSec.length &&
      result.actualLapsSec.every((seconds) => seconds > 0) &&
      result.lapDistancesM.every((distance) => distance > 0)
    ) {
      return [
        {
          id: `result-fm-${session.id}`,
          date: result.date,
          type: "workout",
          purpose: session.category,
          description: `${session.name}（正式結果・旧形式）`,
          resultLapsSec: result.actualLapsSec,
          lapDistancesM: result.lapDistancesM,
          rpe: result.rpe,
        },
      ];
    }
    return [];
  });
  const derivedIds = new Set(derived.map((marker) => marker.id));
  return [...saved.filter((marker) => !derivedIds.has(marker.id)), ...derived];
}

// ---------------------------------------------------------------------------
// セットアップ / プラン生成
// ---------------------------------------------------------------------------

/** 目標に紐づくレースだけを、目標→通過点の順で返す。 */
export function racesForGoal(repo: Store): Race[] {
  const goal = repo.getGoal();
  if (!goal) return [];
  const byId = new Map(repo.listRaces().map((race) => [race.id, race]));
  return [goal.targetRaceId, ...(goal.subRaceIds ?? [])]
    .map((id) => byId.get(id))
    .filter((race): race is Race => race !== undefined);
}

/**
 * 通過ボーダーを、読めた値だけ残す形に整える。
 *
 * `Number.isFinite` は 0 と負を通す。0 が保存されると `planHeatPace` の
 * `race.borderTimeSec ?? goalTargetSec + 2` が 0 を nullish と見なさないため、
 * 予選の通過目安が0秒基準（−0.5秒）になる。画面には値が出たまま中身だけ壊れる。
 *
 * 画面（`app/goal/page.tsx`）は入力を検証しているが、APIは `req.json()` の生データを、
 * `importBackup` は他端末が書いたJSON（Supabaseのpullも同じ経路）を受けるので、
 * 保存層の手前でも同じ規則を通す。
 *
 * 着順は以前 `Math.max(1, ...)` で1着へ丸めていた。丸めると「0が入ってきた」のか
 * 「1着通過」なのかが後から区別できなくなるので、丸めずに未入力へ戻す。
 */
function normalizeRaceBorders(race: Race): Race {
  return {
    ...race,
    borderPlace:
      race.borderPlace !== undefined &&
      Number.isFinite(race.borderPlace) &&
      race.borderPlace >= 1
        ? Math.trunc(race.borderPlace)
        : undefined,
    borderTimeSec:
      race.borderTimeSec !== undefined &&
      Number.isFinite(race.borderTimeSec) &&
      race.borderTimeSec > 0
        ? race.borderTimeSec
        : undefined,
  };
}

/**
 * 目標とレースを同じ保存単位として更新し、保存後の実体を返す。
 *
 * 画面だけが新しい値でDBが古い、または並び替えで通過点レースのIDが変わる状態を避ける。
 * 目標から外したレースも過去の競技記録になり得るため、保存層からは削除しない。
 */
export function saveGoalAndRaces(
  repo: Store,
  goal: Goal,
  races: Race[]
): { goal: Goal; races: Race[] } {
  const unique = new Map<string, Race>();
  for (const race of races) {
    unique.set(
      race.id,
      assignExpectedPaces(normalizeRaceBorders(race), goal.targetTimeSec)
    );
  }

  /*
   * 本命レースが無い保存を許す（冬季・基礎構築モード）。
   *
   * 以前はここで必ず例外にしていたので、レースが決まっていない期間は
   * そもそも目標を保存できなかった。冬にレースが無いのは普通のこと。
   *
   * ただし「IDを書いたのにそのレースが無い」は打ち間違いなので弾く。
   * 未定は `targetRaceId: ""` で表す（レースを1件も渡さない形）。
   */
  if (goal.targetRaceId !== "" && !unique.has(goal.targetRaceId)) {
    throw new Error("本命レースが保存対象に含まれていません");
  }
  const normalizedGoal: Goal = {
    ...goal,
    subRaceIds: (goal.subRaceIds ?? []).filter(
      (id, index, ids) =>
        id !== goal.targetRaceId && unique.has(id) && ids.indexOf(id) === index
    ),
  };

  for (const race of unique.values()) repo.saveRace(race);
  repo.saveGoal(normalizedGoal);

  return {
    goal: repo.getGoal()!,
    races: racesForGoal(repo),
  };
}

export function setupCfeIfNeeded(repo: Store, today: string): void {
  if (repo.getCfe()) return;
  const athlete = repo.getAthlete();
  if (!athlete) return;
  const recentRace = repo
    .listMarkers()
    .filter((m) => m.type === "race" && m.resultLapsSec.length > 0)
    .map((m) => ({
      date: m.date,
      timeSec: m.resultLapsSec.reduce((a, b) => a + b, 0),
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
    .at(-1);
  repo.saveCfe(initCfe(athlete.pb800mSec, today, recentRace));
}

/** 完了済み自動生成セッションだけを、次回の形式選択に使える履歴へ変換する。 */
function completedTemplateHistory(repo: Store): TemplateHistoryEntry[] {
  const resultsBySessionId = new Map(
    trustedResults(repo).map((result) => [result.sessionId, result])
  );
  return repo.listSessions().flatMap((session) => {
    if (!session.generation || session.status !== "completed") return [];
    const result = resultsBySessionId.get(session.id);
    return [
      {
        date: session.date,
        category: session.category,
        templateId: session.generation.templateId,
        variationGroup: session.generation.variationGroup,
        progressionStage: session.generation.progressionStage,
        achievement: result?.achievement,
        rpe: result?.rpe,
        nextDayLegs: result?.nextDayLegs,
        aborted: result?.aborted,
        abortCause: result?.abortCause,
      },
    ];
  });
}

/**
 * 「これは本人のものだから、相手側の値で消してはいけない」予定かどうか。
 *
 * 同期の統合（merge）で使う。統合は「両方を残す」操作なので、
 * 別端末やクラウドに残っていた古い自動生成予定で、
 * この端末の完了済み・本人編集・固定枠・手動追加・遡り入力を上書きしない。
 *
 * 判定の材料は regeneratePlan の置き換え判定と同じ。
 * 旧データには origin が無いので、`s-user-*` を手動として保守的に扱う。
 * 迷ったら守る側に倒す（消えたデータは取り返せないが、残ったものは後から消せる）。
 *
 * クラウドを本当に優先したいときは、本人が競合画面で「クラウドを優先」を選ぶ。
 * そちらは replace なので、この保護は掛からない。
 */
function isOwnedByAthlete(session: Session): boolean {
  return (
    session.status === "completed" ||
    session.status === "skipped" ||
    session.userEdited === true ||
    session.isFixed === true ||
    session.backfilled === true ||
    session.origin === "manual" ||
    session.id.startsWith("s-user-")
  );
}

export function regeneratePlan(repo: Store, startDate: string): {
  sessionCount: number;
  strengthCount: number;
  violations: RuleViolation[];
  templateViolations: RuleViolation[];
  customMenusUsed: number;
  /** 目標レースが無い期間（冬季・基礎構築モード）で組んだか。ピーキングしていない */
  offSeason: boolean;
  /** 冬季モードのブロック割り。何を繰り返しているのかを見せる */
  offSeasonBlocks: { weekStart: string; emphasis: string; label: string }[];
  /** N日周期で組んだときに、週テンプレートの配分から変えた点（理由つき） */
  cycleNotes: string[];
  /** 暦の1週間に高負荷が集中するのを避けて内容を落とした枠。理由つきで見せる */
  spacingSwaps: { date: string; from: string; to: string; note: string }[];
  limiterSwaps: { date: string; from: string; to: string; note: string }[];
  limiterNote?: string;
  unsafeSkipped: number;
  safetyAdjustments: { date: string; sessionId: string; reason: string }[];
} {
  /*
   * 再生成は「旧自動予定の削除 → 新予定の生成・保存」で1操作。
   * 後半で例外が起きたときに削除だけが確定すると予定を失うため、
   * 保存層が提供するトランザクションで操作全体を原子的に扱う。
   */
  return repo.transaction(() => regeneratePlanCore(repo, startDate));
}

function regeneratePlanCore(repo: Store, startDate: string): {
  sessionCount: number;
  strengthCount: number;
  violations: RuleViolation[];
  /** 3-1: 曜日テンプレート自体の問題（生成前に気づけるように別枠で返す） */
  templateViolations: RuleViolation[];
  customMenusUsed: number;
  /** 目標レースが無い期間（冬季・基礎構築モード）で組んだか。ピーキングしていない */
  offSeason: boolean;
  /** 冬季モードのブロック割り。何を繰り返しているのかを見せる */
  offSeasonBlocks: { weekStart: string; emphasis: string; label: string }[];
  /** N日周期で組んだときに、週テンプレートの配分から変えた点（理由つき） */
  cycleNotes: string[];
  /** 暦の1週間に高負荷が集中するのを避けて内容を落とした枠。理由つきで見せる */
  spacingSwaps: { date: string; from: string; to: string; note: string }[];
  /** M-7: 制限因子で振り替えた枠。黙って配分を変えないための記録 */
  limiterSwaps: { date: string; from: string; to: string; note: string }[];
  limiterNote?: string;
  /** 対象6: 生成ロジックのバグで物理的にありえない設定ペースが出て、除外した枠数 */
  unsafeSkipped: number;
  safetyAdjustments: { date: string; sessionId: string; reason: string }[];
} {
  const athlete = repo.getAthlete();
  const goal = repo.getGoal();
  if (!athlete || !goal) throw new Error("プロフィールと目標を先に登録してください");
  setupCfeIfNeeded(repo, startDate);
  const cfe = applyStaleness(repo.getCfe()!, startDate, lastRecordedDate(repo));
  repo.saveCfe(cfe);

  const races = repo.listRaces().map((r) => assignExpectedPaces(r, goal.targetTimeSec));
  for (const r of races) repo.saveRace(r);

  const aerobic = buildAerobicProfile(
    aerobicEvidenceMarkers(repo),
    startDate,
    cfe.estimated800mSec,
    heatFlaggedDates(repo),
    repo.getAthlete()?.pb1500mSec
  );
  const savedSessions = repo.listSessions();
  const templateHistory = completedTemplateHistory(repo);

  /*
   * 再生成で置き換えるのは自動生成された未実施枠だけ。
   * - 新形式は origin で識別する。
   * - 旧形式は s-user-* / 固定 / backfilled を手動データとして保護し、
   *   planned の自動生成候補だけを置き換える。
   * - 本人が編集した予定、完了・中止済みは残す。
   *
   * 同じ「本人のものは消さない」判断を、同期の統合でも使う（isOwnedByAthlete）。
   * 判定の材料は同じだが、こちらは「置き換えてよいか」、あちらは「守るべきか」を見る。
   * 片方を直したらもう片方も確認すること。
   */
  for (const session of savedSessions) {
    const legacyGeneratedPlanned =
      session.origin === undefined &&
      session.status === "planned" &&
      !session.id.startsWith("s-user-") &&
      !session.backfilled &&
      !session.isFixed;
    const generatedUnfinished =
      (session.origin === "generated" || session.origin === "recovery") &&
      !session.userEdited &&
      (session.status === "planned" || session.status === "modified");
    if (legacyGeneratedPlanned || generatedUnfinished) {
      repo.deleteSession(session.id);
    }
  }
  repo.deleteAllPlannedStrengths();

  const weekTemplate = repo.getWeekTemplate();
  const customMenus = repo.listCustomMenus();

  // M-7: 制限因子から配分の重みを決める
  const limiter = assessLimiter(athlete, goal.targetTimeSec);
  const limiterWeights = categoryWeights(limiter.limiter);

  /*
   * S-7: 直近の実行状況を生成に渡す。
   *
   * これまで生成は「今どうなっているか」を見ずに、カテゴリごとの固定文面を出していた。
   * 設定を守れていないカテゴリで量を増やしても、守れない練習が増えるだけなので、
   * カテゴリごとの傾向（M-2と同じ判定）を内容の組み立てに使う。
   */
  const recentTrend = recentTrendByCategory(repo, startDate);

  const plan = generatePlan({
    athlete,
    goal,
    races,
    cfeSec: cfe.estimated800mSec,
    aerobicProfile: aerobic,
    startDate,
    weekTemplate,
    customMenus,
    limiterWeights,
    recentTrend,
    athleteType:
      athlete.athleteTypeOverride ?? diagnose(athlete, goal.targetTimeSec).athleteType,
    templateHistory,
    ...loadSensitivity(repo, startDate),
  });

  // 3-2: 使われた自作メニューの使用実績を更新する
  const usedCounts = new Map<string, string>();
  for (const u of plan.usedCustomMenus) {
    const prev = usedCounts.get(u.menuId);
    if (!prev || u.date > prev) usedCounts.set(u.menuId, u.date);
  }
  for (const [menuId, lastDate] of usedCounts) {
    const m = customMenus.find((x) => x.id === menuId);
    if (m) {
      repo.saveCustomMenu({
        ...m,
        timesUsed: (m.timesUsed ?? 0) + 1,
        lastUsedDate: lastDate,
      });
    }
  }
  // 固定セッション(is_fixed)は deleteAllPlannedSessions の対象だが、
  // ユーザー登録の固定枠は status を "modified" 扱いにしない設計のため、
  // ここでは生成分のみ保存する（固定枠はUIから個別登録）。
  // 手動追加・本人編集・旧固定枠が同じ日/時間帯にある場合は、その枠を優先する。
  // 残した直後に自動生成分を足して二重表示にしない。
  const occupiedSlots = new Set(
    repo.listSessions().map((session) => `${session.date}|${session.timeOfDay}`)
  );
  const candidateSessions = plan.sessions.filter(
    (session) => !occupiedSlots.has(`${session.date}|${session.timeOfDay}`)
  );
  const injuryHistory = repo.listInjuries();
  const safetyAdjustments: { date: string; sessionId: string; reason: string }[] = [];
  const injuryProtectedSessions = candidateSessions.map((session) => {
    const activeInjuries = activeInjuriesAt(injuryHistory, session.date);
    if (activeInjuries.length === 0 || !isHighLoadSession(session)) return session;
    const reason =
      `継続中の故障記録（${activeInjuries
        .map((injury) => `${injury.bodyPart}: 痛み${injury.painLevel}/10`)
        .join("、")}）があるため、高負荷を回復メニューへ変更`;
    safetyAdjustments.push({ date: session.date, sessionId: session.id, reason });
    return {
      ...session,
      category: "aerobic" as const,
      name: "回復ジョグ（故障保護）",
      prescription:
        "20〜30分・会話可能・RPE 2以下。痛みが増す、走動作が変わる場合は中止して完全休養。",
      targetPaces: [],
      transfer800m: 1,
      transfer1500m: 1,
      riskLevel: "low" as const,
      durationMin: 25,
      distanceKm: undefined,
      paceSecPerKm: undefined,
      aerobicPurpose: "recovery" as const,
      origin: "recovery" as const,
    };
  });
  /*
   * 対象6: 危険なトレーニング提案の防止。
   * 生成ロジックのバグで物理的にありえない設定ペースが出た場合、
   * 全体の生成を止めるのではなく、その枠だけを除いて件数を報告する
   * （黙って混ぜない。1枠のバグで明日の練習全体が消えるのも避ける）。
   */
  const generatedSessions = injuryProtectedSessions.filter(
    (session) => !hasBlockingIssue(checkSessionPlausibility(session))
  );
  const unsafeSkipped = candidateSessions.length - generatedSessions.length;
  repo.saveSessions(generatedSessions);
  repo.saveStrengths(plan.strengthSessions);

  // ラウンド間回復プロトコルを生成
  for (const r of races) {
    if (r.rounds.length >= 2) {
      const recovery = generateRecoverySessions(r).filter(
        (session) => !repo.listSessions().some(
          (saved) => saved.date === session.date && saved.timeOfDay === session.timeOfDay
        )
      );
      repo.saveSessions(recovery);
    }
  }

  /*
   * 生成の途中で内容を差し替えた枠を、変更履歴に残す。
   *
   * これまで `limiterSwaps` と `spacingSwaps` は生成直後の画面メッセージにしか出ず、
   * **画面を離れると理由が消えていた**。あとで予定を見返したときに
   * 「なぜここだけCVなのか」が分からない。
   * 変更履歴はバックアップにも入る（forge-v89）ので、端末を替えても残る。
   *
   * 保存済みの枠ぶんだけ残す——安全性の判定で捨てた枠の理由を残しても、
   * 対応する予定が無いので読めない。
   */
  const savedIds = new Set(generatedSessions.map((s) => s.id));
  const logSwap = (
    swap: { date: string; from: string; to: string; note: string },
    triggeredBy: string
  ) => {
    const sessionId = `s-plan-${swap.date}-pm`;
    if (!savedIds.has(sessionId)) return;
    repo.logChange({
      sessionId,
      field: "category",
      before: swap.from,
      after: swap.to,
      reason: swap.note,
      triggeredBy,
      /*
       * 上げ・下げのどちらでもない。
       * 制限因子の振り替えも間隔の調整も、量や強度を動かしているのではなく
       * **枠の中身を入れ替えている**だけ（CVを経済走に、経済走をCVに）。
       * down にすると「軽くした」記録として集計に効いてしまう。
       */
      direction: "neutral",
      action: "modify",
    });
  };
  for (const swap of plan.limiterSwaps) logSwap(swap, "M-7");
  for (const swap of plan.spacingSwaps) logSwap(swap, "RULE-04");

  const violations = runRuleEngine(buildRuleContext(repo, startDate));
  return {
    sessionCount: generatedSessions.length,
    strengthCount: plan.strengthSessions.length,
    violations,
    templateViolations: weekTemplate ? validateWeekTemplate(weekTemplate) : [],
    customMenusUsed: usedCounts.size,
    /*
     * N日周期で組んだときに、週テンプレートの配分から変えた点。
     * 「10日周期にしたら高乳酸が減った」のを黙って起こさない。
     */
    offSeason: plan.offSeason,
    offSeasonBlocks: plan.offSeasonBlocks,
    cycleNotes: plan.cycleNotes,
    spacingSwaps: plan.spacingSwaps,
    limiterSwaps: plan.limiterSwaps,
    limiterNote:
      plan.limiterSwaps.length > 0
        ? `制限因子は「${LIMITER_LABELS[limiter.limiter]}」と判定しました。` +
          `${plan.limiterSwaps.length}枠を振り替えています（${plan.limiterSwaps[0].from} → ${plan.limiterSwaps[0].to} ほか）`
        : undefined,
    unsafeSkipped,
    safetyAdjustments,
  };
}

/**
 * 負荷まわりの生成入力。生成と確定範囲の作り直しで必ず同じ値を使う。
 * 片方だけ条件が違うと、同じ日付なのに作り直すたびに内容が変わる。
 */
function loadSensitivity(
  repo: Store,
  startDate: string
): { loadHigh: boolean; recentFatigueSignal: boolean } {
  const acwrNow = acwr(
    dailyLoads({
      sessions: repo.listSessions(),
      resultsBySessionId: new Map(trustedResults(repo).map((r) => [r.sessionId, r])),
      strengthSessions: repo.listStrengths(),
    }),
    startDate
  );
  const concern = hasRecentLoadConcern(repo, startDate);
  return {
    // ACWRは補助指標。増加側で、かつ疲労・未達の実測がある場合だけ漸進を止める。
    loadHigh: acwrNow.acwr !== undefined && acwrNow.acwr > 1.3 && concern,
    // ACWRの裏付けが無くても、疲労の実測（signal・翌日の脚の重さ・未達）だけで
    // 筋損傷リスクの高い形式を避ける（selectTemplate参照）。loadHighはこれを
    // 必要条件として含むため、loadHighが真ならこちらも必ず真になる。
    recentFatigueSignal: concern,
  };
}

// ---------------------------------------------------------------------------
// ② 確定範囲の作り直し
// ---------------------------------------------------------------------------

/**
 * 確定範囲（今日〜14日）の予定を、今のCFEで作り直す。
 *
 * **以前は `repaceFutureSessions` が `targetPaces` だけを書き換えていた。**
 * 処方の文面（`400m × 3 @400m 52.5〜53.6秒 r6分`）には設定ペースが埋まっているので、
 * 数字だけ更新すると文面と設定が食い違う。実際、CFEが2.5秒動いたときに
 * 34枠すべてで「画面には52.5秒、実際の設定は51.6秒」という状態になっていた。
 * 1秒近い差を、本人が気づけない形で持っていたことになる。
 *
 * 直し方として文面側の数字を置換することも考えたが、採らなかった。
 * 処方の文面は `progression.ts` / `periodization.ts` が組み立てており、
 * 表示のためにもう1か所で解釈すると「同じ文字列が場所によって違う意味になる」。
 * **生成と同じ経路で作り直す**ことにして、文面と設定が構造的にズレないようにした。
 *
 * 作り直すのは確定範囲だけ。その先は素案として設定ペースを出さない（`horizon.ts`）ので、
 * 古い数字を持っていても表示されず、確定範囲に入る前にここで作り直される。
 *
 * 触らないもの（`regeneratePlan` と同じ判断。片方を直したらもう片方も確認する）:
 *   - 実施済み・中止済み
 *   - 本人が編集したもの（M-2の適応提案を適用したものを含む。userEditedが立つ）
 *   - 固定枠（コーチ指定）
 *   - 自動生成でないもの
 */
export function refreshNearHorizon(repo: Store, fromDate: string): SessionChange[] {
  const athlete = repo.getAthlete();
  const goal = repo.getGoal();
  const cfe = repo.getCfe();
  if (!athlete || !goal || !cfe) return [];
  const races = repo.listRaces();
  /*
   * 目標レースが無くても確定範囲は作り直す（冬季・基礎構築モード）。
   * 以前はここで諦めていたので、冬は結果を入れてもCFEが予定に反映されなかった。
   * 冬こそ土台が動く時期なので、ここを止める理由が無い。
   */

  const until = addDays(fromDate, CONFIRM_HORIZON_DAYS);
  const plan = generatePlan({
    athlete,
    goal,
    races,
    cfeSec: cfe.estimated800mSec,
    aerobicProfile: buildAerobicProfile(
      aerobicEvidenceMarkers(repo),
      fromDate,
      cfe.estimated800mSec,
      heatFlaggedDates(repo),
      repo.getAthlete()?.pb1500mSec
    ),
    startDate: fromDate,
    weekTemplate: repo.getWeekTemplate(),
    customMenus: repo.listCustomMenus(),
    limiterWeights: categoryWeights(assessLimiter(athlete, goal.targetTimeSec).limiter),
    recentTrend: recentTrendByCategory(repo, fromDate),
    athleteType:
      athlete.athleteTypeOverride ?? diagnose(athlete, goal.targetTimeSec).athleteType,
    templateHistory: completedTemplateHistory(repo),
    ...loadSensitivity(repo, fromDate),
  });

  const changes: SessionChange[] = [];
  for (const next of plan.sessions) {
    if (next.date < fromDate || next.date > until) continue;
    const current = repo.getSession(next.id);
    if (!current) continue; // 新しく増やすのは再生成の仕事。ここでは差し替えだけ
    if (current.status === "completed" || current.status === "skipped") continue;
    if (current.userEdited || current.isFixed) continue;
    if (current.origin !== undefined && current.origin !== "generated") continue;

    const paceOf = (s: Session) =>
      s.targetPaces[0]
        ? `${s.targetPaces[0].targetSecFast.toFixed(1)}〜${s.targetPaces[0].targetSecSlow.toFixed(1)}秒/${s.targetPaces[0].distanceM}m`
        : "設定ペースなし";
    const sameText = current.prescription === next.prescription;
    const samePace = paceOf(current) === paceOf(next);
    if (sameText && samePace) continue;

    // 対象6: 作り直した結果がありえない設定なら、その枠は元のまま残す
    if (hasBlockingIssue(checkSessionPlausibility(next))) continue;

    const before = current.targetPaces[0]?.targetSecFast;
    const after = next.targetPaces[0]?.targetSecFast;
    changes.push({
      sessionId: current.id,
      field: "prescription",
      before: `${current.prescription}（${paceOf(current)}）`,
      after: `${next.prescription}（${paceOf(next)}）`,
      reason: `CFE更新(${fmtTime(cfe.estimated800mSec)})に伴い、確定範囲（${CONFIRM_HORIZON_DAYS}日）の予定を作り直し`,
      triggeredBy: "CFE",
      direction:
        before === undefined || after === undefined
          ? "neutral"
          : after < before
            ? "up"
            : after > before
              ? "down"
              : "neutral",
      action: "modify",
    });
    // status / userEdited は current のものを保つ（作り直しは本人の編集ではない）
    repo.saveSession({ ...next, status: current.status, userEdited: current.userEdited });
  }
  return changes;
}

// ---------------------------------------------------------------------------
// 練習結果の登録（4-5 フロー全体）
// ---------------------------------------------------------------------------

export interface ProcessResultOutput {
  cfeBefore: number;
  cfeAfter: number;
  cfeApplied: boolean;
  guardrailNotes: string[];
  changes: SessionChange[];
  violations: RuleViolation[];
  economySignalNote?: string;
  categoryChange?: { before: SessionCategory; after: SessionCategory };
}

export interface ProcessResultOptions {
  isRace?: boolean;
  raceTimeSec?: number;
  /** 予定時ではなく、実際に行った内容の分類。結果の再保存でも再計算する。 */
  sessionCategory?: SessionCategory;
}

const RESULT_SESSION_CATEGORIES: readonly SessionCategory[] = [
  "high_lactate",
  "race_economy",
  "modeling",
  "neural",
  "cv",
  "threshold",
  "aerobic",
];

export function processResult(
  repo: Store,
  result: SessionResult,
  opts: ProcessResultOptions = {}
): ProcessResultOutput {
  /*
   * 結果・完了状態・CFE・将来予定・変更履歴は同じ記録操作の一部。
   * 途中失敗で一部だけ残さないよう、通常入力もFIT確認と同じ原子性を持たせる。
   */
  return repo.transaction(() => processResultCore(repo, result, opts));
}

function processResultCore(
  repo: Store,
  result: SessionResult,
  opts: ProcessResultOptions = {}
): ProcessResultOutput {
  const storedSession = repo.getSession(result.sessionId);
  if (!storedSession) throw new Error("セッションが見つかりません");
  if (
    opts.sessionCategory !== undefined &&
    !RESULT_SESSION_CATEGORIES.includes(opts.sessionCategory)
  ) {
    throw new Error("実際に行ったメニューの種類が正しくありません");
  }
  const categoryChange =
    opts.sessionCategory !== undefined && opts.sessionCategory !== storedSession.category
      ? { before: storedSession.category, after: opts.sessionCategory }
      : undefined;
  const session: Session = categoryChange
    ? {
        ...storedSession,
        category: categoryChange.after,
        userEdited: true,
        generation: undefined,
        rationale: undefined,
      }
    : storedSession;
  const athlete = repo.getAthlete()!;

  // 2-1: 環境条件から暑熱フラグを自動判定して記録に埋め込む
  const env = evaluateEnvironment({
    tempC: result.weatherTempC,
    humidityPct: result.humidityPct,
  });
  // 1-2: 構造化記録があれば達成度を実測から機械的に決める（手入力より優先）
  const inferred = result.interval ? inferAchievement(result.interval) : undefined;
  const shortenedRep = result.interval?.results.find(
    (rep) =>
      rep.plannedDistanceM !== undefined &&
      rep.distanceM + REP_DISTANCE_TOLERANCE_M < rep.plannedDistanceM
  );
  const fullyCompletedReps = result.interval?.results.filter(
    (rep) =>
      rep.plannedDistanceM === undefined ||
      rep.distanceM + REP_DISTANCE_TOLERANCE_M >= rep.plannedDistanceM
  ).length;

  /*
   * M-1: 同じセッションの記録を直して入れ直したときは「上書き」にする。
   * 新しいidで積むと記録が二重に残り、負荷も達成度も二重に数えられる。
   * CFEも同じ練習で2回動いてしまい、±1.5秒のガードレールが実質±3秒になる。
   */
  const existing = repo.resultForSession(result.sessionId);
  /*
   * 理由が選ばれていれば、それは本人が「途中でやめた」と言っているということ。
   * 中止基準に引っかかっていなくても打ち切りとして扱う——
   * 痛みや時間で止めた場合、設定から外れていないので M-3 は反応しない。
   */
  const abortCause = normalizeAbortCause(result.abortCause);

  /*
   * アップは主練習の子データ。**画面を通さない経路でも必ずここを通す。**
   * 復元・FIT・APIから直接来た値をそのまま保存すると、
   * 知らない区間種別が残り、分析でそれをジョグとして数えることになる。
   */
  const warmup = normalizeWarmup(result.warmup);
  const warmupProblem = checkWarmup(warmup);
  if (warmupProblem) throw new Error(warmupProblem);

  result = {
    ...result,
    warmup,
    id: existing?.id ?? result.id,
    heatFlagged: env?.isHeatFlagged ?? result.heatFlagged,
    achievement: inferred ?? result.achievement,
    abortCause,
    // 理由を消したら記述も消す（「その他」から選び直したときに前の文が残らないように）
    abortNote: abortCause ? result.abortNote?.trim() || undefined : undefined,
    aborted: shortenedRep !== undefined || abortCause !== undefined ? true : result.aborted,
    abortReason:
      result.abortReason ??
      (shortenedRep
        ? `${shortenedRep.index}本目を予定${shortenedRep.plannedDistanceM}mのうち${shortenedRep.distanceM}mで終了`
        : undefined),
    completedReps:
      result.completedReps ??
      (shortenedRep !== undefined ? fullyCompletedReps : result.interval?.results.length),
    prescribedReps: result.prescribedReps ?? result.interval?.reps,
  };

  repo.saveResult(result);
  repo.saveSession({ ...session, status: "completed" });

  // 直近の next_day_legs 連続状況
  const allResults = repo
    .listResults()
    .sort((a, b) => a.date.localeCompare(b.date));
  const prevLegs = allResults
    .filter((r) => r.id !== result.id)
    .slice(-2)
    .map((r) => r.nextDayLegs)
    .filter((l): l is NonNullable<typeof l> => !!l);
  const heavyStreak =
    [...prevLegs, result.nextDayLegs].filter((l) => l === "heavy").length >= 2 &&
    result.nextDayLegs === "heavy"
      ? 2
      : 0;

  // ① CFE更新
  let cfe = applyStaleness(repo.getCfe()!, result.date, lastRecordedDate(repo));
  // 修正の保存なら、前回この練習で動かしたぶんを取り消してから入れ直す
  if (existing) cfe = revertCfeForSession(cfe, result.sessionId);
  const before = cfe.estimated800mSec;
  const update = updateCfeFromResult(cfe, session, result, {
    tempC: result.weatherTempC,
    heavyLegsStreak: heavyStreak,
    isRace: opts.isRace,
    raceTimeSec: opts.raceTimeSec,
    // 統合監査で追加: 未達幅の基準から目標タイムの混入を取り除くために渡す
    goalTargetTimeSec: repo.getGoal()?.targetTimeSec,
  });
  cfe = update.cfe;
  repo.saveCfe(cfe);

  // ② ペース再計算
  const repaceChanges = refreshNearHorizon(repo, result.date);

  // ③ 波及（下げ方向のみ強く）
  const upcoming = repo.listSessions().filter((s) => s.status === "planned");
  const propChanges = propagate({
    session,
    result,
    upcomingSessions: upcoming,
    athlete,
    recentNextDayLegs: prevLegs,
  });

  // 衝突解決（4-5-5）: 下げ方向優先・ルール最優先
  const changes = resolveConflicts([...propChanges, ...repaceChanges]);

  // 波及の適用（category置換系のみ自動反映、他は提案として記録）
  for (const c of changes) {
    if (c.action === "replace_with_off" || c.action === "replace_with_aerobic") {
      const target = repo.getSession(c.sessionId);
      if (target && !target.isFixed) {
        const replaceWithOff = c.action === "replace_with_off";
        repo.saveSession(
          replaceWithOff
            ? {
                ...target,
                category: "off",
                name: "完全休養（自動置換）",
                prescription: "完全休養",
                targetPaces: [],
                durationMin: undefined,
                distanceKm: undefined,
                paceSecPerKm: undefined,
                aerobicPurpose: undefined,
                status: "modified",
              }
            : {
                ...target,
                category: "aerobic",
                name: "回復ジョグ（自動置換）",
                prescription:
                  "30分回復ジョグ（会話可能・RPE 2〜3を優先。疲労・暑熱時はペースを強制しない）",
                targetPaces: [],
                durationMin: 30,
                distanceKm: undefined,
                paceSecPerKm: undefined,
                aerobicPurpose: "recovery",
                status: "modified",
              }
        );
      }
    }
    repo.logChange(c);
  }

  // ④ ルールエンジン再検証（常に最後）
  const violations = runRuleEngine(buildRuleContext(repo, result.date));

  // 経済走の特別シグナル（4-5-6）
  let economySignalNote: string | undefined;
  if (session.category === "race_economy") {
    economySignalNote =
      "経済走は「同じ設定でより楽に感じるか」で評価します。分析画面のRPE推移を確認してください。";
  }

  return {
    cfeBefore: before,
    cfeAfter: cfe.estimated800mSec,
    cfeApplied: update.applied,
    guardrailNotes: update.guardrailNotes,
    changes,
    violations,
    economySignalNote,
    categoryChange,
  };
}

/**
 * 誤って記録した結果を削除する（不具合4対応）。
 *
 * CFEへの寄与を`revertCfeForSession`で取り消してから結果を消す
 * （M-1の上書き処理と同じ考え方——記録を消すなら、その記録が動かした
 * CFEも一緒に取り消さないと、無かったはずの記録の影響が能力推定に残り続ける）。
 *
 * セッション自体は、backfilled（過去データ・FIT取込由来で対応する予定枠が
 * 元から無い）なら一緒に削除する（結果を消したら空の枠だけ残る意味が無い）。
 * 通常の予定セッションなら"planned"に戻す（予定そのものは消さない——
 * 「本人が決めたものを黙って変えない」原則）。
 */
/**
 * 保存された結果の読み返し。「入れたものがそのまま入っているか」を確かめるための機能。
 *
 * 並べ直すのはコア（`buildResultAudit`）。ここでやるのは
 * **何に使われたかを本物の判定関数から取ること**。
 * 「CFEに使われたか」を画面用に書き直すと、実際の処理と説明が食い違ったときに
 * 説明のほうが正しく見えてしまう。`updateCfeFromResult` は純粋関数で
 * 保存もしないので、そのまま呼んで判定と理由だけを受け取る。
 */
export function resultAudit(repo: Store, resultId: string): ResultAudit | undefined {
  const result = repo.listResults().find((r) => r.id === resultId);
  if (!result) return undefined;
  const session = repo.getSession(result.sessionId);
  if (!session) return undefined;

  const audit = buildResultAudit(session, result);

  const cfe = repo.getCfe();
  if (cfe) {
    // 保存はしない。判定と理由を見るためだけに通す
    const decision = updateCfeFromResult(cfe, session, result, {
      goalTargetTimeSec: repo.getGoal()?.targetTimeSec,
    });
    audit.usage.push({
      label: "CFE（推定800mタイム）",
      used: decision.applied,
      note: decision.applied
        ? `実測から800m相当 ${decision.impliedSec?.toFixed(2)}秒として反映`
        : (decision.guardrailNotes[0] ?? "この結果はCFEに使われません"),
    });
  }

  /*
   * 負荷とLT推定は、CFEに使われなかった結果でも算入される。
   * ここを出さないと「CFEに使われない＝入力が無駄だった」と読めてしまう。
   */
  audit.usage.push({
    label: "負荷（ACWR・週の量）",
    used: true,
    note: "実施した本数と距離をそのまま算入します",
  });
  audit.usage.push({
    label: "同じメニューどうしの比較",
    used: true,
    note: "同じ処方の回どうしでタイム・RPE・翌日の脚を並べます",
  });

  return audit;
}

export function deleteResult(repo: Store, resultId: string): void {
  const result = repo.listResults().find((r) => r.id === resultId);
  if (!result) throw new Error("記録が見つかりません");

  const cfe = repo.getCfe();
  if (cfe) {
    repo.saveCfe(revertCfeForSession(cfe, result.sessionId));
  }

  repo.deleteResult(resultId);

  const session = repo.getSession(result.sessionId);
  if (session) {
    if (session.backfilled) {
      repo.deleteSession(session.id);
    } else {
      repo.saveSession({ ...session, status: "planned" });
    }
  }
}

// ---------------------------------------------------------------------------
// スキップ処理（4-5-4）
// ---------------------------------------------------------------------------

export function processSkip(
  repo: Store,
  sessionId: string,
  reason: SkipReason
): { decision: ReturnType<typeof handleSkip>; violations: RuleViolation[] } {
  const session = repo.getSession(sessionId);
  if (!session) throw new Error("セッションが見つかりません");

  // 直前の質練習がスキップされていたか（SKIP-04）
  const prevQuality = repo
    .listSessions()
    .filter((s) => isHighLoadSession(s) && s.date < session.date)
    .sort((a, b) => a.date.localeCompare(b.date))
    .at(-1);
  const races = repo.listRaces().filter((r) => r.priority !== "C");
  const nearest = races
    .map((r) => diffDays(session.date, r.dateStart))
    .filter((d) => d >= 0)
    .sort((a, b) => a - b)[0];

  const decision = handleSkip(session, reason, {
    previousQualitySkipped: prevQuality?.status === "skipped",
    daysToNearestRace: nearest,
  });

  if (decision.action === "delete") {
    repo.saveSession({ ...session, status: "skipped" });
  } else if (decision.action === "postpone" && session.isFixed) {
    /*
     * 固定枠（チーム練習等）は後ろ倒ししない。
     * 日時が決まっているから固定枠なのであって、2日ずらした「チーム練習」は
     * 実在しない予定になる。RULE-15が変更・移動を禁じているのと同じ理由。
     * 中止したという事実だけを残す。
     */
    repo.saveSession({ ...session, status: "skipped" });
    return {
      decision: {
        ...decision,
        action: "delete",
        message:
          decision.message +
          " ただし固定枠（チーム練習等）なので後ろ倒しはせず、中止として記録しました。",
      },
      violations: runRuleEngine(buildRuleContext(repo, session.date)),
    };
  } else if (decision.action === "postpone") {
    // 最大2日後ろ倒し → ルール再実行で違反が出れば削除推奨（ここでは1候補を試す）
    const newDate = addDays(session.date, Math.min(2, decision.maxPostponeDays ?? 2));
    repo.saveSession({ ...session, date: newDate, status: "modified" });
    const violations = runRuleEngine(buildRuleContext(repo, session.date));
    const affected = violations.filter(
      (v) => v.level === "ERROR" && v.sessionIds.includes(session.id)
    );
    if (affected.length > 0) {
      // 後ろ倒しで違反 → 削除を推奨し、元に戻してskipped扱い
      repo.saveSession({ ...session, status: "skipped" });
      return {
        decision: {
          ...decision,
          action: "delete_recommended",
          message:
            decision.message +
            ` 後ろ倒し(${newDate})を試行しましたがルール違反(${affected.map((v) => v.rule).join(",")})が発生するため削除しました。`,
        },
        violations,
      };
    }
    return { decision, violations };
  } else {
    repo.saveSession({ ...session, status: "skipped" });
  }
  const violations = runRuleEngine(buildRuleContext(repo, session.date));
  return { decision, violations };
}

/**
 * 中止（skipped）を取り消して予定に戻す。
 *
 * 中止した枠はカレンダーの一覧から外れる。押し間違いに気づいたときに
 * 戻せないと、消えた予定を手で作り直すしかなくなる（固定枠は手で作り直せない）。
 *
 * 記録済みのものは戻さない。中止したのに結果があるという状態は
 * どちらが本当か分からなくなるため。
 */
export function restoreSkippedSession(
  repo: Store,
  sessionId: string,
  today: string
): { ok: boolean; error?: string; violations: RuleViolation[] } {
  const session = repo.getSession(sessionId);
  if (!session) return { ok: false, error: "セッションが見つかりません", violations: [] };
  if (session.status !== "skipped") {
    return { ok: false, error: "中止していない予定です", violations: [] };
  }
  if (repo.resultForSession(sessionId)) {
    return { ok: false, error: "記録が入っている予定は戻せません", violations: [] };
  }
  repo.saveSession({ ...session, status: "planned" });
  return { ok: true, violations: runRuleEngine(buildRuleContext(repo, today)) };
}

// ---------------------------------------------------------------------------
// 日次コンディション（4-5-8）
// ---------------------------------------------------------------------------

export function processDailyCheck(
  repo: Store,
  check: DailyCheck
): { signal: string; action: string; reasons: string[]; changes: SessionChange[] } {
  const checks = repo.listDailyChecks();
  const withHr = checks.filter((c) => c.restingHr !== undefined).slice(-28);
  const baseline =
    withHr.length >= 5
      ? [...withHr.map((c) => c.restingHr!)].sort((a, b) => a - b)[
          Math.floor(withHr.length / 2)
        ]
      : undefined;
  const judged = judgeSignal(check, baseline);
  repo.saveDailyCheck({ ...check, signal: judged.signal });

  // 黄3連続 → 赤扱い（4-5-8）
  const eff = effectiveSignal(repo.listDailyChecks());
  let changes: SessionChange[] = [];
  if (eff.signal === "red") {
    // PROP-06: 直後3日間の質練習を置換
    changes = propagateRedSignal(check.date, repo.listSessions());
    for (const c of changes) {
      const s = repo.getSession(c.sessionId);
      if (s && !s.isFixed) {
        repo.saveSession({
          ...s,
          category: "aerobic",
          name: "回復ジョグ（赤信号による自動置換）",
          status: "modified",
        });
      }
      repo.logChange(c);
    }
  }
  return {
    signal: eff.signal,
    action: eff.escalated ? `${judged.action}（黄3日連続のため赤扱い）` : judged.action,
    reasons: judged.reasons,
    changes,
  };
}

// ---------------------------------------------------------------------------
// レース結果（4-5-7 + 4-7-4）
// ---------------------------------------------------------------------------

export function processRaceResult(
  repo: Store,
  raceId: string,
  rounds: (RoundResult & { front400Sec?: number; back400Sec?: number; rpe?: number })[],
  date: string
): {
  cfeBefore: number;
  cfeAfter: number;
  roundsDiagnosis: ReturnType<typeof diagnoseRounds>;
  analysis?: RaceAnalysisOutput;
  changes: SessionChange[];
  violations: RuleViolation[];
} {
  const athlete = repo.getAthlete()!;
  const goal = repo.getGoal();
  const roundsDiag = diagnoseRounds(rounds);

  // FitnessMarkerとして各ラウンドを記録
  for (const r of rounds) {
    repo.saveMarker({
      id: `race-${raceId}-${r.roundType}-${date}`,
      date,
      type: "race",
      description: `${raceId} ${r.roundType}`,
      resultLapsSec: r.laps ?? [r.timeSec],
      lapDistancesM: r.laps ? r.laps.map(() => 800 / r.laps!.length) : [800],
      rpe: r.rpe,
    });
  }

  // ① CFEを大きく更新（最速ラウンド・信頼度1.0・±3秒ガード）
  let cfe = applyStaleness(repo.getCfe()!, date, lastRecordedDate(repo));
  const before = cfe.estimated800mSec;
  let delta = roundsDiag.fastestTimeSec - cfe.estimated800mSec;
  if (Math.abs(delta) > 3.0) delta = Math.sign(delta) * 3.0;
  cfe = {
    estimated800mSec: cfe.estimated800mSec + delta,
    confidence: 1.0,
    lastUpdated: date,
    history: [
      ...cfe.history,
      {
        date,
        before,
        after: cfe.estimated800mSec + delta,
        source: `レース結果（最速ラウンド ${fmtTime(roundsDiag.fastestTimeSec)}）`,
      },
    ],
  };
  repo.saveCfe(cfe);

  // ② ラップからの課題再診断（決勝または最速ラウンド）
  const peak = rounds.find((r) => r.roundType === "final") ?? rounds[0];
  let analysis: RaceAnalysisOutput | undefined;
  if (goal && peak.front400Sec !== undefined && peak.back400Sec !== undefined) {
    const target = repo.listRaces().find((r) => r.id === goal.targetRaceId);
    const weeks = target ? Math.max(0, diffDays(date, target.dateStart) / 7) : 8;
    analysis = analyzeRace({
      front400Sec: peak.front400Sec,
      back400Sec: peak.back400Sec,
      targetTimeSec: goal.targetTimeSec,
      rpe: peak.rpe,
      athlete,
      cfeAfterRaceSec: cfe.estimated800mSec,
      weeksToTargetRace: weeks,
    });
  }

  // ペース再計算 + ルール再検証
  const changes = refreshNearHorizon(repo, date);
  for (const c of changes) repo.logChange(c);
  const violations = runRuleEngine(buildRuleContext(repo, date));

  return {
    cfeBefore: before,
    cfeAfter: cfe.estimated800mSec,
    roundsDiagnosis: roundsDiag,
    analysis,
    changes,
    violations,
  };
}

// ---------------------------------------------------------------------------
// ダッシュボード
// ---------------------------------------------------------------------------

/** 当日（または直近の未実施日）のメインセッションと、その準備度を返す */
export function todaySession(
  repo: Store,
  today: string
): { session?: Session; readiness?: Readiness } {
  const all = repo.listSessions();
  const candidates = all
    .filter((s) => s.date === today && s.category !== "off" && s.status !== "skipped")
    .sort((a, b) => sessionPriority(b) - sessionPriority(a));
  const session = candidates[0];
  if (!session) return {};

  const checks = repo.listDailyChecks();
  const eff = effectiveSignal(checks.filter((c) => c.date <= today));

  const loads = dailyLoads({
    sessions: all,
    resultsBySessionId: new Map(trustedResults(repo).map((r) => [r.sessionId, r])),
    strengthSessions: repo.listStrengths(),
  });

  const lastQuality = all
    .filter((s) => isHighLoadSession(s) && s.date < today && s.status === "completed")
    .sort((a, b) => a.date.localeCompare(b.date))
    .at(-1);

  const resultsBySession = new Map(trustedResults(repo).map((r) => [r.sessionId, r]));
  const recentQualityResults = all
    .filter((s) => isHighLoadSession(s) && s.date < today && resultsBySession.has(s.id))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 3)
    .map((s) => resultsBySession.get(s.id)!);

  let errorViolationCount = 0;
  try {
    errorViolationCount = runRuleEngine(buildRuleContext(repo, today)).filter(
      (v) => v.level === "ERROR" && v.sessionIds.includes(session.id)
    ).length;
  } catch {
    errorViolationCount = 0;
  }

  const readiness = computeReadiness({
    session,
    athlete: repo.getAthlete()!,
    signal: eff.signal,
    signalEscalated: eff.escalated,
    acwr: acwr(loads, today).acwr,
    daysSinceLastQuality: lastQuality ? diffDays(lastQuality.date, today) : undefined,
    recentQualityResults,
    errorViolationCount,
  });

  return { session, readiness };
}

/** 「今日のメニュー」に出すべき主役セッションの優先度（質練習 > neural > 有酸素） */
function sessionPriority(s: Session): number {
  if (isHighLoadSession(s)) return 3;
  if (s.category === "neural") return 2;
  return 1;
}

export function dashboard(repo: Store, today: string) {
  /*
   * 取り込み済みの過去データを、必要なら1度だけ作り直す。
   * 変換の中身を直しても、すでに端末に入っているぶんは古いまま残るため
   * （Q-3: 前回この経路が無く、修正が既存データに届いていなかった）。
   */
  rebuildPastDerivedOnce(repo);

  const athlete = repo.getAthlete();
  const goal = repo.getGoal();
  const cfe = repo.getCfe();
  const ctx = buildRuleContext(repo, today);
  const violations = runRuleEngine(ctx);
  const summary = weeklySummary(ctx, weekStart(today));
  // 負荷は「実際にやった練習」で数える。
  // ctx.sessions はルール評価用に過去データ入力ぶんを除いてあるので、
  // ここでそれを使うと過去データを入れてもACWRが埋まらない。
  const loads = dailyLoads({
    sessions: repo.listSessions(),
    resultsBySessionId: new Map(trustedResults(repo).map((r) => [r.sessionId, r])),
    strengthSessions: ctx.strengthSessions,
  });
  const acwrNow = acwr(loads, today);
  const calendarRaces = racesForGoal(repo);
  const targetRace = goal
    ? calendarRaces.find((r) => r.id === goal.targetRaceId)
    : undefined;
  const feasibility =
    goal && cfe && targetRace
      ? goalFeasibility(
          cfe.estimated800mSec,
          goal.targetTimeSec,
          Math.max(0, diffDays(today, targetRace.dateStart) / 7)
        )
      : undefined;
  const aerobicProfile = buildAerobicProfile(
    aerobicEvidenceMarkers(repo),
    today,
    cfe?.estimated800mSec,
    heatFlaggedDates(repo),
    repo.getAthlete()?.pb1500mSec
  );
  const diag = athlete ? diagnose(athlete, goal?.targetTimeSec) : undefined;
  const phase = targetRace
    ? ctx.sessions.find((s) => s.date >= today && s.status === "planned")?.phase
    : undefined;

  const checks = repo.listDailyChecks().filter((c) => c.date <= today);
  const signal = effectiveSignal(checks);
  const latestCheck = checks.sort((a, b) => a.date.localeCompare(b.date)).at(-1);
  const today_ = todaySession(repo, today);

  // CFE の前回比（下がる＝改善なので、符号の意味をUIに渡す）
  const hist = cfe?.history ?? [];
  const cfeDelta =
    hist.length >= 2 ? hist[hist.length - 1].after - hist[0].after : undefined;

  // --- 改修A: ホーム再構成で必要になる派生値をここで用意する ---
  // UIに計算を持ち込まない（同じ数字が画面ごとに違う、という事故を防ぐ）。
  const allSessions = repo.listSessions();
  const resultsAll = trustedResults(repo);
  const resultBySession = new Map(resultsAll.map((r) => [r.sessionId, r]));

  // 今日のセッションの記録状況（TODAYの主アクションの出し分けに使う）
  const todayResult = today_.session ? resultBySession.get(today_.session.id) : undefined;
  const todayIsOff =
    !today_.session &&
    allSessions.some((s) => s.date === today && s.category === "off");

  // 前回ポイント練習からの経過（RECOVERY 副指標）
  const lastQuality = allSessions
    .filter((s) => isHighLoadSession(s) && s.date < today && s.status === "completed")
    .sort((a, b) => a.date.localeCompare(b.date))
    .at(-1);
  const daysSinceQuality = lastQuality ? diffDays(lastQuality.date, today) : undefined;

  // 故障ログの未回復件数（RECOVERY 副指標・新規表示）
  const openInjuries = repo
    .listInjuries()
    .filter((i) => i.status !== "recovered");

  // 当日・翌日のセッションに関する警告だけをTODAYに出す（A-3）。
  // 将来日の警告でホームを占有させない（現行の問題点3）。
  const tomorrow = addDays(today, 1);
  const todaySessionIds = new Set(
    allSessions.filter((s) => s.date === today || s.date === tomorrow).map((s) => s.id)
  );
  const todayViolations = violations.filter(
    (v) =>
      v.dates.some((dt) => dt === today || dt === tomorrow) ||
      v.sessionIds.some((id) => todaySessionIds.has(id))
  );

  /*
   * ホームの WEEKLY SUMMARY（距離・時間・強度）。
   *
   * 上の「UIに計算を持ち込まない」と同じ理由でここに置く。
   * 強度は既存の負荷定義（RPE×分。`loads` はACWRと同じ値）をそのまま合計する——
   * 画面用に別の強度を定義すると、分析画面のACWRと数字が食い違う。
   * 予定は数えず、実施したぶんだけを数える（`dailyLoads` と同じ扱い）。
   */
  const weekFrom = weekStart(today);
  const weekTo = addDays(weekFrom, 6);
  const weekTotals = (() => {
    let distanceKm = 0;
    let durationMin = 0;
    for (const s of allSessions) {
      if (s.date < weekFrom || s.date > weekTo) continue;
      const r = resultBySession.get(s.id);
      if (!r && s.status !== "completed") continue;
      distanceKm += r?.continuous?.distanceKm ?? s.distanceKm ?? 0;
      durationMin += r?.durationMin ?? s.durationMin ?? 0;
      /*
       * アップは主練習の一部だが、走った距離と時間としては実在する。
       * 主練習側に既に含まれていれば0が返るので、二重には足さない。
       */
      distanceKm += warmupAddedDistanceKm(r?.warmup);
      durationMin += warmupAddedDurationMin(r?.warmup);
    }
    let load = 0;
    for (let d = weekFrom; d <= weekTo; d = addDays(d, 1)) load += loads.get(d) ?? 0;
    return {
      distanceKm: Math.round(distanceKm * 10) / 10,
      durationMin: Math.round(durationMin),
      load: Math.round(load),
    };
  })();

  // 日付ごとの警告件数（カレンダーのバッジ用・C-2）
  const violationsByDate: Record<string, number> = {};
  for (const v of violations) {
    for (const dt of v.dates) violationsByDate[dt] = (violationsByDate[dt] ?? 0) + 1;
  }

  return {
    athlete,
    goal,
    cfe,
    cfeDelta,
    // H: 表示専用のレンジ。計算には使わない
    cfeRange: cfe ? cfeRange(cfe.estimated800mSec, cfe.confidence, cfeSpreadForDashboard(repo, today)) : undefined,
    racePlan: raceSplitPlanInternal(repo),
    todayResult,
    todayIsOff,
    daysSinceQuality,
    openInjuryCount: openInjuries.length,
    todayViolations,
    violationsByDate,
    diagnosis: diag,
    currentPhase: phase,
    signal: signal.signal,
    signalEscalated: signal.escalated,
    overallFatigue: latestCheck?.overallFatigue,
    todaySession: today_.session,
    /*
     * 2部練習の日にもう1本が画面から消えないようにする。
     *
     * `todaySession` は優先度のいちばん高い1本しか返さない。それだけを出していたので、
     * 午前ジョグ＋午後ポイントの日は片方がホームに出てこず、カレンダーを開かないと
     * 気づけなかった。主役（判断ゲート）は今までどおり1本のまま、
     * 同じ日の残りをここに添える。
     */
    todayOtherSessions: repo
      .listSessions(today, today)
      .filter(
        (s) =>
          s.id !== today_.session?.id && s.category !== "off" && s.status !== "skipped"
      )
      .sort((a, b) => (a.timeOfDay ?? "pm").localeCompare(b.timeOfDay ?? "pm")),
    readiness: today_.readiness,
    /*
     * 今日が「何の繰り返しの、どこ」なのか。
     *
     * N日周期と冬季ブロックは、決めたあと画面から見えなくなっていた。
     * 繰り返している構造が見えないと、周期にした意味（間隔を自分で決める）が
     * 本人にも分からない。理由まで出して、違うと思ったら設定を変えられるようにする。
     */
    todayStructure: todayStructure(repo, today, today_.session),
    aerobicProfile,
    ltRefreshHint: aerobicProfile.refreshHint,
    lastSync: repo.listSyncs(1)[0],
    injuries: repo.listInjuries(),
    daysToRace: targetRace ? diffDays(today, targetRace.dateStart) : undefined,
    weekTotals,
    weekSessions: repo.listSessions(weekStart(today), addDays(weekStart(today), 6)),
    weekStrengths: repo.listStrengths(weekStart(today), addDays(weekStart(today), 6)),
    violations,
    weeklySummary: summary,
    acwr: acwrNow,
    feasibility,
    targetRace,
    races: calendarRaces,
  };
}

// ---------------------------------------------------------------------------
// 過去データの遡り入力と現在地の再測定
// ---------------------------------------------------------------------------

/**
 * 過去データを1件登録する。
 *
 * ここで意図的にやらないこと: CFEの更新と未来セッションへの波及。
 * processResult（通常の結果記録）はこの2つを必ず行うが、過去データを
 * それに流すと、±1.5秒のガードレールが件数ぶん適用されてCFEが際限なく動き、
 * さらに過去日付を起点にした変更提案が大量に出る。
 * 過去データは「保存」と「負荷・LTへの反映」までにとどめ、
 * 現在地の算出は assessFitness で全件まとめて1回だけ行う。
 */
export function addPastEntry(repo: Store, entry: PastEntry): { entry: PastEntry } {
  repo.savePastEntry(entry);

  // ACWR（直近28日のうち14日以上のデータが必要）の下地として
  // 実施済みセッション＋結果に変換して保存する。
  const { session, result } = toSessionAndResult(entry);
  repo.saveSession(session);
  repo.saveResult(result);

  // ジョグ・持続走はLT推定の材料になる
  const marker = pastToMarker(entry);
  if (marker) repo.saveMarker(marker);

  return { entry };
}

export function deletePastEntry(repo: Store, id: string): void {
  repo.deletePastEntry(id);
  repo.deleteSession(`past-s-${id}`);
}

/** 過去データの作り直しをやったかどうかの印。作り直す内容を変えたら上げる */
const PAST_REBUILD_KEY = "migration:past-derived";
const PAST_REBUILD_VERSION = "structured-v1";

export interface PastRebuildResult {
  entries: number;
  rebuilt: number;
  /** 設定タイムが残っていない件数。M-2 の材料にはならない（本文から作り直せない） */
  withoutTarget: number;
}

/**
 * 保存済みの過去データから、セッションと結果を作り直す。
 *
 * `toSessionAndResult` は**取り込んだ瞬間にしか走らない**ので、
 * 変換の中身を直しても、すでに端末に入っているぶんは古いまま残る。
 * 実際、構造化記録（interval / continuous）を入れるようにした修正は、
 * 修正後に取り込んだデータにしか効いていなかった。
 *
 * 何度実行しても同じ結果になる（PastEntry が唯一の元データで、
 * `past-s-*` / `past-r-*` はそこから機械的に決まる）。
 * 実測値を書き換えることはない。
 *
 * ただし取り込み時に捨てられていた設定タイムは、ここでは戻せない。
 * 元の本文が残っていないので、作り直しても出どころが無い（推測で埋めない）。
 * 何件がその状態かを返して、画面から見えるようにする。
 */
export function rebuildPastDerived(repo: Store): PastRebuildResult {
  const entries = repo.listPastEntries();
  let rebuilt = 0;
  let withoutTarget = 0;

  for (const e of entries) {
    const { session, result } = toSessionAndResult(e);
    const before = repo.listResults().find((r) => r.id === result.id);
    const changed =
      !before ||
      (!!result.interval && !before.interval) ||
      (!!result.continuous && !before.continuous) ||
      before.interval?.targetSec !== result.interval?.targetSec;
    if (changed) {
      repo.saveSession(session);
      repo.saveResult(result);
      rebuilt++;
    }
    if (e.kind === "interval" && e.targetSec === undefined) withoutTarget++;
  }

  repo.saveKv(PAST_REBUILD_KEY, PAST_REBUILD_VERSION);
  return { entries: entries.length, rebuilt, withoutTarget };
}

/**
 * 初回表示のときに1度だけ作り直す。
 * 本人が「データ管理」を開くまで壊れたままなのは、直っていないのと同じなので自動で走らせる。
 * 実測値は動かさないため、確認は取らない（数値を書き換える変更とは性質が違う）。
 */
export function rebuildPastDerivedOnce(repo: Store): PastRebuildResult | undefined {
  if (repo.getKv<string>(PAST_REBUILD_KEY) === PAST_REBUILD_VERSION) return undefined;
  return rebuildPastDerived(repo);
}

// ---------------------------------------------------------------------------
// FIT取込: 元ファイル・自動解析・手動修正・結果確認の信頼層を分離して保存
// ---------------------------------------------------------------------------

export interface ImportFitFileInput {
  fileName: string;
  /** 元ファイルの生バイト列（base64） */
  rawBytesBase64: string;
  parse: FitParseResult;
  autoClassification: IntervalClassifyResult;
  /** 本人が画面上で直した後の最終的な種別（lap配列と同じ並び） */
  confirmedKinds: IntervalKind[];
  /**
   * FIT取込 Phase 6: 計画済みセッションへの紐付け。
   * 省略時（1回目の呼び出し）は確認要否だけを判定して返す。
   * 文字列 = そのセッションIDへ紐付ける。null = 紐付けず新規のbackfilled記録にする。
   */
  linkToSessionId?: string | null;
  /** 指定された場合だけ、同じ操作内で本人確認まで完了する。 */
  resultConfirmation?: FitResultConfirmationInput;
}

export interface FitResultConfirmationInput {
  category: SessionCategory;
  rpe: number;
  achievement: SessionResult["achievement"];
  subjective: SessionResult["subjective"];
}

export interface ConfirmFitImportInput extends FitResultConfirmationInput {
  fitImportId: string;
}

export interface FitPlannedCandidate {
  id: string;
  name: string;
  prescription: string;
  category: SessionCategory;
}

/** 計画済みセッションが見つかったので、紐付けるかどうかを本人に確認してほしいという応答 */
export interface ImportFitFileNeedsConfirmation {
  needsConfirmation: true;
  date: string;
  candidates: FitPlannedCandidate[];
}

export interface ImportFitFileOutput {
  needsConfirmation?: false;
  record: FitImportRecord;
  session: Session;
  result: SessionResult;
  warnings: string[];
  /** 同じ元ファイル（生バイト列が完全一致）が既に取り込まれていた場合 true。新規登録ではなく上書き */
  duplicate: boolean;
  /** 既存の計画済みセッションへ紐付けたか（true）、新規のbackfilled記録か（false） */
  linked: boolean;
  /** 紐付けた場合のみ。CFE更新・ルール違反など、通常の記録経路と同じ結果 */
  processResult?: ProcessResultOutput;
}

/** 元FITと解析は保存したが、主観情報がまだ本人確認されていない状態。 */
export interface ImportFitFilePendingResult {
  needsResultConfirmation: true;
  record: FitImportRecord;
  date: string;
  suggestedCategory: SessionCategory;
  warnings: string[];
  duplicate: boolean;
  linked: boolean;
}

export interface PendingFitImportSummary {
  id: string;
  fileName: string;
  date?: string;
  suggestedCategory?: SessionCategory;
  linked: boolean;
  error?: string;
}

export type ImportFitFileResult =
  | ImportFitFileNeedsConfirmation
  | ImportFitFilePendingResult
  | ImportFitFileOutput;

const FIT_CONFIRMABLE_CATEGORIES = new Set<SessionCategory>([
  "high_lactate",
  "race_economy",
  "modeling",
  "neural",
  "cv",
  "threshold",
  "aerobic",
]);

function confirmedFitResult(
  input: FitResultConfirmationInput,
  confirmedAtUtc = new Date().toISOString()
): Extract<FitResultConfirmation, { status: "confirmed" }> {
  if (!FIT_CONFIRMABLE_CATEGORIES.has(input.category)) {
    throw new Error("FIT記録の練習カテゴリを確認してください");
  }
  if (!Number.isFinite(input.rpe) || input.rpe < 1 || input.rpe > 10) {
    throw new Error("RPEは1〜10で入力してください");
  }
  if (!["achieved", "partial", "failed"].includes(input.achievement)) {
    throw new Error("達成状態を確認してください");
  }
  if (!["easy", "moderate", "hard", "very_hard"].includes(input.subjective)) {
    throw new Error("主観強度を確認してください");
  }
  return {
    status: "confirmed",
    confirmedAtUtc,
    category: input.category,
    rpe: input.rpe,
    achievement: input.achievement,
    subjective: input.subjective,
  };
}

function linkedSessionIdOf(record: FitImportRecord): string | null {
  if (record.linkToSessionId !== undefined) return record.linkToSessionId;
  if (!record.sessionId || record.sessionId === `fit-s-${record.id}`) return null;
  return record.sessionId;
}

/**
 * 本人未確認のFIT由来結果を、能力・負荷・完遂率の材料から外す。
 *
 * 旧形式には確認状態が無いため安全側で未確認とする。結果そのものは削除せず、
 * 元FITと一緒に保持する。過去にCFEへ入ってしまった寄与だけはsessionIdを使って
 * 取り消し、本人確認時のprocessResultで正しい値を入れ直す。
 */
/**
 * カテゴリを問わない最後の記録日。CFEの鈍化（`applyStaleness`）の基準に使う。
 *
 * CVや閾値はCFEを更新できない（800m相当への換算比率が無い）ので、
 * 「CFEが動いた日」を基準にすると、記録を入れているのに鈍化だけが進む。
 * 練習しているかどうかは、CFEが動いたかではなく記録があるかで見る。
 */
function lastRecordedDate(repo: Store): string | undefined {
  let latest: string | undefined;
  for (const r of trustedResults(repo)) {
    if (!latest || r.date > latest) latest = r.date;
  }
  for (const s of repo.listStrengths()) {
    if (!latest || s.date > latest) latest = s.date;
  }
  return latest;
}

export function trustedResults(repo: Store): SessionResult[] {
  const pending = repo.listFitImports().filter((record) => !isFitResultConfirmed(record));
  if (pending.length === 0) return repo.listResults();

  const excludedResultIds = new Set<string>();
  const excludedSessionIds = new Set<string>();
  for (const record of pending) {
    if (record.resultId) excludedResultIds.add(record.resultId);
    if (record.sessionId) {
      excludedSessionIds.add(record.sessionId);
      const stored = repo.resultForSession(record.sessionId);
      if (stored) excludedResultIds.add(stored.id);
    }
  }

  const currentCfe = repo.getCfe();
  if (currentCfe) {
    let repaired = currentCfe;
    for (const sessionId of excludedSessionIds) {
      repaired = revertCfeForSession(repaired, sessionId);
    }
    if (
      repaired.estimated800mSec !== currentCfe.estimated800mSec ||
      repaired.history.length !== currentCfe.history.length
    ) {
      repo.saveCfe(repaired);
    }
  }

  return repo
    .listResults()
    .filter(
      (result) =>
        !excludedResultIds.has(result.id) && !excludedSessionIds.has(result.sessionId)
    );
}

/**
 * FIT本体・解析・区間分類を保存し、本人確認値が渡された場合だけ正式結果を登録する。
 *
 * FIT取込 Phase 6: 計画済みセッションとの紐付け。
 * 導出した日付に`status: "planned"`のセッションがあれば、`linkToSessionId`を
 * 指定せずに呼んだ1回目はいったん保存せず`needsConfirmation`を返す。
 * 呼び出し側（画面）が本人に確認し、選んだ結果を`linkToSessionId`に入れて
 * もう一度呼ぶ。
 *
 * - 紐付ける場合: `processResult`（通常の記録経路）にそのまま渡す。
 *   手入力で記録した場合と同じくCFE更新・ルールエンジンが働く——
 *   「今日やる予定だった練習を、手入力の代わりにFITで正確に記録する」ことと
 *   同じだから。計画とFITの実測内容（インターバルかジョグか等）が食い違って
 *   いても検知しない（通常の手入力経路も同様に検知していないため、
 *   ここだけ新しく厳しくしない）。
 * - 紐付けない場合（計画が無い、または本人が「新しい記録として登録する」を
 *   選んだ場合）: 従来通り`backfilled: true`の新規セッションを作る。
 *   ルールエンジンの評価対象・自動生成の上書き対象からは外れる
 *   （過去データの遡り入力と同じ扱い）。
 *
 * 元ファイル・自動解析は本人確認より先に保存する。正式結果の保存だけ失敗しても
 * 再入力を求めないためで、Session/SessionResult側はトランザクションで保護する。
 *
 * FIT取込 Phase 5: 二重登録防止。生バイト列（元ファイル）が既存の取込と
 * 完全一致すれば、そのときのidをそのまま再利用する。`saveFitImport` /
 * `saveSession` / `saveResult` はどれも同じidへのINSERT...ON CONFLICT DO UPDATE
 * （またはIndexedDBでの同id上書き）なので、同じファイルの再登録は新規の
 * 二重登録ではなく上書きになる——一括入力（`pe-bulk-*`）やApple Health
 * （`ah-*`）が内容から決まるidで自然に二重登録を防いでいるのと同じ考え方。
 * 完全一致以外（同じ活動を別の書き出しで得たファイル等）は別記録として扱う
 * （推測で「同じ活動だろう」と判定しない）。
 */
export function importFitFile(repo: Store, input: ImportFitFileInput): ImportFitFileResult {
  const cfe = repo.getCfe();
  const derived = deriveFitActuals({
    parse: input.parse,
    confirmedKinds: input.confirmedKinds,
    grpSecPerM: cfe ? cfe.estimated800mSec / 800 : undefined,
  });

  if (input.linkToSessionId === undefined) {
    const planned = repo
      .listSessions(derived.date, derived.date)
      .filter((s) => s.status === "planned");
    if (planned.length > 0) {
      return {
        needsConfirmation: true,
        date: derived.date,
        candidates: planned.map((s) => ({
          id: s.id,
          name: s.name,
          prescription: s.prescription,
          category: s.category,
        })),
      };
    }
  }

  const existing = repo
    .listFitImports()
    .find((r) => r.rawBytesBase64 === input.rawBytesBase64);
  // Date.now()だけだと、短時間に別ファイルを続けて取り込んだ場合にミリ秒が
  // 衝突しうる（衝突すると全く別の記録を上書きしてしまう）。二重登録防止の
  // 前提が崩れるため、乱数を足して衝突を避ける。
  const id = existing?.id ?? `fit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const selectedLink =
    input.linkToSessionId !== undefined
      ? input.linkToSessionId
      : existing
      ? linkedSessionIdOf(existing)
      : null;

  /*
   * 同じ確認済みFITをもう一度選んだだけなら、正式結果を再処理しない。
   * processResultを再実行するとCFE履歴を無用に作り直すため。
   */
  if (existing && isFitResultConfirmed(existing) && !input.resultConfirmation) {
    const session = existing.sessionId ? repo.getSession(existing.sessionId) : undefined;
    const result = existing.sessionId ? repo.resultForSession(existing.sessionId) : undefined;
    if (!session || !result) {
      throw new Error("確認済みFITの記録が見つかりません。データ管理から作り直してください");
    }
    return {
      record: existing,
      session,
      result,
      warnings: derived.warnings,
      duplicate: true,
      linked: linkedSessionIdOf(existing) !== null,
    };
  }

  // 主観情報はまだ受け取っていない。元FIT・解析・区間分類だけを先に保存する。
  const record: FitImportRecord = {
    ...existing,
    id,
    importedAtUtc: existing?.importedAtUtc ?? new Date().toISOString(),
    fileName: input.fileName,
    rawBytesBase64: input.rawBytesBase64,
    parse: input.parse,
    autoClassification: input.autoClassification,
    confirmedKinds: input.confirmedKinds,
    resultConfirmation: { status: "pending" },
    linkToSessionId: selectedLink,
  };
  repo.saveFitImport(record);

  if (input.resultConfirmation) {
    const confirmed = confirmFitImport(repo, {
      fitImportId: id,
      ...input.resultConfirmation,
    });
    return { ...confirmed, duplicate: existing !== undefined };
  }

  return {
    needsResultConfirmation: true,
    record,
    date: derived.date,
    suggestedCategory: derived.category,
    warnings: derived.warnings,
    duplicate: existing !== undefined,
    linked: selectedLink !== null,
  };
}

/** 本人入力を受け取って初めて正式なSessionResultを作る。 */
export function confirmFitImport(
  repo: Store,
  input: ConfirmFitImportInput
): ImportFitFileOutput {
  const record = repo.listFitImports().find((r) => r.id === input.fitImportId);
  if (!record) throw new Error("確認するFIT取込が見つかりません");
  const confirmation = confirmedFitResult(input);
  const cfe = repo.getCfe();
  const derived = deriveFitActuals({
    parse: record.parse,
    confirmedKinds: record.confirmedKinds,
    grpSecPerM: cfe ? cfe.estimated800mSec / 800 : undefined,
  });
  const confirmedDerived = { ...derived, category: confirmation.category };
  const linkToSessionId = linkedSessionIdOf(record);

  if (linkToSessionId) {
    const target = repo.getSession(linkToSessionId);
    if (!target) throw new Error("紐付け先のセッションが見つかりません");
    const result = buildLinkedResult(
      confirmedDerived,
      target.id,
      record.resultId ?? `fit-r-${record.id}`,
      record.fileName,
      confirmation
    );
    const { processOutput, savedRecord } = repo.transaction(() => {
      // 本人が確認した実際のカテゴリを評価元にする。予定時のカテゴリのままだと、
      // RPEは正しくてもCFE・負荷分類だけが別種目として処理されてしまう。
      if (target.category !== confirmation.category) {
        repo.saveSession({ ...target, category: confirmation.category });
      }
      const processOutput = processResultCore(repo, result);
      const savedResult = repo.resultForSession(target.id)!;
      const savedRecord: FitImportRecord = {
        ...record,
        resultConfirmation: confirmation,
        linkToSessionId: target.id,
        sessionId: target.id,
        resultId: savedResult.id,
      };
      repo.saveFitImport(savedRecord);
      return { processOutput, savedRecord };
    });
    return {
      record: savedRecord,
      session: repo.getSession(target.id)!,
      result: repo.resultForSession(target.id)!,
      warnings: derived.warnings,
      duplicate: isFitResultConfirmed(record),
      linked: true,
      processResult: processOutput,
    };
  }

  const { session, result } = buildBackfilledSessionAndResult(
    confirmedDerived,
    record.id,
    record.fileName,
    confirmation
  );
  const savedRecord: FitImportRecord = {
    ...record,
    resultConfirmation: confirmation,
    linkToSessionId: null,
    sessionId: session.id,
    resultId: result.id,
  };
  repo.transaction(() => {
    repo.saveFitImport(savedRecord);
    repo.saveSession(session);
    repo.saveResult(result);
  });
  return {
    record: savedRecord,
    session,
    result,
    warnings: derived.warnings,
    duplicate: isFitResultConfirmed(record),
    linked: false,
  };
}

export function pendingFitImportSummaries(repo: Store): PendingFitImportSummary[] {
  const cfe = repo.getCfe();
  return repo
    .listFitImports()
    .filter((record) => !isFitResultConfirmed(record))
    .map((record) => {
      try {
        const derived = deriveFitActuals({
          parse: record.parse,
          confirmedKinds: record.confirmedKinds,
          grpSecPerM: cfe ? cfe.estimated800mSec / 800 : undefined,
        });
        return {
          id: record.id,
          fileName: record.fileName,
          date: derived.date,
          suggestedCategory: derived.category,
          linked: linkedSessionIdOf(record) !== null,
        };
      } catch (error) {
        return {
          id: record.id,
          fileName: record.fileName,
          linked: linkedSessionIdOf(record) !== null,
          error: (error as Error).message,
        };
      }
    });
}

/**
 * 保存済みのFIT取込から、セッションと結果を作り直す。
 *
 * `rebuildPastDerived`（過去データ）と同じ理由: `fitToSessionAndResult` は
 * 取り込んだ瞬間にしか走らないので、変換ロジックを直しても既存の取込ぶんには
 * 反映されない。`FitImportRecord`（元ファイル＋自動解析＋確認済み種別）が
 * 唯一の元データで、`fit-s-*`/`fit-r-*` はそこから機械的に決まる。
 */
/**
 * 統合監査で発覚: 紐付け済み（Phase 6でplanned セッションへ紐付けた）FIT取込を
 * 単純に`fitToSessionAndResult`で作り直すと、常に新規backfilledセッション
 * （`fit-s-${record.id}`）を作ってしまい、元の計画済みセッションから
 * 結果が外れて孤立したセッションが増える。`record.sessionId`が
 * `fit-s-${record.id}`と一致するか（＝backfilledとして作られたか）で
 * 分岐し、紐付け済みなら同じ経路（`buildLinkedResult` + `processResult`）で
 * 作り直す。紐付け先が消えていた場合は新規作成に化けさせず、件数だけ報告する。
 */
export function rebuildFitDerived(
  repo: Store
): { imports: number; rebuilt: number; orphaned: number; unconfirmed: number } {
  const imports = repo.listFitImports();
  const cfe = repo.getCfe();
  const grpSecPerM = cfe ? cfe.estimated800mSec / 800 : undefined;
  let rebuilt = 0;
  let orphaned = 0;
  let unconfirmed = 0;
  for (const record of imports) {
    if (!isFitResultConfirmed(record)) {
      // 旧形式も確認済みと推測しない。元FITは残し、本人確認後にだけ再構築する。
      unconfirmed++;
      continue;
    }
    const confirmation = record.resultConfirmation;
    const linkedSessionId = linkedSessionIdOf(record);
    const wasBackfilled = linkedSessionId === null;
    if (!wasBackfilled) {
      const target = repo.getSession(linkedSessionId);
      if (!target) {
        orphaned++;
        continue;
      }
      const derived = deriveFitActuals({
        parse: record.parse,
        confirmedKinds: record.confirmedKinds,
        grpSecPerM,
      });
      const result = buildLinkedResult(
        { ...derived, category: confirmation.category },
        target.id,
        record.resultId ?? `fit-r-${record.id}`,
        record.fileName,
        confirmation
      );
      if (target.category !== confirmation.category) {
        repo.saveSession({ ...target, category: confirmation.category });
      }
      processResult(repo, result);
      rebuilt++;
      continue;
    }
    const { session, result } = fitToSessionAndResult({
      sourceId: record.id,
      fileName: record.fileName,
      parse: record.parse,
      confirmedKinds: record.confirmedKinds,
      grpSecPerM,
      resultConfirmation: confirmation,
    });
    repo.saveSession(session);
    repo.saveResult(result);
    rebuilt++;
  }
  return { imports: imports.length, rebuilt, orphaned, unconfirmed };
}

export interface AssessFitnessOutput extends FitnessAssessment {
  currentCfeSec?: number;
  /** 過去データだけを対象にしたルール診断（過去の練習構成の問題点） */
  pastStructureIssues: RuleViolation[];
  entryCount: number;
}

/**
 * 登録済みの過去データ全件から現在地を1回だけ算出する（適用はしない）。
 */
/**
 * 記録タブで入れた結果を、現在地の測定が読める形（PastEntry）に直す。
 *
 * これが無かったときは `listPastEntries()` だけを見ていたため、
 * **同じ高乳酸のセッションでも、過去データ画面から入れたか記録タブから入れたかで
 * 現在地の測定に入るかどうかが変わっていた。**
 * 実機では過去データが7/26までしか無く、それ以降は記録タブに入れていたので、
 * 直近3週間ぶんが測定の材料から丸ごと落ちていた。
 *
 * 過去データ由来の結果（`past-s-*`）は除く。`addPastEntry` が
 * PastEntry と SessionResult の両方を作るので、入れると同じ練習を二重に数える。
 */
function resultsAsPastEntries(repo: Store): PastEntry[] {
  const sessions = new Map(repo.listSessions().map((s) => [s.id, s]));
  const out: PastEntry[] = [];
  for (const r of trustedResults(repo)) {
    if (r.sessionId.startsWith("past-s-")) continue;
    const session = sessions.get(r.sessionId);
    if (!session) continue;
    if (r.actualLapsSec.length === 0) continue;

    /*
     * 距離が混ざっている本は、いちばん本数の多い距離だけを使う。
     * `updateCfeFromResult` と同じ規則（190秒と30秒を平均すると換算が壊れる）。
     * 片方を直したらもう片方も確認すること。
     */
    const dists =
      r.lapDistancesM ??
      (session.targetPaces[0]
        ? r.actualLapsSec.map(() => session.targetPaces[0].distanceM)
        : undefined);
    let repDistanceM: number | undefined;
    let repTimesSec = r.actualLapsSec;
    if (dists && dists.length > 0) {
      const counts = new Map<number, number>();
      for (const d of dists) counts.set(d, (counts.get(d) ?? 0) + 1);
      repDistanceM = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
      repTimesSec = r.actualLapsSec.filter((_, i) => dists[i] === repDistanceM);
    }
    if (!repDistanceM) continue;

    out.push({
      id: `res-${r.id}`,
      date: r.date,
      kind: "interval",
      category: session.category,
      repDistanceM,
      repTimesSec,
      reps: repTimesSec.length,
      rpe: r.rpe,
      restType: r.interval?.restType,
      restSec: r.interval?.restSec,
      // 暑熱下の実測を除外できるように環境も引き継ぐ（SessionResult側は weatherTempC）
      tempC: r.weatherTempC,
      humidityPct: r.humidityPct,
    } as PastEntry);
  }
  return out;
}

export function assessFitness(repo: Store, today: string): AssessFitnessOutput {
  const athlete = repo.getAthlete();
  if (!athlete) throw new Error("選手プロフィールが未登録です");
  const entries = repo.listPastEntries();
  // 記録タブに入れたものも同じ材料として扱う（入れた画面で結果が変わってはいけない）
  const all = [...entries, ...resultsAsPastEntries(repo)];
  const cfe = repo.getCfe();
  const assessment = assessCurrentFitness(all, athlete, today, {
    currentCfeSec: cfe?.estimated800mSec,
  });

  return {
    ...assessment,
    currentCfeSec: cfe?.estimated800mSec,
    pastStructureIssues: diagnosePastStructure(repo, today),
    entryCount: all.length,
  };
}

/**
 * 過去の練習構成そのものをルールエンジンにかける。
 *
 * 現在地の把握には「今どれくらい走れるか」だけでなく
 * 「どういう積み方をしてきたか」も要る。高乳酸が週2回入っていた、
 * 質練習が連日だった、といった構造上の問題は不振の原因になり得るので、
 * プランの違反とは別枠で見せる。
 */
export function diagnosePastStructure(repo: Store, today: string): RuleViolation[] {
  const backfilled = repo.listSessions().filter((s) => s.backfilled);
  if (backfilled.length === 0) return [];
  const base = buildRuleContext(repo, today);
  return runRuleEngine({
    ...base,
    sessions: backfilled,
    // 過去の構成診断では、これから組むプランを対象にしたルール
    // （テーパー・レース前後）は意味がないので races/goal を外す
    races: [],
    goal: undefined,
  }).filter((v) => v.level !== "INFO");
}

/**
 * 算出した現在地をCFEへ反映する（本人の承認後に呼ぶ）。
 * 逐次更新のガードレールは通さず、履歴に根拠を残して一度で置き換える。
 */
export function applyAssessedCfe(
  repo: Store,
  today: string
): { before?: number; after: number; changes: SessionChange[] } {
  const a = assessFitness(repo, today);
  if (a.estimated800mSec === undefined) {
    throw new Error("現在地を推定できる実測がありません");
  }
  const cur = repo.getCfe();
  const before = cur?.estimated800mSec;
  const after = a.estimated800mSec;
  repo.saveCfe({
    estimated800mSec: after,
    confidence: a.confidence,
    lastUpdated: today,
    history: [
      ...(cur?.history ?? []),
      {
        date: today,
        before: before ?? after,
        after,
        source: `過去データ${a.samples.length}件からの再測定（${a.samples
          .slice(0, 3)
          .map((s) => `${s.date} ${s.label}`)
          .join(" / ")}${a.samples.length > 3 ? " ほか" : ""}）`,
      },
    ],
  });

  // CFEが変わればすべての設定ペースが変わる
  const changes = refreshNearHorizon(repo, today);
  return { before, after, changes };
}


// ---------------------------------------------------------------------------
// D-3「前回と同じ」
// ---------------------------------------------------------------------------

/**
 * 指定セッションと同じカテゴリの、直近の記録を返す。
 * 呼び出し側（記録フォーム）はこれを初期値として読み込み、
 * どこから読んだかを必ず画面に出す。
 */
export function previousEntryFor(
  repo: Store,
  sessionId: string
): PreviousEntry | undefined {
  const session = repo.getSession(sessionId);
  if (!session) return undefined;
  return findPreviousEntry(
    repo.listSessions(),
    trustedResults(repo),
    session.category,
    session.date,
    session.id
  );
}


// ---------------------------------------------------------------------------
// F-2 一括入力
// ---------------------------------------------------------------------------

/** 解釈済みの1行を PastEntry に変換する（登録は呼び出し側で行う） */
export function rowToPastEntry(row: ParsedRow, index: number): PastEntry | undefined {
  if (!row.date || !row.kind) return undefined;
  const base: PastEntry = {
    id: `pe-bulk-${row.date}-${index}`,
    date: row.date,
    kind: row.kind,
    avgHr: row.avgHr,
    note: [row.note, row.supplementNote].filter(Boolean).join(" ／ ") || undefined,
  };
  if (row.kind === "race" || row.kind === "timetrial") {
    return {
      ...base,
      distanceM: row.raceDistanceM,
      timeSec: row.raceTimeSec,
      // 区間ラップを落とさない。これがレース配分シミュレータの唯一の材料で、
      // 落とすと「ラップが足りません」と言われ続けることになる
      lapsSec: row.lapsSec,
      lapDistanceM:
        row.lapsSec && row.raceDistanceM
          ? Math.round(row.raceDistanceM / row.lapsSec.length)
          : undefined,
    };
  }
  if (row.kind === "interval") {
    return {
      ...base,
      category: row.category,
      repDistanceM: row.repDistanceM,
      reps: row.reps,
      repTimesSec: row.repTimesSec,
      // 設定タイムとレストを落とさない。落とすと結果に「設定に対してどうだったか」が
      // 残らず、週次レビュー・同一処方の比較・M-2の判断材料すべてから外れる
      targetSec: row.targetSec,
      restSec: row.restSec,
      restDistanceM: row.restDistanceM,
      restType: row.restType,
    };
  }
  if (row.kind === "off") return base;
  if (row.kind === "strength") return base;
  return {
    ...base,
    distanceKm: row.distanceKm,
    // 0.1分（6秒）まで丸める。1840秒を割った 30.666666666666668 のような値を
    // そのまま保存すると、一覧にもバックアップJSONにも出てしまう
    durationMin:
      row.durationSec !== undefined ? Math.round((row.durationSec / 60) * 10) / 10 : undefined,
  };
}

export interface BulkImportResult {
  imported: number;
  skipped: number;
  entries: PastEntry[];
  /** そのうち補強として StrengthSession に入れた件数 */
  strengthCount: number;
}

/**
 * 解釈済みの行をまとめて登録する。
 *
 * ready でない行は登録しない。「とりあえず入れておく」を許すと、
 * 推測混じりのデータが CFE と ACWR に流れて、あとから切り分けられなくなる。
 */
export function importBulkRows(
  repo: Store,
  rows: ParsedRow[]
): BulkImportResult {
  const entries: PastEntry[] = [];
  const athlete = repo.getAthlete();
  let skipped = 0;
  let strengthCount = 0;

  rows.forEach((row, i) => {
    if (!computeReady(row)) {
      skipped++;
      return;
    }

    // 補強は SessionCategory を増やさず、既存の StrengthSession へ流す。
    // 走練習と同じ経路に入れると ACWR で二重計上される。
    if (row.kind === "strength") {
      repo.saveStrength({
        id: `past-st-${row.date}-${i}`,
        date: row.date!,
        timeOfDay: "pm",
        type: row.strengthType ?? "strength",
        loadLevel: "moderate",
        exercises: row.note ? [row.note] : [],
        durationMin: row.durationSec !== undefined ? Math.round(row.durationSec / 60) : undefined,
        contactCount: row.contactCount,
        status: "completed",
        note: "過去データの一括入力",
      });
      strengthCount++;
      return;
    }

    const e = rowToPastEntry(row, i);
    if (!e) {
      skipped++;
      return;
    }
    // 保存直前にもう一度検査する（画面で編集された値が入ってくるため）
    if (hasBlockingIssue(checkPastEntry(e, athlete))) {
      skipped++;
      return;
    }
    addPastEntry(repo, e);
    entries.push(e);
  });
  return { imported: entries.length + strengthCount, skipped, entries, strengthCount };
}

/**
 * テキストを解釈して返すだけ（保存しない）。プレビュー用。
 *
 * 現在のCFEからGRP（秒/m）を作って渡す。
 * 「1000(3:15-25)×4」の設定タイムがGRPの何%かでカテゴリが決まるので、
 * これがあるかどうかで「未確定」の数が大きく変わる。
 */
export function previewBulkText(repo: Store, text: string, today: string): ParsedRow[] {
  const cfe = repo.getCfe();
  const athlete = repo.getAthlete();
  const rows = parseBulkText(text, today, {
    grpSecPerM: cfe ? cfe.estimated800mSec / 800 : undefined,
    phrases: repo.listPhrases(),
  });
  // 読めてしまった間違いを検査する。読めなかったものより危ない
  return rows.map((row) => {
    const entry = rowToPastEntry(row, 0);
    if (!entry) return row;
    const issues = checkPastEntry(entry, athlete);
    if (issues.length === 0) return row;
    return {
      ...row,
      issues: [...row.issues, ...issues.map((i) => `${i.severity === "error" ? "要確認" : "注意"}: ${i.message}`)],
      ready: row.ready && !hasBlockingIssue(issues),
    };
  });
}

/** 表記辞書 */
export function listPhrases(repo: Store): PhraseRule[] {
  return repo.listPhrases();
}
export function savePhrase(repo: Store, p: PhraseRule): void {
  repo.savePhrase(p);
}
export function deletePhrase(repo: Store, id: string): void {
  repo.deletePhrase(id);
}


// ---------------------------------------------------------------------------
// G / H / I
// ---------------------------------------------------------------------------

/** dashboard から使う内部ヘルパー（循環を避けるため下で定義したものを使う） */
function cfeSpreadForDashboard(repo: Store, today: string): number {
  const athlete = repo.getAthlete();
  if (!athlete) return 0;
  return spreadOf(assessCurrentFitness(repo.listPastEntries(), athlete, today));
}
function raceSplitPlanInternal(repo: Store) {
  return raceSplitPlan(repo);
}

/** G: 同一処方の経時比較 */
/**
 * 分析画面 PERFORMANCE の期間集計。WEEK/MONTH/YEAR の3つをまとめて返す。
 * 画面側で期間を切り替えるたびに取り直さなくて済むようにする（3つとも軽い）。
 */
export function performanceSummaries(repo: Store, today: string) {
  const sessions = repo.listSessions();
  const resultsBySessionId = new Map(trustedResults(repo).map((r) => [r.sessionId, r]));
  const kinds: PeriodKind[] = ["week", "month", "year"];
  return kinds.map((kind) =>
    periodSummary({ sessions, resultsBySessionId, today, kind })
  );
}

export function samePrescriptionGroups(repo: Store) {
  return groupBySamePrescription(repo.listSessions(), trustedResults(repo));
}

/** H: CFEの予測レンジ（表示専用） */
export function cfeRangeFor(repo: Store, today: string) {
  const cfe = repo.getCfe();
  if (!cfe) return undefined;
  const athlete = repo.getAthlete();
  let spread = 0;
  if (athlete) {
    const a = assessCurrentFitness(repo.listPastEntries(), athlete, today);
    spread = spreadOf(a);
  }
  return cfeRange(cfe.estimated800mSec, cfe.confidence, spread);
}

/** I: レース配分。過去データのレース区間ラップを材料にする */
export function raceSplitPlan(repo: Store) {
  const goal = repo.getGoal();
  if (!goal) return undefined;
  const samples: RaceLapSample[] = repo
    .listPastEntries()
    .filter(
      (e) =>
        (e.kind === "race" || e.kind === "timetrial") &&
        e.distanceM === 800 &&
        (e.lapsSec?.length ?? 0) >= 2
    )
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((e) => ({ date: e.date, distanceM: e.distanceM!, lapsSec: e.lapsSec! }));
  return planRaceSplits(goal.targetTimeSec, samples);
}

// ---------------------------------------------------------------------------
// M-5 予定の編集・移動
// ---------------------------------------------------------------------------

export interface PlanEditResult {
  ok: boolean;
  error?: string;
  applied: boolean;
  /** この変更で新しく出た違反だけ。元からある違反を並べても判断できない */
  newViolations: RuleViolation[];
  /** 変更後の全違反 */
  violations: RuleViolation[];
  /** 違反が出るとき、代わりに置ける日 */
  alternatives: { date: string; note: string }[];
  session?: Session;
  message?: string;
  volumeChanges?: Omit<VolumeProgressionChange, "next">[];
  volumeWindowDays?: number;
}

function violationKey(v: RuleViolation): string {
  return `${v.rule}|${v.level}|${v.dates.join(",")}|${v.message}`;
}

/**
 * セッションを差し替えた状態でルールを評価し、必ず元に戻す。
 *
 * 「動かせるようにする」だけでは足りない。高乳酸を前倒ししたら間隔が4日になった、
 * ということが普通に起きる。動かした瞬間に何が壊れるかを出さないと、
 * 自由に動かせることがそのまま質の低下になる。
 */
function evaluateWith(
  repo: Store,
  sessionId: string,
  next: Session | undefined,
  today: string
): RuleViolation[] {
  const original = repo.getSession(sessionId);
  try {
    if (next) repo.saveSession(next);
    else repo.deleteSession(sessionId);
    return runRuleEngine(buildRuleContext(repo, today));
  } finally {
    if (original) repo.saveSession(original);
    else if (next) repo.deleteSession(sessionId);
  }
}

/** 移動先の候補を探す。前後7日で、新しいERROR級の違反が出ない日 */
function findAlternatives(
  repo: Store,
  session: Session,
  baseKeys: Set<string>,
  today: string,
  limit = 3
): { date: string; note: string }[] {
  const out: { date: string; note: string }[] = [];
  const occupied = new Set(
    repo
      .listSessions()
      .filter((s) => s.id !== session.id && isHighLoadSession(s))
      .map((s) => s.date)
  );
  const offsets = [1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6, 7, -7];
  for (const off of offsets) {
    const date = addDays(session.date, off);
    if (date < today) continue;
    if (occupied.has(date)) continue;
    const vs = evaluateWith(repo, session.id, { ...session, date }, today);
    const added = vs.filter((v) => v.level === "ERROR" && !baseKeys.has(violationKey(v)));
    if (added.length === 0) {
      out.push({
        date,
        note: `${off > 0 ? `${off}日後` : `${-off}日前`}。ここならERROR級の違反は出ません`,
      });
      if (out.length >= limit) break;
    }
  }
  return out;
}

/**
 * 予定の変更（内容・日付）。
 *
 * force を付けない限り、新しくERROR級の違反が出る変更は適用しない。
 * force を付けた場合は適用するが、強行したことを変更履歴に残す。
 */
export function editSession(
  repo: Store,
  sessionId: string,
  updates: Partial<Session>,
  today: string,
  opts: { force?: boolean; dryRun?: boolean } = {}
): PlanEditResult {
  const session = repo.getSession(sessionId);
  if (!session) {
    return { ok: false, error: "セッションが見つかりません", applied: false, newViolations: [], violations: [], alternatives: [] };
  }
  if (session.isFixed) {
    return {
      ok: false,
      error: "固定セッション（チーム練習等）は変更できません（RULE-15）。前後の自由枠を組み替えてください。",
      applied: false,
      newViolations: [],
      violations: [],
      alternatives: [],
    };
  }

  const base = runRuleEngine(buildRuleContext(repo, today));
  const baseKeys = new Set(base.map(violationKey));
  const next: Session = {
    ...session,
    ...updates,
    id: session.id,
    status: "modified",
    userEdited: true,
  };
  // 対象6: 物理的にありえない設定ペースは、ルール判定・forceより前に弾く
  if (updates.targetPaces) {
    const plausibility = checkSessionPlausibility(next);
    if (hasBlockingIssue(plausibility)) {
      return {
        ok: false,
        error: plausibility.find((i) => i.severity === "error")!.message,
        applied: false,
        newViolations: [],
        violations: [],
        alternatives: [],
      };
    }
  }
  const after = evaluateWith(repo, sessionId, next, today);
  const newViolations = after.filter((v) => !baseKeys.has(violationKey(v)));
  const hasError = newViolations.some((v) => v.level === "ERROR");

  const alternatives =
    hasError && updates.date ? findAlternatives(repo, next, baseKeys, today) : [];

  if (opts.dryRun || (hasError && !opts.force)) {
    return {
      ok: !hasError,
      applied: false,
      newViolations,
      violations: after,
      alternatives,
      session: next,
      error: hasError && !opts.dryRun ? "この変更はルールに反します。内容を確認してください" : undefined,
    };
  }

  repo.saveSession(next);
  if (updates.date && updates.date !== session.date) {
    repo.logChange(
      {
        sessionId,
        field: "date",
        before: session.date,
        after: updates.date,
        reason: hasError
          ? `本人の判断で変更（警告あり: ${newViolations.map((v) => v.rule).join(",")}）`
          : "本人の判断で変更",
        triggeredBy: "M-5",
        direction: "neutral",
        action: "modify",
      },
      true,
      hasError ? "違反を承知で強行" : undefined
    );
  }
  return {
    ok: true,
    applied: true,
    newViolations,
    violations: runRuleEngine(buildRuleContext(repo, today)),
    alternatives: [],
    session: next,
  };
}

/** 予定を消す。実施済みの記録は消さない */
export function deletePlannedSession(repo: Store, sessionId: string, today: string): PlanEditResult {
  const session = repo.getSession(sessionId);
  if (!session) {
    return { ok: false, error: "セッションが見つかりません", applied: false, newViolations: [], violations: [], alternatives: [] };
  }
  if (session.isFixed) {
    return { ok: false, error: "固定セッションは削除できません", applied: false, newViolations: [], violations: [], alternatives: [] };
  }
  repo.deleteSession(sessionId);
  return {
    ok: true,
    applied: true,
    newViolations: [],
    violations: runRuleEngine(buildRuleContext(repo, today)),
    alternatives: [],
  };
}

/**
 * 予定を足す。
 * 同じ日に午前・午後の2本を残したいとき（M-1）にも使う。
 */
export function addSession(
  repo: Store,
  input: Partial<Session> & { date: string; category: Session["category"] },
  today: string
): PlanEditResult {
  const base = runRuleEngine(buildRuleContext(repo, today));
  const baseKeys = new Set(base.map(violationKey));
  const session: Session = {
    id: input.id ?? `s-user-${input.date}-${Date.now().toString(36)}`,
    date: input.date,
    category: input.category,
    name: input.name ?? "手動で追加した練習",
    prescription: input.prescription ?? "",
    targetPaces: input.targetPaces ?? [],
    transfer800m: input.transfer800m ?? 3,
    transfer1500m: input.transfer1500m ?? 3,
    riskLevel: input.riskLevel ?? "mid",
    phase: input.phase ?? "Specific",
    status: "planned",
    origin: "manual",
    userEdited: true,
    isFixed: input.isFixed ?? false,
    timeOfDay: input.timeOfDay ?? "pm",
    distanceKm: input.distanceKm,
    durationMin: input.durationMin,
    paceSecPerKm: input.paceSecPerKm,
  };
  // 対象6: 物理的にありえない設定ペースは、ルールエンジンの判断以前に弾く（forceでも越えられない）
  const plausibility = checkSessionPlausibility(session);
  if (hasBlockingIssue(plausibility)) {
    return {
      ok: false,
      error: plausibility.find((i) => i.severity === "error")!.message,
      applied: false,
      newViolations: [],
      violations: [],
      alternatives: [],
    };
  }
  repo.saveSession(session);
  const after = runRuleEngine(buildRuleContext(repo, today));
  return {
    ok: true,
    applied: true,
    newViolations: after.filter((v) => !baseKeys.has(violationKey(v))),
    violations: after,
    alternatives: [],
    session,
  };
}

// ---------------------------------------------------------------------------
// M-6 レース前の変則調整
// ---------------------------------------------------------------------------

export interface TaperPlanOutput {
  stage: TaperStage;
  stageLabel: string;
  daysToRace?: number;
  notice: string;
  adjustments: TaperAdjustment[];
  applied: boolean;
  /** 既に辞退している場合 */
  rejected?: { at: string; reason?: string };
}

const TAPER_REJECT_KEY = "taper:rejected";

/**
 * テーパーの調整案。
 *
 * 生成し直すのではなく、今ある予定に対する差分として出す。
 * 手で直した内容を消さないため。
 */
export function taperPlan(repo: Store, today: string, horizonDays = 21): TaperPlanOutput {
  const goal = repo.getGoal();
  const race = repo.listRaces().find((r) => r.id === goal?.targetRaceId);
  if (!race) {
    return { stage: "none", stageLabel: "", notice: "", adjustments: [], applied: false };
  }
  const days = diffDays(today, race.dateStart);
  const stage = taperStage(today, race.dateStart);
  const sessions = repo
    .listSessions()
    .filter((s) => s.date >= today && s.date <= addDays(today, horizonDays));
  const adjustments = planTaper(sessions, race.dateStart, today);
  return {
    stage,
    stageLabel: TAPER_STAGE_LABELS[stage],
    daysToRace: days >= 0 ? days : undefined,
    notice: taperNotice(stage, days),
    adjustments,
    applied: false,
    rejected: repo.getKv<{ at: string; reason?: string }>(TAPER_REJECT_KEY),
  };
}

/** 調整を適用する。適用したものだけ差分として履歴に残す */
export function applyTaperPlan(
  repo: Store,
  today: string,
  sessionIds?: string[]
): { applied: number; violations: RuleViolation[] } {
  const plan = taperPlan(repo, today);
  let applied = 0;
  for (const a of plan.adjustments) {
    if (!a.next) continue;
    if (sessionIds && !sessionIds.includes(a.sessionId)) continue;
    repo.saveSession(a.next);
    repo.logChange(
      {
        sessionId: a.sessionId,
        field: a.kind,
        before: a.before,
        after: a.after,
        reason: a.reason,
        triggeredBy: "M-6",
        direction: "down",
        action: "modify",
      },
      true
    );
    applied++;
  }
  repo.deleteKv(TAPER_REJECT_KEY);
  return { applied, violations: runRuleEngine(buildRuleContext(repo, today)) };
}

export function rejectTaperPlan(repo: Store, today: string, reason?: string): void {
  repo.saveKv(TAPER_REJECT_KEY, { at: today, reason });
}

// ---------------------------------------------------------------------------
// M-7 制限因子 / M-8 600m通過 / M-10 接地時間 / M-11 週次レビュー / M-12 書き出し
// ---------------------------------------------------------------------------

/**
 * Q-2: 直近4週のカテゴリ配分を見て、足りていないものを提案する。
 *
 * セッションは過去データ入力ぶんも含めて数える。
 * 実際にやった練習の配分を見たいので、入力経路で回数が変わってはいけない
 * （ルールエンジンが backfilled を評価対象から外しているのとは目的が違う）。
 */
export function coverageReview(repo: Store, today: string): CoverageReview | undefined {
  const athlete = repo.getAthlete();
  if (!athlete) return undefined;
  const goal = repo.getGoal();
  const race = repo.listRaces().find((r) => r.id === goal?.targetRaceId);
  const phase: Phase = race ? phaseForDate(today, race.dateStart) : "Base";
  const limiter = assessLimiter(athlete, goal?.targetTimeSec).limiter;
  return reviewCoverage({
    sessions: repo.listSessions(),
    results: trustedResults(repo),
    strengthSessions: repo.listStrengths(),
    today,
    phase,
    limiter,
    weeksToRace: race ? weeksUntil(today, race.dateStart) : undefined,
    raceDate: race?.dateStart,
  });
}

/**
 * Q-2: 提案どおりに1件だけ入れ替える。
 * 固定曜日設定そのものは変えない（本人が決めたものなので、その週の予定だけを動かす）。
 */
export function applyCoverageProposal(
  repo: Store,
  sessionId: string,
  category: SessionCategory,
  today: string,
  force = false
): PlanEditResult {
  const session = repo.getSession(sessionId);
  if (!session) {
    return {
      ok: false,
      error: "セッションが見つかりません",
      applied: false,
      newViolations: [],
      violations: [],
      alternatives: [],
    };
  }
  // force を受け取るのは、入れ替えが RULE 違反になる組み合わせが普通に起きるため。
  // 画面側で「何のルールに反するか」を出したうえで本人に決めさせる。
  // 黙って適用も、黙って握りつぶしもしない。
  return editSession(
    repo,
    sessionId,
    { category, name: `${CATEGORY_JP_LABELS[category] ?? category}（不足ぶんの補い）` },
    today,
    { force }
  );
}

/** M-7: 制限因子と、それを次の配分にどう反映するか */
export function limiterAssessment(repo: Store): {
  assessment?: LimiterAssessment;
  weights: CategoryWeight[];
  appliedNote: string;
  /** 目標タイム（秒）。妥当域とPBを同じ数直線に並べて見せるために返す */
  targetSec?: number;
} {
  const athlete = repo.getAthlete();
  if (!athlete) return { weights: [], appliedNote: "" };
  const targetSec = repo.getGoal()?.targetTimeSec;
  const assessment = assessLimiter(athlete, targetSec);
  const weights = categoryWeights(assessment.limiter);
  // 動かす項目だけを出す。据え置き（1.0）を「0%」と並べても判断材料にならない
  const moved = weights.filter((w) => w.weight !== 1);
  const appliedNote =
    moved.length === 0
      ? "配分は変えません。どちらの側も大きくは外れていないため、今の配分のままで問題ありません"
      : "次の4週の配分を次のように変えます: " +
        moved
          .map(
            (w) =>
              `${CATEGORY_JP_LABELS[w.category] ?? w.category} ${w.weight > 1 ? "+" : ""}${Math.round((w.weight - 1) * 100)}%（${w.note}）`
          )
          .join(" / ");
  return { assessment, weights, appliedNote, targetSec };
}

const CATEGORY_JP_LABELS: Record<string, string> = {
  high_lactate: "高乳酸",
  race_economy: "経済走",
  modeling: "モデリング",
  cv: "CV",
  threshold: "閾値",
  neural: "神経系",
  aerobic: "有酸素",
};

/**
 * S-6: 他の選手のメニューを自分の設定に換算する。
 *
 * 解釈も換算もコアに任せる。表記辞書とCFEを渡すのがここの役目。
 */
export function convertMenuForMe(
  repo: Store,
  prescription: string,
  theirPb800Sec: number
): { converted?: ConvertedMenu; text?: string; error?: string } {
  const cfe = repo.getCfe();
  if (!cfe) return { error: "現在地（CFE）がまだありません。先にプロフィールと過去データを入れてください" };
  const converted = convertMenu({
    prescription,
    theirPb800Sec,
    myCfeSec: cfe.estimated800mSec,
    parseOptions: {
      grpSecPerM: cfe.estimated800mSec / 800,
      phrases: repo.listPhrases(),
    },
  });
  return { converted, text: describeConverted(converted) };
}

/** S-7: カテゴリごとの直近の傾向。生成の材料にする */
function recentTrendByCategory(
  repo: Store,
  today: string
): Partial<Record<SessionCategory, TrendVerdict>> {
  const sessions = repo.listSessions();
  const results = trustedResults(repo);
  const out: Partial<Record<SessionCategory, TrendVerdict>> = {};
  for (const c of ["high_lactate", "race_economy", "modeling", "cv", "threshold", "neural"] as const) {
    out[c] = executionTrend(
      executionSamples(sessions, results, c, today, undefined, undefined, true)
    ).verdict;
  }
  return out;
}

/**
 * S-9: 次のポイント練習の進め方を2案出す。
 *
 * 保存はしない。選んだ結果だけを既存のセッションに書く。
 * 案そのものを保存すると、どの案が生きているかという状態が増えて、
 * M-2 / M-6 / ルールエンジンと取り合いになる。
 */
export function sessionPlanVariants(
  repo: Store,
  sessionId: string,
  today: string
): {
  session?: Session;
  variants?: (SessionVariant & { prescription: string })[];
} {
  const session = repo.getSession(sessionId);
  const athlete = repo.getAthlete();
  const cfe = repo.getCfe();
  if (!session || !athlete || !cfe) return {};

  const goal = repo.getGoal();
  const race = repo.listRaces().find((r) => r.id === goal?.targetRaceId);
  const phase: Phase = race ? phaseForDate(session.date, race.dateStart) : "Base";
  const trend = executionTrend(
    executionSamples(
      repo.listSessions(),
      trustedResults(repo),
      session.category,
      session.date,
      undefined,
      session
    )
  ).verdict;
  const aerobicProfile = buildAerobicProfile(
    aerobicEvidenceMarkers(repo),
    session.date,
    cfe.estimated800mSec,
    heatFlaggedDates(repo),
    repo.getAthlete()?.pb1500mSec
  );

  const base = buildSessionSpec({
    category: session.category,
    phase,
    weekIndex: Math.max(0, Math.floor(diffDays(today, session.date) / 7)),
    cfeSec: cfe.estimated800mSec,
    trend,
    aerobicProfile,
    athleteType:
      athlete.athleteTypeOverride ?? diagnose(athlete, goal?.targetTimeSec).athleteType,
    templateHistory: completedTemplateHistory(repo),
    onDate: session.date,
  });
  if (!base) return { session };

  const limiter = assessLimiter(athlete, goal?.targetTimeSec).limiter;
  const variants = sessionVariants(base, { trend, limiter }).map((v) => ({
    ...v,
    prescription: v.spec.prescription,
  }));
  return { session, variants };
}

/** S-9: 選んだ案をその日の予定に書き込む。ルール検査は editSession に任せる */
export function applySessionVariant(
  repo: Store,
  sessionId: string,
  variantKey: string,
  today: string
): PlanEditResult {
  const { session, variants } = sessionPlanVariants(repo, sessionId, today);
  const chosen = variants?.find((v) => v.key === variantKey);
  if (!session || !chosen) {
    return {
      ok: false,
      error: "案が見つかりません",
      applied: false,
      newViolations: [],
      violations: [],
      alternatives: [],
    };
  }
  let result: PlanEditResult;
  if (chosen.appliesToCurrent === false) {
    result = {
      ok: true,
      applied: true,
      newViolations: [],
      violations: runRuleEngine(buildRuleContext(repo, today)),
      alternatives: [],
      session,
    };
  } else {
    result = editSession(
      repo,
      sessionId,
      {
        prescription: chosen.spec.prescription,
        targetPaces: chosen.spec.targetPaces,
        durationMin: chosen.spec.durationMin,
        distanceKm: chosen.spec.distanceKm,
      },
      today
    );
  }
  if (!result.ok || variantKey !== "volume") return result;

  const goal = repo.getGoal();
  const race = repo.listRaces().find((item) => item.id === goal?.targetRaceId);
  const volumeChanges = planVolumeProgression({
    sessions: repo.listSessions(),
    anchorSessionId: sessionId,
    today,
    raceDate: race?.dateStart,
  });
  for (const change of volumeChanges) {
    repo.saveSession({ ...change.next, userEdited: true });
    repo.logChange(
      {
        sessionId: change.sessionId,
        field: change.kind,
        before: change.before,
        after: change.after,
        reason: change.reason,
        triggeredBy: "VOLUME-PROGRESSION",
        direction: "up",
        action: "modify",
      },
      true
    );
  }
  const publicChanges = volumeChanges.map(({ next: _next, ...change }) => change);
  return {
    ...result,
    violations: runRuleEngine(buildRuleContext(repo, today)),
    message:
      publicChanges.length > 0
        ? `今後${VOLUME_HORIZON_DAYS}日間の${publicChanges.length}件へ量の増加を反映しました。高乳酸・テーパー・回復日・手動変更は対象外です。`
        : "安全に増やせる今後の自動生成メニューが無かったため、カレンダーは変更していません。",
    volumeChanges: publicChanges,
    volumeWindowDays: VOLUME_HORIZON_DAYS,
  };
}

export interface HrUsageLine {
  date: string;
  name: string;
  category: SessionCategory;
  verdict: string;
  note: string;
  /*
   * 画面で帯として見せるための素の値。
   * 以前は note（一文）だけを返していたので、同じ文が日数ぶん縦に並び、
   * どの日が狙いから外れているのかを読み取るのに全部読む必要があった。
   * 文はそのまま残す（読みたいときに読める）。
   */
  bpm?: number;
  pct?: number;
  band?: { min: number; max: number };
  blockedReason?: string;
}

/**
 * R-1: 心拍が何に効いているかを、直近の記録に対して実際に出す。
 *
 * 「保存されているか」ではなく「使われているか」を画面で確かめられるようにする。
 * 心拍が無い記録は判定できないと出す（空欄を good 扱いにしない）。
 */
export function hrUsage(
  repo: Store,
  today: string,
  limit = 8
): {
  reference?: HrMaxReference;
  lines: HrUsageLine[];
  /** 暑熱フラグの付いた日について、心拍が裏づけになっているか */
  heat: (HrUsageLine & { supported: boolean })[];
} {
  const athlete = repo.getAthlete();
  const sessions = repo.listSessions();
  const results = trustedResults(repo);
  const byId = new Map(sessions.map((s) => [s.id, s]));
  const reference = hrMaxReference(athlete, results, repo.listMarkers());

  const recent = results
    .filter((r) => r.date <= today && byId.has(r.sessionId))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, limit);

  const lines: HrUsageLine[] = [];
  const heat: (HrUsageLine & { supported: boolean })[] = [];
  for (const r of recent) {
    const s = byId.get(r.sessionId)!;
    const ri = relativeIntensity(s, r, reference);
    lines.push({
      date: r.date,
      name: s.name,
      category: s.category,
      verdict: ri.verdict,
      note: ri.note,
      bpm: ri.bpm,
      pct: ri.pct,
      band: ri.band,
      blockedReason: ri.blockedReason,
    });
    if (r.heatFlagged) {
      const ev = heatHrEvidence(sessions, results, r);
      heat.push({
        date: r.date,
        name: s.name,
        category: s.category,
        verdict: ev.supported ? "supported" : "not_supported",
        note: ev.note,
        supported: ev.supported,
      });
    }
  }
  return { reference, lines, heat };
}

/** M-8: 600m通過からの残り200m */
export function splitAnalysis(repo: Store): SplitTrend {
  const goal = repo.getGoal();
  const target = goal?.targetTimeSec ?? repo.getAthlete()?.pb800mSec ?? 108.9;
  const samples = [
    ...splitSamplesFromPast(repo.listPastEntries()),
    ...splitSamplesFromMarkers(repo.listMarkers()),
  ];
  // 同じ日の重複を落とす（過去データと実測マーカーの両方に入ることがある）
  const seen = new Set<string>();
  const unique = samples.filter((s) => {
    const k = `${s.date}|${s.pass600Sec.toFixed(1)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return splitTrend(unique, target);
}

/**
 * シューズ。
 *
 * 一覧は kv に置く。専用のテーブルを作らないのは、
 * 数が十数足で、検索の条件にもならないため。kv は書き出し・復元の両方に乗っている。
 *
 * **使用距離は持たない。** 結果から毎回足し上げる（`shoeUsage`）。
 * カウンタを持つと、記録を消したり直したりしたときにずれて、
 * しかもずれたことに気づけない。
 */
const SHOES_KEY = "shoes:list";

export function listShoes(repo: Store): Shoe[] {
  return repo.getKv<Shoe[]>(SHOES_KEY) ?? [];
}

export function saveShoe(repo: Store, shoe: Shoe): Shoe[] {
  const name = shoe.name.trim();
  if (!name) throw new Error("シューズの名前を入れてください");
  const list = listShoes(repo);
  const index = list.findIndex((x) => x.id === shoe.id);
  const next = { ...shoe, name };
  if (index >= 0) list[index] = next;
  else list.push(next);
  repo.saveKv(SHOES_KEY, list);
  return list;
}

/**
 * 消す。
 *
 * **使った記録がある靴は消さない。** 消すと過去の記録が指す先が無くなり、
 * 「何を履いていたか」が分からなくなる。使い終わったものは「引退」にする
 * （選択肢からは消えるが、履歴は残る）。
 */
export function deleteShoe(
  repo: Store,
  shoeId: string
): { deleted: boolean; reason?: string } {
  const used = repo.listResults().some((r) => r.shoeId === shoeId);
  if (used) {
    return {
      deleted: false,
      reason:
        "使った記録があるシューズは消せません。履歴が指す先が無くなるためです。使い終わったものは「引退」にしてください（選択肢から外れ、記録は残ります）。",
    };
  }
  const list = listShoes(repo);
  const rest = list.filter((x) => x.id !== shoeId);
  /*
   * 消すものが無ければ「消した」と言わない。
   * 何もしていないのに成功と返すと、画面は「削除しました」と出す。
   * 実行していないことを成功と報告しない（禁止事項の同じ話）。
   */
  if (rest.length === list.length) {
    return { deleted: false, reason: "そのシューズは登録されていません。" };
  }
  repo.saveKv(SHOES_KEY, rest);
  return { deleted: true };
}

/**
 * 打ち切りの理由別の内訳。
 * 記録は端末の中にしかないので、数えるのもここ（画面から呼ぶ）。
 */
export function abortBreakdown(repo: Store, today: string): AbortSummary {
  return abortSummary(trustedResults(repo), today);
}

/** 靴ごとの使用距離。結果から毎回足し上げる */
export function shoeUsageList(repo: Store): ShoeUsage[] {
  return shoeUsage(listShoes(repo), trustedResults(repo), repo.listSessions());
}

/**
 * 同じ処方を条件タグで分けたときのRPEの差。
 *
 * 「設定は同じでも雨でRPEが上がった」を数字にする。
 * **これで設定は動かさない。** 見て本人が判断する材料。
 */
/**
 * その日の練習に合う靴。
 *
 * **判断は core/shoeRecommend.ts だけ。** ここは材料を集めて渡すだけで、
 * 画面ごとに別の理屈を書かないための入口。
 *
 * 材料:
 *   ・登録してある靴と使用距離
 *   ・その日のセッション（狙い・場所）
 *   ・直近の状態（疲労・痛み）
 *   ・同じ狙いで実際に履いたときの結果
 */
// ---------------------------------------------------------------------------
// アップ（主練習の子データ）
// ---------------------------------------------------------------------------

export interface WarmupFitCandidate {
  fitId: string;
  fileName: string;
  date?: string;
  warmup: WarmupRecord;
}

export interface WarmupOptions {
  /** 同じカテゴリで最後に記録したアップ。「前回と同じ」の中身 */
  previous?: { date: string; warmup: WarmupRecord };
  /** 固定の型。実績から作らない */
  templates: { key: string; label: string; warmup: WarmupRecord }[];
  /** その日のFITから拾えるアップ区間 */
  fromFit: WarmupFitCandidate[];
}

/**
 * 記録画面のアップ欄に出す選択肢。
 *
 * **毎回ゼロから入力させない**ための材料を集めるだけで、
 * どれかを既定で選んだ状態にはしない。
 * 既定で入れてしまうと、実際にはやっていないアップが記録に残る。
 *
 * `mainIsContinuous` は二重計上の判断に要る（`warmupFromFitLaps` を参照）。
 * 画面が「いま持続走として入力しているか」を知っているので、そこから渡す。
 */
export function warmupOptionsFor(
  repo: Store,
  sessionId: string,
  opts: { mainIsContinuous: boolean }
): WarmupOptions {
  const session = repo.getSession(sessionId);

  /*
   * 前回は**同じカテゴリ**から探す。
   * ポイント練習のアップをジョグの日に持ってきても意味が無い。
   */
  let previous: WarmupOptions["previous"];
  if (session) {
    const sessionById = new Map(repo.listSessions().map((s) => [s.id, s]));
    const candidate = trustedResults(repo)
      .filter((r) => r.warmup && r.sessionId !== sessionId)
      .filter((r) => sessionById.get(r.sessionId)?.category === session.category)
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    if (candidate?.warmup) previous = { date: candidate.date, warmup: candidate.warmup };
  }

  const fromFit: WarmupFitCandidate[] = [];
  for (const record of repo.listFitImports()) {
    const kinds =
      record.confirmedKinds?.length
        ? record.confirmedKinds
        : record.autoClassification?.laps?.map((l) => l.kind) ?? [];
    const w = warmupFromFitLaps(record.parse?.laps ?? [], kinds, opts);
    if (!w) continue;
    fromFit.push({
      fitId: record.id,
      fileName: record.fileName,
      date: record.parse?.activityTimestampUtc?.slice(0, 10),
      warmup: w,
    });
  }

  return {
    previous,
    templates: WARMUP_TEMPLATES.map((t) => ({ key: t.key, label: t.label, warmup: t.build() })),
    fromFit,
  };
}

/**
 * アップと主練習の相性。
 *
 * **ここでは何も変えない。** 返すのは読むための材料だけで、
 * 設定やアップを自動で書き換える口は用意していない。
 */
export function warmupAnalysis(repo: Store): WarmupInsight {
  return warmupInsight(trustedResults(repo), repo.listSessions());
}

export function shoeAdviceFor(
  repo: Store,
  sessionId: string,
  today: string
): ShoeRecommendation {
  const session = repo.getSession(sessionId);
  const shoes = listShoes(repo);
  const usage = shoeUsageList(repo);
  if (!session) {
    return recommendShoes(shoes, { kind: "easy" }, usage, shoeOutcomes(repo));
  }

  /*
   * 痛みと疲労は既にある記録から取る。**推薦のために新しく聞かない。**
   * 聞く欄を増やすと、答えないと推薦が出ない仕組みになる。
   */
  const injuries = activeInjuriesAt(repo.listInjuries(), session.date);
  const recentChecks = repo
    .listDailyChecks()
    .filter((c) => c.date <= session.date && diffDays(c.date, session.date) <= 3);
  const fatigueHigh = recentChecks.some(
    (c) =>
      c.signal === "yellow" ||
      c.signal === "red" ||
      (c.overallFatigue ?? 0) >= 4 ||
      (c.legFatigue ?? 0) >= 4
  );

  const nextRace = repo
    .listRaces()
    .map((r) => r.dateStart)
    .filter((d) => d >= session.date)
    .sort()[0];

  return recommendShoes(
    shoes,
    {
      kind: shoeSessionKindOf(session.category, {
        aerobicPurpose: session.aerobicPurpose,
      }),
      place: session.surface === "treadmill" ? "treadmill" : session.surface,
      fatigueHigh,
      hasPain: injuries.length > 0,
      daysToRace: nextRace ? diffDays(session.date, nextRace) : undefined,
    },
    usage,
    shoeOutcomes(repo)
  );
}

/** 同じ狙いで実際に履いたときの結果。少ないうちは推薦側が使わない */
function shoeOutcomes(repo: Store): ShoeOutcome[] {
  const sessionById = new Map(repo.listSessions().map((s) => [s.id, s]));
  const out: ShoeOutcome[] = [];
  for (const r of trustedResults(repo)) {
    if (!r.shoeId) continue;
    const s = sessionById.get(r.sessionId);
    if (!s) continue;
    out.push({
      shoeId: r.shoeId,
      kind: shoeSessionKindOf(s.category, { aerobicPurpose: s.aerobicPurpose }),
      rpe: r.rpe,
      legsHeavy: r.nextDayLegs === "heavy",
    });
  }
  return out;
}

export function conditionComparison(repo: Store): ConditionSplit[] {
  return conditionSplits(trustedResults(repo));
}

/** M-10: 接地時間 */
const CONTACT_KEY = "contact:samples";

export function listContactSamples(repo: Store): ContactSample[] {
  return repo.getKv<ContactSample[]>(CONTACT_KEY) ?? [];
}

export function importContactSamples(
  repo: Store,
  samples: ContactSample[]
): { imported: number; total: number } {
  const existing = listContactSamples(repo);
  const map = new Map(existing.map((s) => [`${s.date}|${s.contactMs}`, s]));
  let imported = 0;
  for (const s of samples) {
    const k = `${s.date}|${s.contactMs}`;
    if (!map.has(k)) imported++;
    map.set(k, s);
  }
  const merged = [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
  repo.saveKv(CONTACT_KEY, merged);
  return { imported, total: merged.length };
}

/**
 * 判定に使う接地時間の材料。
 *
 * CSV取り込みぶん（`listContactSamples`）と、記録そのものから導いたぶんを合わせる。
 * FIT取込は前からランニングダイナミクスを保存していたのに、判定はCSVぶんしか
 * 見ておらず、アプリの中に値があるのに「時計から書き出してください」と
 * 案内し続けていた。
 *
 * 本人未確認のFIT結果は入れない（`trustedResults`）。確認前の値を分析へ流さない
 * という既存の切り分けに合わせる。
 *
 * 同じ日・同じ値は片方だけ数える。同じ練習をCSVとFITの両方から入れると
 * 二重になり、判定に必要な件数（6件）を実際より早く満たしてしまう。
 */
function allContactSamples(repo: Store): ContactSample[] {
  const merged = new Map<string, ContactSample>();
  for (const s of [
    ...listContactSamples(repo),
    ...contactSamplesFromResults(trustedResults(repo)),
  ]) {
    merged.set(`${s.date}|${s.contactMs}`, s);
  }
  return [...merged.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function contactTimeStatus(repo: Store, today: string): ContactAssessment {
  return assessContactTime(allContactSamples(repo), today);
}

/** M-11: 週次レビュー */
export function weeklyReview(repo: Store, today: string, weekStartDate?: string): WeeklyReview {
  const ws = weekStartDate ?? weekStart(addDays(today, -7));
  const athlete = repo.getAthlete();
  const goal = repo.getGoal();
  const loads = dailyLoads({
    sessions: repo.listSessions(),
    resultsBySessionId: new Map(trustedResults(repo).map((r) => [r.sessionId, r])),
    strengthSessions: repo.listStrengths(),
  });
  let violations: RuleViolation[] = [];
  try {
    violations = runRuleEngine(buildRuleContext(repo, today));
  } catch {
    violations = [];
  }
  return buildWeeklyReview({
    weekStart: ws,
    sessions: repo.listSessions(),
    results: trustedResults(repo),
    checks: repo.listDailyChecks(),
    violations,
    acwr: acwr(loads, addDays(ws, 6)).acwr,
    cfeSec: repo.getCfe()?.estimated800mSec,
    targetSec: goal?.targetTimeSec,
    limiterNarrative: athlete
      ? assessLimiter(athlete, goal?.targetTimeSec).narrative
      : undefined,
  });
}

/** M-12: 書き出し */
const BACKUP_META_KEY = "backup:lastExportedAt";

export function exportBackup(repo: Store, now: string): BackupFile {
  const data: Record<string, unknown> = {
    athlete: repo.getAthlete(),
    goal: repo.getGoal(),
    races: repo.listRaces(),
    sessions: repo.listSessions(),
    strengths: repo.listStrengths(),
    results: repo.listResults(),
    dailyChecks: repo.listDailyChecks(),
    markers: repo.listMarkers(),
    cfe: repo.getCfe(),
    heatBlocks: repo.listHeatBlocks(),
    heatEntries: repo
      .listHeatBlocks()
      .flatMap((b) => repo.listHeatEntries(b.id).map((e) => ({ blockId: b.id, entry: e }))),
    injuries: repo.listInjuries(),
    weekTemplate: repo.getWeekTemplate(),
    customMenus: repo.listCustomMenus(),
    phrases: repo.listPhrases(),
    pastEntries: repo.listPastEntries(),
    fitImports: repo.listFitImports(),
    /*
     * 自動変更の履歴。
     *
     * これが入っていないと、iOSがストレージを消して書き出しから復元したときに
     * 「設定ペースがなぜ下がったのか」「CFEがなぜ動いたのか」だけが消える。
     * 結果もCFEの値も残るので、**失われたことに気づけない**。
     *
     * `listChangeLog` は新しい順で返すが、復元では古い順に積みたいので
     * ここで並べ替えてから入れる（保存層の並び順を時系列と一致させるため）。
     */
    changeLog: [...repo.listChangeLog(BACKUP_CHANGE_LOG_LIMIT)].reverse(),
    kv: repo.listKv<unknown>(""),
  };
  const counts: Record<string, number> = {};
  for (const [k, v] of Object.entries(data)) {
    if (Array.isArray(v)) counts[k] = v.length;
  }
  repo.saveKv(BACKUP_META_KEY, now);
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: now,
    athleteName: repo.getAthlete()?.name,
    counts,
    data,
  };
}

/**
 * 登録したレースを消す。
 *
 * 保存層には前から `deleteRace` があったが、呼ぶ側が無かった。
 * 間違えて登録したレースが残り続け、目標から外しても記録としては消えなかった。
 *
 * 消さないものが2つある。
 *   ・**本命レース**——消すと目標が指す先が無くなり、冬季モードに落ちる。
 *     やりたいなら先に目標側で外す（あちらは「レース未定」を選ぶ導線がある）
 *   ・**結果が紐づいているレース**——それは競技記録で、間違いではない。
 *     `processRaceResult` が有酸素マーカーを作っているので、消すと現在地の根拠が欠ける
 */
export function deleteRace(repo: Store, raceId: string): { deleted: boolean; reason?: string } {
  const goal = repo.getGoal();
  if (goal?.targetRaceId === raceId) {
    return {
      deleted: false,
      reason:
        "本命レースは消せません。先に「目標・レース」で別のレースを本命にするか、レース未定（冬季・基礎構築）にしてください。",
    };
  }
  const hasResult = repo.listMarkers().some((m) => m.description.startsWith(`${raceId} `));
  if (hasResult) {
    return {
      deleted: false,
      reason:
        "結果を入力済みのレースは消せません。走った記録は現在地の根拠になっているためです（目標から外すことはできます）。",
    };
  }
  repo.deleteRace(raceId);
  if (goal) {
    repo.saveGoal({ ...goal, subRaceIds: (goal.subRaceIds ?? []).filter((id) => id !== raceId) });
  }
  return { deleted: true };
}

/**
 * 直近4週の「予定と実際のズレ」。
 *
 * `periodSummary` と役割を分ける。
 *   ・`periodSummary` = 距離・時間・強度の**合計**（WEEK / MONTH / YEAR）。伸びたかを見る
 *   ・ここ            = 予定に対して**どれだけ実施できたか**。守れているかを見る
 * 同じ週の数字が2種類出ないよう、こちらは合計を主役にしない。
 *
 * 見る意味は、設定を守れているかが処方の組み立てに効いているから
 * （`recentTrend` がカテゴリ単位で同じことを見て、本数とレストを動かしている）。
 * その判断の材料を、本人も週単位で見返せるようにする。
 */
export function trainingBalance(repo: Store, today: string): FourWeekBalance {
  const goal = repo.getGoal();
  const race = goal ? repo.listRaces().find((r) => r.id === goal.targetRaceId) : undefined;
  return buildFourWeekBalance({
    sessions: repo.listSessions(),
    results: repo.listResults(),
    strengths: repo.listStrengths(),
    today,
    raceDate: race?.dateStart,
    // レースが無い期間（冬季）は Base のまま。currentPhase と同じ判定を通す
    phase: currentPhase(repo, today).phase,
  });
}

/**
 * 相談に送る「練習の組み方」。
 *
 * 画面（`todayStructure`）と同じものを、文章にして送る。
 * 別々に組み立てると、片方を直したときに
 * 「画面ではこう見えているのにAIは別の前提で答える」ことになる。
 */
export function assistantStructure(
  repo: Store,
  today: string
): { cycle?: string; offSeason?: { label: string; reason: string } } | undefined {
  const session = repo
    .listSessions(today, today)
    .find((s) => s.offSeasonBlock !== undefined);
  const s = todayStructure(repo, today, session);
  if (!s.cycle && !s.offSeason) return undefined;
  return {
    cycle: s.cycle
      ? `${s.cycle.lengthDays}日周期（今日は${s.cycle.position}日目）`
      : undefined,
    offSeason: s.offSeason,
  };
}

export interface TodayStructure {
  /** N日周期なら「4日目 / 10日」のような位置。曜日で組んでいれば undefined */
  cycle?: { position: number; lengthDays: number; label: string };
  /** 冬季・基礎構築モードなら、その日のブロックと理由 */
  offSeason?: { label: string; reason: string };
}

/**
 * 今日が「何の繰り返しの、どこ」なのか。
 *
 * 周期は保存してある起点から**その場で数える**（`cyclePositionFor`）。
 * 冬季のブロックは生成時にしか分からないので、セッションに持たせたものを読む
 * （`Session.offSeasonBlock` のコメントを参照）。
 */
export function todayStructure(
  repo: Store,
  today: string,
  session: Session | undefined
): TodayStructure {
  const out: TodayStructure = {};

  const template = repo.getWeekTemplate();
  const position = cyclePositionFor(template, today);
  const cycle = cycleOf(template);
  if (position !== undefined && cycle) {
    out.cycle = {
      position: position + 1,
      lengthDays: cycle.lengthDays,
      label: `周期 ${position + 1}日目 / ${cycle.lengthDays}日`,
    };
  }

  const block = session?.offSeasonBlock;
  if (block) {
    const emphasis = block.emphasis as OffSeasonEmphasis;
    const name = OFF_SEASON_LABELS[emphasis];
    if (name) {
      out.offSeason = {
        label: `第${block.number}ブロック ${name}`,
        reason: OFF_SEASON_REASONS[emphasis],
      };
    }
  }
  return out;
}

/**
 * いま何期か。
 *
 * フェーズ別の表（補強の内容など）を画面に出すときに、
 * **「今はここ」が無いとただの資料**になって読まれない。
 * 判定そのものは生成と同じ関数を通す（別の判定を書くと表と実物がずれる）。
 */
export function currentPhase(
  repo: Store,
  today: string
): { phase: Phase; offSeason: boolean } {
  const goal = repo.getGoal();
  const races = repo.listRaces();
  const target = goal ? races.find((r) => r.id === goal.targetRaceId) : undefined;
  // 目標レースが無い期間は基礎期のまま動かさない（冬季・基礎構築モードと同じ扱い）
  if (!target) return { phase: "Base", offSeason: true };
  return { phase: phaseForDate(today, target.dateStart), offSeason: false };
}

export function backupStatus(repo: Store, today: string) {
  const last = repo.getKv<string>(BACKUP_META_KEY);
  return { ...shouldRemindBackup(last, today, diffDays), lastExportedAt: last };
}

/**
 * 復元。
 * replace = いま入っているものを消してから入れる
 * merge   = idで突き合わせて足す（重複を作らない）
 *
 * 対象2（安全なバックアップ復元）: 完全検証が終わるまで既存データを削除しない。
 * `validateBackup` は各コレクションの形（配列か・idが文字列か）を先に確認する。
 * さらに実際の書き込み（`resetAll()` を含む）は `repo.transaction()` で包み、
 * 検証をすり抜けた想定外のデータで途中失敗しても、開始前の状態へ完全に戻す
 * （SQLiteは実トランザクション、IndexedDBはスナップショットからの差し戻し）。
 */
export function importBackup(
  repo: Store,
  file: unknown,
  mode: RestoreMode
): RestoreReport {
  const validation = validateBackup(file);
  if (!validation.ok) {
    const detail = validation.issues
      .slice(0, 5)
      .map((i) => `${i.path}: ${i.reason}`)
      .join(" / ");
    throw new Error(`このファイルは復元できません（${detail}）`);
  }
  const validFile = validation.file;
  const report: RestoreReport = { mode, added: {}, updated: {}, kept: {}, warnings: [] };
  const d = validFile.data as Record<string, any>;

  repo.transaction(() => {
    importBackupData(repo, d, mode, report);
  });

  if (validFile.version > BACKUP_VERSION) {
    report.warnings.push(
      `このファイルは新しい形式（v${validFile.version}）です。読めない項目がある可能性があります`
    );
  }
  // 守ったことを黙っていると、取り込めなかったのか守られたのかが分からない
  const keptSessions = report.kept.sessions ?? 0;
  if (keptSessions > 0) {
    report.warnings.push(
      `この端末の練習 ${keptSessions}件（完了済み・本人が編集・固定枠・手動追加・遡り入力）は` +
        `そのまま残しました。取り込んだ側の内容で置き換えたい場合は「クラウドを優先」を選んでください`
    );
  }
  return report;
}

/** importBackup の実際の書き込み部分。repo.transaction() の中でだけ呼ぶ */
function importBackupData(
  repo: Store,
  d: Record<string, any>,
  mode: RestoreMode,
  report: RestoreReport
): void {
  if (mode === "replace") repo.resetAll();

  if (d.athlete) repo.saveAthlete(d.athlete);
  if (d.goal) repo.saveGoal(d.goal);
  if (d.cfe) repo.saveCfe(d.cfe);
  if (d.weekTemplate) repo.saveWeekTemplate(d.weekTemplate);

  const put = <T extends { id: string }>(
    name: string,
    incoming: T[] | undefined,
    existing: () => T[],
    save: (x: T) => void,
    keepExisting?: (mine: T, theirs: T) => boolean
  ) => {
    if (!incoming) return;
    const cur = mode === "replace" ? [] : existing();
    const { merged, added, updated, kept } = mergeById(cur, incoming, keepExisting);
    report.added[name] = added;
    report.updated[name] = updated;
    report.kept[name] = kept;
    for (const x of merged) save(x);
  };

  // 復元は saveGoalAndRaces を通らないので、ボーダーの規則はここでも通す
  put("races", d.races, () => repo.listRaces(), (x) => repo.saveRace(normalizeRaceBorders(x)));
  put(
    "sessions",
    d.sessions,
    () => repo.listSessions(),
    (x) => repo.saveSession(x),
    // replace は本人が「クラウドを優先」と決めた経路なので保護しない
    mode === "merge" ? (mine: Session) => isOwnedByAthlete(mine) : undefined
  );
  put("strengths", d.strengths, () => repo.listStrengths(), (x) => repo.saveStrength(x));
  put("results", d.results, () => repo.listResults(), (x) => repo.saveResult(x));
  put("markers", d.markers, () => repo.listMarkers(), (x) => repo.saveMarker(x));
  put("injuries", d.injuries, () => repo.listInjuries(), (x) => repo.saveInjury(x));
  put("customMenus", d.customMenus, () => repo.listCustomMenus(), (x) => repo.saveCustomMenu(x));
  put("phrases", d.phrases, () => repo.listPhrases(), (x) => repo.savePhrase(x));
  put("pastEntries", d.pastEntries, () => repo.listPastEntries(), (x) => repo.savePastEntry(x));
  put("heatBlocks", d.heatBlocks, () => repo.listHeatBlocks(), (x) => repo.saveHeatBlock(x));
  put("fitImports", d.fitImports, () => repo.listFitImports(), (x) => repo.saveFitImport(x));

  if (Array.isArray(d.dailyChecks)) {
    const cur = mode === "replace" ? [] : repo.listDailyChecks();
    const { merged, added, updated } = mergeByDate(cur, d.dailyChecks);
    report.added.dailyChecks = added;
    report.updated.dailyChecks = updated;
    for (const c of merged) repo.saveDailyCheck(c);
  }
  if (Array.isArray(d.heatEntries)) {
    for (const h of d.heatEntries) repo.saveHeatEntry(h.blockId, h.entry);
  }
  /*
   * 自動変更の履歴。
   *
   * idを持たないので `put`（id突合）は使えない。
   * merge のときは「同じ日時に同じセッションの同じ項目を同じ理由で変えた」ものを
   * 同一とみなす。日時はミリ秒まであるので、これで実用上ぶつからない。
   *
   * 古い書き出しには入っていないので、無ければ何もしない（`?? []` ではなく
   * 配列判定で分ける——空配列を渡して replace で全消しになるのを避ける）。
   */
  if (Array.isArray(d.changeLog)) {
    const key = (e: ChangeLogEntry) =>
      `${e.createdAt}|${e.sessionId}|${e.field}|${e.triggeredBy}|${e.reason}`;
    const mine = mode === "replace" ? [] : repo.listChangeLog(Number.MAX_SAFE_INTEGER);
    const have = new Set(mine.map(key));
    const incoming = (d.changeLog as ChangeLogEntry[]).filter((e) => !have.has(key(e)));
    repo.restoreChangeLog(incoming);
    report.added.changeLog = incoming.length;
    report.kept.changeLog = (d.changeLog as ChangeLogEntry[]).length - incoming.length;
  }
  if (Array.isArray(d.kv)) {
    for (const x of d.kv) repo.saveKv(x.key, x.value);
  }
}

// ---------------------------------------------------------------------------
// N-2 / N-3 メニュー本文の解釈
// ---------------------------------------------------------------------------

/**
 * 本文から構造とカテゴリを読み取る。
 *
 * 現在のCFEからGRPを渡すので、設定タイムが書かれていればカテゴリが一意に決まる。
 * 表記辞書も通すので、本人が登録した語も効く。
 * 一括入力とまったく同じ解釈になる（同じ関数を通しているため）。
 */
export function interpretPrescription(repo: Store, text: string): PrescriptionStructure {
  const cfe = repo.getCfe();
  return parsePrescription(text, {
    grpSecPerM: cfe ? cfe.estimated800mSec / 800 : undefined,
    phrases: repo.listPhrases(),
  });
}

// ---------------------------------------------------------------------------
// 相談（AI）に渡す文脈
// ---------------------------------------------------------------------------

/**
 * 端末外へ送る文脈を組み立てる。**読むだけ**で、何も保存しない。
 *
 * 組み立て自体はコアの純関数（`buildAssistantContext`）に任せる。
 * ここの役目は保存層から材料を集めることだけ。
 * 集める先を増やすと端末外へ出る情報が増えるので、増やすときは
 * 画面の「送る内容」表示で本人が確認できることを必ず確かめること。
 */
export function assistantContext(repo: Store, today: string): AssistantContext {
  const athlete = repo.getAthlete();
  const goal = repo.getGoal();
  const cfe = repo.getCfe();
  const race = goal ? racesForGoal(repo).find((r) => r.id === goal.targetRaceId) : undefined;

  const toSession = (s: Session): AssistantSessionInput => ({
    date: s.date,
    timeOfDay: s.timeOfDay,
    category: s.category,
    name: s.name,
    prescription: s.prescription,
    status: s.status,
    phase: s.phase,
    riskLevel: s.riskLevel,
    targetPaces: s.targetPaces.map((p) => ({
      distanceM: p.distanceM,
      targetSecFast: p.targetSecFast,
      targetSecSlow: p.targetSecSlow,
      isEstimated: p.isEstimated,
    })),
    selectionReasons: s.generation?.selectionReasons,
    confidence: s.generation?.confidence,
  });

  const sessionsById = new Map(repo.listSessions().map((s) => [s.id, s]));
  const recentResults: AssistantResultInput[] = trustedResults(repo)
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .map((r) => {
      const s = sessionsById.get(r.sessionId);
      return {
        date: r.date,
        sessionName: s?.name ?? "（予定が見つかりません）",
        category: s?.category ?? "unknown",
        lapsSec: r.actualLapsSec,
        lapDistancesM: r.lapDistancesM,
        rpe: r.rpe,
        achievement: r.achievement,
        completedReps: r.completedReps,
        prescribedReps: r.prescribedReps,
        aborted: r.aborted,
        abortCauseLabel: abortCauseLabel(r.abortCause) || undefined,
      };
    });

  const limiter = athlete ? limiterAssessment(repo) : undefined;
  const coverage = coverageReview(repo, today);

  return buildAssistantContext({
    today,
    pb800Sec: athlete?.pb800mSec,
    goal: goal
      ? {
          targetTimeSec: goal.targetTimeSec,
          raceDate: race?.dateStart,
          raceName: race?.name,
        }
      : undefined,
    cfe: cfe
      ? {
          estimated800mSec: cfe.estimated800mSec,
          confidence: cfe.confidence,
          lastUpdated: cfe.lastUpdated,
          history: cfe.history.map((h) => ({
            date: h.date,
            before: h.before,
            after: h.after,
            source: h.source,
          })),
        }
      : undefined,
    phase: race ? phaseForDate(today, race.dateStart) : undefined,
    /*
     * 組み方（N日周期・冬季モード）。
     * 画面に出しているのと同じものを送る。片方だけ更新すると、
     * 「画面ではこう見えているのにAIは別の前提で答える」ことになる。
     */
    structure: assistantStructure(repo, today),
    todaySessions: repo.listSessions(today, today).map(toSession),
    upcomingSessions: repo.listSessions(addDays(today, 1), addDays(today, UPCOMING_DAYS)).map(toSession),
    recentResults,
    violations: runRuleEngine(buildRuleContext(repo, today)).map((v) => ({
      rule: v.rule,
      level: v.level,
      message: v.message,
    })),
    limiter: limiter?.assessment
      ? {
          limiter: limiter.assessment.limiter,
          narrative: limiter.assessment.narrative,
          appliedNote: limiter.appliedNote,
        }
      : undefined,
    coverage: coverage ? { narrative: coverage.narrative, weeks: coverage.weeks } : undefined,
    lastCfeSourceDate: lastRecordedDate(repo),
  });
}
