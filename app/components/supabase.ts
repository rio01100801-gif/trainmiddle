/**
 * S-11 Supabase との通信（薄い層）
 *
 * SDKを入れずに REST を直接叩く。
 * 理由は2つ。
 *   ・PWAのバンドルに数百KBのSDKを入れたくない（起動時間に直接効く）
 *   ・使うのは「サインイン」「1つのファイルの読み書き」だけで、SDKの大半が要らない
 *
 * 設定（URLとanon key）は端末の localStorage に置く。
 * anon key は公開前提の鍵なので端末に置いてよい。
 * **サービスロールキーは絶対に置かないこと**（あれば誰でも全データを読める）。
 */
import type { SyncConfig } from "@/lib/core/sync";

const CONFIG_KEY = "forge:sync:config";
const SESSION_KEY = "forge:sync:session";
const LAST_SYNCED_KEY = "forge:sync:last";

export interface SyncSession {
  accessToken: string;
  refreshToken?: string;
  email?: string;
  expiresAt?: number;
}

function readJson<T>(key: string): T | undefined {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* プライベートモード等で書けなくても、同期が使えないだけ */
  }
}

export function getSyncConfig(): Partial<SyncConfig> {
  return readJson<SyncConfig>(CONFIG_KEY) ?? {};
}
export function saveSyncConfig(c: SyncConfig): void {
  writeJson(CONFIG_KEY, { url: c.url.replace(/\/$/, ""), anonKey: c.anonKey });
}
export function clearSyncConfig(): void {
  try {
    localStorage.removeItem(CONFIG_KEY);
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(LAST_SYNCED_KEY);
  } catch {
    /* 消せなくても実害は無い */
  }
}

export function getSession(): SyncSession | undefined {
  return readJson<SyncSession>(SESSION_KEY);
}
export function saveSession(s: SyncSession): void {
  writeJson(SESSION_KEY, s);
}
export function signOut(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    /* 消せなくても次回サインインで上書きされる */
  }
}

export function getLastSynced(): { exportedAt: string; totalCount: number } | undefined {
  return readJson(LAST_SYNCED_KEY);
}
export function saveLastSynced(m: { exportedAt: string; totalCount: number }): void {
  writeJson(LAST_SYNCED_KEY, m);
}

/**
 * Googleでサインインする。
 *
 * Supabase の authorize へ飛ばすだけ。戻りは URL のハッシュに載る。
 * ⚠️ iOSのホーム画面から起動したPWAでは、遷移先がSafariで開いて
 * PWAに戻ってこないことがある。戻ってこない場合はSafariで開いてサインインし、
 * 同じ端末なので localStorage は共有されない点に注意（別ストレージ）。
 * その場合はPWA側でもう一度サインインする必要がある。
 */
export function signInWithGoogle(url: string): void {
  const redirect = encodeURIComponent(location.href.split("#")[0]);
  location.href = `${url}/auth/v1/authorize?provider=google&redirect_to=${redirect}`;
}

/**
 * サインイン後のリダイレクトを受け取る。
 * URLのハッシュにトークンが載っているので取り出して保存し、URLから消す。
 */
export function captureAuthRedirect(): SyncSession | undefined {
  if (typeof location === "undefined") return undefined;
  const hash = location.hash.startsWith("#") ? location.hash.slice(1) : location.hash;
  if (!hash.includes("access_token=")) return undefined;
  const p = new URLSearchParams(hash);
  const accessToken = p.get("access_token");
  if (!accessToken) return undefined;
  const s: SyncSession = {
    accessToken,
    refreshToken: p.get("refresh_token") ?? undefined,
    expiresAt: Number(p.get("expires_at")) || undefined,
  };
  saveSession(s);
  // トークンをURLに残さない（履歴や共有で漏れる）
  history.replaceState(null, "", location.pathname + location.search);
  return s;
}

/** 保存してあるスナップショットの置き場所。1人1ファイル */
const BUCKET = "forge";
const OBJECT = "snapshot.json";

function headers(cfg: SyncConfig, session: SyncSession): Record<string, string> {
  return {
    apikey: cfg.anonKey,
    Authorization: `Bearer ${session.accessToken}`,
  };
}

/** クラウドのスナップショットを取る。無ければ undefined */
export async function fetchSnapshot(
  cfg: SyncConfig,
  session: SyncSession
): Promise<any | undefined> {
  const r = await fetch(`${cfg.url}/storage/v1/object/${BUCKET}/${OBJECT}`, {
    headers: headers(cfg, session),
  });
  if (r.status === 404 || r.status === 400) return undefined;
  if (!r.ok) throw new Error(`クラウドの読み取りに失敗しました（${r.status}）`);
  return r.json();
}

/** クラウドへ送る。上書きの可否は呼び出し側が判断済みである前提 */
export async function putSnapshot(
  cfg: SyncConfig,
  session: SyncSession,
  file: unknown
): Promise<void> {
  const r = await fetch(`${cfg.url}/storage/v1/object/${BUCKET}/${OBJECT}`, {
    method: "POST",
    headers: {
      ...headers(cfg, session),
      "Content-Type": "application/json",
      "x-upsert": "true",
    },
    body: JSON.stringify(file),
  });
  if (!r.ok) throw new Error(`クラウドへの書き込みに失敗しました（${r.status}）`);
}
