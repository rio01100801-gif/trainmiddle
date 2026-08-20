/**
 * S-7 / S-8 / S-9 ポイント練習の組み立てと漸進
 *
 * これまで生成器はカテゴリごとに**固定の文字列**を返していた
 * （高乳酸なら常に `300m × 5 r5分`）。変わるのは設定タイムだけで、
 * 週が進んでも、直近の出来がどうでも、同じ内容が出続けていた。
 *
 * ここでやること:
 *   ・フェーズと週で内容を進める（漸進）
 *   ・直近の実行状況を内容そのものに反映する
 *   ・進め方を2案出し、どちらも成立させたうえで理由を付ける（S-9）
 *
 * 守ること:
 *   ・LLMを使わない。同じ状態からは必ず同じ内容が出る
 *   ・**数値には必ず理由を書く。** あとで動かしていいか判断できなくなるため
 *   ・きつい方を良しとしない。実行できない設定を出さないことを優先する
 *
 * ここに書いた漸進の考え方（出典ではなく、採用した原則）:
 *   1. 量 → 密度 → 強度 の順に上げる。3つを同時に上げない
 *   2. 3週上げて1週落とす（3:1）。ACWRの急上昇を避ける
 *   3. レースに近づくほど特異的にする（距離を短く・設定をレースペースへ）
 *   4. 高乳酸は「深く入る」種目なので、土台期に量を積まない
 */
import type {
  Achievement,
  AthleteType,
  NextDayLegs,
  RestType,
  SessionCategory,
  TargetPace,
} from "./types";
import type { Phase } from "./types";
import type { AerobicProfile } from "./pace";
import { grpSecPerM, specificPace } from "./pace";
import { diffDays } from "./dates";
import type { Limiter } from "./limiter";
import type { TrendVerdict } from "./adaptive";
import { isStrainCause, type AbortCause } from "./abortCause";
import {
  TRAINING_LOAD_LABELS,
  type TrainingLoadClass,
} from "./trainingClassification";

// ---------------------------------------------------------------------------
// 素の組み立て（フェーズ × 週）
// ---------------------------------------------------------------------------

export interface RepBlock {
  distanceM: number;
  reps: number;
}

export interface SessionSpec {
  category: SessionCategory;
  name: string;
  templateId: string;
  variationGroup: string;
  progressionStage: number;
  selectionReasons: string[];
  alternativeTemplateIds: string[];
  confidence: "low" | "medium" | "high";
  repeatedForComparison?: boolean;
  /** 区間。1種類なら1つ、複合（500+300）なら複数 */
  blocks: RepBlock[];
  restSec: number;
  restType: RestType;
  /** 設定タイムの基準にする距離（複合なら最も本数の多い区間） */
  targetPaces: TargetPace[];
  prescription: string;
  durationMin: number;
  distanceKm: number;
  /** この内容にした理由。画面にそのまま出す */
  reasons: string[];
}

/**
 * フェーズごとの素の内容。
 *
 * 距離と本数の根拠:
 *   Base     … 高乳酸は200mまで。土台期に300m以上を積むと、
 *               有酸素の積み上げが乳酸系の疲労で削られる
 *   Build    … 300mへ。まだレストは長め（完全回復に近い）
 *   Specific … 300mのままレストを詰める。レース終盤の状況に近づける
 *   Modeling … 本数を落として複合にする。レースの形そのものを再現する
 */
export interface SessionTemplateCandidate {
  id: string;
  name: string;
  variationGroup: string;
  progressionStage: number;
  primaryStimulus: TrainingLoadClass;
  secondaryStimuli: TrainingLoadClass[];
  athleteTypes?: AthleteType[];
  difficulty: 1 | 2 | 3 | 4 | 5;
  neuralLoad: 1 | 2 | 3 | 4 | 5;
  glycolyticLoad: 1 | 2 | 3 | 4 | 5;
  aerobicLoad: 1 | 2 | 3 | 4 | 5;
  muscleDamageRisk: 1 | 2 | 3 | 4 | 5;
  recoveryDays: number;
  paceSource: "specific" | "lt" | "cv";
  /**
   * GRP比の上書き。**指定が無ければカテゴリの既定値**（`GRP_RATIOS`）を使う。
   *
   * 同じカテゴリの中で濃さの違う処方を置くために要る。
   * 経済走は 104〜106% が既定だが、その先に 101〜103% の帯がある
   * （レースペース付近を連続走で保つ枠。BACKLOG F-1）。
   *
   * `specificPace` の床（1.04）は動かさない。あれは
   * **導入の到達点**（106%から入って週ごとに104%へ寄せる）であって、
   * 経済走全体の下限ではない。床を下げると導入期の経済走が
   * 週を追うだけで速くなり、導入の目的（レースペースに慣れる）から外れる。
   * レシピ側に持たせれば、どの処方が何%なのかがレシピを見れば分かる。
   */
  grpRatio?: { fast: number; slow: number };
  blocks: RepBlock[];
  restSec: number;
  restType: RestType;
  /** 設定タイムを計算する距離 */
  paceDistanceM: number[];
  durationMin: number;
  distanceKm: number;
}

function raceEconomyCandidates(
  phase: "Build" | "Specific" | "Modeling",
  restSec: number,
  longReps: number
): SessionTemplateCandidate[] {
  const stage = phase === "Build" ? 0 : phase === "Specific" ? 1 : 2;
  return [
    {
      id: `race-economy-600-${phase.toLowerCase()}`,
      name: "レースペース経済走（600m）",
      variationGroup: "race-economy-long",
      progressionStage: stage,
      primaryStimulus: "middle_distance_specific",
      secondaryStimuli: ["aerobic_high"],
      athleteTypes: ["speed", "lactate_tolerant"],
      difficulty: phase === "Modeling" ? 4 : 3,
      neuralLoad: 3,
      glycolyticLoad: 3,
      aerobicLoad: 3,
      muscleDamageRisk: 2,
      recoveryDays: 3,
      paceSource: "specific",
      blocks: [{ distanceM: 600, reps: longReps }],
      restSec,
      restType: "full",
      paceDistanceM: [600],
      durationMin: phase === "Modeling" ? 50 : 60,
      distanceKm: phase === "Modeling" ? 7 : 8,
    },
    {
      id: `race-economy-500-${phase.toLowerCase()}`,
      name: "レースペース経済走（500m）",
      variationGroup: "race-economy-medium",
      progressionStage: stage,
      primaryStimulus: "middle_distance_specific",
      secondaryStimuli: ["neuromuscular"],
      athleteTypes: ["balanced"],
      difficulty: 3,
      neuralLoad: 3,
      glycolyticLoad: 3,
      aerobicLoad: 3,
      muscleDamageRisk: 2,
      recoveryDays: 3,
      paceSource: "specific",
      blocks: [{ distanceM: 500, reps: longReps + 1 }],
      restSec: Math.max(300, restSec - 60),
      restType: "full",
      paceDistanceM: [500],
      durationMin: phase === "Modeling" ? 50 : 60,
      distanceKm: phase === "Modeling" ? 7 : 8,
    },
    {
      id: `race-economy-400-${phase.toLowerCase()}`,
      name: "レースペース経済走（400m）",
      variationGroup: "race-economy-short",
      progressionStage: stage,
      primaryStimulus: "middle_distance_specific",
      secondaryStimuli: ["neuromuscular"],
      athleteTypes: ["endurance"],
      difficulty: 3,
      neuralLoad: 4,
      glycolyticLoad: 2,
      aerobicLoad: 2,
      muscleDamageRisk: 2,
      recoveryDays: 3,
      paceSource: "specific",
      blocks: [{ distanceM: 400, reps: longReps + 2 }],
      restSec: Math.max(240, restSec - 120),
      restType: "full",
      paceDistanceM: [400],
      durationMin: phase === "Modeling" ? 50 : 58,
      distanceKm: phase === "Modeling" ? 7 : 8,
    },
  ];
}

