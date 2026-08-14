/**
 * 4-6. ピリオダイゼーション自動生成
 * ファンネル理論: 純スピード(neural)と超低強度(aerobic)の両極から開始し、
 * 徐々に目標レースペースへ収束させる。
 * Base期でも neural を微量で継続する非線形ピリオダイゼーションを採用。
 */
import type {
  Athlete,
  AthleteType,
  Goal,
  Phase,
  Race,
  Session,
  SessionCategory,
  AerobicPurpose,
  StrengthSession,
  TargetPace,
} from "./types";
import { addDays, diffDays, fmtPacePerKm, fmtTime, weekStart } from "./dates";
import { guardedBaseTime } from "./cfe";
import { AerobicProfile, specificPace } from "./pace";
import { rationaleFor } from "./rationale";
import { buildSessionSpec, type TemplateHistoryEntry } from "./progression";
import { isHighLoadCategory, isSpecificCategory } from "./trainingClassification";
import { STRENGTH_PHASE_TABLE } from "./strength";
import type { TrendVerdict } from "./adaptive";
import {
  type CustomMenu,
  type Dow,
  type TrainingCycle,
  type WeekTemplate,
  type WeekdayPreferenceMode,
  type WeekdaySlot,
  amSlotOf,
  cycleAmSlotOf,
  cycleModeOf,
  cycleOf,
  cycleSlotOf,
  isPointSlot,
  modeOf,
  pickCustomMenu,
  slotOf,
} from "./weekTemplate";
import {
  type OffSeasonEmphasis,
  OFF_SEASON_HORIZON_WEEKS,
  OFF_SEASON_LABELS,
  describeOffSeasonBlock,
  offSeasonEmphasis,
} from "./offSeason";
import {
  type CycleShape,
  type CycleShapeInput,
  cycleNumberOf,
  cyclePositionOf,
  planCycleShape,
  pointCategoryAt,
} from "./cycleTemplate";

/** レースまでの日数からフェーズを判定する（仕様書 4-6 の表） */
export function phaseForDaysToRace(days: number): Phase {
  if (days >= 84) return "Base"; // 12週〜
  if (days >= 56) return "Build"; // 8〜12週
  if (days >= 28) return "Specific"; // 4〜8週
  if (days >= 14) return "Modeling"; // 2〜4週
  return "Taper"; // 〜2週
}

export function phaseForDate(date: string, raceDate: string): Phase {
  return phaseForDaysToRace(diffDays(date, raceDate));
}

// ---------------------------------------------------------------------------
// 週テンプレート
// ---------------------------------------------------------------------------

interface DayTemplate {
  category: SessionCategory;
  name: string;
  buildPrescription: (grpBase: number, aerobic: AerobicProfile) => {
    prescription: string;
    targetPaces: TargetPace[];
    distanceKm?: number;
    durationMin?: number;
    paceSecPerKm?: number;
  };
  transfer800m: number;
  transfer1500m: number;
  risk: "low" | "mid" | "high";
  timeOfDay?: "am" | "pm";
  aerobicPurpose?: AerobicPurpose;
  /**
   * この処方が本来「ジョグ+刺激」のような複合内容を1つの文面に押し込んでいた場合の
   * ジョグ分（分）。設定すると、この処方自体の文面からはジョグ部分を外し、
   * 別のaerobicセッションとして同じ日にもう1件自動生成する
   * （不具合: 「ジョグ＋坂ダッシュ」等が1セッションに固められ、
   * 別々に記録したいという要望に応えられなかった）。
   */
  combinedJogMin?: number;
}

const jog = (min: number, name = "ジョグ"): DayTemplate => ({
  category: "aerobic",
  name,
  aerobicPurpose: /回復|調整/.test(name) ? "recovery" : "aerobic",
  buildPrescription: (_g, a) => {
    const pace = (a.jogPaceSecPerKm.fast + a.jogPaceSecPerKm.slow) / 2;
    const recovery = /回復|調整/.test(name);
    return {
      prescription: recovery
        ? `${min}分回復ジョグ（会話可能・RPE 2〜3を優先。${fmtPacePerKm(
            a.jogPaceSecPerKm.slow
          )}は速くしすぎない目安で、疲労・暑熱時は遅くてよい）`
        : `${min}分有酸素ジョグ @${fmtPacePerKm(
            a.jogPaceSecPerKm.fast
          )}〜${fmtPacePerKm(
            a.jogPaceSecPerKm.slow
          )}（会話可能な呼吸・RPE 3〜4を優先。暑熱時はペースを強制しない）`,
      targetPaces: [],
      durationMin: min,
      distanceKm: Math.round(((min * 60) / pace) * 10) / 10,
      paceSecPerKm: pace,
    };
  },
  transfer800m: 2,
  transfer1500m: 2,
  risk: "low",
});

const longRun = (min: number): DayTemplate => ({
  category: "aerobic",
  name: "ロングラン",
  aerobicPurpose: "long_run",
  buildPrescription: (_g, a) => {
    const pace = (a.longRunPaceSecPerKm.fast + a.longRunPaceSecPerKm.slow) / 2;
    return {
      prescription: `${min}分ロングラン @${fmtPacePerKm(a.longRunPaceSecPerKm.fast)}〜${fmtPacePerKm(a.longRunPaceSecPerKm.slow)}`,
      targetPaces: [],
      durationMin: min,
      distanceKm: Math.round(((min * 60) / pace) * 10) / 10,
      paceSecPerKm: pace,
    };
  },
  transfer800m: 2,
  transfer1500m: 3,
  risk: "low",
});

const off = (): DayTemplate => ({
  category: "off",
  name: "完全休養",
  buildPrescription: () => ({ prescription: "完全休養", targetPaces: [] }),
  transfer800m: 1,
  transfer1500m: 1,
  risk: "low",
});

const hillSprints = (reps: number): DayTemplate => ({
  category: "neural",
  name: "坂ダッシュ",
  buildPrescription: () => ({
    prescription: `坂ダッシュ 8〜10秒 × ${reps}本（完全休息・歩行で戻る）`,
    targetPaces: [],
    durationMin: 15,
    distanceKm: 1,
  }),
  transfer800m: 3,
  transfer1500m: 2,
  risk: "low",
  // 別枠のジョグと合わせて元の「坂ダッシュ+ジョグ30分」と同じ内容にする
  combinedJogMin: 30,
});

const strides = (reps: number, dist = 150): DayTemplate => ({
  category: "neural",
  name: "流し",
  buildPrescription: (g) => ({
    prescription: `${dist}m流し × ${reps}本（完全休息）`,
    targetPaces: [specificPace(g, "neural", dist)],
    durationMin: 15,
    distanceKm: 1,
  }),
  transfer800m: 3,
  transfer1500m: 2,
  risk: "low",
  combinedJogMin: 30,
});

const thresholdReps = (): DayTemplate => ({
  category: "threshold",
  name: "サブ閾値インターバル",
  buildPrescription: (_g, a) => ({
    prescription: `1000m × 4〜5 @${fmtPacePerKm(a.ltPaceSecPerKm)} r60〜75秒${a.isEstimated ? "（※LTは推定値。実測入力を推奨）" : ""}`,
    targetPaces: [
      {
        distanceM: 1000,
        targetSecFast: a.ltPaceSecPerKm,
        targetSecSlow: a.ltPaceSecPerKm + 5,
        isEstimated: a.isEstimated,
      },
    ],
    durationMin: 55,
    distanceKm: 10,
  }),
  transfer800m: 2,
  transfer1500m: 4,
  risk: "low",
});

