/**
 * PWA用ストレージ: メモリ上のStore実装 + IndexedDBへの永続化。
 * サービス層は同期APIを前提とするため、読み書きはメモリで同期処理し、
 * 変更後にデバウンスしてIndexedDBへ保存する。
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
} from "../src/lib/core/types";
import type { ChangeLogEntry, Store } from "../src/lib/db/store";
import type { SyncRecord } from "../src/lib/core/healthImport";
import type { PastEntry } from "../src/lib/core/backfill";
import type { PhraseRule } from "../src/lib/core/bulkImport";
import type { FitImportRecord } from "../src/lib/core/fitToSession";
import type { CustomMenu, WeekTemplate } from "../src/lib/core/weekTemplate";

export interface AppState {
  athlete?: Athlete;
  goal?: Goal;
  races: Race[];
  sessions: Session[];
  strengths: StrengthSession[];
  results: SessionResult[];
  dailyChecks: DailyCheck[];
  markers: FitnessMarker[];
  cfe?: CurrentFitnessEstimate;
  heatBlocks: HeatBlock[];
  heatEntries: { blockId: string; entry: HeatBlockEntry }[];
  injuries: InjuryLog[];
  syncs: SyncRecord[];
  weekTemplate?: WeekTemplate;
  customMenus: CustomMenu[];
  pastEntries: PastEntry[];
  phrases: PhraseRule[];
  fitImports: FitImportRecord[];
  kv: { key: string; value: unknown }[];
  changeLog: ChangeLogEntry[];
  version: 1;
}

export function emptyState(): AppState {
  return {
    races: [],
    sessions: [],
    strengths: [],
    results: [],
    dailyChecks: [],
    markers: [],
    heatBlocks: [],
    heatEntries: [],
    injuries: [],
    syncs: [],
    customMenus: [],
    pastEntries: [],
    phrases: [],
    fitImports: [],
    kv: [],
    changeLog: [],
    version: 1,
  };
}

export class MemoryStore implements Store {
  constructor(
    private state: AppState = emptyState(),
    private onChange?: (state: AppState) => void
  ) {}

  getState(): AppState {
    return this.state;
  }
  replaceState(s: AppState): void {
    this.state = s;
    this.touch();
  }
  private touch(): void {
    this.onChange?.(this.state);
  }

  // ---- Athlete ----
  saveAthlete(a: Athlete): void {
    this.state.athlete = a;
    this.touch();
  }
  getAthlete(): Athlete | undefined {
    return this.state.athlete;
  }

  // ---- Goal ----
  saveGoal(g: Goal): void {
    this.state.goal = g;
    this.touch();
  }
  getGoal(): Goal | undefined {
    return this.state.goal;
  }

  // ---- Race ----
  saveRace(r: Race): void {
    const i = this.state.races.findIndex((x) => x.id === r.id);
    if (i >= 0) this.state.races[i] = r;
    else this.state.races.push(r);
    this.touch();
  }
  listRaces(): Race[] {
    return [...this.state.races].sort((a, b) => a.dateStart.localeCompare(b.dateStart));
  }
  deleteRace(id: string): void {
    this.state.races = this.state.races.filter((r) => r.id !== id);
    this.touch();
  }

  // ---- Session ----
  saveSession(s: Session): void {
    const i = this.state.sessions.findIndex((x) => x.id === s.id);
    if (i >= 0) this.state.sessions[i] = s;
    else this.state.sessions.push(s);
    this.touch();
  }
  saveSessions(list: Session[]): void {
    for (const s of list) {
      const i = this.state.sessions.findIndex((x) => x.id === s.id);
      if (i >= 0) this.state.sessions[i] = s;
      else this.state.sessions.push(s);
    }
    this.touch();
  }
  getSession(id: string): Session | undefined {
    return this.state.sessions.find((s) => s.id === id);
  }
  listSessions(from?: string, to?: string): Session[] {
    return this.state.sessions
      .filter((s) => (!from || s.date >= from) && (!to || s.date <= to))
      .sort((a, b) => a.date.localeCompare(b.date));
  }
  deleteSession(id: string): void {
    this.state.sessions = this.state.sessions.filter((s) => s.id !== id);
    this.touch();
  }
  deleteAllPlannedSessions(): void {
    this.state.sessions = this.state.sessions.filter((s) => s.status !== "planned");
    this.touch();
  }

  // ---- Strength ----
  saveStrength(s: StrengthSession): void {
    const i = this.state.strengths.findIndex((x) => x.id === s.id);
    if (i >= 0) this.state.strengths[i] = s;
    else this.state.strengths.push(s);
    this.touch();
  }
  saveStrengths(list: StrengthSession[]): void {
    for (const s of list) {
      const i = this.state.strengths.findIndex((x) => x.id === s.id);
      if (i >= 0) this.state.strengths[i] = s;
      else this.state.strengths.push(s);
    }
    this.touch();
  }
  listStrengths(from?: string, to?: string): StrengthSession[] {
    return this.state.strengths
      .filter((s) => (!from || s.date >= from) && (!to || s.date <= to))
      .sort((a, b) => a.date.localeCompare(b.date));
  }
  deleteAllPlannedStrengths(): void {
    this.state.strengths = this.state.strengths.filter((s) => s.status !== "planned");
    this.touch();
  }

  // ---- Result ----
  saveResult(r: SessionResult): void {
    const i = this.state.results.findIndex(
      (x) => x.id === r.id || x.sessionId === r.sessionId
    );
    if (i >= 0) this.state.results[i] = { ...r, id: this.state.results[i].id };
    else this.state.results.push(r);
    this.touch();
  }
  listResults(): SessionResult[] {
    return [...this.state.results].sort((a, b) => a.date.localeCompare(b.date));
  }
  resultForSession(sessionId: string): SessionResult | undefined {
    return this.listResults()
      .filter((r) => r.sessionId === sessionId)
      .at(-1);
  }
  deleteResult(id: string): void {
    this.state.results = this.state.results.filter((x) => x.id !== id);
    this.touch();
  }

  // ---- DailyCheck ----
  saveDailyCheck(c: DailyCheck): void {
    const i = this.state.dailyChecks.findIndex((x) => x.date === c.date);
    if (i >= 0) this.state.dailyChecks[i] = c;
    else this.state.dailyChecks.push(c);
    this.touch();
  }
  listDailyChecks(): DailyCheck[] {
    return [...this.state.dailyChecks].sort((a, b) => a.date.localeCompare(b.date));
  }

  // ---- Marker ----
  saveMarker(m: FitnessMarker): void {
    const i = this.state.markers.findIndex((x) => x.id === m.id);
    if (i >= 0) this.state.markers[i] = m;
    else this.state.markers.push(m);
    this.touch();
  }
  listMarkers(): FitnessMarker[] {
    return [...this.state.markers].sort((a, b) => a.date.localeCompare(b.date));
  }

  // ---- CFE ----
  saveCfe(c: CurrentFitnessEstimate): void {
    this.state.cfe = c;
    this.touch();
  }
  getCfe(): CurrentFitnessEstimate | undefined {
    return this.state.cfe;
  }

  // ---- Heat ----
  saveHeatBlock(b: HeatBlock): void {
    const i = this.state.heatBlocks.findIndex((x) => x.id === b.id);
    if (i >= 0) this.state.heatBlocks[i] = b;
    else this.state.heatBlocks.push(b);
    this.touch();
  }
  listHeatBlocks(): HeatBlock[] {
    return [...this.state.heatBlocks];
  }
  saveHeatEntry(blockId: string, e: HeatBlockEntry): void {
    const i = this.state.heatEntries.findIndex(
      (x) => x.blockId === blockId && x.entry.date === e.date
    );
    if (i >= 0) this.state.heatEntries[i] = { blockId, entry: e };
    else this.state.heatEntries.push({ blockId, entry: e });
    this.touch();
  }
  listHeatEntries(blockId: string): HeatBlockEntry[] {
    return this.state.heatEntries
      .filter((x) => x.blockId === blockId)
      .map((x) => x.entry)
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  // ---- 固定曜日設定（3-1） ----
  saveWeekTemplate(t: WeekTemplate): void {
    this.state.weekTemplate = t;
    this.touch();
  }
  getWeekTemplate(): WeekTemplate | undefined {
    return this.state.weekTemplate;
  }

  // ---- 自作メニュー（3-2） ----
  saveCustomMenu(m: CustomMenu): void {
    const i = this.state.customMenus.findIndex((x) => x.id === m.id);
    if (i >= 0) this.state.customMenus[i] = m;
    else this.state.customMenus.push(m);
    this.touch();
  }
  listCustomMenus(): CustomMenu[] {
    return [...this.state.customMenus];
  }
  savePhrase(p: PhraseRule): void {
    if (!this.state.phrases) this.state.phrases = [];
    const i = this.state.phrases.findIndex((x) => x.id === p.id);
    if (i >= 0) this.state.phrases[i] = p;
    else this.state.phrases.push(p);
    this.touch();
  }
  listPhrases(): PhraseRule[] {
    return [...(this.state.phrases ?? [])];
  }
  deletePhrase(id: string): void {
    this.state.phrases = (this.state.phrases ?? []).filter((x) => x.id !== id);
    this.touch();
  }

  savePastEntry(e: PastEntry): void {
    const i = this.state.pastEntries.findIndex((x) => x.id === e.id);
    if (i >= 0) this.state.pastEntries[i] = e;
    else this.state.pastEntries.push(e);
    this.touch();
  }
  listPastEntries(): PastEntry[] {
    return [...this.state.pastEntries].sort((a, b) => b.date.localeCompare(a.date));
  }
  deletePastEntry(id: string): void {
    this.state.pastEntries = this.state.pastEntries.filter((x) => x.id !== id);
    this.touch();
  }

  deleteCustomMenu(id: string): void {
    this.state.customMenus = this.state.customMenus.filter((x) => x.id !== id);
    this.touch();
  }

  // ---- 同期履歴（Apple Health） ----
  saveSync(r: SyncRecord): void {
    this.state.syncs.push(r);
    this.touch();
  }
  listSyncs(limit = 20): SyncRecord[] {
    return [...this.state.syncs].reverse().slice(0, limit);
  }

  // ---- FIT取込（元ファイル・解析・修正・結果確認の信頼層） ----
  saveFitImport(r: FitImportRecord): void {
    if (!this.state.fitImports) this.state.fitImports = [];
    const i = this.state.fitImports.findIndex((x) => x.id === r.id);
    if (i >= 0) this.state.fitImports[i] = r;
    else this.state.fitImports.push(r);
    this.touch();
  }
  listFitImports(): FitImportRecord[] {
    return [...(this.state.fitImports ?? [])].sort((a, b) =>
      b.importedAtUtc.localeCompare(a.importedAtUtc)
    );
  }

  // ---- 故障ログ（2-3） ----
  saveInjury(i: InjuryLog): void {
    const idx = this.state.injuries.findIndex((x) => x.id === i.id);
    if (idx >= 0) this.state.injuries[idx] = i;
    else this.state.injuries.push(i);
    this.touch();
  }
  listInjuries(): InjuryLog[] {
    return [...this.state.injuries].sort((a, b) => b.date.localeCompare(a.date));
  }
  deleteInjury(id: string): void {
    this.state.injuries = this.state.injuries.filter((x) => x.id !== id);
    this.touch();
  }

  // ---- ChangeLog ----
  logChange(c: SessionChange, accepted?: boolean, rejectReason?: string): void {
    this.state.changeLog.push({
      ...c,
      createdAt: new Date().toISOString(),
      accepted,
      rejectReason,
    });
    this.touch();
  }
  listChangeLog(limit = 100): ChangeLogEntry[] {
    return [...this.state.changeLog].reverse().slice(0, limit);
  }
  /** 書き出しからの復元。記録した日時をそのまま書く（logChange は今の時刻になる） */
  restoreChangeLog(entries: ChangeLogEntry[]): void {
    // 古い順で渡ってくる。listChangeLog が reverse するので、そのまま末尾に積む
    this.state.changeLog.push(...entries);
    this.touch();
  }

  // ---- KV ----
  saveKv(key: string, value: unknown): void {
    if (!this.state.kv) this.state.kv = [];
    const i = this.state.kv.findIndex((x) => x.key === key);
    if (i >= 0) this.state.kv[i] = { key, value };
    else this.state.kv.push({ key, value });
    this.touch();
  }
  getKv<T>(key: string): T | undefined {
    return (this.state.kv ?? []).find((x) => x.key === key)?.value as T | undefined;
  }
  listKv<T>(prefix: string): { key: string; value: T }[] {
    return (this.state.kv ?? [])
      .filter((x) => x.key.startsWith(prefix))
      .map((x) => ({ key: x.key, value: x.value as T }))
      .sort((a, b) => a.key.localeCompare(b.key));
  }
  deleteKv(key: string): void {
    this.state.kv = (this.state.kv ?? []).filter((x) => x.key !== key);
    this.touch();
  }

  resetAll(): void {
    this.state = emptyState();
    this.touch();
  }

  /**
   * JSは単一スレッドなので、`fn` の実行中に他の処理が割り込むことはない。
   * これを利用して、実行前の状態をスナップショットしておき、例外が起きたら
   * 差し戻す。SQLite側の実トランザクション（Repo.transaction）と同じ役割。
   *
   * `fn` の中の save系メソッドは呼ばれるたびに `touch()`（＝永続化のデバウンス
   * 予約）を実行する。差し戻した後にもう一度 `touch()` を呼ばないと、
   * 差し戻し前の（壊れた）状態を指したままの予約がそのままIndexedDBへ
   * 書き込まれてしまう。かならず差し戻し後に `touch()` を呼ぶ。
   */
  transaction<T>(fn: () => T): T {
    const snapshot = structuredClone(this.state);
    try {
      return fn();
    } catch (error) {
      this.state = snapshot;
      this.touch();
      throw error;
    }
  }
}

