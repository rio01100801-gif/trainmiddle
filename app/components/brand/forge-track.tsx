"use client";
import { useId } from "react";

/**
 * FORGE の光るトラック。
 *
 * リファレンス（reference-ui）の「発光する2周トラック」を、細い光の弧の重なりとして描く。
 * アプリアイコンのような写実的な光跡（アスファルトの粒状感・強いブルーム）は
 * カード内では使わない——リファレンスのカード内トラックは、質感のある写真ではなく
 * 細く分離した光の線で構成されており、写実素材を敷くと文字が読めなくなる。
 * 写実素材はアイコン・スプラッシュ側で使う。
 *
 * 形はオーバル（400mトラック）のカーブを回り込む部分。左から入って右端で折り返し、
 * 下へ抜ける。左側は消えていくので、文字を置く領域を邪魔しない。
 *
 * 親要素に `position: relative` と `overflow: hidden` が必要。
 */
export type ForgeTrackVariant = "card";

/*
 * パスは 0..212 の座標系で引いてあるが、線が実際にあるのは下側だけ。
 * 全体を表示すると上半分が空き、帯に押し込むと縦に潰れて弧に見えなくなる。
 * 線のある範囲だけを切り出して、ほぼ等倍で見せる。
 */
const VIEWBOX = "0 130 358 82";

export function ForgeTrack({
  variant = "card",
  className,
}: {
  variant?: ForgeTrackVariant;
  className?: string;
}) {
  /*
   * gradient / filter の id はインスタンスごとに一意にする。
   * 同じ画面に2つ置いたとき、id が衝突すると片方の参照が壊れる。
   */
  const uid = useId().replace(/:/g, "");
  const grad = `ft-g-${uid}`;
  const blur = `ft-b-${uid}`;

  if (variant !== "card") return null;

  /*
   * レーンは6本。うち2本（core / inner）だけを明るくし、残りは細く落とす。
   * 全部を同じ明るさにすると、光の帯ではなく塗りに見える。
   */
  const LANES = [
    { d: "M6,158 C90,157 156,154 214,148", w: 0.8, o: 0.3 },
    { d: "M16,150 C144,141 266,124 328,154 C358,169 354,203 308,212", w: 0.9, o: 0.42 },
    { d: "M14,162 C142,153 264,138 322,164 C356,180 350,206 300,212", w: 1.9, o: 1 },
    { d: "M22,176 C150,167 272,152 332,177 C358,188 355,206 322,212", w: 0.9, o: 0.48 },
    { d: "M32,190 C160,182 280,168 342,190 C360,199 358,207 344,212", w: 2.4, o: 1 },
    { d: "M46,204 C174,197 292,186 352,204", w: 1, o: 0.4 },
  ];
  /** 明るい2本にだけ、ぼかした太い複製を敷いて発光させる */
  const GLOW = [LANES[2].d, LANES[4].d];

  return (
    <svg
      className={className}
      viewBox={VIEWBOX}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
    >
      <defs>
        {/* 左（文字側）で消え、右（折り返し）に向かって白熱する */}
        <linearGradient id={grad} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#b6ff00" stopOpacity="0" />
          <stop offset=".26" stopColor="#b6ff00" stopOpacity=".22" />
          <stop offset=".64" stopColor="#c8ff3c" stopOpacity=".85" />
          <stop offset="1" stopColor="#f0ffbe" stopOpacity="1" />
        </linearGradient>
        <filter id={blur} x="-15%" y="-30%" width="130%" height="170%">
          <feGaussianBlur stdDeviation="4.2" />
        </filter>
      </defs>

      <g fill="none" stroke={`url(#${grad})`} filter={`url(#${blur})`} opacity=".45">
        {GLOW.map((d, i) => (
          <path key={i} d={d} strokeWidth="6" />
        ))}
      </g>
      <g fill="none" stroke={`url(#${grad})`} strokeLinecap="round">
        {LANES.map((l, i) => (
          <path key={i} d={l.d} strokeWidth={l.w} opacity={l.o} />
        ))}
      </g>
    </svg>
  );
}
