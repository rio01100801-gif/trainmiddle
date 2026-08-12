/**
 * 4-5-1. CFE（Current Fitness Estimate＝推定800mタイム）
 * 4-5-2. 基準タイムとペースの再計算
 *
 * CFEは「すべてのペースの親となる唯一の数値」。
 * 練習結果はセッション設定の上下ではなく、CFE更新のために使う。
 */
import type {
  CurrentFitnessEstimate,
  Phase,
  Session,
  SessionCategory,
  SessionResult,
} from "./types";
import { diffDays, fmtTime } from "./dates";
import { impliedFromInterval } from "./backfill";
import { GRP_RATIOS } from "./pace";

/**
 * RPE 1ポイントあたりの補正（秒/800m）。
 *
 * 実測タイム基準に変えたときに 0.4 から下げた。主役は実測で、RPEは補助。
 * 0にしないのは、レストを削った・向かい風だった等がRPEにしか出ないため。
 */
export const RPE_ADJUST_SEC_PER_POINT = 0.15;

// ---------------------------------------------------------------------------
// 期待RPEと信頼度（仕様書 4-5-1 の表）
// ---------------------------------------------------------------------------

export const SESSION_CFE_PARAMS: Partial<
  Record<SessionCategory | "race", { expectedRpe: number | null; confidence: number }>
> = {
  race: { expectedRpe: null, confidence: 1.0 },
  modeling: { expectedRpe: 9, confidence: 0.8 },
  high_lactate: { expectedRpe: 8, confidence: 0.7 },
  race_economy: { expectedRpe: 6, confidence: 0.6 },
  cv: { expectedRpe: 7, confidence: 0.3 },
  threshold: { expectedRpe: 5, confidence: 0.25 },
  aerobic: { expectedRpe: null, confidence: 0.0 }, // CFE更新に使わない
  neural: { expectedRpe: null, confidence: 0.0 }, // CFE更新に使わない
};

/** 初期値: 直近12週以内のレース実績。無ければ 800mPB + 1.5秒 */
export function initCfe(
  pb800Sec: number,
  today: string,
  recentRace?: { date: string; timeSec: number }
): CurrentFitnessEstimate {
  if (recentRace && diffDays(recentRace.date, today) <= 84 && diffDays(recentRace.date, today) >= 0) {
    return {
      estimated800mSec: recentRace.timeSec,
      confidence: 1.0,
      lastUpdated: today,
      history: [
        {
          date: today,
          before: recentRace.timeSec,
          after: recentRace.timeSec,
          source: `初期化: ${recentRace.date} のレース実績`,
        },
      ],
    };
  }
  const v = pb800Sec + 1.5;
  return {
    estimated800mSec: v,
    confidence: 0.5,
    lastUpdated: today,
    history: [{ date: today, before: v, after: v, source: "初期化: 800mPB + 1.5秒" }],
  };
}

// ---------------------------------------------------------------------------
// CFE更新
// ---------------------------------------------------------------------------

export interface CfeUpdateContext {
  /** 気温28℃以上、または next_day_legs="heavy" が既に2連続 → 改善・悪化どちらの方向も反映しない */
  tempC?: number;
  heavyLegsStreak?: number;
  isRace?: boolean;
  raceTimeSec?: number; // レースの場合の実測タイム
  /**
   * 目標タイム（統合監査で追加）。
   *
   * `session.targetPaces` は `baseTime(CFE, 目標, フェーズ)` から作られており、
   * Build以降のフェーズでは目標タイムの重みが混ざっている（4-5-2）。
   * これを未達幅の基準にそのまま使うと、「同じ実測でも目標を速く設定した
   * ほうがCFEが悪化する」——目標タイムから現在能力を逆算するのと実質同じ
   * ことになってしまう（統合監査で実測して確認）。
   *
   * ここに目標タイムを渡すと、未達幅の基準を「CFEだけならこうだったはず」
   * のペースに戻してから計算する。GRP比率表・未達幅の式そのものは変えない
   * ——目標由来のスケールだけを打ち消す。省略時は打ち消さない
   * （呼び出し側が目標を渡さない限り、この修正は効かない）。
   */
  goalTargetTimeSec?: number;
}

