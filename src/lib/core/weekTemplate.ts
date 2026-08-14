/**
 * 3-1. 固定曜日設定 / 3-2. 自作メニュー登録
 *
 * 生活リズムやチームの活動日は曜日で固定されていることが多い。
 * 「火・土はポイント練習、木は休養、日はロングラン」のような枠を先に決めておき、
 * ピリオダイゼーションはその枠の中で内容を割り当てる、という順序にする。
 *
 * 重要な設計方針:
 * 固定曜日は「枠」であって「免罪符」ではない。
 * 設定した曜日どおりに置いた結果ルール違反になる場合は、
 * 生成前にテンプレート自体の問題として警告する（後から気づくと手遅れになるため）。
 */
import type { RuleViolation, SessionCategory } from "./types";
import { isHighLoadCategory, isSpecificCategory } from "./trainingClassification";
import {
  MAX_CYCLE_DAYS,
  MIN_CYCLE_DAYS,
  clampCycleLength,
  cyclePositionOf,
} from "./cycleTemplate";

/** 0=日曜 … 6=土曜（JavaScript の Date#getDay と同じ並び） */
export type Dow = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export const DOW_LABELS: Record<Dow, string> = {
  0: "日",
  1: "月",
  2: "火",
  3: "水",
  4: "木",
  5: "金",
  6: "土",
};

/**
 * 曜日に割り当てる枠。
 * - "auto": 自動生成に任せる（既定）
 * - "point": 高負荷を含むポイント練習。具体的なカテゴリはフェーズに応じて自動で決まる
 * - 個別カテゴリ: そのカテゴリに固定する
 */
/**
 * 曜日に割り当てる枠。
 *
 * `"hill"` はカテゴリではなく**内容の指定**。中身は神経系だが、
 * 坂ダッシュと流しは同じ neural でも別物なので選び分けられるようにした。
 * 以前は neural を選ぶと必ず流しになり、**坂ダッシュは実装があるのに
 * 曜日設定から選べなかった**（自動生成の週テンプレートにしか出てこない）。
 */
export type WeekdaySlot = "auto" | "point" | "hill" | SessionCategory;
export type WeekdayPreferenceMode = "none" | "preferred" | "fixed";

export const SLOT_LABELS: Record<string, string> = {
  auto: "自動",
  point: "ポイント練習",
  high_lactate: "高乳酸",
  race_economy: "経済走",
  modeling: "モデリング",
  cv: "CV",
  threshold: "閾値",
  /*
   * 「神経系（ジョグ込み）」では何をやるのか伝わらなかった。
   * 実物は「150m流し×6 ＋ ジョグ30分」なので、そのまま名前にする。
   */
  neural: "ジョグ＋流し（WS）",
  hill: "ジョグ＋坂ダッシュ",
  aerobic: "ジョグ",
  off: "休養",
};

export interface WeekTemplate {
  /**
   * 曜日ごとの枠（**午後＝主練習**）。未設定の曜日は "auto" 扱い。
   *
   * 2部練習に対応したときも、この名前のまま午後の意味にした。
   * `pmSlots` に改名すると保存済みのデータが全部読めなくなるため。
   */
  slots: Partial<Record<Dow, WeekdaySlot>>;
  /**
   * 曜日指定の強さ。
   * 旧データには存在しないため、枠があり mode が無い場合は fixed として読む。
   */
  modes?: Partial<Record<Dow, WeekdayPreferenceMode>>;
  /**
   * 2部練習の**午前**枠。
   *
   * 未設定なら午前は置かない。`slots` と違って "auto"（自動生成に任せる）が
   * 無いのは、**黙って練習を増やさない**ため。
   * 午前を自動で埋めると、本人が頼んでいない量が勝手に乗る。
   * 800mで効くのは量ではないので、増やすなら本人が明示する。
   */
  amSlots?: Partial<Record<Dow, WeekdaySlot>>;
  /** ロングランを置く曜日（aerobic のうち長い方）。未設定なら自動 */
  longRunDow?: Dow;
  enabled: boolean;
  /**
   * N日周期。入っていて `enabled` なら、**曜日ではなく周期で組む**。
   *
   * 曜日の設定（`slots` など）は消さずに残す。周期を試して戻したくなったときに
   * 曜日の設定を入れ直させるのは、設定を壊すのと同じだから。
   */
  cycle?: TrainingCycle;
}