// ---------------------------------------------------------------------------
// IndexedDB 永続化（依存ライブラリなしの最小実装）
// ---------------------------------------------------------------------------

const DB_NAME = "train800";
const STORE_NAME = "state";
const KEY = "app";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export interface StateIndexedDbReader {
  get(key: string): Promise<unknown>;
}

export interface StateLocalStorageReader {
  getItem(key: string): string | null;
}

export interface LoadStateDeps {
  indexedDb?: StateIndexedDbReader;
  localStorageImpl?: StateLocalStorageReader;
}

const STATE_ARRAY_KEYS = [
  "races",
  "sessions",
  "strengths",
  "results",
  "dailyChecks",
  "markers",
  "heatBlocks",
  "heatEntries",
  "injuries",
  "syncs",
  "customMenus",
  "pastEntries",
  "phrases",
  "fitImports",
  "kv",
  "changeLog",
] as const;

/** 旧版で後から追加された配列は補完するが、壊れた値を空配列で隠さない。 */
export function hydrateState(value: unknown): AppState {
  if (!value || typeof value !== "object") {
    throw new Error("保存データの形式が正しくありません");
  }
  const candidate = value as Partial<AppState>;
  if (candidate.version !== 1) {
    throw new Error(`未対応の保存データ版です（version=${String(candidate.version)}）`);
  }
  for (const key of STATE_ARRAY_KEYS) {
    const field = candidate[key];
    if (field !== undefined && !Array.isArray(field)) {
      throw new Error(`保存データの ${key} が壊れています`);
    }
  }
  return { ...emptyState(), ...candidate } as AppState;
}

