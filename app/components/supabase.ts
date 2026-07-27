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
import {
  googleAuthorizeUrl,
  normalizeSyncConfig,
  oauthRedirectTo,
  validateSyncConfig,
  type SyncConfig,
} from "@/lib/core/sync";

const CONFIG_KEY = "forge:sync:config";
const SESSION_KEY = "forge:sync:session";
const LAST_SYNCED_KEY = "forge:sync:last";

type SyncStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface SyncSession {
  accessToken: string;
  refreshToken?: string;
  email?: string;
  expiresAt?: number;
}

export interface SavedSyncConfig {
  config: SyncConfig;
  changed: boolean;
  savedAt: string;
  source: "localStorage";
}

function browserStorage(storage?: SyncStorage): SyncStorage {
  if (storage) return storage;
  if (typeof localStorage === "undefined") {
    throw new Error("この実行環境ではlocalStorageを利用できません。");
  }
  return localStorage;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readJson<T>(key: string, storage?: SyncStorage): T | undefined {
  const target = browserStorage(storage);
  let raw: string | null;
  try {
    raw = target.getItem(key);
  } catch (error) {
    throw new Error(`保存領域を読み取れませんでした: ${errorText(error)}`);
  }
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error("保存されている同期設定が壊れています。「接続設定を消す」で入れ直してください。");
  }
}

function writeJson(key: string, value: unknown, storage?: SyncStorage): void {
  const target = browserStorage(storage);
  const encoded = JSON.stringify(value);
  try {
    target.setItem(key, encoded);
    if (target.getItem(key) !== encoded) {
      throw new Error("書き込んだ値を再読込できませんでした");
    }
  } catch (error) {
    throw new Error(`保存領域へ書き込めませんでした: ${errorText(error)}`);
  }
}

function removeStored(key: string, storage?: SyncStorage): void {
  const target = browserStorage(storage);
  try {
    target.removeItem(key);
    if (target.getItem(key) !== null) throw new Error("削除後も値が残っています");
  } catch (error) {
    throw new Error(`保存領域から削除できませんでした: ${errorText(error)}`);
  }
}

function sameConfig(a: Partial<SyncConfig>, b: SyncConfig): boolean {
  const normalized = normalizeSyncConfig(a);
  return normalized.url === b.url && normalized.anonKey === b.anonKey;
}

export function getSyncConfig(storage?: SyncStorage): Partial<SyncConfig> {
  const stored = readJson<unknown>(CONFIG_KEY, storage);
  if (stored === undefined) return {};
  if (!stored || typeof stored !== "object") {
    throw new Error("保存されている同期設定の形式が正しくありません。");
  }
  const value = stored as { url?: unknown; anonKey?: unknown };
  return normalizeSyncConfig({
    url: typeof value.url === "string" ? value.url : "",
    anonKey: typeof value.anonKey === "string" ? value.anonKey : "",
  });
}

export function saveSyncConfig(c: SyncConfig, storage?: SyncStorage): SavedSyncConfig {
  const normalized = normalizeSyncConfig(c);
  const validationError = validateSyncConfig(normalized);
  if (validationError) throw new Error(validationError);

  const previous = getSyncConfig(storage);
  const changed = !sameConfig(previous, normalized);
  writeJson(CONFIG_KEY, normalized, storage);

  const persisted = getSyncConfig(storage);
  if (!sameConfig(persisted, normalized)) {
    throw new Error("保存後に再読込した設定が一致しません。");
  }

  // 別プロジェクトのユーザーJWTと同期基準を新しい接続先へ持ち込まない。
  if (changed) {
    removeStored(SESSION_KEY, storage);
    removeStored(LAST_SYNCED_KEY, storage);
  }

  const savedAt = new Date().toISOString();
  rememberRuntime(normalized, savedAt);
  return { config: normalized, changed, savedAt, source: "localStorage" };
}

export function clearSyncConfig(storage?: SyncStorage): void {
  removeStored(CONFIG_KEY, storage);
  removeStored(SESSION_KEY, storage);
  removeStored(LAST_SYNCED_KEY, storage);
}