/**
 * N日周期の枠。
 *
 * 位置は**0始まり**（画面には「1日目」と出す）。
 * 曜日と同じ語彙（`WeekdaySlot` / `WeekdayPreferenceMode`）を使うので、
 * 曜日と周期で意味が食い違うことはない。
 */
export interface TrainingCycle {
  enabled: boolean;
  /** 周期の長さ（日）。4〜14 */
  lengthDays: number;
  /** この日を1日目にする */
  anchorDate: string;
  slots?: Partial<Record<number, WeekdaySlot>>;
  modes?: Partial<Record<number, WeekdayPreferenceMode>>;
  amSlots?: Partial<Record<number, WeekdaySlot>>;
  longRunIndex?: number;
}

export function emptyWeekTemplate(): WeekTemplate {
  return { slots: {}, modes: {}, enabled: false };
}

export function emptyCycle(anchorDate: string): TrainingCycle {
  return { enabled: false, lengthDays: 10, anchorDate, slots: {}, modes: {} };
}

/** 周期モードで動いているか（曜日ではなく周期で組む） */
export function isCycleMode(t: WeekTemplate | undefined): boolean {
  return !!t?.enabled && !!t.cycle?.enabled && !!t.cycle.anchorDate;
}

/** 有効な周期。周期モードでなければ undefined */
export function cycleOf(t: WeekTemplate | undefined): TrainingCycle | undefined {
  if (!isCycleMode(t)) return undefined;
  const c = t!.cycle!;
  return { ...c, lengthDays: clampCycleLength(c.lengthDays) };
}

export function cycleSlotOf(c: TrainingCycle | undefined, position: number): WeekdaySlot {
  if (!c || !c.enabled) return "auto";
  return c.slots?.[position] ?? "auto";
}

export function cycleModeOf(
  c: TrainingCycle | undefined,
  position: number
): WeekdayPreferenceMode {
  if (cycleSlotOf(c, position) === "auto") return "none";
  // 周期は最初から modes を持つ。旧データの fixed 既定（曜日側）は持ち込まない
  return c?.modes?.[position] ?? "fixed";
}

export function cycleAmSlotOf(
  c: TrainingCycle | undefined,
  position: number
): WeekdaySlot | undefined {
  if (!c || !c.enabled) return undefined;
  const slot = c.amSlots?.[position];
  return slot && slot !== "auto" ? slot : undefined;
}

export function slotOf(t: WeekTemplate | undefined, dow: Dow): WeekdaySlot {
  if (!t || !t.enabled) return "auto";
  return t.slots[dow] ?? "auto";
}

export function modeOf(t: WeekTemplate | undefined, dow: Dow): WeekdayPreferenceMode {
  const slot = slotOf(t, dow);
  if (slot === "auto") return "none";
  // 従来の曜日枠は完全固定だったため、modes の無い保存データは固定として維持する。
  return t?.modes?.[dow] ?? "fixed";
}

/**
 * 2部練習の午前枠。未設定・"auto" はどちらも「午前は置かない」。
 *
 * 午後（`slotOf`）と違って "auto" を自動生成の合図にしない理由は
 * `WeekTemplate.amSlots` のコメントを参照。
 */
export function amSlotOf(t: WeekTemplate | undefined, dow: Dow): WeekdaySlot | undefined {
  if (!t || !t.enabled) return undefined;
  const slot = t.amSlots?.[dow];
  return slot && slot !== "auto" ? slot : undefined;
}

/** 2部練習の日か（午前枠が入っていて、午後が休養でない） */
export function isDoubleDay(t: WeekTemplate | undefined, dow: Dow): boolean {
  return amSlotOf(t, dow) !== undefined && slotOf(t, dow) !== "off";
}

