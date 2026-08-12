/**
 * fetch("/api/...") をブラウザ内で処理するシム。
 * Next.js の各APIルート(app/api 配下)と同じ処理をサービス層直呼びで再現する。
 * 既存のUIコンポーネントは一切変更せずにそのまま動く。
 */
import type { Store } from "../src/lib/db/store";
import {
  buildRuleContext,
  aerobicEvidenceMarkers,
  dashboard,
  deleteResult,
  resultAudit,
  heatFlaggedDates,
  processDailyCheck,
  processRaceResult,
  processResult,
  processSkip,
  restoreSkippedSession,
  regeneratePlan,
  refreshNearHorizon,
  importAppleHealth,
  previousEntryFor,
  addPastEntry,
  assessFitness,
  applyAssessedCfe,
  deletePastEntry,
  importBulkRows,
  previewBulkText,
  rebuildPastDerived,
  coverageReview,
  applyCoverageProposal,
  hrUsage,
  sessionPlanVariants,
  applySessionVariant,
  convertMenuForMe,
  performanceSummaries,
  samePrescriptionGroups,
  cfeRangeFor,
  raceSplitPlan,
  listPhrases,
  savePhrase,
  deletePhrase,
  adaptiveProposal,
  adaptiveProposals,
  applyAdaptiveProposal,
  rejectAdaptiveProposal,
  sessionProgress,
  saveSessionProgress,
  finishSessionProgress,
  discardSessionProgress,
  addSession,
  editSession,
  deletePlannedSession,
  taperPlan,
  applyTaperPlan,
  rejectTaperPlan,
  limiterAssessment,
  splitAnalysis,
  contactTimeStatus,
  listContactSamples,
  importContactSamples,
  weeklyReview,
  exportBackup,
  importBackup,
  backupStatus,
  interpretPrescription,
  saveGoalAndRaces,
  importFitFile,
  confirmFitImport,
  pendingFitImportSummaries,
  rebuildFitDerived,
  trustedResults,
} from "../src/lib/service";
import { parseContactCsv } from "../src/lib/core/contactTime";
import type { PastEntry } from "../src/lib/core/backfill";
import type { PhraseRule } from "../src/lib/core/bulkImport";
import { runRuleEngine, weeklySummary } from "../src/lib/core/rules";
import { buildAerobicProfile } from "../src/lib/core/pace";
import {
  normalizeWeekTemplate,
  validateWeekTemplate,
  type CustomMenu,
} from "../src/lib/core/weekTemplate";
import { judgeEconomyTrend } from "../src/lib/core/propagation";
import { acwr, dailyLoads, highLactate28dAvgPerWeek } from "../src/lib/core/load";
import { restingHrTrend } from "../src/lib/core/signal";
import { buildTimeline } from "../src/lib/core/timeline";
import { addDays, localToday, weekStart } from "../src/lib/core/dates";
import { CONFIRM_HORIZON_DAYS } from "../src/lib/core/horizon";
import { amSlotAdvice } from "../src/lib/core/amSlotAdvice";
import {
  assessHeatBlock,
  HEAT_BLOCK_CONTENT,
  heatBlockTimingCheck,
  planHeatBlock,
  raceDayHeatChecklist,
} from "../src/lib/core/heat";
import type { Session, SessionResult, FitnessMarker, InjuryLog } from "../src/lib/core/types";

type Handler = (repo: Store, body: any, params: URLSearchParams) => unknown;