export function getSession(storage?: SyncStorage): SyncSession | undefined {
  return readJson<SyncSession>(SESSION_KEY, storage);
}
export function saveSession(s: SyncSession, storage?: SyncStorage): void {
  writeJson(SESSION_KEY, s, storage);
}
export function signOut(storage?: SyncStorage): void {
  removeStored(SESSION_KEY, storage);
}

export function getLastSynced(
  storage?: SyncStorage
): { exportedAt: string; totalCount: number } | undefined {
  return readJson(LAST_SYNCED_KEY, storage);
}
export function saveLastSynced(
  m: { exportedAt: string; totalCount: number },
  storage?: SyncStorage
): void {
  writeJson(LAST_SYNCED_KEY, m, storage);
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
export function isHashNavigationRuntime(): boolean {
  const navigationGlobal = globalThis as typeof globalThis & { __HASH_NAV__?: boolean };
  return navigationGlobal.__HASH_NAV__ === true;
}

let lastRuntime: { urlHost: string; createdAt: string } | undefined;
let lastOAuthRedirectTo: string | undefined;

function rememberRuntime(config: SyncConfig, createdAt = new Date().toISOString()): SyncConfig {
  const normalized = normalizeSyncConfig(config);
  lastRuntime = { urlHost: new URL(normalized.url).hostname, createdAt };
  return normalized;
}

function createRuntime(config: SyncConfig): SyncConfig {
  const normalized = normalizeSyncConfig(config);
  const validationError = validateSyncConfig(normalized);
  if (validationError) throw new Error(validationError);
  return rememberRuntime(normalized);
}

export function currentOAuthRedirectTo(): string {
  if (typeof location === "undefined") throw new Error("ブラウザ以外ではOAuthを開始できません。");
  return oauthRedirectTo(
    { origin: location.origin, pathname: location.pathname },
    isHashNavigationRuntime()
  );
}

export function signInWithGoogle(config: SyncConfig): void {
  const runtime = createRuntime(config);
  const redirectTo = currentOAuthRedirectTo();
  lastOAuthRedirectTo = redirectTo;
  location.assign(googleAuthorizeUrl(runtime, redirectTo));
}

export type ConnectionTest =
  | {
      ok: true;
      message: string;
      urlHost: string;
      status: number;
      testedAt: string;
      durationMs: number;
    }
  | {
      ok: false;
      kind:
        | "url"
        | "key"
        | "offline"
        | "timeout"
        | "cors"
        | "dns"
        | "http"
        | "response";
      message: string;
      urlHost?: string;
      status?: number;
      testedAt: string;
      durationMs: number;
    };

export interface ConnectionTestOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  online?: boolean;
  now?: () => number;
}

function isAbortError(error: unknown): boolean {
  return !!error && typeof error === "object" && "name" in error && error.name === "AbortError";
}

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function isAuthSettings(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  return (
    "external" in value ||
    "disable_signup" in value ||
    "mailer_autoconfirm" in value ||
    "phone_autoconfirm" in value
  );
}

