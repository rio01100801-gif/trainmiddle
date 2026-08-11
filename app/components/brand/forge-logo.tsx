"use client";

/**
 * FORGE ワードマーク。
 *
 * リファレンス（reference-ui/00-app-icon.jpeg）の字形をそのまま資産化したもの。
 * 斜体をかけた普通のテキストでは、あの幅広・角落としの字形にならない
 * （指示書でも「斜体テキストを最終実装にしないこと」と明示されている）。
 *
 * 実体はCSSの mask なので色は currentColor に従う。画像そのものを貼っていないのは、
 * 白以外（緑・半透明）で置きたい箇所があるため。
 * 画像パスは globals.css 側で解決する——Next.js と PWA でURLの基準が違うので、
 * CSSの url() に寄せると両方で正しく解決される（JS側でパスを組み立てない）。
 */
export function ForgeLogo({
  width = 200,
  className,
  title = "FORGE",
}: {
  width?: number;
  className?: string;
  /** 読み上げ用。装飾として置く場合は空文字にする */
  title?: string;
}) {
  // 原本の縦横比（切り出し 1012 x 366）。
  // 字形を差し替えたときはここも直す——旧ロゴは 1120 x 205 で、
  // 比が 5.46 から 2.77 に変わっている。放置すると縦に潰れる。
  const height = Math.round(width * (366 / 1012));
  return (
    <span
      className={`forge-wordmark${className ? ` ${className}` : ""}`}
      style={{ width, height }}
      role={title ? "img" : undefined}
      aria-label={title || undefined}
      aria-hidden={title ? undefined : true}
    />
  );
}