export function normalizeWeekTemplate(t: WeekTemplate): WeekTemplate {
  const slots: WeekTemplate["slots"] = {};
  const modes: NonNullable<WeekTemplate["modes"]> = {};
  const amSlots: NonNullable<WeekTemplate["amSlots"]> = {};
  for (const dow of [0, 1, 2, 3, 4, 5, 6] as Dow[]) {
    const slot = t.slots?.[dow] ?? "auto";
    const mode = modeOf(t, dow);
    if (slot !== "auto" && mode !== "none") {
      slots[dow] = slot;
      modes[dow] = mode;
    }
    const am = t.amSlots?.[dow];
    // 午前は「指定されたものだけ」を残す。"auto" は指定なしと同じ
    if (am && am !== "auto") amSlots[dow] = am;
  }
  return {
    slots,
    modes,
    amSlots,
    longRunDow: t.longRunDow,
    enabled: t.enabled,
    cycle: t.cycle ? normalizeCycle(t.cycle) : undefined,
  };
}

export function normalizeCycle(c: TrainingCycle): TrainingCycle {
  const lengthDays = clampCycleLength(c.lengthDays);
  const slots: NonNullable<TrainingCycle["slots"]> = {};
  const modes: NonNullable<TrainingCycle["modes"]> = {};
  const amSlots: NonNullable<TrainingCycle["amSlots"]> = {};
  for (let i = 0; i < lengthDays; i++) {
    const slot = c.slots?.[i] ?? "auto";
    const mode = cycleModeOf(c, i);
    if (slot !== "auto" && mode !== "none") {
      slots[i] = slot;
      modes[i] = mode;
    }
    const am = c.amSlots?.[i];
    if (am && am !== "auto") amSlots[i] = am;
  }
  return {
    enabled: c.enabled,
    lengthDays,
    anchorDate: c.anchorDate,
    slots,
    modes,
    amSlots,
    // 周期が短くなって位置が消えたら、ロングランの指定も落とす
    longRunIndex:
      c.longRunIndex !== undefined && c.longRunIndex < lengthDays ? c.longRunIndex : undefined,
  };
}

/** その枠が高負荷を含むポイント練習か */
export function isPointSlot(slot: WeekdaySlot): boolean {
  if (slot === "point") return true;
  if (slot === "auto") return false;
  // 坂ダッシュは神経系。低負荷なのでポイント練習には数えない
  if (slot === "hill") return false;
  return isHighLoadCategory(slot);
}

// ---------------------------------------------------------------------------
// テンプレート自体の検証（生成前に警告する）
// ---------------------------------------------------------------------------

/**
 * 曜日テンプレート単体をルールに照らして検証する。
 * 週は循環するため、土→翌週火のような週をまたぐ間隔も見る。
 */
