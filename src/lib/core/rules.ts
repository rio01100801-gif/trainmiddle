/**
 * 4-4. 制約ルールエンジン（本ツールの核心）
 *
 * 週間・月間プランを機械的にチェックし、違反を検出したら
 * 警告 + 具体的な修正案を提示する。
 *
 * カテゴリの取り扱い:
 * - 質練習     = high_lactate / modeling / race_economy / cv / threshold
 * - 特異的     = high_lactate / modeling / race_economy
 * - 有酸素系質 = cv / threshold
 * - 高乳酸相当 = high_lactate / modeling（RULE-01/07/22 で同等に扱う。
 *   モデリング核はレース再現＝解糖系フル動員のため）
 * - neural は解糖系ではないため質練習にカウントしない（仕様書 4-3）
 */
import type {
  Athlete,
  DailyCheck,
  Goal,
  HeatBlock,
  Race,
  RuleViolation,
  Session,
  SessionCategory,
  StrengthSession,
  WeeklySummary,
} from "./types";
import { addDays, diffDays, isMidsummer, isSummer, weekStart } from "./dates";
import { isGrayZonePace } from "./pace";

export const QUALITY_CATEGORIES: SessionCategory[] = [
  "high_lactate",
  "modeling",
  "race_economy",
  "cv",
  "threshold",
];
export const SPECIFIC_CATEGORIES: SessionCategory[] = [
  "high_lactate",
  "modeling",
  "race_economy",
];
export const AEROBIC_QUALITY_CATEGORIES: SessionCategory[] = ["cv", "threshold"];
export const HL_EQUIV_CATEGORIES: SessionCategory[] = ["high_lactate", "modeling"];

export const isQuality = (c: SessionCategory) => QUALITY_CATEGORIES.includes(c);
export const isSpecific = (c: SessionCategory) => SPECIFIC_CATEGORIES.includes(c);
export const isHlEquiv = (c: SessionCategory) => HL_EQUIV_CATEGORIES.includes(c);

export interface RuleContext {
  sessions: Session[];
  strengthSessions: StrengthSession[];
  races: Race[];
  goal?: Goal;
  athlete: Athlete;
  dailyChecks: DailyCheck[];
  heatBlocks: HeatBlock[];
  /** 日付ごとの予想/実測気温。無い場合は夏季月フラグで代替 */
  dayTempsC?: Record<string, number>;
  ltPaceSecPerKm?: number;
  evaluationDate: string;
  /** load.ts で計算した現在のACWR（RULE-16） */
  currentAcwr?: number;
}

const active = (s: Session) => s.status !== "skipped" && s.category !== "off";

function sorted(sessions: Session[]): Session[] {
  return [...sessions].sort((a, b) => a.date.localeCompare(b.date));
}

function groupByWeek(sessions: Session[]): Map<string, Session[]> {
  const m = new Map<string, Session[]>();
  for (const s of sessions) {
    const w = weekStart(s.date);
    if (!m.has(w)) m.set(w, []);
    m.get(w)!.push(s);
  }
  return m;
}

/** RULE-15: 関与セッションが全て固定の場合、違反を「回避不能」として扱う */
function finalize(v: RuleViolation, involved: Session[]): RuleViolation {
  const movable = involved.filter((s) => !s.isFixed);
  if (involved.length > 0 && movable.length === 0) {
    return {
      ...v,
      unavoidable: true,
      suggestion:
        `固定セッションのみが関与しているため自動回避できません。` +
        `当日の対処案: 強度を1段階抑える / 本数を減らす / レストを延長する。` +
        (v.suggestion ? ` 元の提案: ${v.suggestion}` : ""),
      autofix: undefined,
    };
  }
  return v;
}

function raceDateOf(race: Race): string {
  return race.dateStart;
}

function aRaces(ctx: RuleContext): Race[] {
  return ctx.races.filter((r) => r.priority === "A");
}

function tempOn(ctx: RuleContext, date: string): number | undefined {
  return ctx.dayTempsC?.[date];
}

function isHotDay(ctx: RuleContext, date: string): boolean {
  const t = tempOn(ctx, date);
  if (t !== undefined) return t >= 28;
  return isSummer(date); // 夏季フラグで代替（仕様書 RULE-10）
}

// ---------------------------------------------------------------------------
// 個別ルール
// ---------------------------------------------------------------------------

/**
 * RULE-01 [ERROR] high_lactate は同一週内に1回まで。最短間隔5日。
 * 例外: モデリング期（レース14〜28日前）に限り、3日間隔での2連を1回だけ許可。
 *       ただしその直後7日間は high_lactate 禁止。
 */