export interface CfeUpdateResult {
  cfe: CurrentFitnessEstimate;
  applied: boolean;
  deltaSec: number;
  impliedSec?: number;
  guardrailNotes: string[];
}

/**
 * セッション結果から「暗黙の800mタイム」を算出し、CFEを更新する。
 *
 * ΔRPE = 実測RPE − 期待RPE
 * 未達幅 = (実測平均ペース − 設定ペース) の800m換算秒（達成なら0）
 * 暗黙の800mタイム = 現CFE + (ΔRPE × 0.4) + 未達幅
 * 新CFE = 現CFE + (暗黙のタイム − 現CFE) × 0.3 × 信頼度
 */
export function updateCfeFromResult(
  cfe: CurrentFitnessEstimate,
  session: Session,
  result: SessionResult,
  ctx: CfeUpdateContext = {}
): CfeUpdateResult {
  const notes: string[] = [];
  const cur = cfe.estimated800mSec;

  // --- レース結果（信頼度1.0、ただし1回で3秒以上動かさない） ---
  if (ctx.isRace && ctx.raceTimeSec !== undefined) {
    let delta = ctx.raceTimeSec - cur;
    if (Math.abs(delta) > 3.0) {
      delta = Math.sign(delta) * 3.0;
      notes.push("ガードレール: レース結果でも1回の更新は±3.0秒まで");
    }
    const after = cur + delta;
    return {
      cfe: pushHistory(
        cfe,
        after,
        result.date,
        `レース結果 ${ctx.raceTimeSec.toFixed(2)}秒`,
        1.0,
        result.sessionId
      ),
      applied: true,
      deltaSec: delta,
      impliedSec: ctx.raceTimeSec,
      guardrailNotes: notes,
    };
  }

  const params = SESSION_CFE_PARAMS[session.category];
  if (!params || params.confidence === 0 || params.expectedRpe === null) {
    return {
      cfe,
      applied: false,
      deltaSec: 0,
      guardrailNotes: ["ガードレール: aerobic / neural の結果ではCFEを更新しない"],
    };
  }

  /*
   * 実測タイムから800m相当を出す（この方式に変えた経緯）。
   *
   * 以前は「現CFE + ΔRPE×0.4 + 未達幅」で暗黙のタイムを作っていた。
   * 未達幅は `Math.max(0, 実測 − 設定)` で、**速く走った分は捨てていた**。
   * つまりタイムが速いことはCFEに一切入らず、改善が入る経路はRPE（主観）だけ。
   * 実測すると、設定より3.5秒/本 速く走っても −0.17秒しか動かないのに、
   * 遅いと +1.34秒 動いた。同じタイムでもRPEを高く入れると符号が反転した。
   * 続けるほど遅い側へ寄る作りで、本人の感覚と合わなくなっていた。
   *
   * 今は `impliedFromInterval`（過去データからの現在地測定と同じ実装）を使う。
   * 実測平均 ÷ カテゴリのGRP比率 × 800 で、速い側も遅い側も対称に効く。
   * レストの長さ・本数・カテゴリによる信頼度もそちらが持っている。
   * **換算をここに書き直さない**——同じ実測から画面ごとに違う推定が出てはいけない。
   *
   * 設定ペース（targetPaces）を見なくなった副次効果として、
   * 「目標タイクが設定に混ざってCFEに逆流する」問題（goalTargetTimeSec で
   * 打ち消していたもの）が構造的に消えた。絶対時間しか見ていないため。
   */
  const dists =
    result.lapDistancesM ??
    (session.targetPaces[0]
      ? result.actualLapsSec.map(() => session.targetPaces[0].distanceM)
      : undefined);

  /*
   * 距離の違う本が混ざっていたら、いちばん本数の多い距離だけを使う。
   *
   * 1000m×4＋200m×3 のような複合セットで全部を平均すると
   * 190秒と30秒を混ぜることになり、換算が完全に壊れる。
   * 一括入力（parseRow）が「代表として1000mぶんだけを能力推定に使います」と
   * 言っているのと同じ規則を、ここでも適用する。
   * 片方を直したらもう片方も確認すること。
   */
  let repDistanceM: number | undefined;
  let repTimesSec = result.actualLapsSec;
  if (dists && dists.length > 0) {
    const counts = new Map<number, number>();
    for (const d of dists) counts.set(d, (counts.get(d) ?? 0) + 1);
    repDistanceM = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
    if (counts.size > 1) {
      repTimesSec = result.actualLapsSec.filter((_, i) => dists[i] === repDistanceM);
      notes.push(
        `距離の違う本が混ざっているため、${repDistanceM}m の${repTimesSec.length}本だけを能力推定に使いました`
      );
    }
  }

  if (!GRP_RATIOS[session.category]) {
    /*
     * 800m相当への換算比率を持たないカテゴリ（CV・閾値）。
     *
     * 旧実装ではRPEと未達幅だけでCFEを動かしていたが、
     * 1000mのCV走から800m能力を出す根拠がそもそも無い。
     * 推測で埋めずに「使わない」と言う。負荷やLT推定には従来どおり算入される。
     */
    return {
      cfe,
      applied: false,
      deltaSec: 0,
      guardrailNotes: [
        `ガードレール: ${session.category} は800m相当への換算比率を持たないためCFEに使わない（負荷とLT推定には算入します）`,
      ],
    };
  }

  const measured = impliedFromInterval({
    id: result.id,
    date: result.date,
    kind: "interval",
    category: session.category,
    repDistanceM,
    repTimesSec,
    rpe: result.rpe,
    restType: result.interval?.restType,
    restSec: result.interval?.restSec,
  });

  if (!measured) {
    return {
      cfe,
      applied: false,
      deltaSec: 0,
      guardrailNotes: [
        result.rpe !== undefined && result.rpe < 6
          ? "ガードレール: RPEが低い（全力に近くない）実測は能力の推定に使わない"
          : "実測から800m相当を出せませんでした（1本の距離か実施タイムが足りない）",
      ],
    };
  }

  /*
   * RPEは補助に降格した。
   *
   * 同じタイムでも楽に出せたなら能力は上、というのは実在する情報なので残すが、
   * 主役は実測タイム。係数を 0.4 から 0.15 に下げてある。
   * 0にしないのは、レストを削った・向かい風だった等がRPEにだけ出るため。
   */
  const dRpe = result.rpe - params.expectedRpe;
  const implied = measured.implied800mSec + dRpe * RPE_ADJUST_SEC_PER_POINT;

  /*
   * 中断（SKIP-06）: 本数を減らして終了したセッションは代表性が落ちる。
   *
   * 以前は「中断＝未達」として悪化方向に固定で足していたが、実測基準では
   * 完走した本のタイムがそのまま入るので二重に罰することになる。
   * 値ではなく**信頼度**を下げる形に変えた。
   * M-3 の中止基準にしたがって打ち切った場合を除くのは従来どおり
   * （止めろと指示しておいて、止めたことを能力低下に響かせない）。
   */
  let reliability = measured.reliability;
  if (
    !result.aborted &&
    result.completedReps !== undefined &&
    result.prescribedReps !== undefined &&
    result.completedReps < result.prescribedReps
  ) {
    reliability *= 0.5;
    notes.push("SKIP-06: セッション中断のため、この結果の信頼度を半分にする");
  }

  let delta = (implied - cur) * 0.3 * reliability;

  // ガードレール: 1回の更新で±1.5秒を超えて動かさない
  if (Math.abs(delta) > 1.5) {
    delta = Math.sign(delta) * 1.5;
    notes.push("ガードレール: 1回の更新は±1.5秒まで");
  }

  /*
   * ガードレール: 気温28℃以上 or 脚が重い2連続 → 改善・悪化どちらの方向も反映しない。
   *
   * 統合監査で発覚: 従来は改善方向（delta < 0）だけを止めており、暑熱・疲労
   * 環境下の未達はそのまま能力低下としてCFEに反映されていた
   * （CLAUDE.mdの「実行できなかったこと（暑さ・寝不足・設定が高すぎた）は
   * 能力低下ではないので、設定だけを動かしてCFEは触らない」に反する）。
   * 環境要因による未達も、環境要因による好走と同じ扱いにする——
   * どちらも「その日たまたま出せた／出せなかった値」であり、
   * 能力の変化ではないため。実行できなかったことへの対応は
   * 設定側（M-2の翌日調整）が担う。
   */
  const hotOrFatigued =
    (ctx.tempC !== undefined && ctx.tempC >= 28) || (ctx.heavyLegsStreak ?? 0) >= 2;
  if (hotOrFatigued && delta !== 0) {
    notes.push(
      delta < 0
        ? "ガードレール: 暑熱/疲労環境下のため改善方向は反映しない（環境要因を実力と誤認しない）"
        : "ガードレール: 暑熱/疲労環境下のため悪化方向も反映しない（実行できなかったことは能力低下ではない）"
    );
    return { cfe, applied: false, deltaSec: 0, impliedSec: implied, guardrailNotes: notes };
  }

  if (delta === 0) {
    return { cfe, applied: false, deltaSec: 0, impliedSec: implied, guardrailNotes: notes };
  }

  const after = cur + delta;
  return {
    cfe: pushHistory(
      cfe,
      after,
      result.date,
      `${session.category} 実測から800m相当 ${implied.toFixed(2)}秒（${measured.note} / RPE ${result.rpe}）`,
      reliability,
      result.sessionId
    ),
    applied: true,
    deltaSec: delta,
    impliedSec: implied,
    guardrailNotes: notes,
  };
}