export function validateWeekTemplate(t: WeekTemplate): RuleViolation[] {
  const out: RuleViolation[] = [];
  if (!t.enabled) return out;
  // 周期モードでは曜日の枠は使われない。使われていないものを検証しても混乱するだけ
  if (isCycleMode(t)) return validateCycle(cycleOf(t)!);

  /*
   * 2部練習の検証。
   *
   * 生成してからルールエンジンに拾わせるのでは遅い。設定した時点で言う
   * （このファイルの方針: 固定曜日は枠であって免罪符ではない）。
   *
   * いちばん危ないのは同じ日に高負荷を2本置く形。RULE-03 が生成後に
   * ERRORにするが、そのときには「なぜそう置いたのか」がもう分からない。
   */
  for (const dow of [0, 1, 2, 3, 4, 5, 6] as Dow[]) {
    const am = amSlotOf(t, dow);
    if (!am) continue;
    const pm = slotOf(t, dow);
    if (isPointSlot(am) && isPointSlot(pm)) {
      out.push({
        rule: "RULE-03",
        level: "ERROR",
        message: `${DOW_LABELS[dow]}曜は午前・午後とも高負荷（${SLOT_LABELS[am] ?? am}／${SLOT_LABELS[pm] ?? pm}）です。同じ日に高負荷を2本置くと回復が間に合いません。`,
        dates: [],
        sessionIds: [],
        suggestion:
          "2部にするなら片方はジョグ・補強・神経系にしてください。質は1日1本に集約するほうが転移します。",
      });
    }
    if (pm === "off") {
      out.push({
        rule: "RULE-04",
        level: "WARN",
        message: `${DOW_LABELS[dow]}曜は午後が休養なのに午前枠（${SLOT_LABELS[am] ?? am}）が入っています。`,
        dates: [],
        sessionIds: [],
        suggestion:
          "休養日にするなら午前枠も外してください。半日だけ走るなら午後側を「自動」か「ジョグ」にしてください。",
      });
    }
  }

  const pointDows = ([0, 1, 2, 3, 4, 5, 6] as Dow[]).filter(
    (d) => modeOf(t, d) === "fixed" && isPointSlot(slotOf(t, d))
  );

  const demandingDows = pointDows.filter((d) => {
    const slot = slotOf(t, d);
    // "hill" はカテゴリではない（＝中身の指定）。ここはカテゴリだけを見る
    return (
      slot !== "point" && slot !== "auto" && slot !== "hill" && isSpecificCategory(slot)
    );
  });
  const tooManyDemanding = demandingDows.length > 2;
  const tooManyOverall = pointDows.length > 3;

  // --- RULE-04 と同じく、回数だけでなく高負荷の種類を分けて評価する ---
  if (tooManyDemanding || tooManyOverall) {
    out.push({
      rule: "RULE-04",
      level: "ERROR",
      message: `高負荷練習を週${pointDows.length}日（${pointDows
        .map((d) => DOW_LABELS[d])
        .join("・")}）固定しています。うち高乳酸・中距離特異的は${demandingDows.length}日です。`,
      dates: [],
      sessionIds: [],
      suggestion:
        "1つを「優先」または指定なしに変え、回復状況と前後の負荷から移動できる余地を残してください。",
    });
  } else if (pointDows.length === 3) {
    out.push({
      rule: "RULE-04",
      level: "WARN",
      message: `高負荷練習を週3日（${pointDows
        .map((d) => DOW_LABELS[d])
        .join("・")}）固定しています。一律に禁止はしませんが、実施結果と回復日の確保が必要です。`,
      dates: [],
      sessionIds: [],
      suggestion:
        "疲労・RPEが高い場合に有酸素高強度の1日を動かせるよう、少なくとも1つを「優先」にする案があります。",
    });
  }

  // --- ポイント練習の間隔（RULE-03: 最低中1日 / 指示書: 中48〜72時間） ---
  for (let i = 0; i < pointDows.length; i++) {
    for (let j = i + 1; j < pointDows.length; j++) {
      const a = pointDows[i];
      const b = pointDows[j];
      // 週をまたぐ循環距離のうち小さい方
      const raw = Math.abs(b - a);
      const gap = Math.min(raw, 7 - raw);
      if (gap <= 1) {
        out.push({
          rule: "RULE-03",
          level: "ERROR",
          message: `${DOW_LABELS[a]}曜と${DOW_LABELS[b]}曜のポイント練習が${
            gap === 0 ? "同日" : "連日"
          }です。ポイント練習の間隔は最低でも中1日（48時間）必要です。`,
          dates: [],
          sessionIds: [],
          suggestion: `${DOW_LABELS[b]}曜を1日ずらすか「自動」に戻してください。`,
        });
      } else if (gap === 2) {
        out.push({
          rule: "RULE-03",
          level: "WARN",
          message: `${DOW_LABELS[a]}曜と${DOW_LABELS[b]}曜のポイント練習は中1日（約48時間）です。`,
          dates: [],
          sessionIds: [],
          suggestion:
            "許容範囲ですが、間の日は必ずジョグか休養にしてください（神経系の流しは可）。高乳酸を含む週は中2日（72時間）が安全です。",
        });
      }
    }
  }

  // --- ポイント練習が週1回だけ ---
  if (pointDows.length === 1) {
    out.push({
      rule: "TEMPLATE",
      level: "WARN",
      message: `高負荷練習を${DOW_LABELS[pointDows[0]]}曜の週1回だけに固定しています。`,
      dates: [],
      sessionIds: [],
      suggestion:
        "固定はその曜日を動かしませんが、指定なし・優先の曜日には安全性を確認して別の高負荷練習を配置できます。",
    });
  }

  // --- 休養日がゼロ ---
  const offDows = ([0, 1, 2, 3, 4, 5, 6] as Dow[]).filter(
    (d) => modeOf(t, d) === "fixed" && slotOf(t, d) === "off"
  );
  const fixedDows = ([0, 1, 2, 3, 4, 5, 6] as Dow[]).filter(
    (d) => modeOf(t, d) === "fixed" && slotOf(t, d) !== "auto"
  );
  if (fixedDows.length >= 6 && offDows.length === 0) {
    out.push({
      rule: "TEMPLATE",
      level: "WARN",
      message: "週の全曜日を固定していますが、休養日が1日もありません。",
      dates: [],
      sessionIds: [],
      suggestion:
        "完全休養を週1日入れることを推奨します。入れない場合でも、最低1日は「自動」にして回復日を確保できる余地を残してください。",
    });
  }

  // --- 高乳酸を週2回以上固定（RULE-01） ---
  const hlDows = ([0, 1, 2, 3, 4, 5, 6] as Dow[]).filter(
    (d) => modeOf(t, d) === "fixed" && slotOf(t, d) === "high_lactate"
  );
  if (hlDows.length > 1) {
    out.push({
      rule: "RULE-01",
      level: "ERROR",
      message: `高乳酸を週${hlDows.length}回（${hlDows
        .map((d) => DOW_LABELS[d])
        .join("・")}）に固定しています。高乳酸は同一週内1回までです。`,
      dates: [],
      sessionIds: [],
      suggestion:
        "1つを「ポイント練習」（内容はフェーズに応じて自動決定）または経済走に変えてください。",
    });
  }

  return out;
}