const cvReps = (): DayTemplate => ({
  category: "cv",
  name: "CVインターバル",
  buildPrescription: (_g, a) => ({
    prescription: `1000m × 4 @${fmtPacePerKm(a.cvPaceSecPerKm.fast)}〜${fmtPacePerKm(a.cvPaceSecPerKm.slow)} r2分${a.isEstimated ? "（※推定値）" : ""}`,
    targetPaces: [
      {
        distanceM: 1000,
        targetSecFast: a.cvPaceSecPerKm.fast,
        targetSecSlow: a.cvPaceSecPerKm.slow,
        isEstimated: a.isEstimated,
      },
    ],
    durationMin: 55,
    distanceKm: 10,
  }),
  transfer800m: 3,
  transfer1500m: 4,
  risk: "mid",
});

const raceEconomy = (economyWeek?: number): DayTemplate => ({
  category: "race_economy",
  name: "レースペース経済走",
  buildPrescription: (g) => {
    const p = specificPace(g, "race_economy", 600, economyWeek);
    return {
      prescription: `600m × 3 @${p.targetSecFast.toFixed(1)}〜${p.targetSecSlow.toFixed(1)}秒 r7分（完全休息）`,
      targetPaces: [p],
      durationMin: 60,
      distanceKm: 8,
    };
  },
  transfer800m: 5,
  transfer1500m: 3,
  risk: "mid",
});

const highLactate = (): DayTemplate => ({
  category: "high_lactate",
  name: "高乳酸セッション",
  buildPrescription: (g) => {
    const p = specificPace(g, "high_lactate", 300);
    return {
      prescription: `300m × 5 @${p.targetSecFast.toFixed(1)}〜${p.targetSecSlow.toFixed(1)}秒 r5分`,
      targetPaces: [p],
      durationMin: 60,
      distanceKm: 8,
    };
  },
  transfer800m: 5,
  transfer1500m: 3,
  risk: "high",
});

const modelingCore = (): DayTemplate => ({
  category: "modeling",
  name: "モデリング核（レース再現）",
  buildPrescription: (g) => {
    const p500 = specificPace(g, "modeling", 500);
    const p300 = specificPace(g, "modeling", 300);
    return {
      prescription: `(500m + 300m) × 1〜2 @レースペース(500m ${p500.targetSecFast.toFixed(1)}〜${p500.targetSecSlow.toFixed(1)}秒 / 300m ${p300.targetSecFast.toFixed(1)}〜${p300.targetSecSlow.toFixed(1)}秒) 間60秒`,
      targetPaces: [p500, p300],
      durationMin: 60,
      distanceKm: 7,
    };
  },
  transfer800m: 5,
  transfer1500m: 3,
  risk: "high",
});

/**
 * そのフェーズが本来もっているカテゴリ配分（4週ぶんの回数）。
 *
 * 「この期間なら何回欲しいか」を別表で持たない。
 * 生成器が実際に置く内容そのものを数えることで、
 * 提案の基準と生成の基準がずれないようにする（Q-2）。
 */
export function categoryCountsPerFourWeeks(phase: Phase): Record<SessionCategory, number> {
  const out = {
    high_lactate: 0,
    race_economy: 0,
    modeling: 0,
    neural: 0,
    cv: 0,
    threshold: 0,
    aerobic: 0,
    off: 0,
  } as Record<SessionCategory, number>;
  for (let w = 0; w < 4; w++) {
    for (const d of weekTemplate(phase, w % 2, w)) {
      if (d) out[d.category]++;
    }
  }
  return out;
}

/**
 * 冬季・基礎構築モードの週テンプレート（月曜始まり）。
 *
 * どれも Base（基礎期）の変形。フェーズを増やしていないのは、
 * 処方の中身（`RECIPE_CATALOG`）・補強・ペースの土台が全部フェーズで引かれているので、
 * 新しいフェーズを足すと**そこに載っていないカテゴリが固定文面に落ちる**ため。
 * 冬にやりたいのは「基礎期の中で重心を移すこと」なので、Baseのままでよい。
 *
 * 変えているのは並びだけ。高乳酸は入れない（`speed_base` の隔週だけ残す）——
 * レースが無い期間に高乳酸を積む理由が無く、積むと春に上げしろが残らない。
 */
function offSeasonWeekTemplate(
  emphasis: OffSeasonEmphasis,
  weekParity: number
): (DayTemplate | null)[] {
  switch (emphasis) {
    case "aerobic_volume":
      // 有酸素の土台。ロングランを長くし、質は閾値1本に絞る
      return [
        jog(45),
        hillSprints(8),
        jog(55),
        thresholdReps(),
        jog(40, "回復ジョグ"),
        strides(6),
        longRun(80),
      ];
    case "strength_hills":
      // 坂を週2本。接地で押す力を作る期間なので、走る質は閾値1本に留める
      return [
        jog(40),
        hillSprints(10),
        jog(40, "回復ジョグ"),
        thresholdReps(),
        jog(45),
        hillSprints(8),
        longRun(70),
      ];
    case "aerobic_high":
      // 閾値とCVを2本。乳酸を処理する側を上げる
      return [
        jog(40),
        thresholdReps(),
        jog(40, "回復ジョグ"),
        strides(6),
        cvReps(),
        jog(45),
        longRun(70),
      ];
    case "speed_base":
      /*
       * スピードの土台。神経系を週2回に増やす。
       * 高乳酸は隔週で1本だけ入れる（Base期と同じ扱い）。
       * 量だけを長く積むと速い動きが出なくなるので、冬のうちに戻しておく。
       */
      return [
        jog(40),
        hillSprints(8),
        jog(40, "回復ジョグ"),
        strides(6),
        weekParity === 1 ? highLactate() : cvReps(),
        jog(40),
        longRun(65),
      ];
  }
}

/**
 * フェーズ別の週テンプレート（月曜始まり、index 0 = 月曜）
 * weekParity: 隔週要素の切り替え（0 or 1）
 *
 * `emphasis` が入っているのは冬季・基礎構築モードのとき。
 * そのときフェーズは必ず Base で、並びだけがブロックごとに変わる。
 */
function weekTemplate(
  phase: Phase,
  weekParity: number,
  economyWeek: number,
  emphasis?: OffSeasonEmphasis
): (DayTemplate | null)[] {
  if (emphasis) return offSeasonWeekTemplate(emphasis, weekParity);
  switch (phase) {
    case "Base":
      // 主軸 aerobic + neural。高乳酸は0〜隔週(パリティ1の週のみ軽く)
      return [
        jog(40),
        hillSprints(8),
        jog(50),
        thresholdReps(),
        jog(40, "回復ジョグ"),
        weekParity === 1 ? highLactate() : strides(6),
        longRun(70),
      ];
    case "Build":
      // threshold/cv + race_economy導入。高乳酸は隔週
      return [
        jog(40),
        weekParity === 0 ? raceEconomy(economyWeek) : highLactate(),
        jog(40, "回復ジョグ"),
        hillSprints(8),
        weekParity === 0 ? cvReps() : raceEconomy(economyWeek),
        jog(40),
        longRun(60),
      ];
    case "Specific":
      // race_economy 主軸 + 高乳酸週1
      return [
        jog(40),
        highLactate(),
        jog(40, "回復ジョグ"),
        strides(6),
        raceEconomy(economyWeek),
        jog(40),
        longRun(60),
      ];
    case "Modeling":
      // レース再現セッション週1（高乳酸相当としてカウント）
      return [
        jog(40),
        modelingCore(),
        jog(30, "回復ジョグ"),
        strides(6),
        raceEconomy(economyWeek),
        jog(40),
        jog(50),
      ];
    case "Taper":
      // neuralのみ。量を段階的に削減
      return [
        jog(30),
        strides(5),
        jog(30),
        strides(4, 120),
        off(),
        jog(20),
        strides(3, 100),
      ];
  }
}