/**
 * ガードレール: 14日以上セッション結果が無い場合、+0.4秒/週で自動的に鈍らせる。
 *
 * `lastResultDate` は**カテゴリを問わない**最後の記録の日付。
 *
 * これが無かったときは `cfe.lastUpdated`（＝CFEが動いた日）だけを見ていた。
 * ところがCVと閾値は800m相当への換算比率を持たないためCFEを更新しない。
 * つまり **CV走を2か月続けると、記録は入っているのに「結果が無い」扱いになり、
 * 鈍化だけが進む**。実際にそれで CFE が PB より4.7秒遅い 1:54.2 まで落ちていた
 * （初期値 1:51.0 に63日ぶんの鈍化が乗った値と一致する）。
 *
 * 鈍化の目的は「練習していない期間の楽観的なCFEを放置しない」ことであって、
 * 練習しているのに罰することではない。記録があるなら鈍らせない。
 */
export function applyStaleness(
  cfe: CurrentFitnessEstimate,
  today: string,
  lastResultDate?: string
): CurrentFitnessEstimate {
  const reference =
    lastResultDate && lastResultDate > cfe.lastUpdated ? lastResultDate : cfe.lastUpdated;
  const days = diffDays(reference, today);
  if (days < 14) return cfe;
  const weeks = (days - 14) / 7 + 1;
  const penalty = 0.4 * weeks;
  const after = cfe.estimated800mSec + penalty;
  return pushHistory(
    cfe,
    after,
    today,
    `${days}日間、練習の記録が無いため +0.4秒/週 で鈍化（+${penalty.toFixed(1)}秒）`,
    Math.max(0.2, cfe.confidence - 0.2)
  );
}