/**
 * 周期の枠を検証する。
 *
 * 曜日版と見ているものは同じ（間隔・回数・休養・高乳酸の重複）だが、
 * **折り返す長さが7ではなくNになる**。10日周期で1日目と6日目にポイントを置いたら
 * 間隔は5日と5日で、これは曜日で言う「中4日」に相当する。
 * 7で割って考えると必ず間違える。
 */
export function validateCycle(c: TrainingCycle): RuleViolation[] {
  const out: RuleViolation[] = [];
  if (!c.enabled) return out;
  const n = clampCycleLength(c.lengthDays);
  const label = (i: number) => `${i + 1}日目`;
  const all = Array.from({ length: n }, (_, i) => i);

  if (!c.anchorDate) {
    out.push({
      rule: "TEMPLATE",
      level: "ERROR",
      message: "周期の起点（1日目にする日）が決まっていません。",
      dates: [],
      sessionIds: [],
      suggestion: "1日目にしたい日付を選んでください。ここが決まらないと周期を暦に置けません。",
    });
  }
  if (c.lengthDays < MIN_CYCLE_DAYS || c.lengthDays > MAX_CYCLE_DAYS) {
    out.push({
      rule: "TEMPLATE",
      level: "WARN",
      message: `周期の長さを${c.lengthDays}日から${n}日に丸めました（${MIN_CYCLE_DAYS}〜${MAX_CYCLE_DAYS}日）。`,
      dates: [],
      sessionIds: [],
      suggestion: `${MIN_CYCLE_DAYS}日未満はポイント練習の間隔が中2日を切ります。${MAX_CYCLE_DAYS}日を超えると周期のほうがフェーズより粗くなります。`,
    });
  }

  for (const i of all) {
    const am = cycleAmSlotOf(c, i);
    if (!am) continue;
    const pm = cycleSlotOf(c, i);
    if (isPointSlot(am) && isPointSlot(pm)) {
      out.push({
        rule: "RULE-03",
        level: "ERROR",
        message: `${label(i)}は午前・午後とも高負荷（${SLOT_LABELS[am] ?? am}／${SLOT_LABELS[pm] ?? pm}）です。同じ日に高負荷を2本置くと回復が間に合いません。`,
        dates: [],
        sessionIds: [],
        suggestion:
          "2部にするなら片方はジョグ・補強・神経系にしてください。質は1日1本に集約するほうが転移します。",
      });
    }
    if (pm === "off") {
      out.push({
        rule: "RULE-04",
        level: "WARN",
        message: `${label(i)}は午後が休養なのに午前枠（${SLOT_LABELS[am] ?? am}）が入っています。`,
        dates: [],
        sessionIds: [],
        suggestion:
          "休養日にするなら午前枠も外してください。半日だけ走るなら午後側を「自動」か「ジョグ」にしてください。",
      });
    }
  }

  const pointIndexes = all.filter(
    (i) => cycleModeOf(c, i) === "fixed" && isPointSlot(cycleSlotOf(c, i))
  );

  /*
   * 回数の上限は「暦の1週間で何本になるか」で見る。
   * ルールエンジン（RULE-04）が暦の週で数える以上、
   * 周期の中で何本かではなく、**週に均すと何本か**が効く。
   */
  const perWeek = (pointIndexes.length * 7) / n;
  if (perWeek > 3.0001) {
    out.push({
      rule: "RULE-04",
      level: "ERROR",
      message: `高負荷練習を${n}日に${pointIndexes.length}本（${pointIndexes
        .map(label)
        .join("・")}）固定しています。週に均すと${perWeek.toFixed(1)}本です。`,
      dates: [],
      sessionIds: [],
      suggestion:
        "週3本を超えると暦の1週間に高負荷が4日入る週ができ、必ずERRORになります。1つを「優先」か指定なしに戻してください。",
    });
  } else if (perWeek > 2.0001) {
    out.push({
      rule: "RULE-04",
      level: "WARN",
      message: `高負荷練習が週換算で${perWeek.toFixed(1)}本（${n}日に${pointIndexes.length}本）です。`,
      dates: [],
      sessionIds: [],
      suggestion:
        "一律には禁止しませんが、高乳酸・中距離特異的は暦の1週間に2日までです。3本目はCV・閾値にすると成立します。",
    });
  }

  // --- ポイントの間隔（周期は折り返す） ---
  for (let a = 0; a < pointIndexes.length; a++) {
    for (let b = a + 1; b < pointIndexes.length; b++) {
      const i = pointIndexes[a];
      const j = pointIndexes[b];
      const raw = Math.abs(j - i);
      const gap = Math.min(raw, n - raw);
      if (gap <= 1) {
        out.push({
          rule: "RULE-03",
          level: "ERROR",
          message: `${label(i)}と${label(j)}のポイント練習が${gap === 0 ? "同日" : "連日"}です。ポイント練習の間隔は最低でも中1日（48時間）必要です。`,
          dates: [],
          sessionIds: [],
          suggestion: `${label(j)}を1日ずらすか「自動」に戻してください。`,
        });
      } else if (gap === 2) {
        out.push({
          rule: "RULE-03",
          level: "WARN",
          message: `${label(i)}と${label(j)}のポイント練習は中1日（約48時間）です。`,
          dates: [],
          sessionIds: [],
          suggestion:
            "許容範囲ですが、間の日は必ずジョグか休養にしてください（神経系の流しは可）。高乳酸を含む周期は中2日（72時間）が安全です。",
        });
      }
    }
  }

  // --- 高乳酸の間隔（RULE-01: 最短5日） ---
  const hl = all.filter(
    (i) => cycleModeOf(c, i) === "fixed" && cycleSlotOf(c, i) === "high_lactate"
  );
  for (let a = 0; a < hl.length; a++) {
    for (let b = a + 1; b < hl.length; b++) {
      const raw = Math.abs(hl[b] - hl[a]);
      const gap = Math.min(raw, n - raw);
      if (gap < 5) {
        out.push({
          rule: "RULE-01",
          level: "ERROR",
          message: `${label(hl[a])}と${label(hl[b])}の高乳酸が${gap}日間隔です。高乳酸は最短でも5日あけます。`,
          dates: [],
          sessionIds: [],
          suggestion:
            "片方を「ポイント練習」（内容はフェーズに応じて自動決定）または経済走に変えてください。",
        });
      }
    }
  }

  const offs = all.filter((i) => cycleModeOf(c, i) === "fixed" && cycleSlotOf(c, i) === "off");
  const fixed = all.filter((i) => cycleModeOf(c, i) === "fixed");
  if (fixed.length >= n - 1 && offs.length === 0) {
    out.push({
      rule: "TEMPLATE",
      level: "WARN",
      message: `${n}日ぶんをほぼ全部固定していますが、休養日が1日もありません。`,
      dates: [],
      sessionIds: [],
      suggestion:
        "完全休養を周期に1日入れることを推奨します。入れない場合でも、最低1日は「自動」にして回復日を確保できる余地を残してください。",
    });
  }

  return out;
}