async function hostIsReachable(
  url: string,
  fetchImpl: typeof fetch,
  timeoutMs: number
): Promise<boolean> {
  try {
    await fetchWithTimeout(
      fetchImpl,
      new URL("/", url),
      { method: "GET", mode: "no-cors", cache: "no-store" },
      timeoutMs
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * 接続先が正しいかを、サインインの前に確かめる。
 *
 * サインインは外部サイトへ飛ぶので、URLが1文字違うだけで
 * 「サーバに接続できません」に飛ばされ、何が悪いのか分からないまま戻ってくる。
 * ここで**飛ぶ前に**確かめて、URLと鍵のどちらが悪いのかまで出す。
 */
export async function testConnection(
  cfg: SyncConfig,
  options: ConnectionTestOptions = {}
): Promise<ConnectionTest> {
  const now = options.now ?? Date.now;
  const startedAt = now();
  const testedAt = new Date().toISOString();
  const normalized = normalizeSyncConfig(cfg);
  const validationError = validateSyncConfig(normalized);
  const durationMs = () => Math.max(0, now() - startedAt);
  if (validationError) {
    const keyError = /Key|key|service_role/.test(validationError);
    return {
      ok: false,
      kind: keyError ? "key" : "url",
      message: validationError,
      testedAt,
      durationMs: durationMs(),
    };
  }

  const runtime = rememberRuntime(normalized);
  const urlHost = new URL(runtime.url).hostname;
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 8000;
  const online =
    options.online ??
    (options.fetchImpl ? true : typeof navigator === "undefined" ? true : navigator.onLine);

  if (!online) {
    return {
      ok: false,
      kind: "offline",
      message: `オフラインです。通信を戻してから ${urlHost} を再テストしてください。`,
      urlHost,
      testedAt,
      durationMs: durationMs(),
    };
  }

  let r: Response;
  try {
    r = await fetchWithTimeout(
      fetchImpl,
      `${runtime.url}/auth/v1/settings`,
      {
        method: "GET",
        headers: { apikey: runtime.anonKey },
        cache: "no-store",
      },
      timeoutMs
    );
  } catch (error) {
    if (isAbortError(error)) {
      return {
        ok: false,
        kind: "timeout",
        message: `${urlHost} への接続が${Math.ceil(timeoutMs / 1000)}秒でタイムアウトしました。回線またはSupabaseプロジェクトの状態を確認してください。`,
        urlHost,
        testedAt,
        durationMs: durationMs(),
      };
    }
    const reachable = await hostIsReachable(runtime.url, fetchImpl, Math.min(timeoutMs, 4000));
    if (reachable) {
      return {
        ok: false,
        kind: "cors",
        message: `${urlHost} 自体には到達しましたが、ブラウザが応答を読めませんでした（CORSまたはSafariの通信制限）。Safariとホーム画面PWAの両方で同じURLを開き直して再テストしてください。`,
        urlHost,
        testedAt,
        durationMs: durationMs(),
      };
    }
    return {
      ok: false,
      kind: "dns",
      message: `${urlHost} を名前解決または接続できませんでした。URLの打ち間違い、DNS、TLS、回線状態を確認してください。`,
      urlHost,
      testedAt,
      durationMs: durationMs(),
    };
  }

  if (r.status === 401 || r.status === 403) {
    return {
      ok: false,
      kind: "key",
      message: `${urlHost} には到達しましたが、Publishable Keyが拒否されました（HTTP ${r.status}）。Settings → API Keys の sb_publishable_... を確認してください。`,
      urlHost,
      status: r.status,
      testedAt,
      durationMs: durationMs(),
    };
  }
  if (!r.ok) {
    return {
      ok: false,
      kind: "http",
      message: `${urlHost} には到達しましたが、Supabase AuthがHTTP ${r.status}を返しました。Project URLとプロジェクト状態を確認してください。`,
      urlHost,
      status: r.status,
      testedAt,
      durationMs: durationMs(),
    };
  }

  let body: unknown;
  try {
    body = await r.json();
  } catch {
    return {
      ok: false,
      kind: "response",
      message: `${urlHost} からJSONではない応答が返りました。SupabaseのProject URLか確認してください。`,
      urlHost,
      status: r.status,
      testedAt,
      durationMs: durationMs(),
    };
  }
  if (!isAuthSettings(body)) {
    return {
      ok: false,
      kind: "response",
      message: `${urlHost} には接続できましたが、Supabase Auth設定の応答ではありませんでした。`,
      urlHost,
      status: r.status,
      testedAt,
      durationMs: durationMs(),
    };
  }
  return {
    ok: true,
    message: `${urlHost} のSupabase Authへ接続できました（HTTP ${r.status}）。Googleサインインへ進めます。`,
    urlHost,
    status: r.status,
    testedAt,
    durationMs: durationMs(),
  };
}

export interface SyncDiagnostics {
  environment: "browser" | "standalone PWA";
  origin: string;
  urlHost?: string;
  storage: string;
  runtimeCreatedAt?: string;
  oauthRedirectTo?: string;
}

export function getSyncDiagnostics(config?: Partial<SyncConfig>): SyncDiagnostics {
  const hashNavigation = isHashNavigationRuntime();
  const standaloneNavigator =
    typeof navigator === "undefined"
      ? false
      : (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const standaloneDisplay =
    typeof matchMedia !== "undefined" && matchMedia("(display-mode: standalone)").matches;
  let urlHost: string | undefined;
  const normalized = normalizeSyncConfig(config ?? {});
  try {
    urlHost = normalized.url ? new URL(normalized.url).hostname : undefined;
  } catch {
    urlHost = undefined;
  }
  return {
    environment: hashNavigation || standaloneNavigator || standaloneDisplay ? "standalone PWA" : "browser",
    origin: typeof location === "undefined" ? "unknown" : location.origin,
    urlHost,
    storage: "localStorage（origin・Safari/PWAごと）",
    runtimeCreatedAt: lastRuntime?.createdAt,
    oauthRedirectTo: lastOAuthRedirectTo,
  };
}

export type AuthRedirectResult =
  | { kind: "session"; session: SyncSession }
  | { kind: "error"; message: string; code?: string };

let pendingAuthMessage: string | undefined;

export function parseAuthRedirectHash(hash: string): AuthRedirectResult | undefined {
  const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const error = params.get("error");
  const errorCode = params.get("error_code") ?? undefined;
  if (error || errorCode) {
    const description = params.get("error_description") ?? error ?? "OAuth認証に失敗しました。";
    return {
      kind: "error",
      code: errorCode,
      message: `Googleサインインに失敗しました${errorCode ? `（${errorCode}）` : ""}: ${description}`,
    };
  }
  const accessToken = params.get("access_token");
  if (!accessToken) return undefined;
  return {
    kind: "session",
    session: {
      accessToken,
      refreshToken: params.get("refresh_token") ?? undefined,
      expiresAt: Number(params.get("expires_at")) || undefined,
    },
  };
}

/**
 * サインイン後のリダイレクトを受け取る。
 * URLのハッシュにトークンが載っているので取り出して保存し、URLから消す。
 */
export function captureAuthRedirect(storage?: SyncStorage): AuthRedirectResult | undefined {
  if (typeof location === "undefined") return undefined;
  const parsed = parseAuthRedirectHash(location.hash);
  if (!parsed) return undefined;
  if (parsed.kind === "session") {
    try {
      saveSession(parsed.session, storage);
    } catch (error) {
      const failed: AuthRedirectResult = {
        kind: "error",
        message: `サインイン情報を端末へ保存できませんでした: ${errorText(error)}`,
      };
      pendingAuthMessage = failed.message;
      history.replaceState(null, "", location.pathname + location.search);
      return failed;
    }
  } else {
    pendingAuthMessage = parsed.message;
  }
  // トークンやOAuthエラーをURLから消す。?sync=1はPWAの復帰判断まで残す。
  history.replaceState(null, "", location.pathname + location.search);
  return parsed;
}

export function consumeAuthMessage(): string | undefined {
  const message = pendingAuthMessage;
  pendingAuthMessage = undefined;
  return message;
}

/** 保存してあるスナップショットの置き場所。1人1ファイル */
const BUCKET = "forge";
const OBJECT = "snapshot.json";

export interface StorageRequestOptions {
  fetchImpl?: typeof fetch;
}

function headers(cfg: SyncConfig, session: SyncSession): Record<string, string> {
  const runtime = createRuntime(cfg);
  return {
    apikey: runtime.anonKey,
    Authorization: `Bearer ${session.accessToken}`,
  };
}

function storageErrorFields(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const payload = value as Record<string, unknown>;
  const fields = ["code", "error", "message"]
    .map((key) => payload[key])
    .filter((field): field is string => typeof field === "string")
    .map((field) => field.replace(/\s+/g, " ").trim().slice(0, 180))
    .filter(Boolean);
  return [...new Set(fields)];
}

/**
 * Supabase Storage のエラー本文から、利用者が直せる範囲だけを表示する。
 * レスポンス本文に鍵やJWTは含まれないが、既知フィールドだけを取り出し長さも制限する。
 */
async function storageFailure(
  response: Response,
  action: "読み取り" | "書き込み"
): Promise<Error> {
  let fields: string[] = [];
  try {
    fields = storageErrorFields(await response.json());
  } catch {
    // Storage がJSON以外を返した場合も、HTTP status と対処方法は必ず返す。
  }

  const detail = fields.join(" / ");
  const normalized = detail.toLowerCase();
  let hint: string;
  if (response.status === 401) {
    hint = "サインインの有効期限が切れている可能性があります。サインアウト後、Googleで再サインインしてください。";
  } else if (normalized.includes("bucket") && normalized.includes("not found")) {
    hint = "Supabase StorageにPrivateバケット「forge」を作成してください。";
  } else if (
    response.status === 403 ||
    normalized.includes("row-level security") ||
    normalized.includes("policy") ||
    normalized.includes("unauthorized")
  ) {
    hint =
      "StorageのRLSで拒否されています。「forge」バケットにauthenticated向けのSELECT・INSERT・UPDATEポリシーを設定してください。";
  } else if (response.status === 413) {
    hint = "書き出しデータがStorageの上限を超えています。端末の書き出しファイルサイズを確認してください。";
  } else if (response.status === 400) {
    hint =
      "「forge」バケットの存在と、authenticated向けSELECT・INSERT・UPDATEポリシーを確認してください。";
  } else {
    hint = "Supabase Storageの「forge」バケットとポリシー、サインイン状態を確認してください。";
  }

  return new Error(
    `クラウドの${action}に失敗しました（HTTP ${response.status}）。` +
      (detail ? ` Supabase: ${detail}。` : "") +
      ` ${hint}`
  );
}

/**
 * Supabase Storageは、存在するバケット内の未作成オブジェクトにも
 * HTTP 400 + { code: "not_found", message: "Object not found" }を返す。
 * 同じ400でもBucket not foundやRLS違反は設定不備なので、本文まで一致した場合だけ
 * 「初回同期でまだsnapshot.jsonがない」と判断する。
 */
async function isMissingSnapshot(response: Response): Promise<boolean> {
  if (response.status === 404) return true;
  if (response.status !== 400) return false;
  try {
    const value: unknown = await response.clone().json();
    if (!value || typeof value !== "object") return false;
    const payload = value as Record<string, unknown>;
    const codeValue =
      typeof payload.code === "string"
        ? payload.code
        : typeof payload.error === "string"
          ? payload.error
          : "";
    const code = codeValue.toLowerCase();
    const message =
      typeof payload.message === "string" ? payload.message.trim().toLowerCase() : "";
    return code === "not_found" && message === "object not found";
  } catch {
    return false;
  }
}

/** クラウドのスナップショットを取る。無ければ undefined */
export async function fetchSnapshot(
  cfg: SyncConfig,
  session: SyncSession,
  options: StorageRequestOptions = {}
): Promise<unknown | undefined> {
  const runtime = createRuntime(cfg);
  const fetchImpl = options.fetchImpl ?? fetch;
  const r = await fetchImpl(`${runtime.url}/storage/v1/object/${BUCKET}/${OBJECT}`, {
    headers: headers(runtime, session),
  });
  // 400全体を空扱いにはしない。Supabase固有の「Object not found」だけを
  // 初回状態として扱い、Bucket not found・RLS不備は詳細エラーへ進める。
  if (await isMissingSnapshot(r)) return undefined;
  if (!r.ok) throw await storageFailure(r, "読み取り");
  return r.json();
}

/** クラウドへ送る。上書きの可否は呼び出し側が判断済みである前提 */
export async function putSnapshot(
  cfg: SyncConfig,
  session: SyncSession,
  file: unknown,
  options: StorageRequestOptions = {}
): Promise<void> {
  const runtime = createRuntime(cfg);
  const fetchImpl = options.fetchImpl ?? fetch;
  const r = await fetchImpl(`${runtime.url}/storage/v1/object/${BUCKET}/${OBJECT}`, {
    method: "POST",
    headers: {
      ...headers(runtime, session),
      "Content-Type": "application/json",
      "x-upsert": "true",
    },
    body: JSON.stringify(file),
  });
  if (!r.ok) throw await storageFailure(r, "書き込み");
}