function rule01(ctx: RuleContext): RuleViolation[] {
  const out: RuleViolation[] = [];
  const hl = sorted(ctx.sessions.filter((s) => active(s) && isHlEquiv(s.category)));
  const races = aRaces(ctx);

  const inModelingWindow = (date: string) =>
    races.some((r) => {
      const d = diffDays(date, raceDateOf(r));
      return d >= 14 && d <= 28;
    });

  let exceptionUsed = false;
  const exemptIds = new Set<string>();

  for (let i = 1; i < hl.length; i++) {
    const prev = hl[i - 1];
    const cur = hl[i];
    const gap = diffDays(prev.date, cur.date);
    if (gap >= 5) continue;

    // 例外判定: モデリング期の3日間隔2連（1回だけ）
    const eligible =
      !exceptionUsed &&
      gap === 3 &&
      inModelingWindow(prev.date) &&
      inModelingWindow(cur.date);
    if (eligible) {
      // 直後7日間の high_lactate 禁止をチェック
      const following = hl.filter(
        (s) => diffDays(cur.date, s.date) > 0 && diffDays(cur.date, s.date) <= 7
      );
      if (following.length === 0) {
        exceptionUsed = true;
        exemptIds.add(prev.id);
        exemptIds.add(cur.id);
        continue;
      }
      out.push(
        finalize(
          {
            rule: "RULE-01",
            level: "ERROR",
            message: `モデリング期の2連(${prev.date}, ${cur.date})の直後7日間に高乳酸(${following[0].date})が配置されています。2連の後7日間は high_lactate 禁止です。`,
            dates: [prev.date, cur.date, following[0].date],
            sessionIds: [prev.id, cur.id, following[0].id],
            suggestion: `${following[0].date} の高乳酸を削除するか、${addDays(cur.date, 8)} 以降へ移動してください。`,
          },
          [prev, cur, following[0]]
        )
      );
      continue;
    }

    out.push(
      finalize(
        {
          rule: "RULE-01",
          level: "ERROR",
          message: `高乳酸系セッションの間隔が${gap}日です（${prev.date} → ${cur.date}）。最短間隔は5日です。`,
          dates: [prev.date, cur.date],
          sessionIds: [prev.id, cur.id],
          suggestion: `どちらかを移動して5日以上空けてください。例: ${cur.date} のセッションを ${addDays(prev.date, 5)} 以降へ。`,
        },
        [prev, cur]
      )
    );
  }

  // 同一週内2回チェック（例外ペアを除く）
  for (const [w, list] of groupByWeek(hl)) {
    const counted = list.filter((s) => !exemptIds.has(s.id));
    if (counted.length > 1) {
      // 間隔5日以上でも同一週2回は違反（例: 月曜と土曜）
      const already = out.some((v) =>
        counted.every((s) => v.sessionIds.includes(s.id))
      );
      if (!already) {
        out.push(
          finalize(
            {
              rule: "RULE-01",
              level: "ERROR",
              message: `週(${w}〜)内に高乳酸系セッションが${counted.length}回あります。同一週内は1回までです。`,
              dates: counted.map((s) => s.date),
              sessionIds: counted.map((s) => s.id),
              suggestion: "1回を翌週へ移動するか、race_economy / neural に置き換えてください。",
            },
            counted
          )
        );
      }
    }
  }
  return out;
}

/**
 * RULE-02 [WARN] high_lactate の翌日に60分超のロングランを置く場合、
 * ペースを通常ジョグ +20〜30秒/km 遅くすること。
 */
function rule02(ctx: RuleContext): RuleViolation[] {
  const out: RuleViolation[] = [];
  const lt = ctx.ltPaceSecPerKm;
  const hl = ctx.sessions.filter((s) => active(s) && s.category === "high_lactate");
  for (const h of hl) {
    const next = ctx.sessions.filter(
      (s) =>
        active(s) &&
        s.date === addDays(h.date, 1) &&
        s.category === "aerobic" &&
        (s.durationMin ?? 0) > 60
    );
    for (const n of next) {
      if (lt !== undefined && n.paceSecPerKm !== undefined) {
        const normalJogSlowest = lt + 80;
        if (n.paceSecPerKm < normalJogSlowest + 20) {
          out.push(
            finalize(
              {
                rule: "RULE-02",
                level: "WARN",
                message: `高乳酸翌日(${n.date})の${n.durationMin}分ロングランのペースが通常ジョグ+20〜30秒/kmまで落とされていません。`,
                dates: [h.date, n.date],
                sessionIds: [h.id, n.id],
                suggestion: `ペースを ${Math.round(normalJogSlowest + 20)}〜${Math.round(normalJogSlowest + 30)}秒/km へ落としてください。`,
              },
              [n]
            )
          );
        }
      } else {
        out.push(
          finalize(
            {
              rule: "RULE-02",
              level: "WARN",
              message: `高乳酸翌日(${n.date})に60分超のロングランがあります。ペースを通常ジョグ+20〜30秒/km遅くしてください。`,
              dates: [h.date, n.date],
              sessionIds: [h.id, n.id],
              suggestion: "ロングランのペースを大幅に落とすか、時間を60分以内に短縮してください。",
            },
            [n]
          )
        );
      }
    }
  }
  return out;
}

