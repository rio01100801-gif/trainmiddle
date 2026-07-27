"use client";
import { useSyncExternalStore } from "react";

/**
 * Next.js版とPWA版（ハッシュルーティング）の両方で使えるクエリ取得。
 *
 * PWA では URL が "#/results?date=2026-07-20" の形になるため、
 * location.search には何も入らない。ハッシュ側から読む必要がある。
 * 画面コンポーネントは両方で共通なので、この差をここだけに閉じ込める。
 */
function isHashNav(): boolean {
  const navigationGlobal = globalThis as typeof globalThis & { __HASH_NAV__?: boolean };
  return navigationGlobal.__HASH_NAV__ === true;
}

export function currentQuery(): URLSearchParams {
  if (typeof location === "undefined") return new URLSearchParams();
  if (isHashNav()) {
    const h = location.hash.replace(/^#/, "");
    const i = h.indexOf("?");
    return new URLSearchParams(i >= 0 ? h.slice(i + 1) : "");
  }
  return new URLSearchParams(location.search);
}

export function useQueryParam(key: string): string | null {
  const get = () => currentQuery().get(key);
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener("hashchange", cb);
      window.addEventListener("popstate", cb);
      return () => {
        window.removeEventListener("hashchange", cb);
        window.removeEventListener("popstate", cb);
      };
    },
    get,
    () => null
  );
}

/** リンク先を組み立てる（PWAでもNextでも同じ書き方でよいようにする） */
export function withQuery(path: string, params: Record<string, string | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) q.set(k, v);
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}