/**
 * レースペース経済走の**先の段**（GRP比 101〜103%）。
 *
 * 設定ペースの帯に空白があった。高乳酸95〜97%、モデリング99〜100%、経済走104〜106%で、
 * **101〜103% を連続走で走る枠が無かった**。モデリングは分割走（500m＋300m）なので、
 * つなぎを挟まずレースペース付近を保つ練習が存在しない。
 * 対象選手の制限因子は「後半の維持＝レースペース経済性」（`limiter.ts`）で、
 * まさにその帯が抜けていた。
 *
 * **追加ではなく置換。** 同じ `race_economy` カテゴリの別レシピなので週の枠数は増えない。
 * `progressionStage` を既存より1つ上に置き、**104〜106%を2回うまく実施したら**
 * 次の段として選ばれる（`desiredStage` は前回の段から、安定2回で+1）。
 * カレンダーで勝手に進まないので、実施できていないのに濃くなることはない。
 *
 * `variationGroup` を既存と分けるのは、同じだと `formatChanged` が立って
 * その週の漸進が止まるため。
 */
function raceEconomyTempoCandidates(
  phase: "Specific" | "Modeling"
): SessionTemplateCandidate[] {
  return [
    {
      id: `race-economy-tempo-600-${phase.toLowerCase()}`,
      name: "レースペース経済走（600m・濃い帯）",
      variationGroup: "race-economy-long-tempo",
      // 既存の経済走（Specific=1 / Modeling=2）の1つ上
      progressionStage: phase === "Specific" ? 2 : 3,
      primaryStimulus: "middle_distance_specific",
      secondaryStimuli: ["aerobic_high", "glycolytic"],
      athleteTypes: ["lactate_tolerant", "speed"],
      difficulty: 4,
      neuralLoad: 3,
      glycolyticLoad: 4,
      aerobicLoad: 3,
      muscleDamageRisk: 3,
      /*
       * 104〜106%（3日）より深く、高乳酸・モデリング（5日）よりは浅い。
       * この値は配置間隔を直接決めるものではなく、準備度と候補選びに効く。
       */
      recoveryDays: 4,
      paceSource: "specific",
      // ここが本体。カテゴリ既定の 104〜106% ではなく 101〜103% を狙う
      grpRatio: { fast: 1.01, slow: 1.03 },
      blocks: [{ distanceM: 600, reps: 2 }],
      // 完全回復6分。この帯は本数ではなく1本の質で効かせる
      restSec: 360,
      restType: "full",
      paceDistanceM: [600],
      durationMin: phase === "Modeling" ? 50 : 55,
      distanceKm: 7,
    },
  ];
}

function modelingCandidates(phase: "Specific" | "Modeling"): SessionTemplateCandidate[] {
  const common = {
    primaryStimulus: "middle_distance_specific" as const,
    secondaryStimuli: ["glycolytic", "neuromuscular"] as TrainingLoadClass[],
    difficulty: 5 as const,
    neuralLoad: 4 as const,
    glycolyticLoad: 5 as const,
    aerobicLoad: 2 as const,
    muscleDamageRisk: 4 as const,
    recoveryDays: 5,
    paceSource: "specific" as const,
    restSec: 60,
    restType: "walk" as const,
    durationMin: 55,
    distanceKm: 7,
    progressionStage: phase === "Specific" ? 1 : 2,
  };
  return [
    {
      ...common,
      id: `modeling-500-300-${phase.toLowerCase()}`,
      name: "モデリング（500m＋300m）",
      variationGroup: "modeling-split-800",
      athleteTypes: ["speed", "lactate_tolerant"],
      blocks: [
        { distanceM: 500, reps: 1 },
        { distanceM: 300, reps: 1 },
      ],
      paceDistanceM: [500, 300],
    },
    {
      ...common,
      id: `modeling-600-200-${phase.toLowerCase()}`,
      name: "モデリング（600m＋200m）",
      variationGroup: "modeling-split-800",
      athleteTypes: ["balanced", "endurance"],
      blocks: [
        { distanceM: 600, reps: 1 },
        { distanceM: 200, reps: 1 },
      ],
      paceDistanceM: [600, 200],
    },
  ];
}

/*
 * テーパー期（Taper）は載せない。
 * レース前の量はM-6とRULE-09が決めており、ここで別の根拠から本数を動かすと
 * 2つの仕組みが同じ週の量を取り合うことになる。漸進モデルが担当するのは積み上げの期間だけ。
 */
const RECIPE_CATALOG: Partial<
  Record<SessionCategory, Partial<Record<Phase, SessionTemplateCandidate[]>>>