/**
 * RULE-03 [ERROR] 質練習の間隔は最低中1日。
 * 中1日の場合、間の日は aerobic または off のみ（neural は可）。
 */
function rule03(ctx: RuleContext): RuleViolation[] {
  const out: RuleViolation[] = [];
  const q = sorted(ctx.sessions.filter((s) => active(s) && isQuality(s.category)));
  for (let i = 1; i < q.length; i++) {
    const prev = q[i - 1];
    const cur = q[i];
    const gap = diffDays(prev.date, cur.date);
    if (gap <= 1) {
      out.push(
        finalize(
          {
            rule: "RULE-03",
            level: "ERROR",
            message:
              gap === 0
                ? `同日(${cur.date})に質練習が2つ配置されています。`
                : `質練習が連日(${prev.date} → ${cur.date})で配置されています。最低中1日空けてください。`,
            dates: [prev.date, cur.date],
            sessionIds: [prev.id, cur.id],
            suggestion: `${cur.name} を ${addDays(prev.date, 2)} 以降へ移動してください。`,
          },
          [prev, cur]
        )
      );
    }
  }
  return out;
}

/** RULE-04 [ERROR] 同一週内の質練習は最大2回（モデリング期の例外を除く） */
function rule04(ctx: RuleContext): RuleViolation[] {
  const out: RuleViolation[] = [];
  const q = ctx.sessions.filter((s) => active(s) && isQuality(s.category));
  const races = aRaces(ctx);
  for (const [w, list] of groupByWeek(q)) {
    const max = races.some((r) => {
      const d = diffDays(w, raceDateOf(r));
      return d >= 7 && d <= 28; // モデリング期の週は例外的に3回まで
    })
      ? 3
      : 2;
    if (list.length > max) {
      out.push(
        finalize(
          {
            rule: "RULE-04",
            level: "ERROR",
            message: `週(${w}〜)の質練習が${list.length}回です。最大${max}回までです。`,
            dates: list.map((s) => s.date),
            sessionIds: list.map((s) => s.id),
            suggestion:
              "優先度の低い質練習（cv / threshold）を aerobic に置き換えるか翌週へ移動してください。",
          },
          list
        )
      );
    }
  }
  return out;
}

/**
 * RULE-05 [WARN] 有酸素系質練習(cv+threshold)が2回以上、かつ
 * 特異的(high_lactate+race_economy)が1回以下 → 有酸素偏重
 */
function rule05(ctx: RuleContext): RuleViolation[] {
  const out: RuleViolation[] = [];
  const q = ctx.sessions.filter((s) => active(s));
  for (const [w, list] of groupByWeek(q)) {
    const aq = list.filter((s) => AEROBIC_QUALITY_CATEGORIES.includes(s.category));
    const sp = list.filter((s) => isSpecific(s.category));
    if (aq.length >= 2 && sp.length <= 1) {
      out.push(
        finalize(
          {
            rule: "RULE-05",
            level: "WARN",
            message: `週(${w}〜)は有酸素系質練習${aq.length}回に対し特異的セッション${sp.length}回で「有酸素偏重」です。800m選手には不適な週構成です。`,
            dates: aq.map((s) => s.date),
            sessionIds: aq.map((s) => s.id),
            suggestion: "cv / threshold の1回を race_economy または high_lactate に置き換えてください。",
          },
          aq
        )
      );
    }
  }
  return out;
}

/** RULE-06 [WARN] 連続する3週で high_lactate が3回以上 → VLaMax上昇リスク */
function rule06(ctx: RuleContext): RuleViolation[] {
  const out: RuleViolation[] = [];
  const hl = sorted(
    ctx.sessions.filter((s) => active(s) && s.category === "high_lactate")
  );
  if (hl.length < 3) return out;
  const weeks = [...new Set(hl.map((s) => weekStart(s.date)))].sort();
  const reported = new Set<string>();
  for (const w of weeks) {
    const windowEnd = addDays(w, 20); // 3週間 = 21日
    const inWindow = hl.filter(
      (s) => s.date >= w && s.date <= windowEnd
    );
    if (inWindow.length >= 3) {
      const key = inWindow.map((s) => s.id).join(",");
      if (reported.has(key)) continue;
      reported.add(key);
      out.push({
        rule: "RULE-06",
        level: "WARN",
        message: `連続3週(${w}〜${windowEnd})に高乳酸が${inWindow.length}回あります。不完全休息での高強度反復の積み重ねはVLaMax上昇（有酸素効率低下）のリスクがあります。`,
        dates: inWindow.map((s) => s.date),
        sessionIds: inWindow.map((s) => s.id),
        suggestion: "1回を race_economy に置き換え、高乳酸の頻度を隔週〜週1未満に抑えることを検討してください。",
      });
    }
  }
  return out;
}