const DOW_BY_WEEK_INDEX: Dow[] = [1, 2, 3, 4, 5, 6, 0];

function templateForSlot(
  slot: ReturnType<typeof slotOf>,
  current: DayTemplate,
  phase: Phase,
  economyWeek: number,
  pointIndex: number,
  weekParity: number,
  longRun: boolean
): DayTemplate {
  if (slot === "auto") return current;
  if (slot === "off") return off();
  if (slot === "point") return pointTemplateFor(phase, economyWeek, pointIndex, weekParity);
  if (slot === "aerobic") return longRun ? longRunTemplate(60) : jog(40);
  // 神経系は中身が2種類ある。どちらもジョグ30分が別枠で付く（combinedJogMin）
  if (slot === "neural") return strides(6);
  if (slot === "hill") return hillSprints(8);
  return categoryTemplate(slot, economyWeek) ?? current;
}

// longRun 引数と同名になる箇所で明示的に使うための別名。
const longRunTemplate = longRun;

function hasAdjacentHighLoad(template: (DayTemplate | null)[], index: number): boolean {
  const current = template[index];
  if (!current || !isHighLoadCategory(current.category)) return false;
  return [index - 1, index + 1].some((i) => {
    const other = i >= 0 && i < template.length ? template[i] : null;
    return !!other && isHighLoadCategory(other.category);
  });
}

/**
 * 曜日設定を週テンプレートへ反映する。
 *
 * fixed は従来どおり枠を上書きする。preferred は同じ週の既存メニューと
 * 入れ替えるだけなので、週の高負荷回数や休養数を増やさない。
 * 入れ替え後に高負荷が連日になる場合は希望を見送り、自動配置を残す。
 */
export function applyWeekPreferences(
  source: (DayTemplate | null)[],
  preference: WeekTemplate | undefined,
  phase: Phase,
  economyWeek: number,
  weekParity: number
): (DayTemplate | null)[] {
  if (!preference?.enabled) return [...source];
  return applySlotPreferences(
    source,
    {
      slotAt: (index) => slotOf(preference, DOW_BY_WEEK_INDEX[index]),
      modeAt: (index) => modeOf(preference, DOW_BY_WEEK_INDEX[index]),
      isLongRunAt: (index) => preference.longRunDow === DOW_BY_WEEK_INDEX[index],
      /*
       * modes の無い旧データだけは「指定曜日以外にポイントを置かない」従来仕様を保つ。
       * 周期には旧データが存在しない（最初から modes を持つ）ので false 固定になる。
       */
      legacyFixedPointsOnly: preference.modes === undefined,
    },
    phase,
    economyWeek,
    weekParity
  );
}

/**
 * 枠の指定を1日ずつのテンプレートに反映する。
 *
 * 曜日（7日）と周期（N日）で同じ実装を通す。
 * 別々に書くと、片方だけ直したときに「同じ設定なのに曜日と周期で結果が違う」になる。
 * 折り返しの長さは `source.length` で決まるので、7でもNでも同じ意味になる。
 */
interface SlotAccess {
  slotAt(index: number): WeekdaySlot;
  modeAt(index: number): WeekdayPreferenceMode;
  isLongRunAt(index: number): boolean;
  legacyFixedPointsOnly: boolean;
}