> = {
  threshold: {
    Base: [
      {
        id: "threshold-1000-cruise",
        name: "サブ閾値インターバル",
        variationGroup: "threshold-cruise",
        progressionStage: 0,
        primaryStimulus: "aerobic_high",
        secondaryStimuli: ["aerobic_low"],
        athleteTypes: ["balanced", "endurance"],
        difficulty: 2,
        neuralLoad: 1,
        glycolyticLoad: 1,
        aerobicLoad: 4,
        muscleDamageRisk: 1,
        recoveryDays: 2,
        paceSource: "lt",
        blocks: [{ distanceM: 1000, reps: 4 }],
        restSec: 75,
        restType: "jog",
        paceDistanceM: [1000],
        durationMin: 55,
        distanceKm: 10,
      },
      {
        id: "threshold-1200-cruise",
        name: "サブ閾値ロングインターバル",
        variationGroup: "threshold-cruise",
        progressionStage: 1,
        primaryStimulus: "aerobic_high",
        secondaryStimuli: ["aerobic_low"],
        athleteTypes: ["speed", "lactate_tolerant"],
        difficulty: 3,
        neuralLoad: 1,
        glycolyticLoad: 1,
        aerobicLoad: 4,
        muscleDamageRisk: 1,
        recoveryDays: 2,
        paceSource: "lt",
        blocks: [{ distanceM: 1200, reps: 3 }],
        restSec: 75,
        restType: "jog",
        paceDistanceM: [1200],
        durationMin: 55,
        distanceKm: 10,
      },
      {
        id: "threshold-800-cruise",
        name: "短いクルーズインターバル",
        variationGroup: "threshold-short-cruise",
        progressionStage: 0,
        primaryStimulus: "aerobic_high",
        secondaryStimuli: ["aerobic_low"],
        difficulty: 2,
        neuralLoad: 1,
        glycolyticLoad: 1,
        aerobicLoad: 4,
        muscleDamageRisk: 1,
        recoveryDays: 2,
        paceSource: "lt",
        blocks: [{ distanceM: 800, reps: 5 }],
        restSec: 60,
        restType: "jog",
        paceDistanceM: [800],
        durationMin: 55,
        distanceKm: 10,
      },
    ],
  },
  cv: {
    Build: [
      {
        id: "cv-1000-standard",
        name: "CVインターバル",
        variationGroup: "cv-distance",
        progressionStage: 0,
        primaryStimulus: "aerobic_high",
        secondaryStimuli: ["middle_distance_specific"],
        difficulty: 3,
        neuralLoad: 1,
        glycolyticLoad: 2,
        aerobicLoad: 5,
        muscleDamageRisk: 1,
        recoveryDays: 2,
        paceSource: "cv",
        blocks: [{ distanceM: 1000, reps: 4 }],
        restSec: 120,
        restType: "jog",
        paceDistanceM: [1000],
        durationMin: 55,
        distanceKm: 10,
      },
      {
        id: "cv-1200-long",
        name: "CVロングインターバル",
        variationGroup: "cv-distance",
        progressionStage: 1,
        primaryStimulus: "aerobic_high",
        secondaryStimuli: ["middle_distance_specific"],
        athleteTypes: ["speed", "lactate_tolerant"],
        difficulty: 4,
        neuralLoad: 1,
        glycolyticLoad: 2,
        aerobicLoad: 5,
        muscleDamageRisk: 1,
        recoveryDays: 2,
        paceSource: "cv",
        blocks: [{ distanceM: 1200, reps: 3 }],
        restSec: 150,
        restType: "jog",
        paceDistanceM: [1200],
        durationMin: 58,
        distanceKm: 10,
      },
      {
        id: "cv-800-short",
        name: "CVショートインターバル",
        variationGroup: "cv-short",
        progressionStage: 0,
        primaryStimulus: "aerobic_high",
        secondaryStimuli: ["middle_distance_specific"],
        difficulty: 3,
        neuralLoad: 2,
        glycolyticLoad: 2,
        aerobicLoad: 4,
        muscleDamageRisk: 1,
        recoveryDays: 2,
        paceSource: "cv",
        blocks: [{ distanceM: 800, reps: 5 }],
        restSec: 90,
        restType: "jog",
        paceDistanceM: [800],
        durationMin: 55,
        distanceKm: 9,
      },
      {
        id: "cv-600-track",
        name: "CVトラックインターバル",
        variationGroup: "cv-track-short",
        progressionStage: 0,
        primaryStimulus: "aerobic_high",
        secondaryStimuli: ["middle_distance_specific"],
        difficulty: 3,
        neuralLoad: 2,
        glycolyticLoad: 2,
        aerobicLoad: 4,
        muscleDamageRisk: 1,
        recoveryDays: 2,
        paceSource: "cv",
        blocks: [{ distanceM: 600, reps: 6 }],
        restSec: 75,
        restType: "jog",
        paceDistanceM: [600],
        durationMin: 52,
        distanceKm: 9,
      },
      {
        id: "cv-mixed-descending",
        name: "CVミックスインターバル",
        variationGroup: "cv-mixed",
        progressionStage: 1,
        primaryStimulus: "aerobic_high",
        secondaryStimuli: ["middle_distance_specific"],
        athleteTypes: ["balanced", "speed"],
        difficulty: 4,
        neuralLoad: 2,
        glycolyticLoad: 2,
        aerobicLoad: 5,
        muscleDamageRisk: 1,
        recoveryDays: 2,
        paceSource: "cv",
        blocks: [
          { distanceM: 1200, reps: 1 },
          { distanceM: 1000, reps: 1 },
          { distanceM: 800, reps: 1 },
        ],
        restSec: 120,
        restType: "jog",
        paceDistanceM: [1200, 1000, 800],
        durationMin: 56,
        distanceKm: 9,
      },
    ],
  },
  high_lactate: {
    // 土台期は短く少なく。深く入らない
    Base: [
      {
        id: "high-lactate-200-controlled",
        name: "高乳酸導入（200m）",
        variationGroup: "high-lactate-short",
        progressionStage: 0,
        primaryStimulus: "glycolytic",
        secondaryStimuli: ["neuromuscular"],
        difficulty: 2,
        neuralLoad: 3,
        glycolyticLoad: 2,
        aerobicLoad: 2,
        muscleDamageRisk: 2,
        recoveryDays: 5,
        paceSource: "specific",
        blocks: [{ distanceM: 200, reps: 5 }],
        restSec: 180,
        restType: "jog",
        paceDistanceM: [200],
        durationMin: 50,
        distanceKm: 7,
      },
      {
        id: "high-lactate-150-intro",
        name: "高乳酸導入（150m）",
        variationGroup: "high-lactate-short",
        progressionStage: 0,
        primaryStimulus: "glycolytic",
        secondaryStimuli: ["neuromuscular"],
        difficulty: 2,
        neuralLoad: 3,
        glycolyticLoad: 2,
        aerobicLoad: 1,
        muscleDamageRisk: 2,
        recoveryDays: 5,
        paceSource: "specific",
        blocks: [{ distanceM: 150, reps: 6 }],
        restSec: 180,
        restType: "full",
        paceDistanceM: [150],
        durationMin: 48,
        distanceKm: 7,
      },
    ],
    Build: [
      {
        id: "high-lactate-300-standard",
        name: "高乳酸セッション（300m）",
        variationGroup: "high-lactate-repetition",
        progressionStage: 1,
        primaryStimulus: "glycolytic",
        secondaryStimuli: ["middle_distance_specific"],
        difficulty: 4,
        neuralLoad: 3,
        glycolyticLoad: 5,
        aerobicLoad: 2,
        muscleDamageRisk: 3,
        recoveryDays: 5,
        paceSource: "specific",
        blocks: [{ distanceM: 300, reps: 5 }],
        restSec: 300,
        restType: "jog",
        paceDistanceM: [300],
        durationMin: 60,
        distanceKm: 8,
      },
      {
        id: "high-lactate-400-low-volume",
        name: "高乳酸セッション（400m低容量）",
        variationGroup: "high-lactate-long",
        progressionStage: 1,
        primaryStimulus: "glycolytic",
        secondaryStimuli: ["middle_distance_specific"],
        athleteTypes: ["endurance", "balanced"],
        difficulty: 4,
        neuralLoad: 3,
        glycolyticLoad: 5,
        aerobicLoad: 2,
        muscleDamageRisk: 3,
        recoveryDays: 5,
        paceSource: "specific",
        blocks: [{ distanceM: 400, reps: 3 }],
        restSec: 360,
        restType: "full",
        paceDistanceM: [400],
        durationMin: 60,
        distanceKm: 8,
      },
    ],
    // レストを詰める＝レース終盤の状況に近づける
    Specific: [
      {
        id: "high-lactate-300-dense",
        name: "高乳酸セッション（300m密度）",
        variationGroup: "high-lactate-repetition",
        progressionStage: 2,
        primaryStimulus: "glycolytic",
        secondaryStimuli: ["middle_distance_specific"],
        difficulty: 5,
        neuralLoad: 3,
        glycolyticLoad: 5,
        aerobicLoad: 2,
        muscleDamageRisk: 3,
        recoveryDays: 5,
        paceSource: "specific",
        blocks: [{ distanceM: 300, reps: 5 }],
        restSec: 240,
        restType: "jog",
        paceDistanceM: [300],
        durationMin: 60,
        distanceKm: 8,
      },
      {
        id: "high-lactate-400-specific",
        name: "高乳酸セッション（400m特異的）",
        variationGroup: "high-lactate-long",
        progressionStage: 2,
        primaryStimulus: "glycolytic",
        secondaryStimuli: ["middle_distance_specific"],
        athleteTypes: ["endurance", "balanced"],
        difficulty: 5,
        neuralLoad: 3,
        glycolyticLoad: 5,
        aerobicLoad: 2,
        muscleDamageRisk: 4,
        recoveryDays: 5,
        paceSource: "specific",
        blocks: [{ distanceM: 400, reps: 3 }],
        restSec: 300,
        restType: "full",
        paceDistanceM: [400],
        durationMin: 60,
        distanceKm: 8,
      },
    ],
    Modeling: [
      {
        id: "high-lactate-300-tapered",
        name: "高乳酸セッション（低容量）",
        variationGroup: "high-lactate-repetition",
        progressionStage: 3,
        primaryStimulus: "glycolytic",
        secondaryStimuli: ["middle_distance_specific"],
        difficulty: 4,
        neuralLoad: 3,
        glycolyticLoad: 4,
        aerobicLoad: 2,
        muscleDamageRisk: 3,
        recoveryDays: 5,
        paceSource: "specific",
        blocks: [{ distanceM: 300, reps: 4 }],
        restSec: 180,
        restType: "jog",
        paceDistanceM: [300],
        durationMin: 55,
        distanceKm: 7,
      },
    ],
  },
  race_economy: {
    Build: raceEconomyCandidates("Build", 420, 3),
    Specific: [
      ...raceEconomyCandidates("Specific", 360, 3),
      ...raceEconomyTempoCandidates("Specific"),
    ],
    Modeling: [
      ...raceEconomyCandidates("Modeling", 420, 2),
      ...raceEconomyTempoCandidates("Modeling"),
    ],
  },
  modeling: {
    // レースの形。前半を作って終盤に入る流れを再現する
    Specific: modelingCandidates("Specific"),
    Modeling: modelingCandidates("Modeling"),
  },
};

