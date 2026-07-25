/**
 * 4-7. ラウンド管理（予選 → 準決勝 → 決勝）
 * 主要大会は2〜3日で2〜3本走る。テーパーは peak_target_round に合わせる。
 */
import type { Race, Round, Session } from "./types";
import { addDays, diffDays, fmtTime } from "./dates";
import { rationaleFor } from "./rationale";

// ---------------------------------------------------------------------------
// 4-7-1. 予選の想定ペース算出
// ---------------------------------------------------------------------------

export interface RoundPacePlan {
  roundType: Round["type"];
  expectedTimeSec: number;
  /** 想定ラップ（前半400 / 後半400） */
  lapFront400Sec: number;
  lapBack400Sec: number;
  /** これ以上速く走る必要はない上限（＝これより速いのは無駄な消耗） */
  upperLimitNote: string;
  reserveNote: string;
  conditionalNote?: string;
}

export function planHeatPace(race: Race, goalTargetSec: number): RoundPacePlan | undefined {
  const heat = race.rounds.find((r) => r.type === "heat");
  if (!heat) return undefined;

  let expected: number;
  let conditional: string | undefined;

  switch (race.advancementRule) {
    case "place": {
      expected = goalTargetSec + 5; // +4〜6秒の中央値
      break;
    }
    case "time": {
      const border = race.borderTimeSec ?? goalTargetSec + 2;
      expected = border - 0.5; // ボーダー + 安全マージン0.5秒（速い側に）
      break;
    }
    case "place_and_time": {
      const byPlace = goalTargetSec + 5;
      const border = (race.borderTimeSec ?? goalTargetSec + 2) - 0.5;
      expected = Math.min(byPlace, border);
      conditional =
        "組の展開次第で切り替える条件付き: 前半から流れが速ければ着順狙いに徹し、遅い展開ならタイム通過ボーダーを意識してロングスパートに切り替える。";
      break;
    }
    default: {
      expected = goalTargetSec + 5;
    }
  }

  // 予選は抑えた入りのイーブン寄り（前後半差 ±0.7秒）
  const front = expected / 2 - 0.7;
  const back = expected / 2 + 0.7;

  return {
    roundType: "heat",
    expectedTimeSec: expected,
    lapFront400Sec: front,
    lapBack400Sec: back,
    upperLimitNote:
      race.advancementRule === "place"
        ? `勝つ必要はなく、着に入れば足りる。${fmtTime(expected)}より速く走る必要はない。`
        : `${fmtTime(expected)}を上限の目安とし、それより速く走る必要はない。`,
    reserveNote:
      "決勝までに残すべき余力の目安: 予選のRPEを7以下に抑える。ラスト100mは競り合いに使わず流して通過する。",
    conditionalNote: conditional,
  };
}

/** 全ラウンドの想定ペースを更新した Race を返す */
export function assignExpectedPaces(race: Race, goalTargetSec: number): Race {
  const heatPlan = planHeatPace(race, goalTargetSec);
  return {
    ...race,
    rounds: race.rounds.map((r) => {
      if (r.type === "heat" && heatPlan) {
        return { ...r, expectedPaceSec: heatPlan.expectedTimeSec };
      }
      if (r.type === "semifinal") {
        return { ...r, expectedPaceSec: goalTargetSec + 2 };
      }
      return { ...r, expectedPaceSec: goalTargetSec };
    }),
  };
}

// ---------------------------------------------------------------------------
// 4-7-2. ラウンド間回復プロトコル
// ---------------------------------------------------------------------------

export interface RecoveryProtocolDay {
  date: string;
  prescription: string;
}

/** ラウンド間隔（日数）に応じた回復プロトコルを返す */
export function recoveryProtocol(gapDays: number): string[] {
  if (gapDays <= 0) {
    return ["ジョグ10〜15分 + ストレッチ。補給を最優先。流しは行わない。"];
  }
  if (gapDays === 1) {
    return ["ジョグ20〜30分 + 流し2〜3本（当日午前または前日夕方）"];
  }
  if (gapDays === 2) {
    return [
      "1日目: ジョグ30分 + 流し4本",
      "2日目: ジョグ20分 + 流し2〜3本",
    ];
  }
  // 中2日以上
  const days: string[] = [];
  for (let i = 1; i < gapDays; i++) {
    days.push(
      i === Math.floor(gapDays / 2)
        ? "中日: 150m × 2〜3（完全休息）を1回まで許可"
        : "ジョグ20〜30分"
    );
  }
  return days;
}