function defaultIndexedDbReader(): StateIndexedDbReader {
  return {
    get: async (key) => {
      const db = await openDb();
      try {
        return await new Promise<unknown>((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, "readonly");
          const req = tx.objectStore(STORE_NAME).get(key);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
      } finally {
        db.close();
      }
    },
  };
}

function defaultLocalStorageReader(): StateLocalStorageReader {
  return { getItem: (key) => localStorage.getItem(key) };
}

export async function loadState(deps: LoadStateDeps = {}): Promise<AppState> {
  const indexedDbReader = deps.indexedDb ?? defaultIndexedDbReader();
  try {
    const state = await indexedDbReader.get(KEY);
    if (state === undefined) {
      // 直前の保存でIndexedDBだけが失敗した場合、writeStateはlocalStorageへ
      // フォールバックする。次回起動時にIndexedDB自体が復旧していても、まだ
      // KEYが無ければ退避データを先に読む必要がある。ここで空状態を返すと、
      // 実データが残っているのに「全部消えた」ように見え、その空状態で後から
      // IndexedDBを上書きしかねない。
      const storage = deps.localStorageImpl ?? defaultLocalStorageReader();
      const raw = storage.getItem(DB_NAME);
      return raw ? hydrateState(JSON.parse(raw) as unknown) : emptyState();
    }
    return hydrateState(state);
  } catch (indexedDbError) {
    // IndexedDB不可時は、旧フォールバックに実データがある場合だけ復旧する。
    // 両方を読めない状態で空データを返すと、その後の保存で既存データを
    // 空状態から上書きしうるため、起動を止めて本人へ明示する。
    try {
      const storage = deps.localStorageImpl ?? defaultLocalStorageReader();
      const raw = storage.getItem(DB_NAME);
      if (raw) return hydrateState(JSON.parse(raw) as unknown);
    } catch (localStorageError) {
      const idbDetail = errorText(indexedDbError);
      const localDetail = errorText(localStorageError);
      throw new Error(
        `端末データを安全に読み込めませんでした。書き込みは開始していません。` +
          `再読み込みしても直らない場合は、ストレージ設定を確認してください。` +
          `（IndexedDB: ${idbDetail} / localStorage: ${localDetail}）`
      );
    }
    throw new Error(
      `端末データを安全に読み込めませんでした。書き込みは開始していません。` +
        `IndexedDBへアクセスできず、復旧用データも見つかりません。` +
        `（${errorText(indexedDbError)}）`
    );
  }
}

/**
 * 永続化の結果。
 *
 * 以前は `persistState` が `void` を返し、IndexedDB・localStorageの両方が
 * 失敗しても呼び出し側に何も伝わらなかった。画面は「保存した」つもりのまま、
 * 実際は端末に何も残っていないことがありえた。
 */
export type PersistFailureReason = "quota" | "unavailable" | "unknown";
export type PersistOutcome =
  | { ok: true; via: "indexeddb" | "localstorage" }
  | { ok: false; reason: PersistFailureReason; detail: string };

/**
 * 実際のIndexedDB書き込みへのアクセス。
 *
 * IndexedDB自体はテスト環境（Node/vitest）に存在しないため、
 * `supabase.ts` の `fetchImpl` と同じ形で注入可能にし、
 * 「成功」「失敗」を明示的に表現したフェイクで分岐を検証できるようにする。
 */
export interface StateIndexedDb {
  put(key: string, value: AppState): Promise<void>;
}
export interface StateLocalStorage {
  setItem(key: string, value: string): void;
}
export interface PersistDeps {
  indexedDb?: StateIndexedDb;
  localStorageImpl?: StateLocalStorage;
}

function defaultIndexedDb(): StateIndexedDb {
  return {
    put: (key, value) =>
      openDb().then(
        (db) =>
          new Promise<void>((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, "readwrite");
            tx.objectStore(STORE_NAME).put(JSON.parse(JSON.stringify(value)), key);
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
            tx.onerror = () => {
              db.close();
              reject(tx.error);
            };
          })
      ),
  };
}