/** Phase 1 の可視化・テスト用。呼び出し側が候補を変更できないよう複製して返す。 */
export function sessionTemplateCandidates(
  category: SessionCategory,
  phase: Phase
): SessionTemplateCandidate[] {
  return (RECIPE_CATALOG[category]?.[phase] ?? []).map((candidate) => ({
    ...candidate,
    blocks: candidate.blocks.map((block) => ({ ...block })),
    secondaryStimuli: [...candidate.secondaryStimuli],
    athleteTypes: candidate.athleteTypes ? [...candidate.athleteTypes] : undefined,
    paceDistanceM: [...candidate.paceDistanceM],
  }));
}

/** 週内の漸進。3週上げて1週落とす（3:1） */
export const LOAD_CYCLE_WEEKS = 4;

/**
 * 週の位置による調整。
 *   0週目 … 素のまま（そのブロックの入り口）
 *   1週目 … 量（本数+1）
 *   2週目 … 密度（レスト−20%）
 *   3週目 … 回復（本数−1・レストは素に戻す）
 *
 * 量→密度の順にするのは、同時に上げると「何が効いたのか」も
 * 「何がきつかったのか」も分からなくなるため。
 */
export function weekStep(weekIndex: number): "baseline" | "volume" | "density" | "recovery" {
  const w = ((weekIndex % LOAD_CYCLE_WEEKS) + LOAD_CYCLE_WEEKS) % LOAD_CYCLE_WEEKS;
  return (["baseline", "volume", "density", "recovery"] as const)[w];
}

/** レストを詰める割合。1回で25%以上詰めると別の練習になる */
export const DENSITY_STEP = 0.2;
/**
 * **反復のレストの下限（秒）。**
 *
 * 完全回復を前提とする反復（300m×5 など）で、これ以下だと回復が成立せず
 * 狙った設定で走れない。**この値は変えない。**
 *
 * 分割走のつなぎの時間とは別の概念。モデリング核（500m+300m を60秒でつなぐ）の
 * 60秒は「回復してから次を走る」ための時間ではなく、**レースの一部を再現するための
 * つなぎ**で、処方そのもの。ここを同じ下限で扱っていたため、密度を上げる週に
 * レストが60秒→90秒へ**伸びて**いた（理由には「詰めます」と出る）。
 * 最もレース再現性が高い練習が、最も特異性を失う方向に動いていた。
 */
export const MIN_REST_SEC = 90;

/**
 * レストそのものが処方の一部で、詰めても伸ばしても別の練習になるカテゴリ。
 *
 * モデリング核は800mを2本に割ってレースを再現する。
 * つなぎを詰めれば高乳酸の反復に、伸ばせばただの分割走に変わる。
 * **量でも密度でもなく「形」で決まっている**ので、漸進の対象にしない。
 * 週を追って変わるのは設定タイムだけ（CFEに連動する）。
 */
export function restIsPrescription(category: SessionCategory): boolean {
  return category === "modeling";
}

/**
 * そのレシピでのレストの下限。
 *
 * **下限が元のレストを上回ってはいけない。** 上回ると、詰めるつもりの操作で
 * 逆に伸びる。`MIN_REST_SEC` は「反復として成立する下限」であって
 * 「どのレシピでもここまで伸ばす」値ではない。
 */
export function restFloorSec(
  recipeRestSec: number,
  paceSource: "specific" | "lt" | "cv"
): number {
  // 完全回復を前提とする特異的練習と、短い回復で行う有酸素反復を同じ下限にしない。
  const byPaceSource = paceSource === "specific" ? MIN_REST_SEC : 45;
  return Math.min(recipeRestSec, byPaceSource);
}

export interface TemplateHistoryEntry {
  date: string;
  category: SessionCategory;
  templateId: string;
  variationGroup: string;
  progressionStage: number;
  achievement?: Achievement;
  rpe?: number;
  nextDayLegs?: NextDayLegs;
  aborted?: boolean;
  /** 途中でやめた理由。体への負担として数えるかがこれで変わる */
  abortCause?: AbortCause;
}