/** RULE-07 [ERROR] レース14日前以降、新規 high_lactate は最大1回（7〜9日前に配置） */
function rule07(ctx: RuleContext): RuleViolation[] {
  const out: RuleViolation[] = [];
  for (const race of aRaces(ctx)) {
    const rd = raceDateOf(race);
    const inWindow = sorted(
      ctx.sessions.filter((s) => {
        if (!active(s) || !isHlEquiv(s.category)) return false;
        const d = diffDays(s.date, rd);
        return d > 0 && d <= 14;
      })
    );
    if (inWindow.length > 1) {
      out.push(
        finalize(
          {
            rule: "RULE-07",
            level: "ERROR",
            message: `${race.name}(${rd})の14日前以降に高乳酸系が${inWindow.length}回あります。最大1回までです。`,
            dates: inWindow.map((s) => s.date),
            sessionIds: inWindow.map((s) => s.id),
            suggestion: `${addDays(rd, -9)}〜${addDays(rd, -7)} の1回だけを残し、他は削除してください。`,
          },
          inWindow
        )
      );
    } else if (inWindow.length === 1) {
      const d = diffDays(inWindow[0].date, rd);
      if (d < 7 || d > 9) {
        out.push(
          finalize(
            {
              rule: "RULE-07",
              level: "ERROR",
              message: `${race.name}(${rd})前の最後の高乳酸がレース${d}日前に配置されています。7〜9日前に配置してください。`,
              dates: [inWindow[0].date],
              sessionIds: [inWindow[0].id],
              suggestion: `${addDays(rd, -9)}〜${addDays(rd, -7)} へ移動してください。`,
            },
            [inWindow[0]]
          )
        );
      }
    }
  }
  return out;
}

/** RULE-08 [ERROR] レース7日前以降、質練習は neural（200m以下・完全休息）のみ */
function rule08(ctx: RuleContext): RuleViolation[] {
  const out: RuleViolation[] = [];
  for (const race of aRaces(ctx)) {
    const rd = raceDateOf(race);
    const bad = ctx.sessions.filter((s) => {
      if (!active(s) || !isQuality(s.category)) return false;
      const d = diffDays(s.date, rd);
      return d > 0 && d < 7;
    });
    for (const s of bad) {
      out.push(
        finalize(
          {
            rule: "RULE-08",
            level: "ERROR",
            message: `${race.name}(${rd})の7日前以降に質練習「${s.name}」(${s.date})が配置されています。この期間の質はneural（200m以下・完全休息）のみです。`,
            dates: [s.date],
            sessionIds: [s.id],
            suggestion: "neural（流し・150m×2〜3 完全休息）に置き換えるか削除してください。",
            autofix: [
              {
                sessionId: s.id,
                field: "category",
                before: s.category,
                after: "neural",
                reason: "レース7日前以降の質練習はneuralのみ（RULE-08）",
                triggeredBy: "RULE-08",
                direction: "down",
                action: "modify",
              },
            ],
          },
          [s]
        )
      );
    }
  }
  return out;
}

/** RULE-09 [ERROR] レース3日前以降、総走行距離を通常週の50%以下に */
function rule09(ctx: RuleContext): RuleViolation[] {
  const out: RuleViolation[] = [];
  const withKm = ctx.sessions.filter((s) => s.distanceKm !== undefined);
  if (withKm.length === 0) return out; // 距離データが無ければ判定不能

  for (const race of aRaces(ctx)) {
    const rd = raceDateOf(race);
    // 通常週の日次平均: レース28日前〜7日前の走行距離 ÷ 21日
    const baseline = withKm
      .filter((s) => {
        const d = diffDays(s.date, rd);
        return d >= 7 && d <= 28 && s.status !== "skipped";
      })
      .reduce((a, s) => a + (s.distanceKm ?? 0), 0);
    if (baseline === 0) continue;
    const dailyAvg = baseline / 21;
    const limit = dailyAvg * 3 * 0.5; // 3日分の50%

    const last3 = withKm.filter((s) => {
      const d = diffDays(s.date, rd);
      return d > 0 && d <= 3 && s.status !== "skipped";
    });
    const total = last3.reduce((a, s) => a + (s.distanceKm ?? 0), 0);
    if (total > limit) {
      out.push(
        finalize(
          {
            rule: "RULE-09",
            level: "ERROR",
            message: `${race.name}(${rd})前3日間の走行距離が${total.toFixed(1)}kmで、通常週換算の50%(${limit.toFixed(1)}km)を超えています。`,
            dates: last3.map((s) => s.date),
            sessionIds: last3.map((s) => s.id),
            suggestion: "ジョグの距離を削り、前3日間の総量を半分以下に抑えてください。",
          },
          last3
        )
      );
    }
  }
  return out;
}

