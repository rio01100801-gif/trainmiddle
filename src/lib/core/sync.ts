/**
 * S-11 端末間の同期（判断の部分）
 *
 * ここには**ネットワークを持ち込まない**。何をすべきかを決めるだけにして、
 * 実際の通信は呼び出し側（app/components/supabase.ts）が行う。
 * 同期は失敗の仕方が多く、通信と判断が混ざると、
 * 「何が起きたのか」を後から追えなくなる。
 *
 * 方式はスナップショット同期。M-12 の書き出し（`BackupFile`）をそのまま送る。
 *
 * レコード単位の同期にしない理由:
 *   全エンティティに更新時刻と削除の墓標が要る。Store は51メソッドあり、
 *   2実装（SQLite / IndexedDB）に同じ変更を入れることになる。
 *   利用者は1人・端末は1〜2台なので、そこまでの精度に見合わない。
 *
 * **黙って上書きしない。** 両方に変更があるときは必ず本人に選ばせる。
 * 練習データは失うと取り返しがつかない（iOSはストレージを消すことがある）。
 */

export type SyncAction =
  | "push" // ローカルだけが進んでいる → 送る
  | "pull" // リモートだけが進んでいる → 取り込む
  | "in_sync" // 同じ
  | "conflict" // 両方進んでいる → 本人に選ばせる
  | "first_push" // リモートに何も無い
  | "first_pull"; // ローカルに何も無い

export interface SyncSnapshotMeta {
  /** 書き出した時刻（ISO） */
  exportedAt: string;
  /** 中身の件数合計。同じ時刻でも中身が違えば区別できる */
  totalCount: number;
}

export interface SyncStateInput {
  local?: SyncSnapshotMeta;
  remote?: SyncSnapshotMeta;
  /** 前回同期したときのスナップショット（どちらが進んだかの基準） */
  lastSynced?: SyncSnapshotMeta;
}

export interface SyncDecision {
  action: SyncAction;
  /** 画面にそのまま出す説明 */
  message: string;
  /** conflict のときに選べる選択肢 */
  choices?: { key: "merge" | "keep_local" | "keep_remote"; label: string; note: string }[];
}

function same(a?: SyncSnapshotMeta, b?: SyncSnapshotMeta): boolean {
  if (!a || !b) return false;
  return a.exportedAt === b.exportedAt && a.totalCount === b.totalCount;
}

/**
 * 何をすべきかを決める。
 *
 * 「前回同期した状態」から見て、どちらが動いたかで判断する。
 * 時刻の新しさだけで決めない。端末の時計はずれることがあり、
 * ずれた端末の古いデータで新しいデータを潰すのが一番まずい。
 */
export function decideSync(input: SyncStateInput): SyncDecision {
  const { local, remote, lastSynced } = input;

  if (!local && !remote) {
    return { action: "in_sync", message: "同期するデータがまだありません。" };
  }
  if (!remote) {
    return { action: "first_push", message: "クラウド側にまだデータがありません。この端末の内容を送ります。" };
  }
  if (!local) {
    return { action: "first_pull", message: "この端末にデータがありません。クラウドの内容を取り込みます。" };
  }
  if (same(local, remote)) {
    return { action: "in_sync", message: "同期済みです。差はありません。" };
  }

  const localMoved = !same(local, lastSynced);
  const remoteMoved = !same(remote, lastSynced);

  if (localMoved && !remoteMoved) {
    return { action: "push", message: "この端末だけが進んでいます。クラウドへ送ります。" };
  }
  if (!localMoved && remoteMoved) {
    return { action: "pull", message: "クラウド側だけが進んでいます。この端末に取り込みます。" };
  }

  return {
    action: "conflict",
    message:
      "この端末とクラウドの両方が、前回の同期のあとに変わっています。" +
      "どちらかを消すことになるので、選んでください。",
    choices: [
      {
        key: "merge",
        label: "両方を残す（統合）",
        note: "同じ記録は重複しません。迷ったらこれを選んでください",
      },
      {
        key: "keep_local",
        label: "この端末を優先",
        note: "クラウド側にしか無い記録は失われます",
      },
      {
        key: "keep_remote",
        label: "クラウドを優先",
        note: "この端末にしか無い記録は失われます",
      },
    ],
  };
}

/** `BackupFile` からメタだけ取り出す */
export function metaOf(file: {
  exportedAt?: string;
  counts?: Record<string, number>;
}): SyncSnapshotMeta | undefined {
  if (!file?.exportedAt) return undefined;
  const totalCount = Object.values(file.counts ?? {}).reduce((a, b) => a + (b ?? 0), 0);
  return { exportedAt: file.exportedAt, totalCount };
}

// ---------------------------------------------------------------------------
// 設定
// ---------------------------------------------------------------------------

export interface SyncConfig {
  /** Supabase の Project URL */
  url: string;
  /** anon public key。公開前提の鍵なので端末に置いてよい */
  anonKey: string;
}

/** 設定が使える形かどうか。中途半端な設定で通信を始めない */
export function validateSyncConfig(c: Partial<SyncConfig>): string | undefined {
  if (!c.url?.trim() && !c.anonKey?.trim()) return "未設定です";
  if (!c.url?.trim()) return "Project URL が空です";
  if (!c.anonKey?.trim()) return "anon key が空です";
  if (!/^https:\/\/[\w-]+\.supabase\.co\/?$/.test(c.url.trim())) {
    return "Project URL の形が違います（https://xxxx.supabase.co）";
  }
  return undefined;
}