export interface BuildSpecInput {
  category: SessionCategory;
  phase: Phase;
  /** そのフェーズに入ってからの週数（0始まり） */
  weekIndex: number;
  /** CFE（推定800mタイム秒）。設定タイムの基準 */
  cfeSec: number;
  /** 直近の同カテゴリの実行状況（M-2と同じ判定） */
  trend?: TrendVerdict;
  /** ACWRが高い（急に増やさない） */
  loadHigh?: boolean;
  /**
   * 直近に疲労の兆候がある（黄・赤信号、翌日の脚の重さ、未達・中止）。
   * ACWRの裏付けが無くても、疲労の実測だけで筋損傷リスクの高い形式を避ける。
   */
  recentFatigueSignal?: boolean;
  /** 経済走の導入週（既存の漸進をそのまま使う） */
  economyWeek?: number;
  /** threshold / CV の実測ベース設定 */
  aerobicProfile?: AerobicProfile;
  /** 選手タイプは候補の除外ではなく、同点時に近い形式を選ぶ小さな重みとして使う */
  athleteType?: AthleteType;
  /** 完了済み履歴と、今回の生成中にすでに選んだ候補 */
  templateHistory?: TemplateHistoryEntry[];
  /** 再使用間隔を日付で評価するための対象日 */
  onDate?: string;
}

interface TemplateSelection {
  candidate: SessionTemplateCandidate;
  reasons: string[];
  alternativeTemplateIds: string[];
  confidence: "low" | "medium" | "high";
  repeatedForComparison: boolean;
}

const ATHLETE_TYPE_LABELS: Record<AthleteType, string> = {
  speed: "スピード型",
  balanced: "バランス型",
  lactate_tolerant: "高乳酸耐性型",
  endurance: "持久型",
};

function successful(entry: TemplateHistoryEntry): boolean {
  return (
    entry.achievement === "achieved" &&
    entry.aborted !== true &&
    (entry.rpe === undefined || entry.rpe <= 8) &&
    entry.nextDayLegs !== "heavy"
  );
}

/**
 * 候補選択は必ず決定的にする。同じ入力なら同じ templateId を返し、
 * ランダムな「飽き防止」で練習意図を変えない。
 */
function selectTemplate(
  candidates: SessionTemplateCandidate[],
  input: BuildSpecInput
): TemplateSelection {
  const onDate = input.onDate;
  const history = (input.templateHistory ?? [])
    .filter(
      (entry) =>
        entry.category === input.category &&
        (!onDate || (entry.date < onDate && diffDays(entry.date, onDate) <= 28))
    )
    .sort((a, b) => b.date.localeCompare(a.date));
  const completed = history.filter((entry) => entry.achievement !== undefined);
  const lastCompleted = completed[0];
  const stableCount = completed.slice(0, 2).filter(successful).length;
  const strainedCount = completed
    .slice(0, 2)
    .filter(
      (entry) =>
        entry.achievement === "partial" ||
        entry.achievement === "failed" ||
        // 天候・時間で止めたぶんは体への負担の証拠ではない（abortCause.ts）
        (entry.aborted === true && isStrainCause(entry.abortCause)) ||
        (entry.rpe !== undefined && entry.rpe >= 9) ||
        entry.nextDayLegs === "heavy"
    ).length;

  /*
   * **到達した段は保つ。**
   *
   * 以前は「前回**実施した**段」から始めていた。ところが同じ形式には
   * 14日のペナルティがかかるので、上の段にレシピが1つしか無いと
   * 次はそれが避けられて下の段が選ばれ、**その次の希望値も下がる**。
   * 上がっては落ちるを繰り返し、せっかく到達した段に留まれなかった
   * （101〜103%帯が隔週でしか出ない状態になっていた）。
   *
   * 段を下げるのは**実施できなかったときだけ**にする（未達・高RPE・翌日の脚・中止）。
   * 履歴は28日で切っているので、昔の一度きりの成功を持ち出すことはない。
   */
  let desiredStage = Math.min(...candidates.map((candidate) => candidate.progressionStage));
  if (lastCompleted) {
    /*
     * 起点は「前回**実施した**段」。到達した最高段には**しない**。
     * 崩れて1段下げたあと、次の週にいきなり最高段へ戻ってしまう。
     * 下げたぶんは、下の段で2回こなしてから上がり直す。
     */
    desiredStage = lastCompleted.progressionStage;
    if (input.trend === "ease" || strainedCount >= 2) {
      desiredStage = Math.max(0, desiredStage - 1);
    } else if (
      /*
       * 次の段へ進むのは、**その段を2回続けてこなせたとき**だけ。
       * 直近2回が成功でも、下の段での成功なら上の段の実績にはならない。
       */
      stableCount >= 2 &&
      completed.slice(0, 2).every((entry) => entry.progressionStage >= desiredStage)
    ) {
      desiredStage++;
    }
  }
  /*
   * **無い段を希望しない。**
   * 最上段をこなし続けると希望値がその上へ抜けてしまい、
   * 「どの候補も等しく遠い」状態になって段の差が効かなくなる。
   * そうなると同じ形式を避けるペナルティだけで決まり、下の段へ落ちる。
   */
  desiredStage = Math.min(
    desiredStage,
    Math.max(...candidates.map((candidate) => candidate.progressionStage))
  );

  /*
   * 希望する段に選択肢が1つしか無いか。
   *
   * 「14日以内に同じ形式を繰り返さない」は**入れ替えられる相手がいる前提**の規則。
   * 相手がいないのにこれを効かせると、繰り返しを避けるために**段を下げる**ことになる。
   * 濃さを落としてまで形式を変えるのは、狙いが逆。
   * 相手がいるときは従来どおり回す（ローテーションは段の中で効かせる）。
   */
  const aloneAtDesiredStage =
    candidates.filter((candidate) => candidate.progressionStage === desiredStage).length === 1;

  const scored = candidates.map((candidate) => {
    /*
     * **段のずれは、他のどの重みよりも重く見る。**
     *
     * 同じ形式を14日以内に繰り返すペナルティ（−4）のほうが大きいと、
     * 上の段にレシピが1つしか無いときに毎回そこから外れる。
     * ローテーションは**同じ段の中で**効かせるものであって、
     * 段を下げる理由にはならない。
     */
    let score = -Math.abs(candidate.progressionStage - desiredStage) * 6;
    const reasons: string[] = [
      `${input.phase}期の${TRAINING_LOAD_LABELS[candidate.primaryStimulus]}候補`,
    ];
    if (candidate.athleteTypes?.includes(input.athleteType ?? "balanced")) {
      score += 1;
      reasons.push(
        `${ATHLETE_TYPE_LABELS[input.athleteType ?? "balanced"]}に適した形式`
      );
    }
    if (lastCompleted?.templateId === candidate.id && stableCount < 2 && input.trend !== "ease") {
      score += 3;
      reasons.push("前回と同じ形式で進行と比較を確認");
    }
    if (lastCompleted?.templateId === candidate.id && strainedCount >= 2) {
      score -= 4;
      reasons.push("同形式で負担が続いたため別形式を優先");
    }
    for (const entry of history) {
      if (!onDate) continue;
      const age = diffDays(entry.date, onDate);
      const noAlternative =
        aloneAtDesiredStage && candidate.progressionStage === desiredStage;
      if (entry.templateId === candidate.id && age <= 14 && !noAlternative) score -= 4;
      else if (entry.variationGroup === candidate.variationGroup && age <= 14) score -= 1.5;
    }
    if (input.trend === "ease" && candidate.difficulty >= 4) score -= 2;
    // ペナルティ自体はここで付ける。理由は「避けられた側」ではなく「選ばれた側」の
    // reasonsに残す必要があるため、その説明はscored確定後にまとめて行う（下記）。
    const fatigueAvoided =
      (input.loadHigh || input.recentFatigueSignal) && candidate.muscleDamageRisk >= 4;
    if (fatigueAvoided) score -= 2;
    return { candidate, score, reasons, fatigueAvoided };
  });
  const minimumStage = Math.min(...candidates.map((candidate) => candidate.progressionStage));
  const rotationPool = candidates.filter(
    (candidate) => candidate.progressionStage === minimumStage
  );
  const rotation =
    input.category === "cv" && completed.length === 0
      ? Math.floor(Math.abs(input.weekIndex) / 2) % rotationPool.length
      : 0;
  const rotationRank = (candidate: SessionTemplateCandidate) => {
    const index = rotationPool.findIndex((item) => item.id === candidate.id);
    if (index < 0) return rotationPool.length;
    return (index - rotation + rotationPool.length) % rotationPool.length;
  };
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      rotationRank(a.candidate) - rotationRank(b.candidate) ||
      a.candidate.id.localeCompare(b.candidate.id)
  );
  const selected = scored[0];
  const repeatedForComparison =
    lastCompleted?.templateId === selected.candidate.id && stableCount < 2;
  if (history.some((entry) => entry.templateId === selected.candidate.id)) {
    selected.reasons.push(
      repeatedForComparison
        ? "同一処方を比較目的で再使用"
        : "代替候補よりフェーズ・進行段階への適合を優先"
    );
  } else {
    selected.reasons.push("直近28日に同一テンプレートの実施なし");
  }
  if (input.trend === "ease" || strainedCount >= 2) {
    selected.reasons.push("未達・高負担の傾向があるため進行段階を上げない");
  }
  else if (stableCount >= 2) selected.reasons.push("安定完遂が2回あり次段階を優先");
  else if (completed.length === 0) selected.reasons.push("同形式の実績不足のため初期候補");

  /*
   * 「600m反復は翌日疲労が強く残るので、同等の刺激を400m反復で低疲労コストに
   * 得たい」という着想への最小対応（8次元の刺激エンジンは作らない）。
   * ペナルティで避けられた候補が、ペナルティが無ければ実際に選ばれていた
   * （＝この選択を左右した）場合だけ、選ばれた側の理由として明記する。
   * 常に出すと「常に触れているが実際は決め手でない」説明になってしまうため、
   * 決定的だったときだけ出す。
   */
  const avoidedHigherRisk = scored.find(
    (item) =>
      item.fatigueAvoided &&
      item.candidate.id !== selected.candidate.id &&
      item.score + 2 > selected.score
  );
  if (avoidedHigherRisk) {
    selected.reasons.push(
      input.loadHigh
        ? `直近の負荷増加と疲労兆候があるため、筋損傷リスクの高い「${avoidedHigherRisk.candidate.name}」を避けました`
        : `直近の疲労兆候があるため、筋損傷リスクの高い「${avoidedHigherRisk.candidate.name}」を避けました`
    );
  }

  return {
    candidate: selected.candidate,
    reasons: selected.reasons,
    alternativeTemplateIds: scored.slice(1, 4).map((item) => item.candidate.id),
    confidence:
      completed.length >= 3 ? "high" : completed.length >= 1 ? "medium" : "low",
    repeatedForComparison,
  };
}