/**
 * RULE-10 [WARN] heat_tolerance="low" かつ 28℃以上（または夏季）:
 * high_lactate / race_economy の設定を1〜2%遅く、threshold は涼所への変更を提案
 */
function rule10(ctx: RuleContext): RuleViolation[] {
  const out: RuleViolation[] = [];
  if (ctx.athlete.heatTolerance !== "low") return out;
  const targets = ctx.sessions.filter(
    (s) =>
      active(s) &&
      (isSpecific(s.category) || s.category === "threshold") &&
      s.status === "planned" &&
      isHotDay(ctx, s.date)
  );
  for (const s of targets) {
    if (s.category === "threshold") {
      out.push({
        rule: "RULE-10",
        level: "WARN",
        message: `${s.date} の閾値走は暑熱環境が予想されます（heat_tolerance: low）。`,
        dates: [s.date],
        sessionIds: [s.id],
        suggestion: "トレッドミルまたは涼しい場所・時間帯への変更を推奨します。",
      });
    } else {
      out.push({
        rule: "RULE-10",
        level: "WARN",
        message: `${s.date} の「${s.name}」は暑熱環境が予想されます（heat_tolerance: low）。設定ペースを1〜2%遅くしてください。`,
        dates: [s.date],
        sessionIds: [s.id],
        suggestion: "設定を1〜2%緩め、達成度評価も暑熱補正付きで行ってください。",
      });
    }
  }
  return out;
}

/** RULE-11 [WARN] 真夏(7-8月)の2部練は heat_tolerance="low" には非推奨 */
function rule11(ctx: RuleContext): RuleViolation[] {
  const out: RuleViolation[] = [];
  if (ctx.athlete.heatTolerance !== "low") return out;
  const byDate = new Map<string, Session[]>();
  for (const s of ctx.sessions.filter((s) => active(s))) {
    if (!isMidsummer(s.date)) continue;
    if (!byDate.has(s.date)) byDate.set(s.date, []);
    byDate.get(s.date)!.push(s);
  }
  for (const [d, list] of byDate) {
    const ams = list.filter((s) => s.timeOfDay === "am");
    const pms = list.filter((s) => s.timeOfDay === "pm");
    if (ams.length > 0 && pms.length > 0) {
      out.push(
        finalize(
          {
            rule: "RULE-11",
            level: "WARN",
            message: `${d} は真夏の2部練習です。heat_tolerance="low" の選手には非推奨です。`,
            dates: [d],
            sessionIds: list.map((s) => s.id),
            suggestion: "高強度を涼しい時間帯（早朝または夜）の単発に集約してください。",
          },
          list
        )
      );
    }
  }
  return out;
}

/** RULE-12 [ERROR] 直近14日に赤信号 → 次の質練習を aerobic に自動置換し再評価 */
function rule12(ctx: RuleContext): RuleViolation[] {
  const out: RuleViolation[] = [];
  const reds = ctx.dailyChecks.filter(
    (c) =>
      c.signal === "red" &&
      diffDays(c.date, ctx.evaluationDate) >= 0 &&
      diffDays(c.date, ctx.evaluationDate) <= 14
  );
  if (reds.length === 0) return out;
  const lastRed = reds.map((c) => c.date).sort().slice(-1)[0];

  const nextQuality = sorted(
    ctx.sessions.filter(
      (s) =>
        s.status === "planned" &&
        isQuality(s.category) &&
        s.date > lastRed &&
        s.date >= ctx.evaluationDate
    )
  )[0];
  if (!nextQuality) return out;

  out.push(
    finalize(
      {
        rule: "RULE-12",
        level: "ERROR",
        message: `直近14日以内(${lastRed})に赤信号があります。次の質練習「${nextQuality.name}」(${nextQuality.date})を有酸素に置換し、状態を再評価してください。`,
        dates: [lastRed, nextQuality.date],
        sessionIds: [nextQuality.id],
        suggestion: "質練習を軽いジョグに置き換え、安静時HR・睡眠が平常に戻るまで質を再開しないでください。",
        autofix: [
          {
            sessionId: nextQuality.id,
            field: "category",
            before: nextQuality.category,
            after: "aerobic",
            reason: `赤信号(${lastRed})後の最初の質練習のため`,
            triggeredBy: "RULE-12",
            direction: "down",
            action: "replace_with_aerobic",
          },
        ],
      },
      [nextQuality]
    )
  );
  return out;
}

