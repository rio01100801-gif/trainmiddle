/**
 * 相談（AI）— Anthropic APIとの通信（薄い層）
 *
 * `supabase.ts` と同じ方針で、SDKを入れずRESTを直接叩く。理由も同じ。
 *   ・PWAのバンドルに数百KBのSDKを入れたくない（起動時間に直接効く。`ci:perf-budget` が見張っている）
 *   ・使うのは `POST /v1/messages` 1本だけで、SDKの大半が要らない
 *
 * **APIキーは端末の localStorage に置く。リポジトリには絶対に置かない。**
 * このキーは公開前提ではない（Supabaseのanon keyとは性質が違う）。
 * 端末に置くのは、この端末を使うのが本人1人であることが前提。
 *
 * **ここは通信だけを担当する。** 送る中身の組み立ては
 * `src/lib/core/assistantContext.ts` にあり、そちらは純関数でテスト済み。
 * 応答は文章として画面に出すだけで、CFEや設定ペースへ書き戻す経路は用意しない。
 */

const KEY_STORAGE = "forge:assistant:key";
const CONSENT_STORAGE = "forge:assistant:consent";

/**
 * 使うモデル。
 *
 * Opus 5 は思考が既定で入るので、`max_tokens` は思考と本文の合計にかかる。
 * effort を low にしているのは、渡す文脈が構造化済みで探索の余地が小さく、
 * 端末で待たされる時間のほうが体感に効くため。
 */
export const ASSISTANT_MODEL = "claude-opus-5";
export const ASSISTANT_API_URL = "https://api.anthropic.com/v1/messages";
export const ASSISTANT_API_VERSION = "2023-06-01";
export const ASSISTANT_MAX_TOKENS = 8000;
/** 応答を待つ上限。思考ぶんがあるので通信のタイムアウトより長く取る */
export const ASSISTANT_TIMEOUT_MS = 120_000;

type KeyStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function browserStorage(storage?: KeyStorage): KeyStorage {
  if (storage) return storage;
  if (typeof localStorage === "undefined") {
    throw new Error("この実行環境ではlocalStorageを利用できません。");
  }
  return localStorage;
}

/**
 * 見た目だけ確かめる。ここで通っても実際に使えるかは送ってみないと分からない。
 * 弾くのは「明らかに別のものを貼った」場合だけにする。
 */
export function validateApiKey(key: string): string | undefined {
  const trimmed = key.trim();
  if (!trimmed) return "APIキーを入力してください。";
  if (/\s/.test(trimmed)) return "APIキーに空白が含まれています。前後の余分な文字を取り除いてください。";
  if (!trimmed.startsWith("sk-ant-")) {
    return "AnthropicのAPIキーは sk-ant- で始まります。console.anthropic.com で発行したキーを貼り付けてください。";
  }
  if (trimmed.length < 20) return "APIキーが短すぎます。全体をコピーできているか確認してください。";
  return undefined;
}

export function getApiKey(storage?: KeyStorage): string | undefined {
  const raw = browserStorage(storage).getItem(KEY_STORAGE);
  return raw ? raw : undefined;
}

export function saveApiKey(key: string, storage?: KeyStorage): void {
  const trimmed = key.trim();
  const error = validateApiKey(trimmed);
  if (error) throw new Error(error);
  const target = browserStorage(storage);
  target.setItem(KEY_STORAGE, trimmed);
  if (target.getItem(KEY_STORAGE) !== trimmed) {
    throw new Error("APIキーを端末へ保存できませんでした。");
  }
}

export function clearApiKey(storage?: KeyStorage): void {
  browserStorage(storage).removeItem(KEY_STORAGE);
}

/**
 * 練習データを端末の外へ出すことへの同意。
 *
 * 鍵を入れたことと、データが外へ出ることを分けて確認する。
 * 鍵の設定は「使えるようにする」操作でしかなく、
 * **何が出ていくか**を本人が把握したこととは別だから。
 * 同意が無い間は1文字も送らない。
 */
export function getConsent(storage?: KeyStorage): boolean {
  return browserStorage(storage).getItem(CONSENT_STORAGE) === "yes";
}

export function saveConsent(agreed: boolean, storage?: KeyStorage): void {
  const target = browserStorage(storage);
  if (agreed) target.setItem(CONSENT_STORAGE, "yes");
  else target.removeItem(CONSENT_STORAGE);
}

/** 画面に出してよい形。頭と尻だけ見せて、途中は伏せる */
export function maskApiKey(key: string): string {
  if (key.length <= 14) return "sk-ant-…";
  return `${key.slice(0, 11)}…${key.slice(-4)}`;
}