/**
 * 目標が非現実的な場合の検知:
 * 必要改善速度 = (CFE − 目標) ÷ 残り週数 が 0.3秒/週 を超える場合 WARN
 */
export function goalFeasibility(
  cfeSec: number,
  targetSec: number,
  weeksRemaining: number
): { requiredSecPerWeek: number; warn: boolean; message?: string } {
  if (weeksRemaining <= 0) {
    const gap = cfeSec - targetSec;
    return {
      requiredSecPerWeek: Infinity,
      warn: gap > 0,
      message: gap > 0 ? "レースまでの残り週数がありません" : undefined,
    };
  }
  const rate = (cfeSec - targetSec) / weeksRemaining;
  const warn = rate > 0.3;
  return {
    requiredSecPerWeek: rate,
    warn,
    message: warn
      ? `必要改善速度 ${rate.toFixed(2)}秒/週 はFORGEの設定ペース運用上限(0.3秒/週)を超えています。` +
        `これは安全な理想値の断定ではありません。目標ペースをそのまま処方へ混ぜず、実測能力を優先します。`
      : undefined,
  };
}

// ---------------------------------------------------------------------------
// 4-5-2. 基準タイム
// ---------------------------------------------------------------------------

/** フェーズごとの目標寄与率 w */
export const PHASE_GOAL_WEIGHT: Record<Phase, number> = {
  Base: 0.0,
  Build: 0.2,
  Specific: 0.5,
  Modeling: 0.8,
  Taper: 1.0,
};

