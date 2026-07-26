/**
 * 800m特化トレーニングツール — データモデル定義（仕様書セクション3）
 *
 * 設計原則:
 * - すべてのタイム・ペースは「秒」で内部保持する（仕様書 8）
 * - 日付は "YYYY-MM-DD"、日時は ISO 8601 文字列
 */

// ---------------------------------------------------------------------------
// 3-1. 選手プロフィール
// ---------------------------------------------------------------------------

export type HeatTolerance = "low" | "normal" | "high";
export type RecoveryProfile = "slow" | "normal" | "fast";

export interface InjuryRecord {
  bodyPart: string;
  period: string; // 例: "2024-06"
  note?: string;
}

/** 過去PB。長距離PBは is_current で「現在走れるか」を必ず区別する（仕様書 3-1 注意） */
export interface PersonalBest {
  timeSec: number;
  isCurrent: boolean; // false = 過去の記録。現在の有酸素能力の根拠に使わない
  date?: string;
}

export interface Athlete {
  id: string;
  name: string;
  heightCm?: number;
  weightKg?: number;
  skeletalMuscleKg?: number;
  pb400mSec?: number;
  pb800mSec: number;
  pb1500mSec?: number;
  pb3000m?: PersonalBest;
  pb5000m?: PersonalBest;
  heatTolerance: HeatTolerance;
  recoveryProfile: RecoveryProfile;
  injuryHistory: InjuryRecord[];
  /**
   * 最大心拍（実測値）。任意。
   * 相対強度の基準に使う。年齢からの推定式は使わない（個人差が±10拍以上あり、
   * 推定を基準にすると強度の判定がその誤差ぶん動く）。
   * 未入力なら記録の中の最高値を基準にし、それが実測の最高値であることを明示する。
   */
  maxHrBpm?: number;
  /**
   * 3-4: 選手タイプの手動設定。
   * 未設定なら PB からの自動診断（4-1）を使う。
   * 手動設定がある場合はそちらを優先し、自動診断との差異を通知する。
   */
  athleteTypeOverride?: AthleteType;
}

// ---------------------------------------------------------------------------
// 3-2. 目標とレース
// ---------------------------------------------------------------------------

export type RacePriority = "A" | "B" | "C";
export type RoundType = "heat" | "semifinal" | "final";
export type AdvancementRule = "place" | "time" | "place_and_time";

export interface Round {
  type: RoundType;
  datetime: string; // ISO 8601
  expectedPaceSec?: number; // 通過に必要な想定タイム（自動算出）
}

export interface Race {
  id: string;
  name: string;
  dateStart: string; // 開催初日 YYYY-MM-DD
  priority: RacePriority;
  rounds: Round[]; // 800mでは必須。1〜3本
  peakTargetRound: RoundType; // 通常 "final"
  advancementRule?: AdvancementRule;
  advancementDetail?: string;
  /** advancement_rule = "time" の場合の過去大会ボーダータイム（ユーザー入力） */
  borderTimeSec?: number;
}

export interface Goal {
  targetEvent: "800m";
  targetTimeSec: number;
  targetRaceId: string;
  subRaceIds: string[];
}

// ---------------------------------------------------------------------------
// 3-3. 現在地の実測データ
// ---------------------------------------------------------------------------

export type FitnessMarkerType = "race" | "workout" | "test";

export interface FitnessMarker {
  id: string;
  date: string;
  type: FitnessMarkerType;
  description: string;
  /** ラップ配列（秒） */
  resultLapsSec: number[];
  /** 各ラップの距離（m）。周回計測ズレに対応するため個別編集可能（仕様書 8） */
  lapDistancesM?: number[];
  avgHr?: number;
  maxHr?: number;
  rpe?: number; // 1-10
  conditionNote?: string;
}

// ---------------------------------------------------------------------------
// 3-4. セッション
// ---------------------------------------------------------------------------

/**
 * 練習カテゴリ（仕様書 4-3）
 * - "modeling" はレース再現セッション（GRP 100〜99%）。4-2/4-5で独立に扱われるため
 *   カテゴリとして分離する。制約ルール上は high_lactate 相当として扱う箇所がある
 *   （RULE-01/07/22 参照）。
 * - "neural" は解糖系ではない。質練習の回数にカウントしない（仕様書 4-3 重要）。
 */