/**
 * 周期の位置が、これから何曜日に当たるかの並び。
 *
 * 7の倍数でない周期にすると、**同じ内容が来る曜日が毎回ずれる**。
 * 10日周期なら70日たたないと元の曜日に戻らない。
 * 学校・仕事・チーム練習が曜日で決まっている人には効く話なので、
 * 警告ではなく事実として画面に出す（禁止する理由は無い）。
 */
export function cycleWeekdayDrift(lengthDays: number): number | undefined {
  const n = clampCycleLength(lengthDays);
  if (n % 7 === 0) return undefined;
  // n と 7 の最小公倍数（7は素数なので n*7/gcd）
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  return (n * 7) / gcd(n, 7);
}

/** その日付が周期の何日目か（0始まり）。周期モードでなければ undefined */
export function cyclePositionFor(
  t: WeekTemplate | undefined,
  date: string
): number | undefined {
  const c = cycleOf(t);
  if (!c) return undefined;
  return cyclePositionOf(c.anchorDate, date, c.lengthDays);
}

// ---------------------------------------------------------------------------
// 3-2. 自作メニュー
// ---------------------------------------------------------------------------

export type CustomMenuSource = "self" | "coach" | "past_success";

export const SOURCE_LABELS: Record<CustomMenuSource, string> = {
  self: "自分の練習",
  coach: "コーチ指示",
  past_success: "過去にうまくいった",
};