/** RULE-13 [WARN] 週内の平均ジョグペースが LT+30〜50秒/km に集中 → グレーゾーン */
function rule13(ctx: RuleContext): RuleViolation[] {
  const out: RuleViolation[] = [];
  const lt = ctx.ltPaceSecPerKm;
  if (lt === undefined) return out;
  const jogs = ctx.sessions.filter(
    (s) => active(s) && s.category === "aerobic" && s.paceSecPerKm !== undefined
  );
  for (const [w, list] of groupByWeek(jogs)) {
    const gray = list.filter((s) => isGrayZonePace(s.paceSecPerKm!, lt));
    if (list.length >= 2 && gray.length / list.length >= 0.5) {
      out.push(
        finalize(
          {
            rule: "RULE-13",
            level: "WARN",
            message: `週(${w}〜)のジョグの${gray.length}/${list.length}本がグレーゾーン(LT+30〜50秒/km)に集中しています。中途半端な強度は回復も刺激も得られません。`,
            dates: gray.map((s) => s.date),
            sessionIds: gray.map((s) => s.id),
            suggestion: `回復日のジョグは LT+60秒/km(${Math.round(lt + 60)}秒/km)より遅くしてください。`,
          },
          gray
        )
      );
    }
  }
  return out;
}

/** RULE-14 [INFO] 路面・シューズ・環境の急変を検出 → 2〜3週の漸進を提案 */
function rule14(ctx: RuleContext): RuleViolation[] {
  const out: RuleViolation[] = [];
  const withSurface = sorted(ctx.sessions.filter((s) => active(s) && s.surface));
  const byWeek = groupByWeek(withSurface);
  const weeks = [...byWeek.keys()].sort();
  for (let i = 1; i < weeks.length; i++) {
    const dom = (list: Session[]) => {
      const counts = new Map<string, number>();
      for (const s of list)
        counts.set(s.surface!, (counts.get(s.surface!) ?? 0) + 1);
      return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    };
    const prev = dom(byWeek.get(weeks[i - 1])!);
    const cur = dom(byWeek.get(weeks[i])!);
    if (prev && cur && prev !== cur) {
      out.push({
        rule: "RULE-14",
        level: "INFO",
        message: `週(${weeks[i]}〜)で主な路面が ${prev} → ${cur} に急変しています。`,
        dates: [weeks[i]],
        sessionIds: byWeek.get(weeks[i])!.map((s) => s.id),
        suggestion: "腱・結合組織への負荷が変わるため、2〜3週かけて段階的に移行してください。",
      });
    }
  }
  return out;
}

/** RULE-16 [WARN] ACWR > 1.5 で急性負荷増大警告、< 0.8 で負荷不足通知 */
function rule16(ctx: RuleContext): RuleViolation[] {
  const out: RuleViolation[] = [];
  if (ctx.currentAcwr === undefined) return out;
  if (ctx.currentAcwr > 1.5) {
    out.push({
      rule: "RULE-16",
      level: "WARN",
      message: `ACWR = ${ctx.currentAcwr.toFixed(2)}。急性負荷が慢性負荷に対して過大です。故障・オーバーリーチのリスクがあります。`,
      dates: [ctx.evaluationDate],
      sessionIds: [],
      suggestion: "今週の量を減らし、ACWRを0.8〜1.3の帯に戻してください。単独指標では判断せず、信号機・主観と併せて確認してください。",
    });
  } else if (ctx.currentAcwr < 0.8) {
    out.push({
      rule: "RULE-16",
      level: "WARN",
      message: `ACWR = ${ctx.currentAcwr.toFixed(2)}。負荷不足の可能性があります（刺激が足りていない）。`,
      dates: [ctx.evaluationDate],
      sessionIds: [],
      suggestion: "コンディションに問題がなければ、計画通りの負荷を確保してください。",
    });
  }
  return out;
}

/** RULE-17 [WARN] 週間走行距離の増加率が前週比15%超 */
function rule17(ctx: RuleContext): RuleViolation[] {
  const out: RuleViolation[] = [];
  const withKm = ctx.sessions.filter(
    (s) => s.distanceKm !== undefined && s.status !== "skipped"
  );
  if (withKm.length === 0) return out;
  const byWeek = new Map<string, number>();
  for (const s of withKm) {
    const w = weekStart(s.date);
    byWeek.set(w, (byWeek.get(w) ?? 0) + (s.distanceKm ?? 0));
  }
  const weeks = [...byWeek.keys()].sort();
  for (let i = 1; i < weeks.length; i++) {
    if (diffDays(weeks[i - 1], weeks[i]) !== 7) continue; // 連続週のみ
    const prev = byWeek.get(weeks[i - 1])!;
    const cur = byWeek.get(weeks[i])!;
    if (prev > 0 && (cur - prev) / prev > 0.15) {
      out.push({
        rule: "RULE-17",
        level: "WARN",
        message: `週(${weeks[i]}〜)の走行距離${cur.toFixed(1)}kmは前週${prev.toFixed(1)}kmから${(((cur - prev) / prev) * 100).toFixed(0)}%増です（上限15%）。`,
        dates: [weeks[i]],
        sessionIds: [],
        suggestion: "増加分をジョグから削り、前週比15%以内に抑えてください。",
      });
    }
  }
  return out;
}

