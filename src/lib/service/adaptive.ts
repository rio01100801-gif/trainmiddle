/**
 * M-2 直近の状態に応じた設定の調整 / M-3 中止基準 / M-9 暑熱補正。
 *
 * CFE（能力の推定）は触らず、**設定ペース（今日出せる値）だけ**を動かす層。
 * 実行できなかったことは能力低下とは限らないので、両者を分けている
 * （考え方は `core/adaptive.ts` の冒頭に書いてある）。
 *
 * `workflow` を呼ぶだけで、`workflow` からここを参照しているものは無い。
 * だから循環せずに切り出せた（`ci:layers` が向きを見張っている）。
 *
 * 移動しただけで中身は変えていない。
 */
import { abortCriteria, prescriptionWithCriteria, type AbortCriteria } from "../core/abort";
import { adjustPrescription, dailyAdjustment, executionSamples, executionTrend, jogEfficiency, qualityHrTrend, type DailyAdjustment, type ExecutionTrend, type JogEfficiency, type PrescriptionProposal, type QualityHrTrend } from "../core/adaptive";
import { addDays, diffDays } from "../core/dates";
import { heatPaceAdjustment, type HeatPaceAdjustment } from "../core/heatPace";
import { runRuleEngine } from "../core/rules";
import { effectiveSignal } from "../core/signal";
import { TAPER_STAGE_LABELS, shouldSuppressVolumeAdjustment, taperStage } from "../core/taper";
import { isHighLoadSession } from "../core/trainingClassification";
import { DailyCheck, RuleViolation, Session, SessionChange } from "../core/types";
import { Store } from "../db/store";
import { buildRuleContext, trustedResults } from "./workflow";
import { isContentLocked } from "../core/sessionLock";

// ---------------------------------------------------------------------------
// M-2 / M-3 / M-9 適応的な処方
// ---------------------------------------------------------------------------

/** 提案を辞退した記録のキー。辞退したものは出し直さない */
function proposalRejectKey(sessionId: string): string {
  return `adaptive:rejected:${sessionId}`;
}

/** 安静時心拍の平常値（直近28日の中央値）。当日の値と比べる基準にする */
function restingHrBaseline(checks: DailyCheck[], today: string): number | undefined {
  const hrs = checks
    .filter((c) => c.restingHr !== undefined && c.date < today && diffDays(c.date, today) <= 28)
    .map((c) => c.restingHr!)
    .sort((a, b) => a - b);
  if (hrs.length < 5) return undefined;
  return hrs[Math.floor(hrs.length / 2)];
}

export interface AdaptiveContext {
  trend: ExecutionTrend;
  jog: JogEfficiency;
  /** Q-1: ポイント練習の心拍の動き */
  qualityHr: QualityHrTrend;
  daily: DailyAdjustment;
  heat: HeatPaceAdjustment;
}

/**
 * ある日のある種目について、判断材料を全部そろえる。
 * 4つの材料（直近の出来・当日のコンディション・ジョグの心拍・ポイント練習の心拍）を必ず通す。
 */
export function adaptiveContext(
  repo: Store,
  session: Session,
  today: string,
  env?: { wbgt?: number; tempC?: number; humidityPct?: number }
): AdaptiveContext {
  const sessions = repo.listSessions();
  const results = trustedResults(repo);
  const checks = repo.listDailyChecks();
  const athlete = repo.getAthlete();

  const sameDistanceSamples = executionSamples(
    sessions,
    results,
    session.category,
    session.date,
    undefined,
    session
  );
  // 同じ反復距離が3回あれば秒差まで比較する。形式変更後で材料が足りなければ、
  // カテゴリ内の target 比で補う（300mの秒差を400mへ直接足すことはしない）。
  const trendSamples =
    sameDistanceSamples.length >= 3
      ? sameDistanceSamples
      : executionSamples(
          sessions,
          results,
          session.category,
          session.date,
          undefined,
          undefined,
          true
        );
  const trend = executionTrend(trendSamples);
  const jog = jogEfficiency(results, today);
  // Q-1: ポイント練習側の心拍。同じ設定・同じタイムでも心拍が上がっていれば疲労
  const qualityHr = qualityHrTrend(sessions, results, session.category, today);
  const eff = effectiveSignal(checks.filter((c) => c.date <= today));
  let daily = dailyAdjustment(
    checks.find((c) => c.date === today),
    eff.signal,
    jog,
    restingHrBaseline(checks, today),
    qualityHr
  );

  /*
   * M-6 との干渉を切る。
   * テーパー期は「直近の出来が悪いから量を落とす」のではなく「意図的に落とす」期間。
   * 両方を掛けると二重に落ちて、レース前に必要な刺激まで消える。
   * 設定ペースの調整（実行可能性の担保）だけを残す。
   */
  const goal = repo.getGoal();
  const race = repo.listRaces().find((r) => r.id === goal?.targetRaceId);
  const stage = race ? taperStage(session.date, race.dateStart) : "none";
  if (shouldSuppressVolumeAdjustment(stage) && daily.repFactor !== 1) {
    daily = {
      ...daily,
      repFactor: 1,
      reasons: [
        ...daily.reasons,
        `${TAPER_STAGE_LABELS[stage]}のため、量の調整は調整期の設計に任せます（二重に落とさない）`,
      ],
    };
  }
  const heat = heatPaceAdjustment({
    wbgt: env?.wbgt,
    tempC: env?.tempC,
    humidityPct: env?.humidityPct,
    heatTolerance: athlete?.heatTolerance,
    category: session.category,
  });
  return { trend, jog, qualityHr, daily, heat };
}

