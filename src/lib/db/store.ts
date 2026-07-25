/**
 * ストレージの抽象インターフェース。
 * - Node/Next.js: SQLite実装（repo.ts の Repo）
 * - PWA: ブラウザ内実装（pwa/memory-store.ts。IndexedDBに永続化）
 * サービス層はこのインターフェースにのみ依存する。
 */
import type { PastEntry } from "../core/backfill";
import type { PhraseRule } from "../core/bulkImport";
import type { SyncRecord } from "../core/healthImport";
import type { CustomMenu, WeekTemplate } from "../core/weekTemplate";
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

export interface ChangeLogEntry extends SessionChange {
  createdAt: string;
  accepted?: boolean;
  rejectReason?: string;
}

export interface Store {
  saveAthlete(a: Athlete): void;
  getAthlete(): Athlete | undefined;

  saveGoal(g: Goal): void;
  getGoal(): Goal | undefined;

  saveRace(r: Race): void;
  listRaces(): Race[];
  deleteRace(id: string): void;

  saveSession(s: Session): void;
  saveSessions(list: Session[]): void;
  getSession(id: string): Session | undefined;
  listSessions(from?: string, to?: string): Session[];
  deleteSession(id: string): void;
  deleteAllPlannedSessions(): void;

  saveStrength(s: StrengthSession): void;
  saveStrengths(list: StrengthSession[]): void;
  listStrengths(from?: string, to?: string): StrengthSession[];
  deleteAllPlannedStrengths(): void;

  saveResult(r: SessionResult): void;
  listResults(): SessionResult[];
  resultForSession(sessionId: string): SessionResult | undefined;

  saveDailyCheck(c: DailyCheck): void;
  listDailyChecks(): DailyCheck[];

  saveMarker(m: FitnessMarker): void;
  listMarkers(): FitnessMarker[];

  saveCfe(c: CurrentFitnessEstimate): void;
  getCfe(): CurrentFitnessEstimate | undefined;

  saveHeatBlock(b: HeatBlock): void;
  listHeatBlocks(): HeatBlock[];
  saveHeatEntry(blockId: string, e: HeatBlockEntry): void;
  listHeatEntries(blockId: string): HeatBlockEntry[];

  saveWeekTemplate(t: WeekTemplate): void;
  getWeekTemplate(): WeekTemplate | undefined;

  saveCustomMenu(m: CustomMenu): void;
  listCustomMenus(): CustomMenu[];
  deleteCustomMenu(id: string): void;

  savePhrase(p: PhraseRule): void;
  listPhrases(): PhraseRule[];
  deletePhrase(id: string): void;

  savePastEntry(e: PastEntry): void;
  listPastEntries(): PastEntry[];
  deletePastEntry(id: string): void;

  saveSync(r: SyncRecord): void;
  listSyncs(limit?: number): SyncRecord[];

  saveInjury(i: InjuryLog): void;
  listInjuries(): InjuryLog[];
  deleteInjury(id: string): void;

  logChange(c: SessionChange, accepted?: boolean, rejectReason?: string): void;
  listChangeLog(limit?: number): ChangeLogEntry[];

  /**
   * 汎用のキー・バリュー。
   * セッション途中の入力、辞退した提案、書き出しの日時など、
   * 単独のテーブルを立てるほどの構造を持たないものを置く。
   * 検索キーが要るものはここに置かないこと。
   */
  saveKv(key: string, value: unknown): void;
  getKv<T>(key: string): T | undefined;
  listKv<T>(prefix: string): { key: string; value: T }[];
  deleteKv(key: string): void;

  /** 全データの消去（復元時の「上書き」で使う） */
  resetAll(): void;
}