/** RULE-18 [ERROR] heavy補強を質練習の前日に配置してはならない */
function rule18(ctx: RuleContext): RuleViolation[] {
  const out: RuleViolation[] = [];
  const heavies = ctx.strengthSessions.filter(
    (st) => st.loadLevel === "heavy" && st.status !== "skipped"
  );
  for (const st of heavies) {
    const nextDayQuality = ctx.sessions.filter(
      (s) => active(s) && s.date === addDays(st.date, 1) && isQuality(s.category)
    );
    if (nextDayQuality.length > 0) {
      out.push({
        rule: "RULE-18",
        level: "ERROR",
        message: `${st.date} のheavy補強が翌日の質練習「${nextDayQuality[0].name}」の前日に配置されています。`,
        dates: [st.date, nextDayQuality[0].date],
        sessionIds: [st.id, ...nextDayQuality.map((s) => s.id)],
        suggestion: `heavy補強は質練習当日(${nextDayQuality[0].date})のpmにブロック化してください（回復日を汚さない原則）。`,
      });
    }
  }
  return out;
}

/** RULE-19 [ERROR] レース7日前以降、heavy/moderate の strength・plyometrics 禁止（core可） */
function rule19(ctx: RuleContext): RuleViolation[] {
  const out: RuleViolation[] = [];
  for (const race of aRaces(ctx)) {
    const rd = raceDateOf(race);
    const bad = ctx.strengthSessions.filter((st) => {
      if (st.status === "skipped") return false;
      if (st.type === "core") return false;
      if (st.loadLevel === "light") return false;
      const d = diffDays(st.date, rd);
      return d >= 0 && d < 7;
    });
    for (const st of bad) {
      out.push({
        rule: "RULE-19",
        level: "ERROR",
        message: `${race.name}(${rd})の7日前以降に ${st.loadLevel} の${st.type}(${st.date})が配置されています。`,
        dates: [st.date],
        sessionIds: [st.id],
        suggestion: "削除するか core（体幹のみ）に置き換えてください。",
      });
    }
  }
  return out;
}

/** RULE-20 [ERROR] 複数ラウンドレースのラウンド間の日に質練習（neural含む）を配置禁止 */
function rule20(ctx: RuleContext): RuleViolation[] {
  const out: RuleViolation[] = [];
  for (const race of ctx.races) {
    if (race.rounds.length < 2) continue;
    const dates = race.rounds.map((r) => r.datetime.slice(0, 10)).sort();
    const first = dates[0];
    const last = dates[dates.length - 1];
    const bad = ctx.sessions.filter((s) => {
      if (s.status === "skipped") return false;
      if (s.isRecoveryProtocol) return false; // 4-7の回復プロトコルは許可
      if (s.category === "aerobic" || s.category === "off") return false;
      return s.date >= first && s.date <= last && !dates.includes(s.date);
    });
    for (const s of bad) {
      out.push(
        finalize(
          {
            rule: "RULE-20",
            level: "ERROR",
            message: `${race.name} のラウンド間(${s.date})に「${s.name}」(${s.category})が配置されています。ラウンド間は aerobic / off / 回復プロトコルのみです。`,
            dates: [s.date],
            sessionIds: [s.id],
            suggestion: "削除するか、4-7-2の回復プロトコル（ジョグ+流し）に置き換えてください。",
            autofix: [
              {
                sessionId: s.id,
                field: "category",
                before: s.category,
                after: "aerobic",
                reason: "ラウンド間に質練習は配置できない（RULE-20）",
                triggeredBy: "RULE-20",
                direction: "down",
                action: "replace_with_aerobic",
              },
            ],
          },
          [s]
        )
      );
    }
  }
  return out;
}

/** RULE-21 [WARN] 予選の想定ペースが目標タイムと同等以上（速すぎる）警告 */
function rule21(ctx: RuleContext): RuleViolation[] {
  const out: RuleViolation[] = [];
  if (!ctx.goal) return out;
  for (const race of ctx.races) {
    if (race.peakTargetRound !== "final") continue;
    const heat = race.rounds.find((r) => r.type === "heat");
    if (!heat || heat.expectedPaceSec === undefined) continue;
    if (heat.expectedPaceSec <= ctx.goal.targetTimeSec) {
      out.push({
        rule: "RULE-21",
        level: "WARN",
        message: `${race.name} の予選想定(${heat.expectedPaceSec.toFixed(1)}秒)が目標タイム(${ctx.goal.targetTimeSec.toFixed(1)}秒)と同等以上です。予選で出し切る設計になっています。`,
        dates: [heat.datetime.slice(0, 10)],
        sessionIds: [],
        suggestion: "通過条件を確認し、予選は「着に入る最低限」まで想定ペースを落としてください。決勝に余力を残すのがラウンド管理の原則です。",
      });
    }
  }
  return out;
}

