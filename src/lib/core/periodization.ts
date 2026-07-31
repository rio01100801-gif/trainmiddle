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
import { baseTime } from "./cfe";
import { AerobicProfile, specificPace } from "./pace";
import { rationaleFor } from "./rationale";
import { buildSessionSpec, type TemplateHistoryEntry } from "./progression";
import { isHighLoadCategory } from "./trainingClassification";
import type { TrendVerdict } from "./adaptive";
import {
  type CustomMenu,
  type Dow,
  type WeekTemplate,
  isPointSlot,
  modeOf,
  pickCustomMenu,
  slotOf,
} from "./weekTemplate";

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
    prescription: `坂ダッシュ 8〜10秒 × ${reps}本（完全休息・歩行で戻る）+ ジョグ30分`,
    targetPaces: [],
    durationMin: 45,
    distanceKm: 6,
  }),
  transfer800m: 3,
  transfer1500m: 2,
  risk: "low",
});

const strides = (reps: number, dist = 150): DayTemplate => ({
  category: "neural",
  name: "流し",
  buildPrescription: (g) => ({
    prescription: `ジョグ30分 + ${dist}m流し × ${reps}本（完全休息）`,
    targetPaces: [specificPace(g, "neural", dist)],
    durationMin: 45,
    distanceKm: 6,
  }),
  transfer800m: 3,
  transfer1500m: 2,
  risk: "low",
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
 * フェーズ別の週テンプレート（月曜始まり、index 0 = 月曜）
 * weekParity: 隔週要素の切り替え（0 or 1）
 */
function weekTemplate(
  phase: Phase,
  weekParity: number,
  economyWeek: number
): (DayTemplate | null)[] {
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
  if (slot === "neural") return strides(6);
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
  const out = [...source];
  const fixedPointDows = DOW_BY_WEEK_INDEX.filter(
    (dow) => modeOf(preference, dow) === "fixed" && isPointSlot(slotOf(preference, dow))
  );

  // 旧形式の完全固定動作を維持する。
  for (let index = 0; index < DOW_BY_WEEK_INDEX.length; index++) {
    const dow = DOW_BY_WEEK_INDEX[index];
    if (modeOf(preference, dow) !== "fixed") continue;
    const slot = slotOf(preference, dow);
    const current = out[index];
    if (!current) continue;
    if (slot === "auto") continue;
    const pointIndex = Math.max(0, fixedPointDows.indexOf(dow));
    out[index] = templateForSlot(
      slot,
      current,
      phase,
      economyWeek,
      pointIndex,
      weekParity,
      preference.longRunDow === dow
    );
  }
  // modes の無い旧データだけは「指定曜日以外にポイントを置かない」従来仕様を保つ。
  if (fixedPointDows.length > 0 && preference.modes === undefined) {
    for (let index = 0; index < out.length; index++) {
      const dow = DOW_BY_WEEK_INDEX[index];
      if (
        modeOf(preference, dow) !== "fixed" &&
        out[index] &&
        isHighLoadCategory(out[index]!.category)
      ) {
        out[index] = jog(40);
      }
    }
  }

  // 優先は回数を増やさず、同じ週の動かせる枠との交換だけを試す。
  for (let target = 0; target < DOW_BY_WEEK_INDEX.length; target++) {
    const dow = DOW_BY_WEEK_INDEX[target];
    if (modeOf(preference, dow) !== "preferred") continue;
    const slot = slotOf(preference, dow);
    const current = out[target];
    if (!current || slot === "auto") continue;

    const wantsPoint = isPointSlot(slot);
    const sourceIndex = out.findIndex((candidate, index) => {
      if (!candidate || index === target) return false;
      const candidateDow = DOW_BY_WEEK_INDEX[index];
      if (modeOf(preference, candidateDow) === "fixed") return false;
      if (wantsPoint) return isHighLoadCategory(candidate.category);
      if (slot === "aerobic" && preference.longRunDow === dow) {
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
            weekParity,
            preference.longRunDow === dow
          );

    if (wantsPoint && hasAdjacentHighLoad(out, target)) {
      out[target] = previousTarget;
      out[sourceIndex] = previousSource;
    }
  }
  return out;
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
  if (!targetRace) throw new Error("目標レースが見つかりません");
  const raceDate = targetRace.dateStart;

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

  const subRaces = races.filter(
    (r) => r.id !== targetRace.id && (r.priority === "B" || r.priority === "C")
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

  while (w <= raceDate) {
    const midWeek = addDays(w, 3);
    const phase = phaseForDate(midWeek, raceDate);
    phaseByWeek.push({ weekStart: w, phase });
    const grpBase = baseTime(cfeSec, goal.targetTimeSec, phase);
    const template = applyWeekPreferences(
      weekTemplate(phase, weekIndex % 2, economyWeek),
      input.weekTemplate,
      phase,
      economyWeek,
      weekIndex % 2
    );

    for (let d = 0; d < 7; d++) {
      const date = addDays(w, d);
      if (date < startDate || date > raceDate) continue;
      if (raceDays.has(date)) continue; // レース当日はセッションを置かない

      let tpl = template[d];
      if (!tpl) continue;
      const dow = new Date(date + "T00:00:00Z").getUTCDay() as Dow;

      const daysToTarget = diffDays(date, raceDate);
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
              prescription: "ジョグ15分 + 100m流し × 3本（完全休息）",
              targetPaces: [specificPace(g, "neural", 100)],
              durationMin: 25,
              distanceKm: 3,
            }),
            transfer800m: 3,
            transfer1500m: 2,
            risk: "low",
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
        if (swapped) {
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
            selectionReasons: spec.selectionReasons,
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
        isFixed:
          modeOf(input.weekTemplate, dow) === "fixed" &&
          slotMatchesCategory(slotOf(input.weekTemplate, dow), tpl.category),
        fixedSource:
          modeOf(input.weekTemplate, dow) === "fixed" &&
          slotMatchesCategory(slotOf(input.weekTemplate, dow), tpl.category)
            ? `${DOW_LABEL_FOR_SOURCE[dow]}曜の固定設定`
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

      // 4-8: 補強を高負荷練習日のpmにブロック化
      const st = strengthForPhase(phase, date, session);
      if (st) strengthSessions.push(st);
    }

    if (phase === "Build" || phase === "Specific" || phase === "Modeling") {
      economyWeek++;
    }
    weekIndex++;
    w = addDays(w, 7);
  }

  return { sessions, strengthSessions, phaseByWeek, usedCustomMenus, limiterSwaps };
}

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
  session: Session
): StrengthSession | undefined {
  const highLoadDay = isHighLoadCategory(session.category);

  const table: Record<
    Phase,
    { load: "light" | "moderate" | "heavy"; type: "strength" | "core"; exercises: string[] } | null
  > = {
    Base: {
      load: "heavy",
      type: "strength",
      exercises: ["スクワット 5×5", "デッドリフト 3×5", "低強度ホッピング 3×20m"],
    },
    Build: {
      load: "moderate",
      type: "strength",
      exercises: ["スクワット(速度重視) 4×4", "ルーマニアンDL 3×6", "ボックスジャンプ 3×5"],
    },
    Specific: {
      load: "moderate",
      type: "strength",
      exercises: ["スクワット(速度重視) 3×3", "バウンディング 3×30m", "MBスロー 3×5"],
    },
    Modeling: {
      load: "light",
      type: "strength",
      exercises: ["自重スクワット 2×10", "低強度ホップ 2×15m（維持のみ）"],
    },
    Taper: { load: "light", type: "core", exercises: ["体幹サーキット 2周（coreのみ）"] },
  };

  const spec = table[phase];
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