export type SessionCategory =
  | "high_lactate"
  | "race_economy"
  | "modeling"
  | "neural"
  | "cv"
  | "threshold"
  | "aerobic"
  | "off";

export type SessionStatus = "planned" | "completed" | "modified" | "skipped";
export type RiskLevel = "low" | "mid" | "high";
export type TimeOfDay = "am" | "pm";
export type Phase = "Base" | "Build" | "Specific" | "Modeling" | "Taper";
export type Surface = "road" | "track" | "treadmill" | "grass" | "hill";

export interface SessionRationale {
  purpose: string; // 【目的】
  targetAbility: string; // 【狙う能力】
  physiologicalBasis: string; // 【生理学的根拠】
  merit: string; // 【メリット】
  demerit: string; // 【デメリット】
  execution: string; // 【実施方法】
  improves800mPhase: string; // ① 800mのどの局面が改善するか
  whyNow: string; // ② なぜ今やるべきか
  whyPriority: string; // ③ 他の練習より優先する理由
  costOfSkipping: string; // ④ やらない場合のデメリット
}

export interface TargetPace {
  distanceM: number;
  targetSecFast: number; // 速い側
  targetSecSlow: number; // 遅い側
  /** 実測データが不足している場合の推定値フラグ（仕様書 4-2） */
  isEstimated?: boolean;
}

export interface Session {
  id: string;
  date: string;
  category: SessionCategory;
  name: string;
  /** 距離・本数・設定・レスト の記述 */
  prescription: string;
  targetPaces: TargetPace[];
  transfer800m: number; // 1-5
  transfer1500m: number; // 1-5
  riskLevel: RiskLevel;
  phase: Phase;
  rationale?: SessionRationale;
  status: SessionStatus;
  /** true = チーム練習等で変更不可。ルールエンジンは動かさない（RULE-15） */
  isFixed: boolean;
  fixedSource?: string;
  timeOfDay: TimeOfDay;
  /** 走行距離（km）。RULE-09 / RULE-17 の判定に使用 */
  distanceKm?: number;
  /** 所要時間（分）。RULE-02 / 負荷計算に使用 */
  durationMin?: number;
  /** ジョグ等のペース（秒/km）。RULE-02 / RULE-13 の判定に使用 */
  paceSecPerKm?: number;
  surface?: Surface;
  shoes?: string;
  /** ラウンド間の回復プロトコルとして生成されたセッション（RULE-20 の例外） */
  isRecoveryProtocol?: boolean;
  /**
   * 過去データの遡り入力から作られた実施済みセッション。
   * 負荷計算（ACWR）には使うが、ルールエンジンの評価対象からは外す。
   * 過ぎた日の練習構成を今から直すことはできないため。
   */
  backfilled?: boolean;
}

// ---------------------------------------------------------------------------
// 3-4b. 補強セッション
// ---------------------------------------------------------------------------

export type StrengthType = "strength" | "plyometrics" | "medicine_ball" | "core";
export type LoadLevel = "light" | "moderate" | "heavy";

export interface StrengthSession {
  id: string;
  date: string;
  timeOfDay: TimeOfDay;
  type: StrengthType;
  loadLevel: LoadLevel;
  exercises: string[];
  note?: string;
  durationMin?: number;
  /** プライオの週間接地回数管理用（4-8-4） */
  contactCount?: number;
  isFixed?: boolean;
  status?: SessionStatus;
}

// ---------------------------------------------------------------------------
// 3-5. 練習結果
// ---------------------------------------------------------------------------

export type Achievement = "achieved" | "partial" | "failed";
export type Subjective = "easy" | "moderate" | "hard" | "very_hard";
export type NextDayLegs = "fresh" | "normal" | "heavy";
export type SkipReason =
  | "fatigue"
  | "red_signal"
  | "injury"
  | "schedule"
  | "weather"
  | "other";

/** レストの種類（1-2） */
export type RestType = "jog" | "walk" | "full";

