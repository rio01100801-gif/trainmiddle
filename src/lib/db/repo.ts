/**
 * リポジトリ層。全エンティティのCRUD。
 * JSONカラム方式: 型はコア(types.ts)が唯一の真実。検索キーのみ列に複製する。
 */
import type {
  Athlete,
  CurrentFitnessEstimate,
  DailyCheck,
  FitnessMarker,
  Goal,
  HeatBlock,
  HeatBlockEntry,
  InjuryLog,
  Race,
  Session,
  SessionChange,
  SessionResult,
  StrengthSession,
} from "../core/types";
import type { DbDriver } from "./driver";
import type { Store } from "./store";
import type { SyncRecord } from "../core/healthImport";
import type { CustomMenu, WeekTemplate } from "../core/weekTemplate";
import type { PastEntry } from "../core/backfill";
import type { PhraseRule } from "../core/bulkImport";
import type { FitImportRecord } from "../core/fitToSession";
import { SCHEMA_SQL } from "./schema";

export class Repo implements Store {
  constructor(private db: DbDriver) {
    db.exec(SCHEMA_SQL);
  }

  // ---- Athlete ----
  saveAthlete(a: Athlete): void {
    this.db
      .prepare("INSERT INTO athlete (id, json) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json")
      .run(a.id, JSON.stringify(a));
  }
  getAthlete(): Athlete | undefined {
    const row = this.db.prepare("SELECT json FROM athlete LIMIT 1").get() as
      | { json: string }
      | undefined;
    return row ? (JSON.parse(row.json) as Athlete) : undefined;
  }

  // ---- Goal ----
  saveGoal(g: Goal): void {
    this.db
      .prepare("INSERT INTO goal (id, json) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json")
      .run(JSON.stringify(g));
  }
  getGoal(): Goal | undefined {
    const row = this.db.prepare("SELECT json FROM goal WHERE id = 1").get() as
      | { json: string }
      | undefined;
    return row ? (JSON.parse(row.json) as Goal) : undefined;
  }

  // ---- Race ----
  saveRace(r: Race): void {
    this.db
      .prepare(
        "INSERT INTO races (id, date_start, priority, json) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET date_start = excluded.date_start, priority = excluded.priority, json = excluded.json"
      )
      .run(r.id, r.dateStart, r.priority, JSON.stringify(r));
  }
  listRaces(): Race[] {
    return (
      this.db.prepare("SELECT json FROM races ORDER BY date_start").all() as {
        json: string;
      }[]
    ).map((r) => JSON.parse(r.json) as Race);
  }
  deleteRace(id: string): void {
    this.db.prepare("DELETE FROM races WHERE id = ?").run(id);
  }

  // ---- Session ----
  saveSession(s: Session): void {
    this.db
      .prepare(
        "INSERT INTO sessions (id, date, category, status, is_fixed, json) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET date = excluded.date, category = excluded.category, status = excluded.status, is_fixed = excluded.is_fixed, json = excluded.json"
      )
      .run(s.id, s.date, s.category, s.status, s.isFixed ? 1 : 0, JSON.stringify(s));
  }
  saveSessions(list: Session[]): void {
    for (const s of list) this.saveSession(s);
  }
  getSession(id: string): Session | undefined {
    const row = this.db.prepare("SELECT json FROM sessions WHERE id = ?").get(id) as
      | { json: string }
      | undefined;
    return row ? (JSON.parse(row.json) as Session) : undefined;
  }
  listSessions(from?: string, to?: string): Session[] {
    let rows: { json: string }[];
    if (from && to) {
      rows = this.db
        .prepare("SELECT json FROM sessions WHERE date >= ? AND date <= ? ORDER BY date")
        .all(from, to) as { json: string }[];
    } else {
      rows = this.db.prepare("SELECT json FROM sessions ORDER BY date").all() as {
        json: string;
      }[];
    }
    return rows.map((r) => JSON.parse(r.json) as Session);
  }
  deleteSession(id: string): void {
    this.db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
  }
  deleteAllPlannedSessions(): void {
    this.db.prepare("DELETE FROM sessions WHERE status = 'planned'").run();
  }

