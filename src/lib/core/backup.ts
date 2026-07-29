/**
 * M-12 データの書き出しと復元
 *
 * iPhoneのPWAはストレージが消えることがある。
 * 数か月ぶんの実測が消えると、現在地の推定が全部やり直しになる。
 * 派手さは無いが、失ったときの損失は他のどの機能より大きい。
 *
 * 形式はJSONひとつ。復元時は「上書き」か「統合」を選べる。
 * 統合はidで突き合わせて重複を作らない。
 */

export const BACKUP_FORMAT = "forge-backup";
export const BACKUP_VERSION = 1;

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: string;
  athleteName?: string;
  counts: Record<string, number>;
  data: Record<string, unknown>;
}

export type RestoreMode = "replace" | "merge";

export interface RestoreReport {
  mode: RestoreMode;
  /** 種類ごとの取り込み件数 */
  added: Record<string, number>;
  /** 既にあって上書きした件数 */
  updated: Record<string, number>;
  /** 手元の内容を守るために、相手側を取り込まなかった件数 */
  kept: Record<string, number>;
  warnings: string[];
}

export function isBackupFile(x: unknown): x is BackupFile {
  const o = x as BackupFile;
  return !!o && o.format === BACKUP_FORMAT && typeof o.version === "number" && !!o.data;
}

/**
 * IDをキーにする統合。同じidは既定では取り込む側で上書きする。
 *
 * `keepExisting` を渡すと、その組み合わせでは**手元の値を残す**。
 * 統合は「両方を残す」操作なので、本人の完了済み・編集済みを
 * 相手側の古い値で黙って消してはいけない（呼び出し側が規則を決める）。
 * 残した件数は `kept` で返す。件数を返さないと画面で知らせようがない。
 */
export function mergeById<T extends { id: string }>(
  existing: T[],
  incoming: T[],
  keepExisting?: (mine: T, theirs: T) => boolean
): { merged: T[]; added: number; updated: number; kept: number } {
  const map = new Map(existing.map((x) => [x.id, x]));
  let added = 0;
  let updated = 0;
  let kept = 0;
  for (const x of incoming) {
    const mine = map.get(x.id);
    if (mine === undefined) {
      added++;
      map.set(x.id, x);
      continue;
    }
    if (keepExisting?.(mine, x)) {
      kept++;
      continue;
    }
    updated++;
    map.set(x.id, x);
  }
  return { merged: [...map.values()], added, updated, kept };
}

/** 日付をキーにするレコード（日次コンディション）の統合 */
export function mergeByDate<T extends { date: string }>(
  existing: T[],
  incoming: T[]
): { merged: T[]; added: number; updated: number } {
  const map = new Map(existing.map((x) => [x.date, x]));
  let added = 0;
  let updated = 0;
  for (const x of incoming) {
    if (map.has(x.date)) updated++;
    else added++;
    map.set(x.date, x);
  }
  return { merged: [...map.values()], added, updated };
}

/** 書き出しからの経過日数で催促するか決める */
export const BACKUP_REMINDER_DAYS = 14;

export function shouldRemindBackup(
  lastExportedAt: string | undefined,
  today: string,
  daysSince: (from: string, to: string) => number
): { remind: boolean; days?: number; message: string } {
  if (!lastExportedAt) {
    return {
      remind: true,
      message:
        "データを書き出したことがありません。端末のストレージが消えると実測がすべて失われます",
    };
  }
  const days = daysSince(lastExportedAt.slice(0, 10), today);
  if (days >= BACKUP_REMINDER_DAYS) {
    return {
      remind: true,
      days,
      message: `最後に書き出してから${days}日たっています。書き出しておいてください`,
    };
  }
  return { remind: false, days, message: `${days}日前に書き出し済みです` };
}
