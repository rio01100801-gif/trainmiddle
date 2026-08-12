"use client";

/**
 * FORGE ワードマーク。
 *
 * アプリアイコンと同じ字形を資産化したもの。普通のテキストでは
 * この角落としの字形にならない（指示書でも「斜体テキストを最終実装にしないこと」）。
 *
 * 実体は**色を持った透過PNG**。以前はCSSの mask にして currentColor で塗っていたが、
 * 今のロゴは緑の縦線がロゴの一部なので、マスクにすると緑が白に潰れる。
 * そのため色は変えられない。変えたくなったら画像を分けること。
 *
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
  // 原本の縦横比（切り出し 1124 x 918）。
  // 字形を差し替えたときはここも直す。放置すると縦に潰れる。
  //   1120x205（比5.46）→ 1012x366（比2.77）→ 1124x918（比1.22）
  const height = Math.round(width * (918 / 1124));
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