/** インターバル/レペの1本ごとの実施記録（1-2） */
export interface RepResult {
  index: number;
  distanceM: number;
  /** 設定タイム（秒） */
  targetSec?: number;
  /** 実施タイム（秒） */
  actualSec: number;
  /**
   * その1本の平均心拍。任意。
   * 同じ設定・同じタイムでも心拍が上がっていれば疲労とみなせる（Q-1）。
   * 時計から拾える人だけが入れるので、無いことのほうが多い前提で扱う。
   */
  avgHr?: number;
  note?: string;
}

/** インターバル/レペの構造化された処方と実績（1-2） */
export interface IntervalDetail {
  reps: number;
  distanceM: number;
  targetSec?: number;
  /**
   * レストの種類。日誌に書かれていないことがあるので任意。
   * 「r5分」とだけ書かれたものをジョグと決めつけない（表示にしか使わない項目なので、
   * 分からないなら出さないほうが正しい）。
   */
  restType?: RestType;
  /** レスト時間（秒）。距離指定の場合は undefined */
  restSec?: number;
  /** レスト距離（m）。時間指定の場合は undefined */
  restDistanceM?: number;
  results: RepResult[];
}

/** ジョグ・持続走の記録（1-1） */
export interface ContinuousRunDetail {
  distanceKm: number;
  durationMin: number;
  /** 平均ペース（秒/km）。距離と時間から自動計算するが手入力で上書き可 */
  avgPaceSecPerKm: number;
  /** true = ユーザーが手入力で上書きした */
  paceOverridden?: boolean;
  avgHr?: number;
  maxHr?: number;
}

export interface SessionResult {
  id: string;
  sessionId: string;
  date: string;
  actualLapsSec: number[];
  /** 1-1: ジョグ・持続走として記録した場合 */
  continuous?: ContinuousRunDetail;
  /** 1-2: インターバル・レペとして構造化記録した場合 */
  interval?: IntervalDetail;
  lapDistancesM?: number[];
  /** 実施本数（処方より少ない場合＝中断。SKIP-06） */
  completedReps?: number;
  /**
   * M-3: 中止基準にしたがって打ち切った。
   * 「失敗」ではなく正常な運用として扱う。設定が高すぎたか、その日の状態が悪かったかで、
   * どちらも次の設定を決める材料になる（M-2）。
   * 打ち切りを未達としてCFEに響かせない（指示どおり止めたことを罰しない）。
   */
  aborted?: boolean;
  abortReason?: string;
  prescribedReps?: number;
  achievement: Achievement;
  rpe: number; // 1-10
  subjective: Subjective;
  nextDayLegs?: NextDayLegs;
  weatherTempC?: number;
  /** 2-1: 環境条件（湿度・風・雨）。weatherTempC と合わせてWBGTを推定する */
  humidityPct?: number;
  wind?: "calm" | "light" | "strong";
  windDirection?: string;
  rain?: boolean;
  /** 2-1: WBGT等から自動判定される暑熱条件フラグ。true は能力推定から除外 */
  heatFlagged?: boolean;
  skipReason?: SkipReason;
  note?: string;
  durationMin?: number;
  /** 過去データの遡り入力から作られた結果（CFEの逐次更新ループには流さない） */
  backfilled?: boolean;
}

// ---------------------------------------------------------------------------
// 3-6. 日次コンディション
// ---------------------------------------------------------------------------

export type Signal = "green" | "yellow" | "red";

export interface DailyCheck {
  date: string;
  restingHr?: number;
  sleepQuality?: number; // 1-5 (5=良い)
  muscleTightness?: number; // 1-5 (5=強い張り)
  overallFatigue?: number; // 1-5 (5=強い疲労)
  /** 2-2: 脚の疲労 1-5 (5=強い) */
  legFatigue?: number;
  /** 2-2: モチベーション 1-5 (5=高い) */
  motivation?: number;
  signal?: Signal; // 自動判定結果を保持
}

// ---------------------------------------------------------------------------
// 2-3. 故障ログ
// ---------------------------------------------------------------------------

export type InjuryStatus = "onset" | "ongoing" | "recovered";

export const INJURY_STATUS_LABELS: Record<InjuryStatus, string> = {
  onset: "発生",
  ongoing: "継続",
  recovered: "回復",
};