/** RULE-22 [WARN] 暑熱順化ブロック期間中に high_lactate / modeling を配置 */
function rule22(ctx: RuleContext): RuleViolation[] {
  const out: RuleViolation[] = [];
  for (const block of ctx.heatBlocks) {
    const bad = ctx.sessions.filter(
      (s) =>
        active(s) &&
        isHlEquiv(s.category) &&
        s.date >= block.startDate &&
        s.date <= block.endDate
    );
    for (const s of bad) {
      out.push(
        finalize(
          {
            rule: "RULE-22",
            level: "WARN",
            message: `暑熱順化ブロック(${block.startDate}〜${block.endDate})中に「${s.name}」(${s.date})が配置されています。順化中は特異的セッションの質が担保できません。`,
            dates: [s.date],
            sessionIds: [s.id],
            suggestion: "特異的セッションは涼しい時間帯に別途確保するか、ブロック外へ移動してください。",
          },
          [s]
        )
      );
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// エンジン本体
// ---------------------------------------------------------------------------

export function runRuleEngine(ctx: RuleContext): RuleViolation[] {
  const violations = [
    ...rule01(ctx),
    ...rule02(ctx),
    ...rule03(ctx),
    ...rule04(ctx),
    ...rule05(ctx),
    ...rule06(ctx),
    ...rule07(ctx),
    ...rule08(ctx),
    ...rule09(ctx),
    ...rule10(ctx),
    ...rule11(ctx),
    ...rule12(ctx),
    ...rule13(ctx),
    ...rule14(ctx),
    ...rule16(ctx),
    ...rule17(ctx),
    ...rule18(ctx),
    ...rule19(ctx),
    ...rule20(ctx),
    ...rule21(ctx),
    ...rule22(ctx),
  ];
  const order = { ERROR: 0, WARN: 1, INFO: 2 };
  return violations.sort((a, b) => order[a.level] - order[b.level]);
}

// ---------------------------------------------------------------------------
// 週次サマリー（4-4）
// ---------------------------------------------------------------------------

/** カテゴリ別のデフォルトRPE（負荷加重に使用） */
const CATEGORY_DEFAULT_RPE: Record<SessionCategory, number> = {
  high_lactate: 8,
  modeling: 9,
  race_economy: 6,
  neural: 4,
  cv: 7,
  threshold: 5,
  aerobic: 3,
  off: 0,
};

const CATEGORY_DEFAULT_DURATION: Record<SessionCategory, number> = {
  high_lactate: 60,
  modeling: 60,
  race_economy: 60,
  neural: 40,
  cv: 55,
  threshold: 55,
  aerobic: 45,
  off: 0,
};

export function sessionLoadEstimate(s: Session): number {
  const dur = s.durationMin ?? CATEGORY_DEFAULT_DURATION[s.category];
  return CATEGORY_DEFAULT_RPE[s.category] * dur;
}

export function weeklySummary(
  ctx: RuleContext,
  weekStartDate: string
): WeeklySummary {
  const weekEnd = addDays(weekStartDate, 6);
  const inWeek = ctx.sessions.filter(
    (s) => s.date >= weekStartDate && s.date <= weekEnd && s.status !== "skipped"
  );

  const categoryCounts = {
    high_lactate: 0,
    race_economy: 0,
    modeling: 0,
    neural: 0,
    cv: 0,
    threshold: 0,
    aerobic: 0,
    off: 0,
  } as Record<SessionCategory, number>;
  const timeByCat: Record<string, number> = {};
  let totalTime = 0;
  let weightedTransfer = 0;
  let totalLoad = 0;
  let totalKm = 0;

  for (const s of inWeek) {
    categoryCounts[s.category]++;
    const dur = s.durationMin ?? CATEGORY_DEFAULT_DURATION[s.category];
    timeByCat[s.category] = (timeByCat[s.category] ?? 0) + dur;
    totalTime += dur;
    const load = sessionLoadEstimate(s);
    weightedTransfer += s.transfer800m * load;
    totalLoad += load;
    totalKm += s.distanceKm ?? 0;
  }

  const categoryTimeRatio: Record<string, number> = {};
  for (const [cat, t] of Object.entries(timeByCat)) {
    categoryTimeRatio[cat] = totalTime > 0 ? t / totalTime : 0;
  }

  const hl28 = ctx.sessions.filter(
    (s) =>
      s.status !== "skipped" &&
      s.category === "high_lactate" &&
      diffDays(s.date, weekEnd) >= 0 &&
      diffDays(s.date, weekEnd) < 28
  ).length;

  const allViolations = runRuleEngine(ctx);
  const weekViolations = allViolations.filter((v) =>
    v.dates.some((d) => d >= weekStartDate && d <= weekEnd)
  );

  return {
    weekStart: weekStartDate,
    categoryCounts,
    categoryTimeRatio,
    transfer800mScore: totalLoad > 0 ? weightedTransfer / totalLoad : 0,
    highLactateLast28d: hl28,
    violations: weekViolations,
    totalDistanceKm: totalKm,
  };
}