const routes: Record<string, Partial<Record<string, Handler>>> = {
  "/api/athlete": {
    GET: (repo) => ({ athlete: repo.getAthlete() ?? null }),
    POST: (repo, body) => {
      repo.saveAthlete({ id: "athlete-1", injuryHistory: [], ...body });
      return { ok: true };
    },
  },

  "/api/goal": {
    GET: (repo) => ({ goal: repo.getGoal() ?? null, races: repo.listRaces() }),
    POST: (repo, body) => {
      const { goal, races } = body;
      if (!goal || !races) return { error: "目標とレースが必要です" };
      return { ok: true, ...saveGoalAndRaces(repo, goal, races) };
    },
  },

  "/api/plan": {
    POST: (repo, body) => regeneratePlan(repo, body?.startDate ?? localToday()),
  },

  // 確定範囲（今日〜14日）だけを今のCFEで作り直す。app/api/plan/refresh と対
  "/api/plan/refresh": {
    POST: (repo, body) => ({
      changes: refreshNearHorizon(repo, body?.today ?? localToday()),
      horizonDays: CONFIRM_HORIZON_DAYS,
    }),
  },

  "/api/sessions": {
    GET: (repo, _b, params) => ({
      sessions: repo.listSessions(
        params.get("from") ?? undefined,
        params.get("to") ?? undefined
      ),
      strengthSessions: repo.listStrengths(
        params.get("from") ?? undefined,
        params.get("to") ?? undefined
      ),
    }),
    POST: (repo, body) => {
      const session = {
        id: `s-user-${Date.now()}`,
        status: "planned",
        origin: "manual",
        userEdited: true,
        targetPaces: [],
        transfer800m: 3,
        transfer1500m: 3,
        riskLevel: "mid",
        phase: "Specific",
        timeOfDay: "pm",
        isFixed: false,
        ...body,
      } as Session;
      repo.saveSession(session);
      return { session, violations: runRuleEngine(buildRuleContext(repo, localToday())) };
    },
    PATCH: (repo, body) => {
      const { id, ...updates } = body;
      const session = repo.getSession(id);
      if (!session) return { error: "セッションが見つかりません" };
      if (session.isFixed && (updates.date || updates.category || updates.prescription)) {
        return {
          error:
            "固定セッション（チーム練習等）は移動・変更できません（RULE-15）。前後の自由枠を組み替えてください。",
        };
      }
      repo.saveSession({ ...session, ...updates, status: "modified", userEdited: true });
      return { ok: true, violations: runRuleEngine(buildRuleContext(repo, localToday())) };
    },
  },

  "/api/results": {
    GET: (repo, _b, params) => {
      const prevFor = params.get("previousFor");
      if (prevFor) return { previous: previousEntryFor(repo, prevFor) ?? null };
      return { results: trustedResults(repo) };
    },
    POST: (repo, body) => {
      const { sessionCategory, ...resultBody } = body;
      return processResult(
        repo,
        { id: `res-${Date.now()}`, actualLapsSec: [], ...resultBody } as SessionResult,
        { sessionCategory }
      );
    },
    DELETE: (repo, _b, params) => {
      const id = params.get("id");
      if (!id) return { error: "id が必要です" };
      deleteResult(repo, id);
      return { ok: true };
    },
  },

  // 保存された結果の読み返し。app/api/result-audit と対
  "/api/result-audit": {
    GET: (repo, _b, params) => {
      const id = params.get("id");
      if (!id) return { error: "id が必要です" };
      const audit = resultAudit(repo, id);
      return audit ? { audit } : { error: "その記録が見つかりません" };
    },
  },

  "/api/skip": {
    POST: (repo, body) => processSkip(repo, body.sessionId, body.reason),
    // 中止の取り消し（押し間違いを戻す）
    DELETE: (repo, _b, params) =>
      restoreSkippedSession(repo, params.get("sessionId") ?? "", params.get("date") ?? localToday()),
  },

  "/api/daily": {
    GET: (repo) => ({ checks: repo.listDailyChecks() }),
    POST: (repo, body) => processDailyCheck(repo, body),
  },

  "/api/dashboard": {
    GET: (repo, _b, params) => dashboard(repo, params.get("date") ?? localToday()),
  },

  "/api/analysis": {
    GET: (repo, _b, params) => {
      const today = params.get("date") ?? localToday();
      const results = trustedResults(repo);
      const sessions = repo.listSessions();
      const sessionById = new Map(sessions.map((s) => [s.id, s]));
      const economyPoints = results
        .filter((r) => sessionById.get(r.sessionId)?.category === "race_economy")
        .map((r) => ({
          date: r.date,
          rpe: r.rpe,
          prescription: sessionById.get(r.sessionId)?.prescription ?? "",
        }));
      const loads = dailyLoads({
        sessions,
        resultsBySessionId: new Map(results.map((r) => [r.sessionId, r])),
        strengthSessions: repo.listStrengths(),
      });
      const loadSeries: { date: string; load: number; acwr?: number }[] = [];
      for (let i = 55; i >= 0; i--) {
        const d = addDays(today, -i);
        loadSeries.push({ date: d, load: loads.get(d) ?? 0, acwr: acwr(loads, d).acwr });
      }
      let weeks: ReturnType<typeof weeklySummary>[] = [];
      try {
        const ctx = buildRuleContext(repo, today);
        weeks = [3, 2, 1, 0].map((i) =>
          weeklySummary(ctx, addDays(weekStart(today), -7 * i))
        );
      } catch {
        weeks = [];
      }
      const timeline = buildTimeline({
        today,
        days: 28,
        loadSeries,
        dailyChecks: repo.listDailyChecks(),
        sessions,
        raceDates: repo
          .listMarkers()
          .filter((m) => m.type === "race")
          .map((m) => m.date),
      });
      return {
        economyPoints,
        economyTrend: judgeEconomyTrend(economyPoints),
        loadSeries,
        acwrNow: acwr(loads, today),
        hlPerWeek28d: highLactate28dAvgPerWeek(sessions, today),
        cfeHistory: repo.getCfe()?.history ?? [],
        restingHrTrend: restingHrTrend(repo.listDailyChecks()),
        samePrescription: samePrescriptionGroups(repo),
        performance: performanceSummaries(repo, today),
        timeline,
        weeks,
        changeLog: repo.listChangeLog(50),
      };
    },
  },

  "/api/race-result": {
    POST: (repo, body) => processRaceResult(repo, body.raceId, body.rounds, body.date),
  },

  "/api/heat": {
    GET: (repo, _b, params) => {
      const athlete = repo.getAthlete();
      const races = repo.listRaces();
      const detail = repo.listHeatBlocks().map((b) => {
        const entries = repo.listHeatEntries(b.id);
        const race = races.find((r) => r.id === b.targetRaceId);
        return {
          block: b,
          entries,
          assessment: athlete?.weightKg ? assessHeatBlock(entries, athlete.weightKg) : undefined,
          timingWarning: race ? heatBlockTimingCheck(b, race) : undefined,
        };
      });
      const expectedTemp = params.get("temp");
      return {
        blocks: detail,
        content: HEAT_BLOCK_CONTENT,
        raceDayChecklist: athlete
          ? raceDayHeatChecklist(athlete, expectedTemp ? Number(expectedTemp) : 30)
          : undefined,
      };
    },
    POST: (repo, body) => {
      if (body.action === "plan") {
        const race = repo.listRaces().find((r) => r.id === body.raceId);
        if (!race) return { error: "レースが見つかりません" };
        const block = planHeatBlock(race, body.blockDays ?? 12);
        repo.saveHeatBlock(block);
        return { block };
      }
      if (body.action === "entry") {
        repo.saveHeatEntry(body.blockId, body.entry);
        return { ok: true };
      }
      return { error: "不明なaction" };
    },
  },

  "/api/markers": {
    GET: (repo, _b, params) => {
      const today = params.get("date") ?? localToday();
      const markers = aerobicEvidenceMarkers(repo);
      return {
        markers,
        aerobicProfile: buildAerobicProfile(
          markers,
          today,
          repo.getCfe()?.estimated800mSec,
          heatFlaggedDates(repo)
        ),
      };
    },
    POST: (repo, body) => {
      const marker: FitnessMarker = {
        id: body.id ?? `fm-${Date.now()}`,
        date: body.date,
        type: body.type ?? "workout",
        description: body.description ?? "",
        resultLapsSec: body.resultLapsSec ?? [],
        lapDistancesM: body.lapDistancesM,
        avgHr: body.avgHr,
        maxHr: body.maxHr,
        rpe: body.rpe,
        conditionNote: body.conditionNote,
        purpose: body.purpose,
      };
      repo.saveMarker(marker);
      return {
        ok: true,
        aerobicProfile: buildAerobicProfile(
          aerobicEvidenceMarkers(repo),
          marker.date,
          repo.getCfe()?.estimated800mSec,
          heatFlaggedDates(repo)
        ),
      };
    },
  },

  "/api/plan-settings": {
    GET: (repo) => {
      const weekTemplate = repo.getWeekTemplate();
      return {
        weekTemplate: weekTemplate ?? null,
        customMenus: repo.listCustomMenus(),
        templateViolations: weekTemplate ? validateWeekTemplate(weekTemplate) : [],
        // 2部の午前枠についての助言。自動では変えない（本人が決める）
        amAdvice: amSlotAdvice(
          repo.getAthlete(),
          weekTemplate,
          repo.getGoal()?.targetTimeSec
        ),
      };
    },
    POST: (repo, body) => {
      if (body.weekTemplate) repo.saveWeekTemplate(normalizeWeekTemplate(body.weekTemplate));
      if (body.customMenu) {
        const m: CustomMenu = {
          id: body.customMenu.id ?? `cm-${Date.now()}`,
          name: body.customMenu.name,
          category: body.customMenu.category,
          source: body.customMenu.source ?? "self",
          prescription: body.customMenu.prescription,
          distanceM: body.customMenu.distanceM,
          reps: body.customMenu.reps,
          restNote: body.customMenu.restNote,
          note: body.customMenu.note,
          timesUsed: body.customMenu.timesUsed,
          lastUsedDate: body.customMenu.lastUsedDate,
          active: body.customMenu.active,
        };
        repo.saveCustomMenu(m);
      }
      return {
        ok: true,
        templateViolations: body.weekTemplate
          ? validateWeekTemplate(normalizeWeekTemplate(body.weekTemplate))
          : [],
      };
    },
    DELETE: (repo, _b, params) => {
      const menuId = params.get("menuId");
      if (!menuId) return { error: "menuId が必要です" };
      repo.deleteCustomMenu(menuId);
      return { ok: true };
    },
  },

  "/api/past": {
    GET: (repo) => ({
      entries: repo.listPastEntries(),
      assessment: repo.getAthlete() ? assessFitness(repo, localToday()) : null,
    }),
    POST: (repo, body) => {
      const today = body?.today ?? localToday();
      // Q-3: 取り込み済みのぶんをいまの変換で作り直す（実測値は動かさない）
      if (body?.rebuild) return { ok: true, rebuild: rebuildPastDerived(repo) };
      if (body?.previewText !== undefined) {
        return { rows: previewBulkText(repo, String(body.previewText), today) };
      }
      if (Array.isArray(body?.rows)) {
        const out = importBulkRows(repo, body.rows);
        return {
          ok: true,
          ...out,
          entries: repo.listPastEntries(),
          assessment: assessFitness(repo, today),
        };
      }
      if (body?.apply) {
        try {
          const out = applyAssessedCfe(repo, today);
          return { ok: true, ...out, assessment: assessFitness(repo, today) };
        } catch (e) {
          return { error: (e as Error).message };
        }
      }
      const e = body?.entry as PastEntry;
      if (!e || !e.date || !e.kind) return { error: "日付と種類は必須です" };
      addPastEntry(repo, { ...e, id: e.id ?? `pe-${Date.now()}` });
      return {
        ok: true,
        entries: repo.listPastEntries(),
        assessment: assessFitness(repo, today),
      };
    },
    DELETE: (repo, _b, params) => {
      const id = params.get("id");
      if (!id) return { error: "id が必要です" };
      deletePastEntry(repo, id);
      return {
        ok: true,
        entries: repo.listPastEntries(),
        assessment: assessFitness(repo, localToday()),
      };
    },
  },

  /**
   * 表記辞書。一括入力が読めなかった語を本人が登録する。
   * 組み込みルールを増やし続けるより、本人の語彙を覚える方が早く収束する。
   */
  "/api/phrases": {
    GET: (repo) => ({ phrases: listPhrases(repo) }),
    POST: (repo, body) => {
      const p = body?.phrase as PhraseRule;
      if (!p?.phrase?.trim() || !p.kind) return { error: "語と種類は必須です" };
      savePhrase(repo, { ...p, id: p.id ?? `ph-${Date.now()}`, phrase: p.phrase.trim() });
      return { ok: true, phrases: listPhrases(repo) };
    },
    DELETE: (repo, _b, params) => {
      const id = params.get("id");
      if (!id) return { error: "id が必要です" };
      deletePhrase(repo, id);
      return { ok: true, phrases: listPhrases(repo) };
    },
  },

  // ---- M-2 / M-3 / M-9 適応的な処方 ----
  "/api/adaptive": {
    GET: (repo, _b, params) => {
      const today = params.get("date") ?? localToday();
      const env = {
        wbgt: params.get("wbgt") ? Number(params.get("wbgt")) : undefined,
        tempC: params.get("tempC") ? Number(params.get("tempC")) : undefined,
        humidityPct: params.get("humidity") ? Number(params.get("humidity")) : undefined,
      };
      if (params.get("all")) return { proposals: adaptiveProposals(repo, today, env) };
      return adaptiveProposal(repo, today, {
        sessionId: params.get("sessionId") ?? undefined,
        ...env,
      });
    },
    POST: (repo, body) => {
      const today = body?.today ?? localToday();
      if (!body?.sessionId) return { error: "sessionId が必要です" };
      if (body.action === "reject") {
        rejectAdaptiveProposal(repo, body.sessionId, today, body.reason);
        return { ok: true };
      }
      return { ok: true, ...applyAdaptiveProposal(repo, body.sessionId, today) };
    },
  },

  // ---- M-4 セッション中の入力 ----
  "/api/session-run": {
    GET: (repo, _b, params) => {
      const id = params.get("sessionId");
      if (!id) return { error: "sessionId が必要です" };
      try {
        return sessionProgress(repo, id);
      } catch (e) {
        return { error: (e as Error).message };
      }
    },
    POST: (repo, body) => {
      const today = body?.today ?? localToday();
      try {
        if (body?.action === "finish") {
          return { ok: true, ...finishSessionProgress(repo, body.sessionId, body) };
        }
        if (body?.action === "discard") {
          discardSessionProgress(repo, body.sessionId);
          return { ok: true };
        }
        return saveSessionProgress(repo, body.sessionId, body?.reps ?? [], today);
      } catch (e) {
        return { error: (e as Error).message };
      }
    },
  },

  // ---- M-5 予定の編集 ----
  "/api/plan-edit": {
    POST: (repo, body) => {
      const today = body?.today ?? localToday();
      if (body?.action === "add") return addSession(repo, body.session, today);
      if (!body?.sessionId) return { error: "sessionId が必要です" };
      return editSession(repo, body.sessionId, body.updates ?? {}, today, {
        force: !!body.force,
        dryRun: !!body.dryRun,
      });
    },
    DELETE: (repo, _b, params) => {
      const id = params.get("sessionId");
      if (!id) return { error: "sessionId が必要です" };
      return deletePlannedSession(repo, id, params.get("date") ?? localToday());
    },
  },

  // ---- M-6 テーパー ----
  "/api/taper": {
    GET: (repo, _b, params) => taperPlan(repo, params.get("date") ?? localToday()),
    POST: (repo, body) => {
      const today = body?.today ?? localToday();
      if (body?.action === "reject") {
        rejectTaperPlan(repo, today, body.reason);
        return { ok: true };
      }
      return { ok: true, ...applyTaperPlan(repo, today, body?.sessionIds) };
    },
  },

  // ---- S-6 他選手のメニューを自分の設定に換算 ----
  "/api/convert-menu": {
    POST: (repo, body) =>
      convertMenuForMe(repo, String(body?.prescription ?? ""), Number(body?.theirPb800Sec)),
  },

  // ---- S-9 次のポイント練習の進め方を2案 ----
  "/api/variants": {
    GET: (repo, _b, params) => {
      const id = params.get("sessionId");
      if (!id) return { error: "sessionId が必要です" };
      return sessionPlanVariants(repo, id, params.get("date") ?? localToday());
    },
    POST: (repo, body) => {
      const today = body?.today ?? localToday();
      if (!body?.sessionId || !body?.variantKey) {
        return { error: "sessionId と variantKey が必要です" };
      }
      return applySessionVariant(repo, body.sessionId, body.variantKey, today);
    },
  },

  // ---- Q-2 足りていないカテゴリの提案 ----
  "/api/coverage": {
    GET: (repo, _b, params) => ({
      review: coverageReview(repo, params.get("date") ?? localToday()) ?? null,
    }),
    POST: (repo, body) => {
      const today = body?.today ?? localToday();
      if (!body?.sessionId || !body?.category) {
        return { error: "sessionId と category が必要です" };
      }
      const out = applyCoverageProposal(repo, body.sessionId, body.category, today, body.force === true);
      return { ...out, review: coverageReview(repo, today) ?? null };
    },
  },

  // ---- M-7 / M-8 / M-10 / M-11 ----
  "/api/insights": {
    GET: (repo, _b, params) => {
      const today = params.get("date") ?? localToday();
      if (!repo.getAthlete()) return { empty: true };
      return {
        limiter: limiterAssessment(repo),
        split: splitAnalysis(repo),
        contact: contactTimeStatus(repo, today),
        hr: hrUsage(repo, today),
        review: weeklyReview(repo, today, params.get("weekStart") ?? undefined),
      };
    },
  },

  // ---- M-12 書き出しと復元 ----
  "/api/backup": {
    GET: (repo, _b, params) => {
      const today = params.get("date") ?? localToday();
      if (params.get("download")) return exportBackup(repo, new Date().toISOString());
      return backupStatus(repo, today);
    },
    POST: (repo, body) => {
      try {
        return {
          ok: true,
          report: importBackup(repo, body?.file, body?.mode === "merge" ? "merge" : "replace"),
        };
      } catch (e) {
        return { error: (e as Error).message };
      }
    },
  },

  // ---- M-10 接地時間 ----
  "/api/contact": {
    GET: (repo, _b, params) => ({
      samples: listContactSamples(repo),
      assessment: contactTimeStatus(repo, params.get("date") ?? localToday()),
    }),
    POST: (repo, body) => {
      const today = body?.today ?? localToday();
      const samples = body?.csv ? parseContactCsv(String(body.csv)) : body?.samples ?? [];
      if (samples.length === 0) return { error: "読み取れる行がありませんでした" };
      return { ok: true, ...importContactSamples(repo, samples), assessment: contactTimeStatus(repo, today) };
    },
  },

  // ---- N-2 / N-3 メニュー本文の解釈 ----
  "/api/prescription": {
    POST: (repo, body) => interpretPrescription(repo, String(body?.text ?? "")),
  },

  "/api/health-import": {
    GET: (repo) => ({ syncs: repo.listSyncs(10) }),
    POST: (repo, body) => {
      if (!body?.xml) return { error: "ファイルの中身が空です" };
      return importAppleHealth(repo, body.xml, localToday(), { days: body.days ?? 120 });
    },
  },

  // ---- FIT取込: 元ファイル・解析・修正・結果確認の信頼層 ----
  "/api/fit-import": {
    GET: (repo) => ({
      imports: repo.listFitImports(),
      pending: pendingFitImportSummaries(repo),
    }),
    POST: (repo, body) => {
      // 保存してある元ファイルから、いまの解析ロジックで作り直す
      if (body?.rebuild) {
        try {
          return { ok: true, rebuild: rebuildFitDerived(repo) };
        } catch (e) {
          return { error: (e as Error).message };
        }
      }
      if (body?.confirmFitImportId) {
        try {
          return {
            ok: true,
            ...confirmFitImport(repo, {
              fitImportId: String(body.confirmFitImportId),
              category: body.category,
              rpe: Number(body.rpe),
              achievement: body.achievement,
              subjective: body.subjective,
            }),
          };
        } catch (e) {
          return { error: (e as Error).message };
        }
      }
      if (!body?.fileName || !body?.rawBytesBase64 || !body?.parse || !body?.autoClassification || !body?.confirmedKinds) {
        return { error: "取込内容が不足しています" };
      }
      try {
        return { ok: true, ...importFitFile(repo, body) };
      } catch (e) {
        return { error: (e as Error).message };
      }
    },
  },

  "/api/injuries": {
    GET: (repo) => ({ injuries: repo.listInjuries() }),
    POST: (repo, body) => {
      const injury: InjuryLog = {
        id: body.id ?? `inj-${Date.now()}`,
        date: body.date,
        bodyPart: body.bodyPart,
        painLevel: Number(body.painLevel ?? 0),
        status: body.status ?? "onset",
        sessionId: body.sessionId,
        note: body.note,
      };
      repo.saveInjury(injury);
      return { ok: true, injury };
    },
    DELETE: (repo, _b, params) => {
      const id = params.get("id");
      if (!id) return { error: "id が必要です" };
      repo.deleteInjury(id);
      return { ok: true };
    },
  },

  "/api/changes": {
    GET: (repo) => ({ changes: repo.listChangeLog(100) }),
    POST: (repo, body) => {
      repo.logChange(body.change, body.accepted, body.rejectReason);
      return { ok: true };
    },
  },
};

/** window.fetch を差し替える。/api/* のみ処理し、それ以外は元のfetchへ */
export function installApiShim(repo: Store, afterMutation: () => void): void {
  const original = window.fetch.bind(window);
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const u = new URL(url, location.origin);
    const route = routes[u.pathname];
    if (!route) return original(input as RequestInfo, init);

    const method = (init?.method ?? "GET").toUpperCase();
    const handler = route[method];
    if (!handler) {
      return new Response(JSON.stringify({ error: "method not allowed" }), { status: 405 });
    }
    let body: unknown = undefined;
    if (init?.body) {
      try {
        body = JSON.parse(String(init.body));
      } catch {
        body = undefined;
      }
    }
    try {
      const result = handler(repo, body, u.searchParams);
      if (method !== "GET") afterMutation();
      return new Response(JSON.stringify(result ?? {}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: (e as Error).message }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
  }) as typeof window.fetch;
}