export interface CustomMenu {
  id: string;
  name: string;
  category: SessionCategory;
  source: CustomMenuSource;
  /** 処方の文章。設定ペースを自動計算させたい場合は distanceM/reps を埋める */
  prescription: string;
  distanceM?: number;
  reps?: number;
  restNote?: string;
  /**
   * S-6: 換算後の設定タイム（秒）。
   * 他の選手のメニューを取り込んだときは、その選手の相対強度を自分に当てた値が入る。
   * 入っていればカテゴリの標準比より優先する（その人が実際にやっていた強度のほうが、
   * このメニューを借りる目的に合っているため）。
   */
  targetSec?: number;
  /** S-6: 元にした選手。誰の練習かを残さないと、あとで数字の出どころが分からなくなる */
  sourceAthlete?: {
    name?: string;
    pb800Sec: number;
  };
  note?: string;
  /** 使用実績（生成時の優先度に使う） */
  timesUsed?: number;
  lastUsedDate?: string;
  /** false にすると生成候補から外す（記録は残す） */
  active?: boolean;
}

/**
 * 生成時にそのカテゴリの自作メニューを選ぶ。
 * 「過去にうまくいった」を最優先し、次にコーチ指示、次に自分の練習。
 * 同順位なら直近で使っていないものを選ぶ（同じ練習の連続を避ける）。
 */
export function pickCustomMenu(
  menus: CustomMenu[],
  category: SessionCategory,
  onDate: string
): CustomMenu | undefined {
  const rank: Record<CustomMenuSource, number> = {
    past_success: 0,
    coach: 1,
    self: 2,
  };
  const candidates = menus
    .filter((m) => m.category === category && m.active !== false)
    .sort((a, b) => {
      const r = rank[a.source] - rank[b.source];
      if (r !== 0) return r;
      // 直近使用が古い順
      return (a.lastUsedDate ?? "").localeCompare(b.lastUsedDate ?? "");
    });
  return candidates[0];
}