let recSeq = 0;

/** ラウンド間の日に回復プロトコルのセッションを生成する（RULE-20の許可対象） */
export function generateRecoverySessions(race: Race): Session[] {
  const dates = [...new Set(race.rounds.map((r) => r.datetime.slice(0, 10)))].sort();
  const out: Session[] = [];
  for (let i = 1; i < dates.length; i++) {
    const gap = diffDays(dates[i - 1], dates[i]);
    const protocol = recoveryProtocol(gap);
    for (let d = 1; d < gap; d++) {
      const date = addDays(dates[i - 1], d);
      const line = protocol[Math.min(d - 1, protocol.length - 1)];
      recSeq++;
      out.push({
        id: `rec-${race.id}-${recSeq}`,
        date,
        category: line.includes("150m") || line.includes("流し") ? "neural" : "aerobic",
        name: "ラウンド間回復",
        prescription: line,
        targetPaces: [],
        transfer800m: 2,
        transfer1500m: 2,
        riskLevel: "low",
        phase: "Taper",
        rationale: rationaleFor("aerobic"),
        status: "planned",
        isFixed: false,
        timeOfDay: "am",
        isRecoveryProtocol: true,
        durationMin: 30,
        distanceKm: 4,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 4-7-3. テーパーの基準日
// ---------------------------------------------------------------------------

export interface TaperAnchor {
  /** テーパー逆算の基準日 = peak_target_round の日付 */
  peakDate: string;
  /** 初戦の日付 */
  firstRoundDate: string;
  /** RULE-08（質はneuralのみ）を適用完了させる期限 = 初戦の3日前 */
  qualityCutoffDate: string;
}

export function taperAnchor(race: Race): TaperAnchor {
  const dates = race.rounds.map((r) => r.datetime.slice(0, 10)).sort();
  const first = dates[0] ?? race.dateStart;
  const peak =
    race.rounds.find((r) => r.type === race.peakTargetRound)?.datetime.slice(0, 10) ??
    dates[dates.length - 1] ??
    race.dateStart;
  return {
    peakDate: peak,
    firstRoundDate: first,
    qualityCutoffDate: addDays(first, -3),
  };
}

// ---------------------------------------------------------------------------
// 4-7-4. ラウンドごとの結果と診断
// ---------------------------------------------------------------------------

export interface RoundResult {
  roundType: Round["type"];
  timeSec: number;
  laps?: number[];
}

export interface RoundsDiagnosis {
  /** CFE更新に使うタイム = 最も速いラウンド */
  fastestTimeSec: number;
  finalMinusHeatSec?: number;
  assessment: string;
}

export function diagnoseRounds(results: RoundResult[]): RoundsDiagnosis {
  const fastest = Math.min(...results.map((r) => r.timeSec));
  const heat = results.find((r) => r.roundType === "heat");
  const final = results.find((r) => r.roundType === "final");

  let diff: number | undefined;
  let assessment = "単一ラウンドのため、ラウンド管理の診断はありません。";

  if (heat && final) {
    diff = final.timeSec - heat.timeSec;
    if (diff < -1.0) {
      assessment =
        "決勝が予選より大幅に速い: 予選を省エネで通せています。ラウンド管理は良好です。";
    } else if (diff > 0) {
      assessment =
        "決勝が予選より遅い: ラウンド間の回復不足、または予選で出し切っています。次回に向けて予選の想定ペース(4-7-1)を見直してください。";
    } else {
      assessment = "予選と決勝がほぼ同タイム: 予選の消耗がやや大きい可能性があります。";
    }
  }

  return { fastestTimeSec: fastest, finalMinusHeatSec: diff, assessment };
}
