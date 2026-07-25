/**
 * next/navigation の差し替え（PWAビルド専用）。詳細は link.tsx を参照。
 *
 * usePathname はクエリを落としたパスだけを返す。
 * "#/run?sessionId=..." のようにクエリが付くので、
 * これを落とさないと画面ごとの出し分け（FABの非表示など）が効かない。
 */
import * as React from "react";

function getPath(): string {
  if (typeof location === "undefined") return "/";
  if ((globalThis as any).__HASH_NAV__) {
    const h = location.hash.replace(/^#/, "").split("?")[0];
    return h === "" ? "/" : h;
  }
  return (globalThis as any).__PATH__ ?? "/";
}

export function usePathname(): string {
  return React.useSyncExternalStore(
    (cb) => {
      if (typeof window === "undefined" || !(globalThis as any).__HASH_NAV__) return () => {};
      window.addEventListener("hashchange", cb);
      return () => window.removeEventListener("hashchange", cb);
    },
    getPath,
    getPath
  );
}

export function useRouter() {
  return {
    push(href: string) {
      location.hash = href;
    },
    replace(href: string) {
      location.replace(`#${href}`);
    },
    back() {
      history.back();
    },
  };
}
