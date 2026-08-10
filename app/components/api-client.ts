import type { ApiErrorResponse } from "@/lib/core/apiError";

export interface ApiRequestOptions {
  fetchImpl?: typeof fetch;
}

function apiError(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const error = (payload as Partial<ApiErrorResponse>).error;
  return typeof error === "string" && error.trim() ? error.trim() : undefined;
}

/**
 * fetchはHTTP 400/500でもrejectしないため、変更系操作はHTTP状態と
 * `{ error }` の両方を確認してから成功UIへ進む。
 */
export async function apiRequest<T = unknown>(
  input: RequestInfo | URL,
  init?: RequestInit,
  options: ApiRequestOptions = {}
): Promise<T> {
  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(input, init);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`通信できませんでした: ${detail}`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    if (!response.ok) throw new Error(`保存できませんでした（HTTP ${response.status}）`);
    throw new Error("サーバーの応答を確認できませんでした。再読み込みして確認してください。");
  }

  const detail = apiError(payload);
  if (!response.ok || detail) {
    throw new Error(detail ?? `保存できませんでした（HTTP ${response.status}）`);
  }
  return payload as T;
}