  // ---- StrengthSession ----
  saveStrength(s: StrengthSession): void {
    this.db
      .prepare(
        "INSERT INTO strength_sessions (id, date, json) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET date = excluded.date, json = excluded.json"
      )
      .run(s.id, s.date, JSON.stringify(s));
  }
  saveStrengths(list: StrengthSession[]): void {
    for (const s of list) this.saveStrength(s);
  }
  listStrengths(from?: string, to?: string): StrengthSession[] {
    let rows: { json: string }[];
    if (from && to) {
      rows = this.db
        .prepare(
          "SELECT json FROM strength_sessions WHERE date >= ? AND date <= ? ORDER BY date"
        )
        .all(from, to) as { json: string }[];
    } else {
      rows = this.db
        .prepare("SELECT json FROM strength_sessions ORDER BY date")
        .all() as { json: string }[];
    }
    return rows.map((r) => JSON.parse(r.json) as StrengthSession);
  }
  deleteAllPlannedStrengths(): void {
    this.db
      .prepare("DELETE FROM strength_sessions WHERE json LIKE '%\"status\":\"planned\"%'")
      .run();
  }

  // ---- SessionResult ----
  saveResult(r: SessionResult): void {
    this.db
      .prepare(
        "INSERT INTO session_results (id, session_id, date, json) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json"
      )
      .run(r.id, r.sessionId, r.date, JSON.stringify(r));
  }
  listResults(): SessionResult[] {
    return (
      this.db.prepare("SELECT json FROM session_results ORDER BY date").all() as {
        json: string;
      }[]
    ).map((r) => JSON.parse(r.json) as SessionResult);
  }
  resultForSession(sessionId: string): SessionResult | undefined {
    const row = this.db
      .prepare("SELECT json FROM session_results WHERE session_id = ? ORDER BY date DESC LIMIT 1")
      .get(sessionId) as { json: string } | undefined;
    return row ? (JSON.parse(row.json) as SessionResult) : undefined;
  }

  // ---- DailyCheck ----
  saveDailyCheck(c: DailyCheck): void {
    this.db
      .prepare(
        "INSERT INTO daily_checks (date, json) VALUES (?, ?) ON CONFLICT(date) DO UPDATE SET json = excluded.json"
      )
      .run(c.date, JSON.stringify(c));
  }
  listDailyChecks(): DailyCheck[] {
    return (
      this.db.prepare("SELECT json FROM daily_checks ORDER BY date").all() as {
        json: string;
      }[]
    ).map((r) => JSON.parse(r.json) as DailyCheck);
  }

  // ---- FitnessMarker ----
  saveMarker(m: FitnessMarker): void {
    this.db
      .prepare(
        "INSERT INTO fitness_markers (id, date, json) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET date = excluded.date, json = excluded.json"
      )
      .run(m.id, m.date, JSON.stringify(m));
  }
  listMarkers(): FitnessMarker[] {
    return (
      this.db.prepare("SELECT json FROM fitness_markers ORDER BY date").all() as {
        json: string;
      }[]
    ).map((r) => JSON.parse(r.json) as FitnessMarker);
  }

  // ---- CFE ----
  saveCfe(c: CurrentFitnessEstimate): void {
    this.db
      .prepare("INSERT INTO cfe (id, json) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json")
      .run(JSON.stringify(c));
  }
  getCfe(): CurrentFitnessEstimate | undefined {
    const row = this.db.prepare("SELECT json FROM cfe WHERE id = 1").get() as
      | { json: string }
      | undefined;
    return row ? (JSON.parse(row.json) as CurrentFitnessEstimate) : undefined;
  }