function targetPacesFor(
  recipe: SessionTemplateCandidate,
  input: BuildSpecInput
): TargetPace[] | undefined {
  if (recipe.paceSource === "specific") {
    if (recipe.grpRatio) {
      /*
       * レシピが比率を持っている場合は、導入の週番号を通さない。
       * `economyWeek` は「106%から104%へ寄せる」ための引数で、
       * 別の帯を狙う処方に当てると意味が混ざる。
       */
      const grp = grpSecPerM(input.cfeSec);
      return recipe.paceDistanceM.map((distanceM) => ({
        distanceM,
        targetSecFast: distanceM * grp * recipe.grpRatio!.fast,
        targetSecSlow: distanceM * grp * recipe.grpRatio!.slow,
      }));
    }
    return recipe.paceDistanceM.map((distanceM) =>
      specificPace(
        input.cfeSec,
        input.category,
        distanceM,
        input.category === "race_economy" ? input.economyWeek : undefined
      )
    );
  }
  if (!input.aerobicProfile) return undefined;
  if (recipe.paceSource === "lt") {
    return recipe.paceDistanceM.map((distanceM) => ({
      distanceM,
      targetSecFast: input.aerobicProfile!.ltPaceSecPerKm * (distanceM / 1000),
      targetSecSlow: (input.aerobicProfile!.ltPaceSecPerKm + 5) * (distanceM / 1000),
      isEstimated: input.aerobicProfile!.isEstimated,
    }));
  }
  return recipe.paceDistanceM.map((distanceM) => ({
    distanceM,
    targetSecFast: input.aerobicProfile!.cvPaceSecPerKm.fast * (distanceM / 1000),
    targetSecSlow: input.aerobicProfile!.cvPaceSecPerKm.slow * (distanceM / 1000),
    isEstimated: input.aerobicProfile!.isEstimated,
  }));
}

/**
 * そのカテゴリ・フェーズ・週の内容を組み立てる。
 *
 * 直近の出来を**内容そのもの**に反映する（S-7）。
 * M-2 は設定タイムだけを動かすが、こちらは本数とレストを動かす。
 * 設定が守れていないときに量を増やしても、守れない練習が増えるだけ。
 */
