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
  /** Publishable key（または旧anon key）。公開前提の鍵なので端末に置いてよい */
  anonKey: string;
}

/**
 * iOSの自動補正やコピー時の改行を保存値へ持ち込まない。
 *
 * URLとキーはいずれもASCIIで発行される値なので、NFKCで全角英数・記号を半角化し、
 * 空白類とゼロ幅文字を除いてよい。URLは正しくparseできる場合はoriginへ揃える。
 */
function compactCredential(value: string | undefined): string {
  return (value ?? "")
    .normalize("NFKC")
    .replace(/[\s\u200b\u2060\ufeff]+/g, "");
}

export function normalizeSyncConfig(c: Partial<SyncConfig>): SyncConfig {
  const rawUrl = compactCredential(c.url);
  let url = rawUrl.replace(/\/+$/, "");
  try {
    const parsed = new URL(rawUrl);
    if (
      parsed.protocol === "https:" &&
      !parsed.username &&
      !parsed.password &&
      !parsed.port &&
      (parsed.pathname === "/" || parsed.pathname === "") &&
      !parsed.search &&
      !parsed.hash
    ) {
      url = parsed.origin;
    }
  } catch {
    // 検証側で具体的なエラーにする。ここでは入力を勝手に補完しない。
  }
  return { url, anonKey: compactCredential(c.anonKey) };
}

function jwtRole(key: string): string | undefined {
  const parts = key.split(".");
  if (parts.length !== 3) return undefined;
  try {
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = payload.padEnd(Math.ceil(payload.length / 4) * 4, "=");
    const decoded: unknown = JSON.parse(atob(padded));
    if (!decoded || typeof decoded !== "object" || !("role" in decoded)) return undefined;
    const role = (decoded as { role?: unknown }).role;
    return typeof role === "string" ? role : undefined;
  } catch {
    return undefined;
  }
}

/** 設定が使える形かどうか。中途半端な設定で通信を始めない */
export function validateSyncConfig(c: Partial<SyncConfig>): string | undefined {
  const normalized = normalizeSyncConfig(c);
  if (!normalized.url && !normalized.anonKey) return "未設定です";
  if (!normalized.url) return "Project URL が空です";
  if (!normalized.anonKey) return "Publishable Key が空です";

  let parsed: URL;
  try {
    parsed = new URL(normalized.url);
  } catch {
    return "Project URL の形が違います（https://xxxx.supabase.co）";
  }

  if (
    parsed.protocol !== "https:" ||
    !/^[a-z0-9-]+\.supabase\.co$/i.test(parsed.hostname) ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash ||
    parsed.username ||
    parsed.password ||
    parsed.port
  ) {
    return "Project URL の形が違います（https://xxxx.supabase.co）";
  }

  if (normalized.anonKey.startsWith("sb_secret_")) {
    return "Secret Key はブラウザへ保存できません。sb_publishable_ で始まるキーを使ってください";
  }
  if (jwtRole(normalized.anonKey) === "service_role") {
    return "service_role キーはブラウザへ保存できません。anon または Publishable Key を使ってください";
  }
  const publishable = /^sb_publishable_[A-Za-z0-9_-]{16,}$/.test(normalized.anonKey);
  const legacyAnon =
    normalized.anonKey.split(".").length === 3 && jwtRole(normalized.anonKey) === "anon";
  if (!publishable && !legacyAnon) {
    return "Publishable Key の形が違います（sb_publishable_... または旧anon key）";
  }
  return undefined;
}

export interface OAuthLocation {
  origin: string;
  pathname: string;
}

/**
 * Supabaseのimplicit flowは戻りURLのハッシュをトークン格納に使う。
 * PWAの画面ルートもハッシュなので、PWAだけはクエリで同期画面への復帰意図を残す。
 * Next.js版は現在の /sync へ直接戻し、ホームへ落とさない。
 */
export function oauthRedirectTo(location: OAuthLocation, hashNavigation: boolean): string {
  const redirect = new URL(location.pathname || "/", location.origin);
  redirect.search = "";
  redirect.hash = "";
  if (hashNavigation) {
    redirect.searchParams.set("sync", "1");
  } else if (!redirect.pathname.endsWith("/sync")) {
    redirect.pathname = "/sync";
  }
  return redirect.toString();
}

export function googleAuthorizeUrl(config: SyncConfig, redirectTo: string): string {
  const normalized = normalizeSyncConfig(config);
  const authorize = new URL("/auth/v1/authorize", normalized.url);
  authorize.searchParams.set("provider", "google");
  authorize.searchParams.set("redirect_to", redirectTo);
  return authorize.toString();
}

export interface AuthRedirectLanding {
  /** ハッシュルーティング（PWA）のとき、着地させるハッシュ */
  hash?: string;
  /** 通常ルーティング（Next.js）のとき、遷移させるパス */
  pathname?: string;
}

/**
 * サインインの戻りを受け取った後、同期画面へ着地させる必要があるか決める。
 *
 * 以前は `?sync=1` というクエリが残っていることを前提にしていたが、
 * Supabase の Redirect URLs にこのアプリのURLを登録していないと、
 * Supabase は指定した redirect_to を無視して Site URL へ飛ばすため、
 * クエリごと落ちる（横取り耐性のための仕様で、こちらの制御が及ばない）。
 * その結果、トークンは保存されるのに画面だけホームに居座っていた。
 *
 * `captureAuthRedirect` が何か拾えた時点で、それは必ず `signInWithGoogle` が
 * 発行した redirect_to からの戻りである（他にこのURLへ来る経路が無い）。
 * したがって `?sync=1` の有無を問わず、同期画面へ戻してよい。
 */
export function authRedirectLanding(
  hashNavigation: boolean,
  pathname: string
): AuthRedirectLanding {
  if (hashNavigation) return { hash: "#/sync" };
  if (!pathname.endsWith("/sync")) return { pathname: "/sync" };
  return {};
}
