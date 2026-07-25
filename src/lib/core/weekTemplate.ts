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
 * - "point": ポイント練習（質練習）。具体的なカテゴリはフェーズに応じて自動で決まる
 * - 個別カテゴリ: そのカテゴリに固定する
 */
export type WeekdaySlot = "auto" | "point" | SessionCategory;

export const SLOT_LABELS: Record<string, string> = {
  auto: "自動",
  point: "ポイント練習",
  high_lactate: "高乳酸",
  race_economy: "経済走",
  modeling: "モデリング",
  cv: "CV",
  threshold: "閾値",
  neural: "神経系",
  aerobic: "ジョグ",
  off: "休養",
};

export interface WeekTemplate {
  /** 曜日ごとの枠。未設定の曜日は "auto" 扱い */
  slots: Partial<Record<Dow, WeekdaySlot>>;
  /** ロングランを置く曜日（aerobic のうち長い方）。未設定なら自動 */
  longRunDow?: Dow;
  enabled: boolean;
}

export function emptyWeekTemplate(): WeekTemplate {
  return { slots: {}, enabled: false };
}

export function slotOf(t: WeekTemplate | undefined, dow: Dow): WeekdaySlot {
  if (!t || !t.enabled) return "auto";
  return t.slots[dow] ?? "auto";
}

/** その枠が質練習（ポイント練習）か */
export function isPointSlot(slot: WeekdaySlot): boolean {
  return (
    slot === "point" ||
    slot === "high_lactate" ||
    slot === "race_economy" ||
    slot === "modeling" ||
    slot === "cv" ||
    slot === "threshold"
  );
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

  const pointDows = ([0, 1, 2, 3, 4, 5, 6] as Dow[]).filter((d) =>
    isPointSlot(slotOf(t, d))
  );

  // --- 週内のポイント練習回数（RULE-04: 最大2回） ---
  if (pointDows.length > 2) {
    out.push({
      rule: "RULE-04",
      level: "ERROR",
      message: `ポイント練習を週${pointDows.length}回（${pointDows
        .map((d) => DOW_LABELS[d])
        .join("・")}）に固定しています。週の質練習は最大2回です。`,
      dates: [],
      sessionIds: [],
      suggestion:
        "1つを「自動」またはジョグに変えてください。800mでは質練習の本数より、1本ごとの質の方が効きます。",
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
      message: `ポイント練習を${DOW_LABELS[pointDows[0]]}曜の週1回だけに固定しています。`,
      dates: [],
      sessionIds: [],
      suggestion:
        "固定した曜日以外には質練習が入りません（週1回で確定します）。Build〜Specific期は週2回が標準なので、もう1日ポイント練習の枠を作るか、片方を「自動」に戻すことを検討してください。",
    });
  }

  // --- 休養日がゼロ ---
  const offDows = ([0, 1, 2, 3, 4, 5, 6] as Dow[]).filter(
    (d) => slotOf(t, d) === "off"
  );
  const fixedDows = ([0, 1, 2, 3, 4, 5, 6] as Dow[]).filter(
    (d) => slotOf(t, d) !== "auto"
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
    (d) => slotOf(t, d) === "high_lactate"
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