export function buildSessionSpec(input: BuildSpecInput): SessionSpec | undefined {
  const candidates = RECIPE_CATALOG[input.category]?.[input.phase];
  if (!candidates || candidates.length === 0) return undefined;
  const selection = selectTemplate(candidates, input);
  const recipe = selection.candidate;

  let blocks = recipe.blocks.map((b) => ({ ...b }));
  let restSec = recipe.restSec;
  const reasons: string[] = [...selection.reasons];
  const step = weekStep(input.weekIndex);
  const previousTemplate = (input.templateHistory ?? [])
    .filter(
      (entry) =>
        entry.category === input.category &&
        (!input.onDate || entry.date < input.onDate)
    )
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  const formatChanged =
    previousTemplate !== undefined && previousTemplate.templateId !== recipe.id;
  const minimumRestSec = restFloorSec(recipe.restSec, recipe.paceSource);
  const protectSpecificVolume = ["high_lactate", "modeling", "race_economy"].includes(
    input.category
  );

  // --- 週による漸進 ---
  if (step === "volume") {
    if (formatChanged) {
      reasons.push("形式を変更した週なので、本数・速度・レストは同時に進めない");
    } else if (!protectSpecificVolume) {
      blocks = bumpReps(blocks, 1);
      reasons.push(`${input.phase}期の2週目。まず量を増やします（本数 +1）`);
    } else {
      reasons.push("高乳酸・中距離特異的は本数を機械的に増やさず形式を維持");
    }
  } else if (step === "density") {
    if (formatChanged) {
      reasons.push("形式を変更した週なので、本数・速度・レストは同時に進めない");
    } else {
      if (!protectSpecificVolume) blocks = bumpReps(blocks, 1);
      if (restIsPrescription(input.category)) {
        reasons.push(
          `${input.phase}期の3週目。レース再現はつなぎの時間も処方なので詰めません（設定タイムだけが動きます）`
        );
      } else {
        /*
         * ここに来るレシピは必ず詰まる。
         * 下限が元のレストと同じになるのは restFloorSec の作りから
         * 「元のレストが下限以下」のときだけで、それに当たるのはモデリング核。
         * そちらは上の分岐で先に返している。
         * 「詰めていないのに詰めますと書く」ことは構造上起きない。
         */
        restSec = roundRestSec(Math.max(minimumRestSec, restSec * (1 - DENSITY_STEP)));
        reasons.push(
          `${input.phase}期の3週目。量は保ったままレストを${Math.round(DENSITY_STEP * 100)}%詰めます`
        );
      }
    }
  } else if (step === "recovery") {
    blocks = bumpReps(blocks, -1);
    reasons.push("4週目は回復週。3週上げたぶんを落として、次の入り口に備えます");
  } else {
    reasons.push(`${input.phase}期の入り口の内容です`);
  }

  // --- 直近の出来を反映（S-7）---
  if (input.trend === "ease") {
    // 設定を守れていない。量を増やす前に、守れる形へ戻す
    blocks = bumpReps(blocks, -1);
    restSec = Math.round(restSec * 1.15);
    reasons.push(
      "直近3回が設定より遅いので、量を増やさず実行できる形に戻します（本数 −1・レストを15%長く）"
    );
  } else if (input.trend === "tighten" && !formatChanged) {
    if (!protectSpecificVolume) {
      blocks = bumpReps(blocks, 1);
      reasons.push("直近3回とも設定より速く安定しているので、1本増やします");
    } else {
      reasons.push("直近実績は良好ですが、高乳酸・中距離特異的の本数は据え置きます");
    }
  } else if (input.trend === "tighten") {
    reasons.push("形式を変更したため、良好な実績があっても同時に本数を増やしません");
  }

  if (input.loadHigh) {
    blocks = bumpReps(blocks, -1);
    reasons.push("直近の負荷（ACWR）が高いので、本数を戻します");
  }

  // 本数は最低1本。0本にすると練習が消える
  blocks = blocks.map((b) => ({ ...b, reps: Math.max(1, b.reps) }));

  const targetPaces = targetPacesFor(recipe, input);
  if (!targetPaces) return undefined;

  return {
    category: input.category,
    name: recipe.name,
    templateId: recipe.id,
    variationGroup: recipe.variationGroup,
    progressionStage: recipe.progressionStage,
    selectionReasons: reasons,
    alternativeTemplateIds: selection.alternativeTemplateIds,
    confidence: selection.confidence,
    repeatedForComparison: selection.repeatedForComparison,
    blocks,
    restSec,
    restType: recipe.restType,
    targetPaces,
    prescription: describeSpec(blocks, restSec, recipe.restType, targetPaces),
    durationMin: recipe.durationMin,
    distanceKm: recipe.distanceKm,
    reasons,
  };
}

function bumpReps(blocks: RepBlock[], delta: number): RepBlock[] {
  // 複合（500+300）は本数を増やさない。形が壊れる
  if (blocks.length > 1) return blocks;
  return blocks.map((b) => ({ ...b, reps: b.reps + delta }));
}

const REST_JP: Record<RestType, string> = { jog: "jog", walk: "walk", full: "完全休息" };

/**
 * レストを5秒刻みに丸める。
 *
 * 漸進で 0.8 倍などを掛けると 207秒 のような端数が出る。
 * トラックで秒単位に測って刻む値ではないので、**そこまでの精度に意味が無い**うえ、
 * 「なぜ207なのか」を本人が読み解けない数字が処方に出る（実際に指摘された）。
 *
 * **丸めるのは表示ではなく値そのもの。** 表示だけ丸めると、
 * 文面の210秒と保存された207秒が食い違い、どちらが本当か分からなくなる。
 */
export function roundRestSec(sec: number): number {
  return Math.max(5, Math.round(sec / 5) * 5);
}

/** 処方の文面。一括入力が読み取れる書き方に揃える（同じ解釈を通すため） */
export function describeSpec(
  blocks: RepBlock[],
  restSec: number,
  restType: RestType,
  paces: TargetPace[]
): string {
  const rest = restSec % 60 === 0 ? `${restSec / 60}分` : `${restSec}秒`;
  const estimateNote = paces.some((p) => p.isEstimated) ? " ※推定値" : "";

  /*
   * 複合（500m＋300m）は区間ごとに設定が違う。
   *
   * 以前は `500m + 300m @500m 68.7〜69.4秒 / 300m 41.2〜41.6秒` と書いていたが、
   * これを一括入力のパーサは**持続走として読んでいた**（区間に割れず、
   * モデリングの日に結果入力の欄が組み上がらなかった）。
   *
   * 本人が日誌に書く形（`300(42)＋600(1:26)＋600(1:26)`）に揃える。
   * この形はパーサが元から読めるうえ、距離と設定が並んでいて人にも読みやすい。
   * 本数ぶんは繰り返して書く（`×2` はパーサが本数として数えないため、
   * 1つにまとめると区間が減って伝わらない）。
   */
  if (blocks.length > 1) {
    const body = blocks
      .flatMap((b) => {
        const p = paces.find((x) => x.distanceM === b.distanceM);
        const label = p
          ? `${b.distanceM}m(${p.targetSecFast.toFixed(1)}〜${p.targetSecSlow.toFixed(1)})`
          : `${b.distanceM}m`;
        return Array.from({ length: Math.max(1, b.reps) }, () => label);
      })
      .join("＋");
    return `${body} r${rest}（${REST_JP[restType]}）${estimateNote}`;
  }

  const body = `${blocks[0].distanceM}m × ${blocks[0].reps}`;
  const pace = paces
    .map((p) => `${p.distanceM}m ${p.targetSecFast.toFixed(1)}〜${p.targetSecSlow.toFixed(1)}秒`)
    .join(" / ");
  return `${body} @${pace} r${rest}（${REST_JP[restType]}）${estimateNote}`;
}