export interface AdaptiveProposalOutput {
  proposal?: PrescriptionProposal;
  context?: AdaptiveContext;
  /** 対象セッション。無ければ提案も無い */
  session?: Session;
  criteria?: AbortCriteria;
  rejected?: { at: string; reason?: string };
}

/**
 * 次に行うポイント練習について、内容と設定を作り直した案を返す。
 *
 * 保存はしない。何をどれだけ動かしたかを見せて、本人が選ぶ。
 * 黙って書き換えると、次に未達だったときに
 * 「設定が下がったからできたのか、実力が上がったのか」が判別できなくなる。
 */
export function adaptiveProposal(
  repo: Store,
  today: string,
  opts: { sessionId?: string; wbgt?: number; tempC?: number; humidityPct?: number } = {}
): AdaptiveProposalOutput {
  if (opts.sessionId) {
    const s = repo.listSessions().find((x) => x.id === opts.sessionId);
    return s ? buildProposal(repo, s, today, opts) : {};
  }
  const list = adaptiveProposals(repo, today, opts);
  // 変わるものを優先して出す。全部据え置きなら直近のものを出す
  return list.find((p) => p.proposal?.hasChange) ?? list[0] ?? {};
}

/**
 * 今後のポイント練習をすべて見て、それぞれの案を返す。
 *
 * 「次の1本」だけを見ると、たまたま次が経済走で高乳酸の材料が使われない、
 * ということが起きる。カテゴリごとに材料が違うので、まとめて出す。
 */
export function adaptiveProposals(
  repo: Store,
  today: string,
  opts: { wbgt?: number; tempC?: number; humidityPct?: number; days?: number } = {}
): AdaptiveProposalOutput[] {
  const until = addDays(today, opts.days ?? 14);
  return repo
    .listSessions()
    .filter(
      (s) =>
        s.status !== "completed" &&
        s.status !== "skipped" &&
        s.date >= today &&
        s.date <= until &&
        !isContentLocked(s) &&
        isHighLoadSession(s) &&
        s.targetPaces.length > 0
    )
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((s) => buildProposal(repo, s, today, opts));
}

function buildProposal(
  repo: Store,
  session: Session,
  today: string,
  opts: { wbgt?: number; tempC?: number; humidityPct?: number }
): AdaptiveProposalOutput {
  const ctx = adaptiveContext(repo, session, today, opts);
  const proposal = adjustPrescription({
    session,
    trend: ctx.trend,
    daily: ctx.daily,
    heatFactor: ctx.heat.factor,
    heatNote: ctx.heat.applied ? ctx.heat.note : undefined,
  });
  const tp = session.targetPaces[0];
  const criteria = tp
    ? abortCriteria(session.category, (tp.targetSecFast + tp.targetSecSlow) / 2)
    : undefined;
  return {
    session,
    proposal,
    context: ctx,
    criteria,
    rejected: repo.getKv<{ at: string; reason?: string }>(proposalRejectKey(session.id)),
  };
}

/** 提案を適用する。適用したことは変更履歴に残す */
export function applyAdaptiveProposal(
  repo: Store,
  sessionId: string,
  today: string
): { applied: boolean; changes: SessionChange[]; violations: RuleViolation[] } {
  const out = adaptiveProposal(repo, today, { sessionId });
  const { session, proposal } = out;
  if (!session || !proposal || !proposal.hasChange) {
    return { applied: false, changes: [], violations: [] };
  }
  repo.saveSession({
    ...session,
    targetPaces: proposal.afterPaces,
    prescription: proposal.afterPrescription,
    status: "modified",
    userEdited: true,
  });
  for (const c of proposal.changes) repo.logChange(c, true);
  repo.deleteKv(proposalRejectKey(sessionId));
  return {
    applied: true,
    changes: proposal.changes,
    violations: runRuleEngine(buildRuleContext(repo, today)),
  };
}

/** 提案を辞退する。同じ提案を出し直さない */
export function rejectAdaptiveProposal(
  repo: Store,
  sessionId: string,
  today: string,
  reason?: string
): void {
  repo.saveKv(proposalRejectKey(sessionId), { at: today, reason });
  const out = adaptiveProposal(repo, today, { sessionId });
  for (const c of out.proposal?.changes ?? []) repo.logChange(c, false, reason ?? "本人が辞退");
}

/** 処方に中止基準を添えた文字列（表示用。保存されている処方は変えない） */
export function prescriptionText(session: Session): string {
  const tp = session.targetPaces[0];
  if (!tp || !isHighLoadSession(session)) return session.prescription;
  const target = (tp.targetSecFast + tp.targetSecSlow) / 2;
  return prescriptionWithCriteria(session.prescription, target, abortCriteria(session.category, target));
}