export interface InjuryLog {
  id: string;
  date: string;
  /** 部位（例: 右アキレス腱、左ハムストリング） */
  bodyPart: string;
  /** 痛みの程度 0〜10 */
  painLevel: number;
  status: InjuryStatus;
  /** 発生したセッションへの紐づけ（任意） */
  sessionId?: string;
  note?: string;
}

// ---------------------------------------------------------------------------
// 4-5-1. CFE（Current Fitness Estimate）
// ---------------------------------------------------------------------------

export interface CfeHistoryEntry {
  date: string;
  before: number;
  after: number;
  source: string; // どの結果・レースが引き金か
  note?: string;
  /**
   * この更新を引き起こしたセッション。
   * 記録を修正して再保存したときに、前回ぶんの更新を取り消して
   * 入れ直すために使う。これが無いと、同じ練習で2回CFEが動く。
   */
  sessionId?: string;
}

export interface CurrentFitnessEstimate {
  estimated800mSec: number;
  confidence: number; // 0.0〜1.0
  lastUpdated: string;
  history: CfeHistoryEntry[];
}

// ---------------------------------------------------------------------------
// 4-10. 暑熱順化ブロック
// ---------------------------------------------------------------------------

export interface HeatBlock {
  id: string;
  startDate: string;
  endDate: string;
  targetRaceId: string;
}

export interface HeatBlockEntry {
  date: string;
  tempC: number;
  humidityPct?: number;
  avgHr?: number;
  paceSecPerKm?: number;
  weightBeforeKg?: number;
  weightAfterKg?: number;
  subjectiveStrain?: number; // 1-5
}

// ---------------------------------------------------------------------------
// 診断・警告の共通型
// ---------------------------------------------------------------------------

export type ViolationLevel = "ERROR" | "WARN" | "INFO";

export interface RuleViolation {
  rule: string; // 例: "RULE-01"
  level: ViolationLevel;
  message: string;
  dates: string[]; // 関係するセッションの日付
  sessionIds: string[];
  suggestion?: string;
  /** RULE-15: 固定セッションが原因で回避不能な違反 */
  unavoidable?: boolean;
  /** 自動修正の提案内容（適用は任意） */
  autofix?: SessionChange[];
}

/** 変更差分（4-5-9）。数値だけを黙って書き換えない */
export interface SessionChange {
  sessionId: string;
  field: string;
  before: string | number;
  after: string | number;
  reason: string; // どのルール／どの結果が引き金か
  triggeredBy: string; // 例: "PROP-01", "SKIP-02", "CFE"
  /** "down" = 下げ方向, "up" = 上げ方向（4-5-5 優先順位解決に使用） */
  direction: "down" | "up" | "neutral";
  /** 削除・置換の場合 */
  action?: "modify" | "delete" | "postpone" | "replace_with_aerobic" | "replace_with_off";
}

// ---------------------------------------------------------------------------
// 4-1. タイプ判定の出力
// ---------------------------------------------------------------------------

export type AthleteType = "speed" | "balanced" | "lactate_tolerant" | "endurance";
export type PrimaryGap = "前半経済性" | "後半維持" | "絶対スピード" | "有酸素土台";

export interface Diagnosis {
  speedReservePct?: number; // 指標A
  speedReserveJudgement?: string;
  conversionDiffSec?: number; // 指標B
  conversionDiffJudgement?: string;
  diff8001500Sec?: number; // 指標C
  diff8001500Judgement?: string;
  athleteType: AthleteType;
  primaryGap: PrimaryGap;
  requiredSpeedReservePct?: number; // 目標タイムに対する必要速度予備率
  narrative: string; // 診断の説明文
}

// ---------------------------------------------------------------------------
// 週次サマリー（4-4）
// ---------------------------------------------------------------------------

export interface WeeklySummary {
  weekStart: string; // 月曜
  categoryCounts: Record<SessionCategory, number>;
  categoryTimeRatio: Record<string, number>;
  transfer800mScore: number; // 負荷加重平均
  highLactateLast28d: number;
  violations: RuleViolation[];
  totalDistanceKm: number;
}