// ---------------------------------------------------------------------------
// S-9 2案
// ---------------------------------------------------------------------------

export interface SessionVariant {
  key: "volume" | "density" | "hold" | "quality";
  label: string;
  spec: SessionSpec;
  /** なぜこの案が成り立つのか */
  why: string;
  /** どちらを勧めるか。両方とも良い案なので、勧めない側も出す */
  recommended: boolean;
  /** false の場合、選択日の高負荷量は変えず将来の安全なメニューへ反映する */
  appliesToCurrent?: boolean;
}

/**
 * 進め方を2案作る。
 *
 * **どちらも成立する案にする。** 片方が明らかに劣る案だと、選ぶ意味が無く
 * 「推奨」を押すだけの操作になる。
 * 状態によって2案の中身そのものを変える:
 *   守れていない → 「本数を減らす」か「レストを伸ばす」（どちらも引く方向）
 *   ちょうど良い → 「量を増やす」か「レストを詰める」（伸ばす方向の2択）
 *   余裕がある   → 「本数を増やす」か「設定を上げる」
 *
 * 推奨は制限因子（M-7）で決める。後半の維持が課題なら密度、
 * 絶対スピードが課題なら量より質を選ぶ。
 */
export function sessionVariants(
  base: SessionSpec,
  opts: { trend?: TrendVerdict; limiter?: Limiter }
): SessionVariant[] {
  const { trend, limiter } = opts;
  const protectSpecificVolume = ["high_lactate", "modeling", "race_economy"].includes(
    base.category
  );
  /*
   * 密度側の案。
   *
   * **下限が元のレストを上回らない**ように `restFloorSec` を通す。
   * 上回ると、詰めるつもりの操作で逆に伸びる（実際にモデリング核で起きていた）。
   */
  const densityOption = (ratio: number) => {
    return {
      restSec: roundRestSec(
        Math.max(restFloorSec(base.restSec, "specific"), base.restSec * ratio)
      ),
      reason: `本数は保ち、レストを${Math.round((1 - ratio) * 100)}%詰めて密度を上げる`,
      label: "密度を上げる",
      why: "本数を増やさずに強度の密度だけを上げます。後半の維持を鍛える方向です。",
    };
  };

  /*
   * **レース再現の分割走には進め方の案を出さない。**
   *
   * 800mを2本に割って60秒でつなぐ、という形そのものが処方。
   * つなぎを詰めれば高乳酸の反復に、伸ばせばただの分割走に、
   * 本数を削れば単なる500mになる。どれも別の練習で、
   * 「同じ練習の進め方」として並べられるものではない。
   * 週を追って変わるのは設定タイムだけ（CFEに連動する）。
   *
   * 2案を機械的に出していたときは、密度案がレストを60秒→90秒へ**伸ばして**いた
   * （ラベルは「レストを15%詰めて密度を上げる」）。
   */
  if (restIsPrescription(base.category)) {
    return [
      {
        key: "hold",
        label: "この形のまま実施する",
        spec: base,
        why: "レース再現は区間の長さもつなぎの時間も処方の一部です。ここを動かすと別の練習になるので、変えずに走ります。設定タイムはCFEに合わせて動きます。",
        recommended: true,
        appliesToCurrent: true,
      },
    ];
  }

  const clone = (s: SessionSpec, blocks: RepBlock[], restSec: number, reasons: string[]): SessionSpec => ({
    ...s,
    blocks,
    restSec,
    prescription: describeSpec(blocks, restSec, s.restType, s.targetPaces),
    reasons,
  });

  if (trend === "ease") {
    // どちらも引く方向。設定を守れる形にするのが目的
    const a = clone(
      base,
      bumpReps(base.blocks, -1),
      base.restSec,
      [...base.reasons, "本数を1本減らして、設定どおりの質で終える"]
    );
    const b = clone(
      base,
      base.blocks,
      roundRestSec(base.restSec * 1.25),
      [...base.reasons, "本数は保ち、レストを25%伸ばして設定を守る"]
    );
    return [
      {
        key: "hold",
        label: "本数を減らす",
        spec: a,
        why: "1本あたりの質を落とさずに終えられます。設定タイムの意味を保てるのはこちらです。",
        recommended: limiter !== "endurance",
      },
      {
        key: "density",
        label: "レストを伸ばす",
        spec: b,
        why: "本数を保つので、こなす総量は落ちません。回復を長く取るぶん、後半の維持を鍛える効果は薄れます。",
        recommended: limiter === "endurance",
      },
    ];
  }

  if (trend === "tighten") {
    const a = clone(base, protectSpecificVolume ? base.blocks : bumpReps(base.blocks, 1), base.restSec, [
      ...base.reasons,
      protectSpecificVolume
        ? "高乳酸・中距離特異的の本数は増やさず、次の2週の有酸素量で積み上げる"
        : "余裕があるので1本増やす",
    ]);
    const tighten = densityOption(0.85);
    const b = clone(base, base.blocks, tighten.restSec, [...base.reasons, tighten.reason]);
    return [
      {
        key: "volume",
        label: protectSpecificVolume ? "次の2週で量を増やす" : "1本増やす",
        spec: a,
        why: protectSpecificVolume
          ? "この高負荷メニューの本数は増やしません。今後14日のジョグ時間など、安全な量だけを増やします。"
          : "同じ設定のまま総量を増やします。積み上げとしては安全側で、失敗しにくい進め方です。",
        recommended: limiter !== "endurance",
        appliesToCurrent: !protectSpecificVolume,
      },
      {
        key: "density",
        label: tighten.label,
        spec: b,
        why: tighten.why,
        recommended: limiter === "endurance",
      },
    ];
  }

  // 据え置き（hold）
  const a = clone(base, protectSpecificVolume ? base.blocks : bumpReps(base.blocks, 1), base.restSec, [
    ...base.reasons,
    protectSpecificVolume
      ? "高乳酸・中距離特異的の本数は据え置き、次の2週の有酸素量で積み上げる"
      : "量を1本ぶん増やす",
  ]);
  const dense = densityOption(1 - DENSITY_STEP);
  const b = clone(base, base.blocks, dense.restSec, [...base.reasons, dense.reason]);
  return [
    {
      key: "volume",
      label: protectSpecificVolume ? "次の2週で量を増やす" : "量を増やす",
      spec: a,
      why: protectSpecificVolume
        ? "高乳酸・中距離特異的の本数は機械的に増やさず、今後14日のジョグ・ロング走などから安全な対象だけを増やします。"
        : "本数を増やして総量を積みます。設定タイムは変わらないので、達成できるかどうかの見通しが立てやすい進め方です。",
      recommended: limiter !== "endurance",
      appliesToCurrent: !protectSpecificVolume,
    },
    {
      key: "density",
      label: dense.label,
      spec: b,
      why: dense.why,
      recommended: limiter === "endurance",
    },
  ];
}