function applySlotPreferences(
  source: (DayTemplate | null)[],
  access: SlotAccess,
  phase: Phase,
  economyWeek: number,
  parity: number
): (DayTemplate | null)[] {
  const out = [...source];
  const indexes = source.map((_, i) => i);
  const fixedPointIndexes = indexes.filter(
    (i) => access.modeAt(i) === "fixed" && isPointSlot(access.slotAt(i))
  );

  for (const index of indexes) {
    if (access.modeAt(index) !== "fixed") continue;
    const slot = access.slotAt(index);
    const current = out[index];
    if (!current) continue;
    if (slot === "auto") continue;
    const pointIndex = Math.max(0, fixedPointIndexes.indexOf(index));
    out[index] = templateForSlot(
      slot,
      current,
      phase,
      economyWeek,
      pointIndex,
      parity,
      access.isLongRunAt(index)
    );
  }
  if (fixedPointIndexes.length > 0 && access.legacyFixedPointsOnly) {
    for (const index of indexes) {
      if (
        access.modeAt(index) !== "fixed" &&
        out[index] &&
        isHighLoadCategory(out[index]!.category)
      ) {
        out[index] = jog(40);
      }
    }
  }

  // 優先は回数を増やさず、同じ周期の中の動かせる枠との交換だけを試す。
  for (const target of indexes) {
    if (access.modeAt(target) !== "preferred") continue;
    const slot = access.slotAt(target);
    const current = out[target];
    if (!current || slot === "auto") continue;

    const wantsPoint = isPointSlot(slot);
    const sourceIndex = out.findIndex((candidate, index) => {
      if (!candidate || index === target) return false;
      if (access.modeAt(index) === "fixed") return false;
      if (wantsPoint) return isHighLoadCategory(candidate.category);
      if (slot === "aerobic" && access.isLongRunAt(target)) {
        return candidate.category === "aerobic" && candidate.name === "ロングラン";
      }
      return candidate.category === slot;
    });
    if (sourceIndex < 0) continue;

    const previousTarget = out[target];
    const previousSource = out[sourceIndex];
    out[sourceIndex] = previousTarget;
    out[target] =
      slot === "point"
        ? previousSource
        : templateForSlot(
            slot,
            current,
            phase,
            economyWeek,
            0,
            parity,
            access.isLongRunAt(target)
          );

    if (wantsPoint && hasAdjacentHighLoad(out, target)) {
      out[target] = previousTarget;
      out[sourceIndex] = previousSource;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// N日周期
// ---------------------------------------------------------------------------

/**
 * そのフェーズの週テンプレートを**実際に数えて**、周期へ引き伸ばす比率を出す。
 *
 * 「Baseは週1.5本」のような別表は作らない。
 * 表と生成器がずれると、曜日で組んだときと周期で組んだときで中身が変わってしまう
 * （`categoryCountsPerFourWeeks` と同じ理由）。
 */
function cycleShapeInputFor(
  phase: Phase,
  lengthDays: number,
  emphasis?: OffSeasonEmphasis
): CycleShapeInput {
  let points = 0;
  let demanding = 0;
  let neural = 0;
  let longRuns = 0;
  const demandingStream: SessionCategory[] = [];
  const aerobicHighStream: SessionCategory[] = [];
  for (const parity of [0, 1]) {
    for (const day of weekTemplate(phase, parity, 0, emphasis)) {
      if (!day) continue;
      if (day.category === "neural") neural++;
      if (day.name === "ロングラン") longRuns++;
      if (!isHighLoadCategory(day.category)) continue;
      points++;
      if (isSpecificCategory(day.category)) {
        demanding++;
        demandingStream.push(day.category);
      } else {
        aerobicHighStream.push(day.category);
      }
    }
  }
  return {
    lengthDays,
    pointsPerWeek: points / 2,
    neuralPerWeek: neural / 2,
    longRunPerWeek: longRuns / 2,
    demandingStream: demandingStream.length > 0 ? demandingStream : ["race_economy"],
    aerobicHighStream: aerobicHighStream.length > 0 ? aerobicHighStream : ["cv"],
    demandingRate: points > 0 ? demanding / points : 0,
  };
}

/**
 * 周期モードで使う、その周のテンプレート（長さN）。
 *
 * 内容の並び（何本目が高乳酸か）は**周期の通し番号**で決まるので、
 * 何周目を作っても、あとで作り直しても同じ答えになる。
 */
function cycleDayTemplates(
  cycle: TrainingCycle,
  cycleNumber: number,
  shape: CycleShape,
  economyWeek: number,
  phase: Phase
): (DayTemplate | null)[] {
  const base: (DayTemplate | null)[] = shape.roles.map((role, position) => {
    switch (role) {
      case "point": {
        const indexInCycle = shape.pointPositions.indexOf(position);
        const category = pointCategoryAt(
          shape,
          cycleNumber * shape.pointsPerCycle + indexInCycle
        );
        return categoryTemplate(category, economyWeek) ?? jog(40);
      }
      case "recovery_jog":
        return jog(40, "回復ジョグ");
      case "long_run":
        return longRun(60);
      case "neural":
        return strides(6);
      default:
        return jog(40);
    }
  });
  return applySlotPreferences(
    base,
    {
      slotAt: (i) => cycleSlotOf(cycle, i),
      modeAt: (i) => cycleModeOf(cycle, i),
      isLongRunAt: (i) => cycle.longRunIndex === i,
      legacyFixedPointsOnly: false,
    },
    phase,
    economyWeek,
    cycleNumber % 2
  );
}

// ---------------------------------------------------------------------------
// プラン生成
// ---------------------------------------------------------------------------

export interface GeneratePlanInput {
  athlete: Athlete;
  goal: Goal;
  races: Race[]; // goal.targetRaceId を含む
  cfeSec: number;
  aerobicProfile: AerobicProfile;
  startDate: string;
  /** 3-1: 曜日ごとの固定枠。未指定なら従来どおり自動 */
  weekTemplate?: WeekTemplate;
  /** 3-2: 登録済みの自作メニュー。該当カテゴリがあれば優先して使う */
  customMenus?: CustomMenu[];
  /**
   * M-7: 制限因子から決めた配分の重み。
   * 重み1未満のカテゴリの枠を、重み1超のカテゴリに振り替える。
   * 何を何に振り替えたかは limiterSwaps で返し、必ず本人に見せる。
   */
  limiterWeights?: { category: SessionCategory; weight: number; note: string }[];
  /**
   * S-7: カテゴリごとの直近の実行状況（M-2 と同じ判定）。
   * 設定を守れていないカテゴリは、量を増やさず実行できる形に戻す。
   */
  recentTrend?: Partial<Record<SessionCategory, TrendVerdict>>;
  /** S-7: 直近の負荷が高い。増やす方向の漸進を止める */
  loadHigh?: boolean;
  /**
   * 直近に疲労の兆候（黄・赤信号、翌日の脚の重さ、未達・中止）がある。
   * `loadHigh`はACWR増加という裏付けが要るが、こちらはACWRに関わらず
   * 疲労の実測だけで立つ——ACWRが低くても、直近で脚が重い等の兆候が
   * あれば筋損傷リスクの高い形式を避けたいため（`selectTemplate`参照）。
   * `loadHigh`が真ならこちらも必ず真になる（`hasRecentLoadConcern`が
   * `loadHigh`の必要条件のため）。
   */
  recentFatigueSignal?: boolean;
  /** 候補形式の重み付けにだけ使う。安全ルールやフェーズを上書きしない */
  athleteType?: AthleteType;
  /** 完了済みの自動生成形式。再使用間隔と段階判定に使う */
  templateHistory?: TemplateHistoryEntry[];
}

export interface GeneratedPlan {
  sessions: Session[];
  strengthSessions: StrengthSession[];
  phaseByWeek: { weekStart: string; phase: Phase }[];
  /** 3-2: 生成で使われた自作メニュー（使用実績の更新に使う） */
  usedCustomMenus: { menuId: string; date: string }[];
  /** M-7: 制限因子によって振り替えた枠 */
  limiterSwaps: { date: string; from: SessionCategory; to: SessionCategory; note: string }[];
  /**
   * N日周期で組んだときに、週テンプレートの配分から変えた点。
   * 黙って減らすと「調子が落ちたのか設定が変わったのか」が分からなくなるので、
   * 理由とセットで返して画面に出す。周期モードでなければ空。
   */
  cycleNotes: string[];
  /**
   * 暦の1週間に高乳酸・中距離特異的が3日入るのを避けて、内容を落とした枠。
   * 落としたことは必ず本人に見せる（黙って軽くすると、伸びていないのか
   * 軽くされたのかが分からなくなる）。
   */
  spacingSwaps: { date: string; from: SessionCategory; to: SessionCategory; note: string }[];
  /**
   * 冬季・基礎構築モード（目標レースが決まっていない）で組んだか。
   * true のときはピーキングしていない——テーパーも、目標タイムの混合も無い。
   */
  offSeason: boolean;
  /** 冬季モードのブロック割り（週の頭 → 重心）。何を繰り返しているのかを見せる */
  offSeasonBlocks: { weekStart: string; emphasis: OffSeasonEmphasis; label: string }[];
}

function generatedSessionId(date: string, timeOfDay: Session["timeOfDay"]): string {
  return `s-plan-${date}-${timeOfDay}`;
}

/**
 * 目標レース日から逆算してプランを生成する。
 * - 通過点レース(B/C)の前3日のみ軽くする「無調整に近い」設計
 * - 補強は高負荷練習日のpmにブロック化（4-8-1）
 * - テーパーの最終高乳酸はレース8日前に配置（RULE-07: 7〜9日前）
 */
export function generatePlan(input: GeneratePlanInput): GeneratedPlan {
  const { athlete, goal, races, cfeSec, aerobicProfile, startDate } = input;
  const targetRace = races.find((r) => r.id === goal.targetRaceId);
  /*
   * 冬季・基礎構築モード。
   *
   * 目標レースが無いときは、以前はここで例外を投げて生成できなかった。
   * 冬にレースが無いのは普通のことなので、**レースが無いことを異常にしない**。
   *
   * `raceDate` はここでは「どこまで作るか」の意味しか持たない。
   * ピーキング（テーパー・目標タイムの混合・レース前の減量）は下で全部止める。
   */
  const offSeason = targetRace === undefined;
  const raceDate = targetRace
    ? targetRace.dateStart
    : addDays(weekStart(startDate), OFF_SEASON_HORIZON_WEEKS * 7 - 1);

  const sessions: Session[] = [];
  const strengthSessions: StrengthSession[] = [];
  const phaseByWeek: { weekStart: string; phase: Phase }[] = [];
  const usedCustomMenus: { menuId: string; date: string }[] = [];
  const limiterSwaps: {
    date: string;
    from: SessionCategory;
    to: SessionCategory;
    note: string;
  }[] = [];
  // 呼び出し元の配列は変更せず、この生成中の選択も履歴へ足して偏りを抑える。
  const templateHistory = [...(input.templateHistory ?? [])];

  /*
   * M-7: 制限因子に合わせて枠を振り替える。
   * 距離とカテゴリだけで機械的に配分すると、
   * 足りていない側と足りている側に同じだけ時間を使うことになる。
   * 減らす側（重み<1）を、増やす側（重みが最大）に置き換える。
   */
  const downWeights = (input.limiterWeights ?? []).filter((w) => w.weight < 1);
  const upTarget = (input.limiterWeights ?? [])
    .filter((w) => w.weight > 1)
    .sort((a, b) => b.weight - a.weight)[0];

  /*
   * 通過点レース。冬季モードでも記録会には出るので、そのまま効かせる
   * （当日はセッションを置かない・前3日は軽くする）。
   * 本命が無いだけで、レースが1つも無いわけではない。
   */
  const subRaces = races.filter(
    (r) => r.id !== targetRace?.id && (r.priority === "B" || r.priority === "C")
  );
  const raceDays = new Set<string>();
  for (const r of races) {
    for (const round of r.rounds) raceDays.add(round.datetime.slice(0, 10));
    raceDays.add(r.dateStart);
    // 複数ラウンドの間の日もブロックする（RULE-20。回復プロトコルは rounds.ts が生成）
    const dates = r.rounds.map((rd) => rd.datetime.slice(0, 10)).sort();
    if (dates.length >= 2) {
      let d = dates[0];
      while (d < dates[dates.length - 1]) {
        raceDays.add(d);
        d = addDays(d, 1);
      }
    }
  }
  const isNearSubRace = (date: string) =>
    subRaces.some((r) => {
      const d = diffDays(date, r.dateStart);
      return d > 0 && d <= 3;
    });

  let w = weekStart(startDate);
  let weekIndex = 0;
  let economyWeek = 0;
  let lastHlDate: string | undefined;

  /*
   * 置いた「きつい方」（高乳酸・経済走・モデリング）の日付。
   * RULE-04 が暦の週で数えるので、こちらも日付で持って7日窓で数える。
   *
   * 日付順に作っているので、これから置く日より後のことは分からない。
   * それでよい——3日入る窓には必ず最後の日があり、その日を置くときに
   * 手前の2日が見えるので、**後ろ向きの7日だけ見れば全部の窓を見たことになる**。
   */
  const demandingDates: string[] = [];
  const demandingDaysEndingAt = (date: string): number =>
    new Set(
      demandingDates.filter((d) => {
        const back = diffDays(d, date);
        return back >= 0 && back <= 6;
      })
    ).size;
  const spacingSwaps: GeneratedPlan["spacingSwaps"] = [];

  /*
   * N日周期。
   *
   * テーパー期だけは周期を当てない。あそこはレース日から逆算した固定の手順
   * （8日前に最終高乳酸／7日前以降は高負荷なし／3日前から総量を削る）で、
   * 起点が本人の決めた日にある周期とは**基準にしている日が違う**。
   * 周期を優先すると、レース1週間前に高乳酸が入る周が出てくる。
   */
  const cycle = cycleOf(input.weekTemplate);
  const cycleShapes = new Map<string, CycleShape>();
  const cycleNotes: string[] = [];
  /*
   * 周期の形はフェーズごとに違う（Base 10日は2本、Specific 10日は3本）。
   * 冬季モードでは重心（ブロック）でも変わるので、両方を鍵にする。
   * フェーズだけを鍵にすると、冬季の4ブロックが全部
   * 最初のブロックの形になる（Baseで1回作って使い回してしまう）。
   */
  const shapeFor = (phase: Phase, emphasis?: OffSeasonEmphasis): CycleShape => {
    const key = `${phase}|${emphasis ?? ""}`;
    const cached = cycleShapes.get(key);
    if (cached) return cached;
    const shape = planCycleShape(
      cycleShapeInputFor(phase, cycle!.lengthDays, emphasis)
    );
    cycleShapes.set(key, shape);
    const where = emphasis ? OFF_SEASON_LABELS[emphasis] : `${PHASE_LABEL[phase]}期`;
    for (const note of shape.adjustments) {
      const line = `${where}: ${note}`;
      if (!cycleNotes.includes(line)) cycleNotes.push(line);
    }
    return shape;
  };
  const cycleTemplateCache = new Map<string, (DayTemplate | null)[]>();
  const cycleTemplateFor = (
    phase: Phase,
    cycleNumber: number,
    economy: number,
    emphasis?: OffSeasonEmphasis
  ): (DayTemplate | null)[] => {
    const key = `${phase}|${emphasis ?? ""}|${cycleNumber}|${economy}`;
    const cached = cycleTemplateCache.get(key);
    if (cached) return cached;
    const built = cycleDayTemplates(
      cycle!,
      cycleNumber,
      shapeFor(phase, emphasis),
      economy,
      phase
    );
    cycleTemplateCache.set(key, built);
    return built;
  };
  const offSeasonBlocks: GeneratedPlan["offSeasonBlocks"] = [];

  while (w <= raceDate) {
    const midWeek = addDays(w, 3);
    /*
     * 冬季モードはフェーズを動かさない。
     * レース日から数える意味が無い（そのレースが無い）ので、
     * 週が進むほど Build → Specific と勝手に上がっていくのは間違い。
     * 期分けは Base のまま、**ブロックで重心だけを移す**。
     */
    const emphasis = offSeason ? offSeasonEmphasis(weekIndex) : undefined;
    const phase = offSeason ? "Base" : phaseForDate(midWeek, raceDate);
    phaseByWeek.push({ weekStart: w, phase });
    if (emphasis) {
      offSeasonBlocks.push({
        weekStart: w,
        emphasis,
        label: describeOffSeasonBlock(weekIndex),
      });
    }
    const paceBasis = guardedBaseTime(
      cfeSec,
      goal.targetTimeSec,
      phase,
      // レースが無いときは「あと何週」も無い。ピーキングの猶予判定に使わせない
      offSeason ? Number.POSITIVE_INFINITY : Math.max(diffDays(midWeek, raceDate) / 7, 0),
      // 処方の土台をPBより速くしない。CFE自体は推定として保持したまま
      athlete.pb800mSec
    );
    const grpBase = paceBasis.timeSec;
    const template = applyWeekPreferences(
      weekTemplate(phase, weekIndex % 2, economyWeek, emphasis),
      input.weekTemplate,
      phase,
      economyWeek,
      weekIndex % 2
    );

    for (let d = 0; d < 7; d++) {
      const date = addDays(w, d);
      if (date < startDate || date > raceDate) continue;
      if (raceDays.has(date)) continue; // レース当日はセッションを置かない

      const cyclePosition =
        cycle && phase !== "Taper"
          ? cyclePositionOf(cycle.anchorDate, date, cycle.lengthDays)
          : undefined;
      let tpl =
        cycle && cyclePosition !== undefined
          ? cycleTemplateFor(
              phase,
              cycleNumberOf(cycle.anchorDate, date, cycle.lengthDays),
              economyWeek,
              emphasis
            )[cyclePosition]
          : template[d];
      if (!tpl) continue;
      const dow = new Date(date + "T00:00:00Z").getUTCDay() as Dow;

      /*
       * 目標レースまでの残り日数。
       *
       * 冬季モードでは `raceDate` は「どこまで作るか」の区切りでしかないので、
       * ここから先のピーキング（最終高乳酸・高負荷の停止・総量の削減）を
       * **1つも通さない**。通すと、ただの区切りの日に向かって
       * 勝手にテーパーが始まる（作った期間の終わりが軽くなる）。
       */
      const daysToTarget = offSeason
        ? Number.POSITIVE_INFINITY
        : diffDays(date, raceDate);
      // テーパー期: レース8日前に最終高乳酸を1回だけ配置（RULE-07対応）
      if (daysToTarget === 8 && phase === "Taper") {
        tpl = {
          category: "high_lactate",
          name: "最終高乳酸（短縮版）",
          buildPrescription: (g) => {
            const p = specificPace(g, "high_lactate", 300);
            return {
              prescription: `300m × 3 @${p.targetSecFast.toFixed(1)}〜${p.targetSecSlow.toFixed(1)}秒 r6分（本数を抑えた最終刺激）`,
              targetPaces: [p],
              durationMin: 50,
              distanceKm: 6,
            };
          },
          transfer800m: 5,
          transfer1500m: 3,
          risk: "mid",
        };
      }
      // レース7日前以降は高負荷練習を置かない（RULE-08）: テンプレ側でneural/jogのみだが保険
      if (
        daysToTarget < 7 &&
        ["high_lactate", "race_economy", "modeling", "cv", "threshold"].includes(
          tpl.category
        )
      ) {
        tpl = strides(4, 120);
      }
      // レース前3日は総量を大幅に削る（RULE-09: 通常週の50%以下）
      if (daysToTarget <= 3 && daysToTarget >= 1) {
        if (daysToTarget === 3) tpl = jog(20, "調整ジョグ");
        else if (daysToTarget === 2) tpl = off();
        else {
          tpl = {
            category: "neural",
            name: "刺激入れ（流し）",
            buildPrescription: (g) => ({
              prescription: "100m流し × 3本（完全休息）",
              targetPaces: [specificPace(g, "neural", 100)],
              durationMin: 10,
              distanceKm: 1,
            }),
            transfer800m: 3,
            transfer1500m: 2,
            risk: "low",
            combinedJogMin: 15,
          };
        }
      }
      // 通過点レース前3日は軽くする（本命のピークを崩さない範囲の「無調整に近い」設計）
      if (isNearSubRace(date) && tpl.category !== "off") {
        tpl =
          diffDays(
            date,
            subRaces.find((r) => {
              const dd = diffDays(date, r.dateStart);
              return dd > 0 && dd <= 3;
            })!.dateStart
          ) === 2
            ? strides(4, 120)
            : jog(30, "調整ジョグ");
      }
      // 高乳酸の最短間隔5日の保険（隔週テンプレの境界対応）
      if (
        (tpl.category === "high_lactate" || tpl.category === "modeling") &&
        lastHlDate &&
        diffDays(lastHlDate, date) < 5
      ) {
        tpl = jog(40, "回復ジョグ");
      }

      // ---- M-7: 制限因子による振り替え ----
      const current: DayTemplate = tpl;
      const down = downWeights.find((w) => w.category === current.category);
      if (down && upTarget && upTarget.category !== current.category) {
        const swapped = categoryTemplate(upTarget.category, economyWeek);
        /*
         * 振り替え先がきつい方（高乳酸・経済走・モデリング）のとき、
         * その週がもう2日埋まっているなら振り替えない。
         *
         * ここが無いと「CVを経済走に回す」が**全部のCVに効いて**、
         * 暦の1週間に経済走が3日入る週ができる（RULE-04がERRORを出す）。
         * 曜日で組んでいたころはポイントが週2枠しか無かったので表に出なかった。
         * N日周期にして3枠目ができた時点で毎回起きる。
         */
        const wouldCrowd =
          swapped !== undefined &&
          isSpecificCategory(upTarget.category) &&
          !isSpecificCategory(current.category) &&
          demandingDaysEndingAt(date) >= MAX_DEMANDING_DAYS_PER_WEEK;
        if (swapped && !wouldCrowd) {
          limiterSwaps.push({
            date,
            from: current.category,
            to: upTarget.category,
            note: `${down.note} / ${upTarget.note}`,
          });
          tpl = swapped;
        }
      }

      /*
       * 最後の保険。暦の1週間に高乳酸・中距離特異的が3日入るなら、有酸素高強度に落とす。
       *
       * 配置（`cycleTemplate.ts`）はここを守るように作ってあるが、守れるのは
       * **その周期の中だけ**。フェーズが変わって配置が切り替わる境目や、
       * 上の振り替えが重なったときには、周期をまたいで3日入ることがある。
       * ルールエンジンにERRORを出させてから直すのでは、
       * 「なぜそう置いたのか」がもう分からない。
       */
      if (
        isSpecificCategory(tpl.category) &&
        demandingDaysEndingAt(date) >= MAX_DEMANDING_DAYS_PER_WEEK
      ) {
        const eased = categoryTemplate("cv", economyWeek);
        if (eased) {
          spacingSwaps.push({
            date,
            from: tpl.category,
            to: "cv",
            note: "直前7日間に高乳酸・中距離特異的がすでに2日あるため、この枠はCVに落としました。",
          });
          tpl = eased;
        }
      }

      /*
       * S-7 / S-8: ポイント練習の中身を漸進モデルから作る。
       *
       * これまではカテゴリごとに固定の文面（高乳酸なら常に 300m×5 r5分）で、
       * 週が進んでも直近の出来がどうでも同じものが出ていた。
       * フェーズ内の週数と直近の実行状況から、本数とレストを動かす。
       * 対応するレシピが無いカテゴリ（有酸素・閾値・CVなど）は従来どおり。
       */
      const buildFromProgression = (t: DayTemplate, onDate: string) => {
        const weekIndex = Math.floor(diffDays(startDate, onDate) / 7);
        const spec = buildSessionSpec({
          category: t.category,
          phase,
          weekIndex,
          cfeSec: grpBase,
          trend: input.recentTrend?.[t.category],
          loadHigh: input.loadHigh,
          recentFatigueSignal: input.recentFatigueSignal,
          economyWeek: t.category === "race_economy" ? economyWeek : undefined,
          aerobicProfile,
          athleteType: input.athleteType,
          templateHistory,
          onDate,
        });
        if (!spec) return undefined;
        return {
          name: spec.name,
          prescription: spec.prescription,
          targetPaces: spec.targetPaces,
          distanceKm: spec.distanceKm,
          durationMin: spec.durationMin,
          paceSecPerKm: undefined,
          generation: {
            templateId: spec.templateId,
            variationGroup: spec.variationGroup,
            progressionStage: spec.progressionStage,
            selectionReasons: paceBasis.guarded
              ? [...spec.selectionReasons, paceBasis.message!]
              : spec.selectionReasons,
            alternativeTemplateIds: spec.alternativeTemplateIds,
            confidence: spec.confidence,
            repeatedForComparison: spec.repeatedForComparison,
          },
        };
      };

      // ---- 3-2: 自作メニューの適用 ----
      // 同じカテゴリの登録メニューがあれば、生成された処方の代わりに使う。
      const custom = input.customMenus
        ? pickCustomMenu(input.customMenus, tpl.category, date)
        : undefined;

      const built: ReturnType<DayTemplate["buildPrescription"]> & {
        name?: string;
        generation?: Session["generation"];
      } = custom
        ? {
            prescription: custom.prescription,
            targetPaces: custom.distanceM
              ? [
                  (() => {
                    /*
                     * S-6: 換算後の設定が入っていればそれを使う。
                     * 他の選手のメニューを借りる目的は「その人の組み立てを再現すること」なので、
                     * カテゴリの標準比（一般値）より、その人が実際にやっていた相対強度のほうが目的に合う。
                     */
                    if (custom.targetSec !== undefined && custom.targetSec > 0) {
                      return {
                        distanceM: custom.distanceM!,
                        targetSecFast: custom.targetSec,
                        targetSecSlow: custom.targetSec,
                      };
                    }
                    try {
                      return specificPace(grpBase, tpl.category, custom.distanceM);
                    } catch {
                      return {
                        distanceM: custom.distanceM,
                        targetSecFast: 0,
                        targetSecSlow: 0,
                      };
                    }
                  })(),
                ]
              : [],
            distanceKm: undefined,
            durationMin: 60,
            paceSecPerKm: undefined,
          }
        : buildFromProgression(tpl, date) ?? tpl.buildPrescription(grpBase, aerobicProfile);

      // RULE-02対応: 高乳酸の翌日に60分超のロングランを置く場合、
      // ペースを通常ジョグ +20〜30秒/km 遅くする（生成段階で織り込む）
      if (
        tpl.category === "aerobic" &&
        (built.durationMin ?? 0) > 60 &&
        lastHlDate === addDays(date, -1) &&
        built.paceSecPerKm !== undefined
      ) {
        // ジョグ帯の遅い側+30秒を下限にする（生成時と評価時でLT推定が
        // 多少ズレても RULE-02 の帯域に確実に入るよう余裕を持たせる）
        const slowed = Math.max(
          built.paceSecPerKm + 25,
          aerobicProfile.jogPaceSecPerKm.slow + 30
        );
        built.paceSecPerKm = slowed;
        built.distanceKm = built.durationMin
          ? Math.round(((built.durationMin * 60) / slowed) * 10) / 10
          : built.distanceKm;
        built.prescription += `（高乳酸翌日のため通常ジョグ+20〜30秒/kmに減速: 目安 ${fmtPacePerKm(slowed)}）`;
      }
      const timeOfDay = tpl.timeOfDay ?? "pm";
      /*
       * 固定枠かどうかは、周期モードでは**曜日ではなく周期の位置**で見る。
       * ここを曜日のままにすると、周期で固定した日が固定として扱われず、
       * ルール違反の自動回避で勝手に動かされる。
       */
      const slotIsFixed =
        cyclePosition !== undefined
          ? cycleModeOf(cycle, cyclePosition) === "fixed" &&
            slotMatchesCategory(cycleSlotOf(cycle, cyclePosition), tpl.category)
          : modeOf(input.weekTemplate, dow) === "fixed" &&
            slotMatchesCategory(slotOf(input.weekTemplate, dow), tpl.category);
      const session: Session = {
        // 同じ日・同じ時間帯の自動生成枠は同じIDにする。
        // 再生成やスナップショット同期を繰り返しても別レコードとして増殖させないため。
        id: generatedSessionId(date, timeOfDay),
        date,
        category: tpl.category,
        name: custom ? custom.name : built.name ?? tpl.name,
        prescription: built.prescription,
        targetPaces: built.targetPaces,
        transfer800m: tpl.transfer800m,
        transfer1500m: tpl.transfer1500m,
        riskLevel: tpl.risk,
        phase,
        rationale: rationaleFor(tpl.category),
        status: "planned",
        origin: "generated",
        isFixed: slotIsFixed,
        fixedSource: slotIsFixed
          ? cyclePosition !== undefined
            ? `周期${cyclePosition + 1}日目の固定設定`
            : `${DOW_LABEL_FOR_SOURCE[dow]}曜の固定設定`
          : undefined,
        timeOfDay,
        distanceKm: built.distanceKm,
        durationMin: built.durationMin,
        paceSecPerKm: built.paceSecPerKm,
        aerobicPurpose: tpl.aerobicPurpose,
        surface: "track",
        generation: custom ? undefined : built.generation,
      };
      sessions.push(session);
      /*
       * 不具合対応: 「ジョグ＋坂ダッシュ」のような複合メニューが1セッションに
       * まとめられ、記録画面で別々に打ち込みたくても片方が消えてしまっていた。
       * combinedJogMinが設定されているテンプレートは、ジョグ部分を別のaerobic
       * セッション（別のtimeOfDay）として自動生成し、最初からカレンダー上で
       * 別々に扱えるようにする。自作メニュー（custom）を使った日は対象外
       * （本人が登録した内容をそのまま尊重する）。
       */
      /*
       * 2部練習の午前枠。
       *
       * 午後（主練習）を作ったあとに足す。午前は**指定された曜日だけ**で、
       * 自動では増やさない（`WeekTemplate.amSlots` のコメント参照）。
       *
       * 午後が休養の日には置かない。休養日に半日走らせると回復日が消える。
       * 主練習が既に午前に置かれている日（tpl.timeOfDay==="am"）も置かない
       * ——同じ時間帯に2本入って id が衝突する。
       */
      const amSlot =
        cyclePosition !== undefined
          ? cycleAmSlotOf(cycle, cyclePosition)
          : amSlotOf(input.weekTemplate, dow);
      const amPlaced =
        amSlot !== undefined &&
        amSlot !== "off" &&
        tpl.category !== "off" &&
        timeOfDay !== "am";
      if (amPlaced) {
        /*
         * 午前の量を、その日の午後と本人の状態に合わせる。
         *
         * 固定の「40分ジョグ」を毎回出していたが、午後が高乳酸の日も
         * 回復ジョグの日も同じ40分では、2部にする意味が薄いうえ危ない。
         * 午前は**午後を殺さないための補助**なので、
         *   ・午後が高負荷の日は短く（脚を残す）
         *   ・疲労の実測があるときはさらに短く
         *   ・テーパー期は短く（総量を落とす局面で午前を積まない）
         * 上げる方向には動かさない。量で伸ばす種目ではないため。
         */
        const amBaseMin =
          phase === "Taper" || phase === "Modeling"
            ? 25
            : isHighLoadCategory(tpl.category)
              ? 30
              : 40;
        const amMin = input.recentFatigueSignal ? Math.round(amBaseMin * 0.7) : amBaseMin;
        /*
         * ジョグは templateForSlot を通さない。
         * あちらは "aerobic" に対して jog(40) を固定で返すので、
         * ここで決めた長さが捨てられてしまう。
         */
        const amTpl =
          amSlot === "aerobic"
            ? jog(amMin, "ジョグ（午前）")
            : templateForSlot(amSlot!, jog(amMin), phase, economyWeek, 0, weekIndex % 2, false);
        const amBuilt: ReturnType<DayTemplate["buildPrescription"]> & {
          name?: string;
          generation?: Session["generation"];
        } = buildFromProgression(amTpl, date) ?? amTpl.buildPrescription(grpBase, aerobicProfile);
        sessions.push({
          id: generatedSessionId(date, "am"),
          date,
          category: amTpl.category,
          name: amBuilt.name ?? amTpl.name,
          prescription: amBuilt.prescription,
          targetPaces: amBuilt.targetPaces,
          transfer800m: amTpl.transfer800m,
          transfer1500m: amTpl.transfer1500m,
          riskLevel: amTpl.risk,
          phase,
          rationale: rationaleFor(amTpl.category),
          status: "planned",
          origin: "generated",
          isFixed: false,
          timeOfDay: "am",
          distanceKm: amBuilt.distanceKm,
          durationMin: amBuilt.durationMin,
          paceSecPerKm: amBuilt.paceSecPerKm,
          aerobicPurpose: amTpl.aerobicPurpose,
          surface: "road",
          generation: amBuilt.generation,
        });
      }

      /*
       * 午前枠を置いた日は、複合メニューのジョグ分割をしない。
       * 分割先は同じ「午前」なので、置くと id が衝突して片方が消える。
       */
      if (!custom && tpl.combinedJogMin && !amPlaced) {
        const jogTpl = jog(tpl.combinedJogMin);
        const jogBuilt = jogTpl.buildPrescription(grpBase, aerobicProfile);
        const jogTimeOfDay: Session["timeOfDay"] = timeOfDay === "am" ? "pm" : "am";
        sessions.push({
          id: generatedSessionId(date, jogTimeOfDay),
          date,
          category: jogTpl.category,
          name: jogTpl.name,
          prescription: jogBuilt.prescription,
          targetPaces: jogBuilt.targetPaces,
          transfer800m: jogTpl.transfer800m,
          transfer1500m: jogTpl.transfer1500m,
          riskLevel: jogTpl.risk,
          phase,
          rationale: rationaleFor(jogTpl.category),
          status: "planned",
          origin: "generated",
          isFixed: false,
          timeOfDay: jogTimeOfDay,
          distanceKm: jogBuilt.distanceKm,
          durationMin: jogBuilt.durationMin,
          paceSecPerKm: jogBuilt.paceSecPerKm,
          aerobicPurpose: jogTpl.aerobicPurpose,
          surface: "road",
        });
      }
      if (session.generation) {
        templateHistory.push({
          date: session.date,
          category: session.category,
          templateId: session.generation.templateId,
          variationGroup: session.generation.variationGroup,
          progressionStage: session.generation.progressionStage,
        });
      }
      if (custom) usedCustomMenus.push({ menuId: custom.id, date });
      if (tpl.category === "high_lactate" || tpl.category === "modeling") {
        lastHlDate = date;
      }
      if (isSpecificCategory(session.category)) demandingDates.push(date);

      // 4-8: 補強を高負荷練習日のpmにブロック化
      const st = strengthForPhase(phase, date, session, offSeason);
      if (st) strengthSessions.push(st);
    }

    if (phase === "Build" || phase === "Specific" || phase === "Modeling") {
      economyWeek++;
    }
    weekIndex++;
    w = addDays(w, 7);
  }

  return {
    sessions,
    strengthSessions,
    phaseByWeek,
    usedCustomMenus,
    limiterSwaps,
    cycleNotes,
    spacingSwaps,
    offSeason,
    offSeasonBlocks,
  };
}

/** 暦の7日間に置いてよい「きつい方」の日数（RULE-04: 3日以上でERROR） */
const MAX_DEMANDING_DAYS_PER_WEEK = 2;

const PHASE_LABEL: Record<Phase, string> = {
  Base: "Base",
  Build: "Build",
  Specific: "Specific",
  Modeling: "Modeling",
  Taper: "Taper",
};

const DOW_LABEL_FOR_SOURCE: Record<Dow, string> = {
  0: "日",
  1: "月",
  2: "火",
  3: "水",
  4: "木",
  5: "金",
  6: "土",
};

function slotMatchesCategory(
  slot: ReturnType<typeof slotOf>,
  category: SessionCategory
): boolean {
  if (slot === "point") return isHighLoadCategory(category);
  if (slot === "auto") return false;
  return slot === category;
}

/**
 * ポイント練習の枠に入れる内容をフェーズから決める。
 *
 * 重要: 週に2枠ある場合、1本目と2本目で内容を変える。
 * すべて同じにすると、800mの中核である高乳酸セッションが
 * 一度も生成されないまま週2回の経済走だけになってしまう。
 *
 * @param indexInWeek その週で何本目のポイント練習か（0始まり）
 * @param weekParity 隔週要素の切り替え（0 or 1）
 */
function pointTemplateFor(
  phase: Phase,
  economyWeek: number,
  indexInWeek: number,
  weekParity: number
): DayTemplate {
  const isFirst = indexInWeek === 0;

  // 高乳酸系（high_lactate / modeling）は必ず「週の1本目」に置く。
  // 週によって1本目/2本目に入れ替わると、前週の2本目→今週の1本目が
  // 3日間隔になり、最短間隔5日（RULE-01）に抵触して自動で潰されてしまう。
  // 常に1本目に固定すれば間隔は必ず7日になる。
  switch (phase) {
    case "Base":
      // 有酸素土台が主。高乳酸は隔週（仕様書 4-6: Base は 0〜隔週）
      if (isFirst) return weekParity === 1 ? highLactate() : thresholdReps();
      return cvReps();
    case "Build":
      // 高乳酸は隔週。経済走を導入していく
      if (isFirst) return weekParity === 1 ? highLactate() : raceEconomy(economyWeek);
      return weekParity === 1 ? raceEconomy(economyWeek) : cvReps();
    case "Specific":
      // 高乳酸 週1 + 経済走 主軸（仕様書 4-6 の表どおり）
      return isFirst ? highLactate() : raceEconomy(economyWeek);
    case "Modeling":
      return isFirst ? modelingCore() : raceEconomy(economyWeek);
    case "Taper":
      return strides(5);
  }
}

/** 個別カテゴリ指定の枠に入れるテンプレート */
function categoryTemplate(
  category: SessionCategory,
  economyWeek: number
): DayTemplate | undefined {
  switch (category) {
    case "high_lactate":
      return highLactate();
    case "race_economy":
      return raceEconomy(economyWeek);
    case "modeling":
      return modelingCore();
    case "cv":
      return cvReps();
    case "threshold":
      return thresholdReps();
    case "neural":
      return strides(6);
    case "aerobic":
      return jog(40);
    case "off":
      return off();
    default:
      return undefined;
  }
}

/**
 * 4-8-2. フェーズ別の補強内容。高負荷日（ポイント練習日）のpmに配置する。
 */
function strengthForPhase(
  phase: Phase,
  date: string,
  session: Session,
  offSeason = false
): StrengthSession | undefined {
  /*
   * 補強は高負荷の日に寄せる（きつい日はきつく、楽な日は楽に）。
   *
   * 冬季モードでは坂ダッシュの日にも置く。
   * 「筋力・坂」のブロックは走る質が閾値1本しか無いので、
   * 高負荷の日だけに寄せると週1回しか補強が入らない。
   * 坂は神経系で解糖系の負債が小さいので、重い補強を同じ日に重ねられる。
   * **流しの日には置かない**——あそこは動きを出す日で、
   * 重いものを引いたあとの流しは目的から外れる。
   */
  const hillDay = offSeason && /坂/.test(session.name);
  const highLoadDay = isHighLoadCategory(session.category) || hillDay;

  /*
   * フェーズ別の内容は `strength.ts` が唯一の出どころ。
   * ここに同じ表を持っていたので、片方を直しても、もう片方は静かに古いままだった。
   */
  const spec = STRENGTH_PHASE_TABLE[phase];
  if (!spec || !highLoadDay) return undefined;

  return {
    id: `st-plan-${date}-pm`,
    date,
    timeOfDay: "pm",
    type: spec.type,
    loadLevel: spec.load,
    exercises: spec.exercises,
    durationMin: 40,
    note: `ポイント練習日のpmにブロック化（回復日を汚さない原則 / ${phase}期）`,
    status: "planned",
  };
}