/** 基準タイム = CFE × (1 − w) + 目標タイム × w */
export function baseTime(cfeSec: number, targetSec: number, phase: Phase): number {
  const w = PHASE_GOAL_WEIGHT[phase];
  return cfeSec * (1 - w) + targetSec * w;
}

/**
 * 目標達成に必要な改善速度が運用上限を超える場合、目標値を設定ペースへ
 * 混ぜない。目標自体は保持し、CFEが追いついた後に通常のフェーズ配分へ戻す。
 */
export function guardedBaseTime(
  cfeSec: number,
  targetSec: number,
  phase: Phase,
  weeksRemaining: number,
  /**
   * 800mのPB。渡すと、処方の土台がPBより速くならないように頭打ちにする。
   *
   * **CFEは触らない。** ここで守るのは「今日出す設定」のほう
   * （CFEは能力の推定、設定ペースは今日出せる値、という分離）。
   *
   * なぜ要るか: 現在地の測定は材料が1件だとその1件の換算結果がそのままCFEになる。
   * 練習1本の換算がレースのPBを上回ることは普通に起きるが、
   * **PBは定義上「これまでで一番速く走れた記録」**なので、それを超えるペースは
   * まだ一度も出したことがない速さ。そこを土台に処方を組むと、
   * 実行できない設定を出し続けることになる。
   * 実機で 1:54.2 → 1:48.3（PBより1.2秒速い）が出て発覚した。
   *
   * 速い側へ寄せるのは目標タイムの寄与が担当する（下の blend）。
   * そちらには非現実的な目標を弾く判定が別にあるので、二重に効かせない。
   */
  pb800Sec?: number
): { timeSec: number; guarded: boolean; message?: string } {
  const cappedCfe =
    pb800Sec !== undefined && cfeSec < pb800Sec ? pb800Sec : cfeSec;
  const cappedByPb = cappedCfe !== cfeSec;

  const feasibility = goalFeasibility(cappedCfe, targetSec, weeksRemaining);
  const guardedByGoal = targetSec < cappedCfe && feasibility.warn;
  const messages = [
    cappedByPb
      ? `推定（${fmtTime(cfeSec)}）が800mPB（${fmtTime(pb800Sec!)}）より速いため、` +
        `処方の土台はPBで頭打ちにしています。PBを超える設定は、レースかTTでその速さを出してから使います`
      : undefined,
    guardedByGoal ? feasibility.message : undefined,
  ].filter(Boolean);

  return {
    timeSec: guardedByGoal ? cappedCfe : baseTime(cappedCfe, targetSec, phase),
    guarded: cappedByPb || guardedByGoal,
    message: messages.length > 0 ? messages.join(" / ") : undefined,
  };
}

// ---------------------------------------------------------------------------

function pushHistory(
  cfe: CurrentFitnessEstimate,
  after: number,
  date: string,
  source: string,
  confidence: number,
  sessionId?: string
): CurrentFitnessEstimate {
  return {
    estimated800mSec: after,
    confidence,
    lastUpdated: date,
    history: [
      ...cfe.history,
      { date, before: cfe.estimated800mSec, after, source, sessionId },
    ],
  };
}

/**
 * 指定セッションによるCFE更新を取り消す。
 *
 * 練習結果を直して保存し直したときに使う。取り消さずに入れ直すと、
 * 同じ練習で2回CFEが動く。1回の更新は±1.5秒までというガードレールが
 * あるので、修正のたびに実質±3秒動かせてしまい、ガードレールが意味を失う。
 *
 * 取り消しは「そのセッションの更新が無かった場合の値」に戻す。
 * 後続の更新の差分（after − before）はそのまま積み直す。
 */
export function revertCfeForSession(
  cfe: CurrentFitnessEstimate,
  sessionId: string
): CurrentFitnessEstimate {
  const idx = cfe.history.findIndex((h) => h.sessionId === sessionId);
  if (idx < 0) return cfe;
  const removed = cfe.history[idx];
  const shift = removed.after - removed.before;
  const history = cfe.history
    .filter((_, i) => i !== idx)
    .map((h, i) =>
      i >= idx ? { ...h, before: h.before - shift, after: h.after - shift } : h
    );
  return {
    ...cfe,
    estimated800mSec: cfe.estimated800mSec - shift,
    history,
  };
}