export type AssistantFailureKind =
  | "no-key"
  | "offline"
  | "timeout"
  | "key"
  | "rate-limit"
  | "cors"
  | "http"
  | "refusal"
  | "response";

export type AssistantAnswer =
  | { ok: true; text: string; truncated: boolean }
  | { ok: false; kind: AssistantFailureKind; message: string; status?: number };

export interface AskOptions {
  apiKey: string;
  system: string;
  user: string;
  /**
   * 添える画像（写真からの転記）。
   * 本文より前に置く。画像を先に見せてから指示を読ませるほうが読み取りが安定する。
   */
  image?: { mediaType: string; base64: string };
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  online?: boolean;
}

function isAbortError(error: unknown): boolean {
  return !!error && typeof error === "object" && "name" in error && error.name === "AbortError";
}

interface MessagesResponse {
  content?: { type?: unknown; text?: unknown }[];
  stop_reason?: unknown;
  stop_details?: { explanation?: unknown } | null;
}

/**
 * 質問を1回送って答えを受け取る。会話は続けない（v1）。
 *
 * 失敗は必ず `kind` で区別する。「エラーが出ました」だけだと、
 * 通信が悪いのか鍵が悪いのか本人が切り分けられず、直しようがない。
 */
export async function askAssistant(options: AskOptions): Promise<AssistantAnswer> {
  const { apiKey, system, user } = options;
  if (!apiKey) {
    return { ok: false, kind: "no-key", message: "APIキーが設定されていません。" };
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? ASSISTANT_TIMEOUT_MS;
  const online =
    options.online ??
    (options.fetchImpl ? true : typeof navigator === "undefined" ? true : navigator.onLine);

  if (!online) {
    return {
      ok: false,
      kind: "offline",
      message: "オフラインです。相談は通信が要ります。通信が戻ってから試してください。",
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetchImpl(ASSISTANT_API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ASSISTANT_API_VERSION,
        // ブラウザから直接叩くために必要。サーバを持たない配信（GitHub Pages）なので他に経路が無い
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: ASSISTANT_MODEL,
        max_tokens: ASSISTANT_MAX_TOKENS,
        output_config: { effort: "low" },
        system,
        messages: [
          {
            role: "user",
            content: options.image
              ? [
                  {
                    type: "image",
                    source: {
                      type: "base64",
                      media_type: options.image.mediaType,
                      data: options.image.base64,
                    },
                  },
                  { type: "text", text: user },
                ]
              : user,
          },
        ],
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if (isAbortError(error)) {
      return {
        ok: false,
        kind: "timeout",
        message: `${Math.round(timeoutMs / 1000)}秒待っても応答がありませんでした。通信を確認してもう一度試してください。`,
      };
    }
    return {
      ok: false,
      kind: "cors",
      message:
        "Anthropicへ接続できませんでした。通信状況を確認してください。回線が生きている場合は、ブラウザが応答を読めていない可能性があります（Safariの通信制限）。",
    };
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 401 || response.status === 403) {
    return {
      ok: false,
      kind: "key",
      message: `APIキーが拒否されました（HTTP ${response.status}）。console.anthropic.com でキーが有効か、残高があるかを確認してください。`,
      status: response.status,
    };
  }
  if (response.status === 429) {
    return {
      ok: false,
      kind: "rate-limit",
      message: "短時間に送りすぎました。少し待ってからもう一度試してください。",
      status: 429,
    };
  }
  if (!response.ok) {
    return {
      ok: false,
      kind: "http",
      message: `AnthropicがHTTP ${response.status}を返しました。時間を置いて試してください。`,
      status: response.status,
    };
  }

  let payload: MessagesResponse;
  try {
    payload = (await response.json()) as MessagesResponse;
  } catch {
    return { ok: false, kind: "response", message: "応答を読み取れませんでした。" };
  }

  /*
   * 内容を読む前に stop_reason を見る。
   * 断られた場合 content は空か途中までで、そのまま出すと
   * 「短い答えが返ってきた」ようにしか見えない。
   */
  if (payload.stop_reason === "refusal") {
    const detail =
      payload.stop_details && typeof payload.stop_details.explanation === "string"
        ? `（${payload.stop_details.explanation}）`
        : "";
    return {
      ok: false,
      kind: "refusal",
      message: `この質問には答えられないと判断されました${detail}。質問の言い方を変えて試してください。`,
    };
  }

  const text = (payload.content ?? [])
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("")
    .trim();

  if (!text) {
    return {
      ok: false,
      kind: "response",
      message: "答えが空で返ってきました。もう一度試してください。",
    };
  }

  // 途中で切れたことは黙って隠さない。切れた答えを完成品として読むと判断を誤る
  return { ok: true, text, truncated: payload.stop_reason === "max_tokens" };
}
