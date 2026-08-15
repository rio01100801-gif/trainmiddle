"use client";
import { useId } from "react";
import type { NextDayLegs, SkipReason, Subjective } from "@/lib/core/types";
import {
  RPE_BAND_COLORS,
  RPE_BAND_LABELS,
  painBand,
  painDescription,
  rpeLevel,
} from "@/lib/core/rpe";

/**
 * 入力の部品。
 *
 * 数値を打たせるのをやめた箇所で使う。
 * テンキーだと `77` のような打ち間違いがそのまま入り、RPEは設定ペースの補正に
 * 直接効くので静かにずれる。段階しか選べない形にすれば、そもそも起きない。
 *
 * 3つの決まりを全部に通す。
 *   1. **既定値を置かない**——未入力は未入力として見せる（forge-v86）
 *   2. **色だけに頼らない**——数字・呼び名・説明文を必ず一緒に出す
 *   3. **片手で押せる**——押せるものは最低44pt
 */

// ---------------------------------------------------------------------------
// 目盛りで止まるスライダー
// ---------------------------------------------------------------------------

export function SnapSlider({
  label,
  value,
  onChange,
  min,
  max,
  describe,
  emptyHint,
  testId,
}: {
  label: string;
  /** undefined = 未入力 */
  value?: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  /** その値の帯の呼び名・説明・色 */
  describe: (v: number) => { band: string; description: string; color: string };
  emptyHint: string;
  testId?: string;
}) {
  const id = useId();
  const filled = value !== undefined;
  /*
   * 未入力のときは真ん中に置く。
   * 端に置くと「1が選ばれている」ように見えて、既定値を置いたのと変わらなくなる。
   */
  const shown = filled ? value : Math.round((min + max) / 2);
  const d = filled ? describe(value) : undefined;

  return (
    <div className="w-full">
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <label htmlFor={id} className="metric-label">
          {label}
        </label>
        <span
          className="text-[11px] font-semibold"
          style={{ color: filled ? "var(--text-2)" : "var(--amber)" }}
        >
          {filled ? d!.band : "未入力"}
        </span>
      </div>

      <div className="flex items-baseline gap-1.5">
        <b
          className="num leading-none font-extrabold"
          style={{ fontSize: "1.75rem", color: filled ? d!.color : "var(--text-3)" }}
          data-testid={testId ? `${testId}-value` : undefined}
        >
          {filled ? value : "—"}
        </b>
        <span className="text-[11px]" style={{ color: "var(--text-3)" }}>
          / {max}
        </span>
      </div>

      {/*
        step=1 なので目盛りで止まるのは range の既定の挙動。
        指を離した位置がそのまま値になるのも同じ。自前で丸めない。
        キーボードは矢印・Home・End がそのまま効く。
      */}
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={1}
        value={shown}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
        aria-valuetext={filled ? `${value}。${d!.band}。${d!.description}` : "未入力"}
        className="w-full !p-0 !border-0 !bg-transparent"
        style={{ accentColor: filled ? d!.color : "var(--text-3)", minHeight: 44 }}
        data-testid={testId}
      />

      {/* どこで止まるのかを目で分かるようにする */}
      <div className="relative h-4" aria-hidden="true">
        {Array.from({ length: max - min + 1 }, (_, i) => {
          const v = min + i;
          return (
            <span
              key={v}
              className="absolute top-0 w-px h-1.5"
              style={{
                left: `${((v - min) / (max - min)) * 100}%`,
                background: filled && v <= value ? d!.color : "var(--border-2)",
              }}
            />
          );
        })}
        <span className="absolute top-1.5 left-0 text-[9px]" style={{ color: "var(--text-3)" }}>
          {min}
        </span>
        <span className="absolute top-1.5 right-0 text-[9px]" style={{ color: "var(--text-3)" }}>
          {max}
        </span>
      </div>

      {/*
        動かしている間ずっと更新される。
        role="status" にして、読み上げでも変化が届くようにする。
      */}
      <p
        className="text-[11.5px] leading-relaxed mt-1"
        style={{ color: filled ? "var(--text)" : "var(--text-3)" }}
        data-testid={testId ? `${testId}-description` : undefined}
        role="status"
      >
        {filled ? d!.description : emptyHint}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 選択チップ
// ---------------------------------------------------------------------------

/**
 * select をやめた箇所で使う。
 *
 * select は「開く → 選ぶ → 閉じる」で3タップかかる。
 * 選択肢が3〜6個ならチップのほうが1タップで済む。
 */
export function ChipGroup<T extends string>({
  label,
  value,
  onChange,
  options,
  allowEmpty,
  emptyLabel = "未入力",
  columns,
  testId,
}: {
  label: string;
  value?: T;
  onChange: (v: T | undefined) => void;
  options: { value: T; label: string; color?: string }[];
  /** true = もう一度押すと未入力に戻せる */
  allowEmpty?: boolean;
  emptyLabel?: string;
  columns?: number;
  testId?: string;
}) {
  const cols = columns ?? Math.min(options.length, 4);
  return (
    <div className="w-full" data-testid={testId}>
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <span className="metric-label">{label}</span>
        {allowEmpty && value === undefined ? (
          <span className="text-[11px] font-semibold" style={{ color: "var(--amber)" }}>
            {emptyLabel}
          </span>
        ) : null}
      </div>
      <div
        role="group"
        aria-label={label}
        className="grid gap-1.5"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {options.map((o) => {
          const on = value === o.value;
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={on}
              aria-label={`${label} ${o.label}`}
              onClick={() => onChange(allowEmpty && on ? undefined : o.value)}
              className="rounded-lg border text-[12.5px] font-semibold min-h-[44px] px-1"
              style={{
                background: on ? (o.color ?? "var(--volt)") : "var(--surface-2)",
                borderColor: on ? "transparent" : "var(--border-2)",
                color: on ? "var(--volt-ink)" : "var(--text-2)",
              }}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ステッパー
// ---------------------------------------------------------------------------

/**
 * 数を1つずつ動かす。
 *
 * 本数やレストのように「だいたい決まっていて、1つ足す・引く」が多い欄に使う。
 * **入力欄は残す**——ステッパーだけにすると、20本を入れるのに20回押すことになる。
 */
export function Stepper({
  label,
  value,
  onChange,
  min = 0,
  max = 9999,
  step = 1,
  unit,
  inputMode = "numeric",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  inputMode?: "numeric" | "decimal";
}) {
  const id = useId();
  const bump = (delta: number) => {
    const n = Number(value);
    const base = Number.isFinite(n) && value.trim() !== "" ? n : min;
    onChange(String(Math.min(max, Math.max(min, base + delta))));
  };
  return (
    <div className="w-full">
      <label htmlFor={id} className="metric-label block mb-1">
        {label}
        {unit ? <span style={{ color: "var(--text-3)" }}>（{unit}）</span> : null}
      </label>
      <div className="flex items-stretch gap-1">
        <button
          type="button"
          aria-label={`${label} を ${step} 減らす`}
          onClick={() => bump(-step)}
          className="btn-ghost !px-0 min-h-[44px] flex-shrink-0"
          style={{ width: 44 }}
        >
          −
        </button>
        <input
          id={id}
          className="flex-1 min-w-0 text-center min-h-[44px]"
          value={value}
          inputMode={inputMode}
          aria-label={label}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          aria-label={`${label} を ${step} 増やす`}
          onClick={() => bump(step)}
          className="btn-ghost !px-0 min-h-[44px] flex-shrink-0"
          style={{ width: 44 }}
        >
          ＋
        </button>
      </div>
    </div>
  );
}

/**
 * 選択肢の表。**画面ごとに文言を書かない。**
 * 結果入力とセッション実行で「楽／余裕」のように言葉が違うと、
 * 同じ値を選んだつもりで別のものを選んでいないか毎回確かめることになる。
 */
export const SUBJECTIVE_OPTIONS: { value: Subjective; label: string }[] = [
  { value: "easy", label: "余裕" },
  { value: "moderate", label: "普通" },
  { value: "hard", label: "きつい" },
  { value: "very_hard", label: "非常に" },
];

export const LEGS_OPTIONS: { value: NextDayLegs; label: string }[] = [
  { value: "fresh", label: "軽い" },
  { value: "normal", label: "普通" },
  { value: "heavy", label: "重い" },
];

export const SKIP_OPTIONS: { value: SkipReason; label: string }[] = [
  { value: "fatigue", label: "疲労" },
  { value: "red_signal", label: "赤信号" },
  { value: "injury", label: "故障" },
  { value: "schedule", label: "予定" },
  { value: "weather", label: "天候" },
  { value: "other", label: "その他" },
];

export const WIND_OPTIONS: { value: "calm" | "light" | "strong"; label: string }[] = [
  { value: "calm", label: "無風" },
  { value: "light", label: "弱い" },
  { value: "strong", label: "強い" },
];

/** スライダーに渡す説明。core の表をそのまま引く（画面で書き換えない） */
export function describeRpe(v: number) {
  const level = rpeLevel(v);
  return {
    band: level ? RPE_BAND_LABELS[level.band] : "",
    description: level ? level.description : "",
    color: level ? RPE_BAND_COLORS[level.band] : "var(--text-3)",
  };
}

export function describePain(v: number) {
  const band = painBand(v);
  return {
    band: v === 0 ? "なし" : RPE_BAND_LABELS[band],
    description: painDescription(v),
    color: v === 0 ? "var(--text-3)" : RPE_BAND_COLORS[band],
  };
}

/**
 * 故障の部位。
 *
 * 自由記述だと「右アキレス」「右アキレス腱」「Rアキレス」が別物として溜まり、
 * 同じ場所を繰り返し痛めているのかが後から分からない。
 * よく使う場所だけチップにして、一覧に無い場所は自由記述に残す。
 */
export const BODY_PARTS = [
  "右アキレス腱",
  "左アキレス腱",
  "右ふくらはぎ",
  "左ふくらはぎ",
  "右ハムストリング",
  "左ハムストリング",
  "右膝",
  "左膝",
  "腰",
  "右足底",
  "左足底",
  "すね（右）",
  "すね（左）",
];

export const BODY_PART_OPTIONS = BODY_PARTS.map((v) => ({ value: v, label: v }));

export const INJURY_STATUS_OPTIONS: {
  value: "onset" | "ongoing" | "recovered";
  label: string;
}[] = [
  { value: "onset", label: "発生" },
  { value: "ongoing", label: "継続" },
  { value: "recovered", label: "回復" },
];

export const REST_TYPE_OPTIONS: { value: "jog" | "walk" | "full"; label: string }[] = [
  { value: "jog", label: "ジョグ" },
  { value: "walk", label: "ウォーク" },
  { value: "full", label: "完全休息" },
];

export const REST_MODE_OPTIONS: { value: "time" | "distance"; label: string }[] = [
  { value: "time", label: "時間(秒)" },
  { value: "distance", label: "距離(m)" },
];