  // ---- HeatBlock ----
  saveHeatBlock(b: HeatBlock): void {
    this.db
      .prepare("INSERT INTO heat_blocks (id, json) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json")
      .run(b.id, JSON.stringify(b));
  }
  listHeatBlocks(): HeatBlock[] {
    return (
      this.db.prepare("SELECT json FROM heat_blocks").all() as { json: string }[]
    ).map((r) => JSON.parse(r.json) as HeatBlock);
  }
  saveHeatEntry(blockId: string, e: HeatBlockEntry): void {
    this.db
      .prepare(
        "INSERT INTO heat_entries (date, block_id, json) VALUES (?, ?, ?) ON CONFLICT(date, block_id) DO UPDATE SET json = excluded.json"
      )
      .run(e.date, blockId, JSON.stringify(e));
  }
  listHeatEntries(blockId: string): HeatBlockEntry[] {
    return (
      this.db
        .prepare("SELECT json FROM heat_entries WHERE block_id = ? ORDER BY date")
        .all(blockId) as { json: string }[]
    ).map((r) => JSON.parse(r.json) as HeatBlockEntry);
  }

  // ---- 固定曜日設定（3-1） ----
  saveWeekTemplate(t: WeekTemplate): void {
    this.db
      .prepare("INSERT INTO week_template (id, json) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json")
      .run(JSON.stringify(t));
  }
  getWeekTemplate(): WeekTemplate | undefined {
    const row = this.db.prepare("SELECT json FROM week_template WHERE id = 1").get() as
      | { json: string }
      | undefined;
    return row ? (JSON.parse(row.json) as WeekTemplate) : undefined;
  }

  // ---- 自作メニュー（3-2） ----
  saveCustomMenu(m: CustomMenu): void {
    this.db
      .prepare(
        "INSERT INTO custom_menus (id, category, json) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET category = excluded.category, json = excluded.json"
      )
      .run(m.id, m.category, JSON.stringify(m));
  }
  listCustomMenus(): CustomMenu[] {
    return (
      this.db.prepare("SELECT json FROM custom_menus").all() as { json: string }[]
    ).map((r) => JSON.parse(r.json) as CustomMenu);
  }
  deleteCustomMenu(id: string): void {
    this.db.prepare("DELETE FROM custom_menus WHERE id = ?").run(id);
  }

  // ---- 表記辞書 ----
  savePhrase(p: PhraseRule): void {
    this.db
      .prepare(
        "INSERT INTO phrases (id, phrase, json) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET phrase = excluded.phrase, json = excluded.json"
      )
      .run(p.id, p.phrase, JSON.stringify(p));
  }
  listPhrases(): PhraseRule[] {
    return (
      this.db.prepare("SELECT json FROM phrases").all() as { json: string }[]
    ).map((r) => JSON.parse(r.json) as PhraseRule);
  }
  deletePhrase(id: string): void {
    this.db.prepare("DELETE FROM phrases WHERE id = ?").run(id);
  }

  // ---- 過去データの遡り入力 ----
  savePastEntry(e: PastEntry): void {
    this.db
      .prepare(
        "INSERT INTO past_entries (id, date, kind, json) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET date = excluded.date, kind = excluded.kind, json = excluded.json"
      )
      .run(e.id, e.date, e.kind, JSON.stringify(e));
  }
  listPastEntries(): PastEntry[] {
    return (
      this.db.prepare("SELECT json FROM past_entries ORDER BY date DESC").all() as {
        json: string;
      }[]
    ).map((r) => JSON.parse(r.json) as PastEntry);
  }
  deletePastEntry(id: string): void {
    this.db.prepare("DELETE FROM past_entries WHERE id = ?").run(id);
  }

  // ---- 同期履歴（Apple Health） ----
  saveSync(r: SyncRecord): void {
    this.db
      .prepare("INSERT INTO syncs (provider, synced_at, json) VALUES (?, ?, ?)")
      .run(r.provider, r.syncedAt, JSON.stringify(r));
  }
  listSyncs(limit = 20): SyncRecord[] {
    return (
      this.db
        .prepare("SELECT json FROM syncs ORDER BY seq DESC LIMIT ?")
        .all(limit) as { json: string }[]
    ).map((r) => JSON.parse(r.json) as SyncRecord);
  }

