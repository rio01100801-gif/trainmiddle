/**
 * next/link の差し替え（PWAビルド専用）
 *
 * app/ 配下の画面は Next.js と PWA の両方で使うので、
 * import は "next/link" のままにしてある。
 * PWAビルド（scripts/build-pwa.mjs）のときだけ、この実装に差し替える。
 *
 * ハッシュ遷移では href の先頭に "#" を付ける。
 * 静的配信（GitHub Pages）でサーバー側のルーティングを持てないため。
 */
import * as React from "react";

export default function Link({
  href,
  children,
  onClick,
  ...rest
}: {
  href: string;
  children?: React.ReactNode;
  onClick?: (e: any) => void;
} & Record<string, any>) {
  const hashNav = typeof globalThis !== "undefined" && (globalThis as any).__HASH_NAV__;
  return React.createElement(
    "a",
    { href: hashNav ? `#${href}` : href, onClick, ...rest },
    children
  );
}