function defaultLocalStorage(): StateLocalStorage {
  return { setItem: (key, value) => localStorage.setItem(key, value) };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function classifyError(error: unknown): "quota" | "unavailable" | "unknown" {
  const name =
    error && typeof error === "object" && "name" in error ? String((error as { name: unknown }).name) : "";
  if (name === "QuotaExceededError") return "quota";
  if (name === "SecurityError" || name === "InvalidStateError") return "unavailable";
  return "unknown";
}

async function writeState(state: AppState, deps: PersistDeps): Promise<PersistOutcome> {
  const indexedDb = deps.indexedDb ?? defaultIndexedDb();
  try {
    await indexedDb.put(KEY, state);
    return { ok: true, via: "indexeddb" };
  } catch {
    const localStorageImpl = deps.localStorageImpl ?? defaultLocalStorage();
    try {
      localStorageImpl.setItem(DB_NAME, JSON.stringify(state));
      return { ok: true, via: "localstorage" };
    } catch (localStorageError) {
      return {
        ok: false,
        reason: classifyError(localStorageError),
        detail: errorText(localStorageError),
      };
    }
  }
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
let pendingState: AppState | undefined;
let pendingDeps: PersistDeps = {};
let pendingWaiters: Array<(outcome: PersistOutcome) => void> = [];

function settlePending(outcome: PersistOutcome): void {
  const waiters = pendingWaiters;
  pendingWaiters = [];
  for (const resolve of waiters) resolve(outcome);
}

/**
 * デバウンス付き保存。書き込み頻度を抑えつつ取りこぼしを防ぐ。
 *
 * 戻り値のPromiseは、実際に書き込みが走った時点（デバウンス後、または
 * `flushPendingState` による即時実行時）に解決する。呼び出し側は
 * これを見て「本当に永続化できたか」を確認できる。
 */
export function persistState(state: AppState, deps: PersistDeps = {}): Promise<PersistOutcome> {
  pendingState = state;
  pendingDeps = deps;
  clearTimeout(saveTimer);
  const promise = new Promise<PersistOutcome>((resolve) => pendingWaiters.push(resolve));
  saveTimer = setTimeout(() => {
    const s = pendingState;
    const d = pendingDeps;
    pendingState = undefined;
    if (s === undefined) return;
    void writeState(s, d).then(settlePending);
  }, 250);
  return promise;
}

/**
 * 保留中の保存をデバウンスを待たず即座に実行する。
 *
 * `pagehide` / `visibilitychange`（バックグラウンド移行）で呼ぶ。
 * アプリ終了直前の更新がデバウンスの250ms待ちで失われることを防ぐ。
 * 保留中の変更が無ければ何もしない。
 */
export function flushPendingState(): Promise<PersistOutcome | undefined> {
  const s = pendingState;
  const d = pendingDeps;
  if (s === undefined) return Promise.resolve(undefined);
  clearTimeout(saveTimer);
  pendingState = undefined;
  return writeState(s, d).then((outcome) => {
    settlePending(outcome);
    return outcome;
  });
}