  // ---- FIT取込（Phase 4: 3層データモデル） ----
  saveFitImport(r: FitImportRecord): void {
    this.db
      .prepare(
        "INSERT INTO fit_imports (id, imported_at, json) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET imported_at = excluded.imported_at, json = excluded.json"
      )
      .run(r.id, r.importedAtUtc, JSON.stringify(r));
  }
  listFitImports(): FitImportRecord[] {
    return (
      this.db.prepare("SELECT json FROM fit_imports ORDER BY imported_at DESC").all() as {
        json: string;
      }[]
    ).map((r) => JSON.parse(r.json) as FitImportRecord);
  }

  // ---- 故障ログ（2-3） ----
  saveInjury(i: InjuryLog): void {
    this.db
      .prepare(
        "INSERT INTO injuries (id, date, body_part, json) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET date = excluded.date, body_part = excluded.body_part, json = excluded.json"
      )
      .run(i.id, i.date, i.bodyPart, JSON.stringify(i));
  }
  listInjuries(): InjuryLog[] {
    return (
      this.db.prepare("SELECT json FROM injuries ORDER BY date DESC").all() as {
        json: string;
      }[]
    ).map((r) => JSON.parse(r.json) as InjuryLog);
  }
  deleteInjury(id: string): void {
    this.db.prepare("DELETE FROM injuries WHERE id = ?").run(id);
  }

  // ---- 変更差分ログ（4-5-9: 却下理由も記録） ----
  logChange(c: SessionChange, accepted?: boolean, rejectReason?: string): void {
    this.db
      .prepare(
        "INSERT INTO change_log (created_at, session_id, triggered_by, accepted, reject_reason, json) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run(
        new Date().toISOString(),
        c.sessionId,
        c.triggeredBy,
        accepted === undefined ? null : accepted ? 1 : 0,
        rejectReason ?? null,
        JSON.stringify(c)
      );
  }
  // ---- KV ----
  saveKv(key: string, value: unknown): void {
    this.db
      .prepare("INSERT INTO kv (key, json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json")
      .run(key, JSON.stringify(value));
  }
  getKv<T>(key: string): T | undefined {
    const row = this.db.prepare("SELECT json FROM kv WHERE key = ?").get(key) as
      | { json: string }
      | undefined;
    return row ? (JSON.parse(row.json) as T) : undefined;
  }
  listKv<T>(prefix: string): { key: string; value: T }[] {
    return (
      this.db.prepare("SELECT key, json FROM kv WHERE key LIKE ? ORDER BY key").all(
        `${prefix}%`
      ) as { key: string; json: string }[]
    ).map((r) => ({ key: r.key, value: JSON.parse(r.json) as T }));
  }
  deleteKv(key: string): void {
    this.db.prepare("DELETE FROM kv WHERE key = ?").run(key);
  }

  /** 全消去。復元の「上書き」でのみ使う */
  resetAll(): void {
    for (const t of [
      "athlete", "goal", "races", "sessions", "strength_sessions", "session_results",
      "daily_checks", "fitness_markers", "cfe", "heat_blocks", "heat_entries",
      "injuries", "week_template", "custom_menus", "phrases", "past_entries",
      "syncs", "change_log", "kv", "fit_imports",
    ]) {
      this.db.prepare(`DELETE FROM ${t}`).run();
    }
  }

  /**
   * 実際のSQLトランザクション。`exec` は3つの実体（bun:sqlite / node:sqlite /
   * better-sqlite3）すべてが同じ生SQLで対応するため、新しい抽象を足さずに済む。
   * ネストは想定していない（呼び出し元がネストしないよう注意する）。
   */
  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  listChangeLog(
    limit = 100
  ): (SessionChange & { createdAt: string; accepted?: boolean; rejectReason?: string })[] {
    return (
      this.db
        .prepare(
          "SELECT created_at, accepted, reject_reason, json FROM change_log ORDER BY seq DESC LIMIT ?"
        )
        .all(limit) as {
        created_at: string;
        accepted: number | null;
        reject_reason: string | null;
        json: string;
      }[]
    ).map((r) => ({
      ...(JSON.parse(r.json) as SessionChange),
      createdAt: r.created_at,
      accepted: r.accepted === null ? undefined : r.accepted === 1,
      rejectReason: r.reject_reason ?? undefined,
    }));
  }
}
