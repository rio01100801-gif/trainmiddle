"use client";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import type { RuleViolation, SessionCategory, SessionChange } from "@/lib/core/types";

// ---------------------------------------------------------------------------
// カテゴリ表現
// 予定表のチップは「文字（頭文字）」を主エンコードにしている。
// 色は補助であり、色だけで意味が決まらないようにする。
// ---------------------------------------------------------------------------

export const CATEGORY_COLORS: Record<SessionCategory, string> = {
  race_economy: "var(--cat-race-economy)",
  high_lactate: "var(--cat-high-lactate)",
  cv: "var(--cat-cv)",
  threshold: "var(--cat-threshold)",
  neural: "var(--cat-neural)",
  aerobic: "var(--cat-aerobic)",
  modeling: "var(--cat-modeling)",
  off: "var(--cat-off)",
};

export const CATEGORY_LABELS: Record<SessionCategory, string> = {
  high_lactate: "高乳酸",
  race_economy: "経済走",
  modeling: "モデリング",
  neural: "神経系",
  cv: "CV",
  threshold: "閾値",
  aerobic: "有酸素",
  off: "休養",
};

export const CATEGORY_INITIALS: Record<SessionCategory, string> = {
  high_lactate: "H",
  race_economy: "R",
  modeling: "M",
  neural: "N",
  cv: "C",
  threshold: "T",
  aerobic: "A",
  off: "OFF",
};

const QUALITY: SessionCategory[] = [
  "high_lactate",
  "race_economy",
  "modeling",
  "cv",
  "threshold",
];

export function CategoryBadge({ category }: { category: SessionCategory }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium whitespace-nowrap">
      <span
        className="inline-block w-2 h-2 rounded-full flex-shrink-0"
        style={{ background: CATEGORY_COLORS[category] }}
      />
      {CATEGORY_LABELS[category]}
    </span>
  );
}

/** 曜日チップ。文字が主エンコード、今日はボルトで塗る */
export function DayRing({
  category,
  today = false,
  size = 34,
}: {
  category: SessionCategory;
  today?: boolean;
  size?: number;
}) {
  const isQ = QUALITY.includes(category);
  const isOff = category === "off";
  return (
    <span
      className="rounded-full flex items-center justify-center mx-auto font-extrabold"
      style={{
        width: size,
        height: size,
        fontSize: isOff ? size * 0.28 : size * 0.37,
        border: `1.6px ${isOff ? "dashed" : "solid"} ${
          today ? "var(--volt)" : isQ ? "var(--text-2)" : "var(--border-2)"
        }`,
        background: today ? "var(--volt)" : "transparent",
        color: today
          ? "var(--volt-ink)"
          : isOff
            ? "var(--text-3)"
            : isQ
              ? "var(--text)"
              : "var(--text-2)",
      }}
    >
      {CATEGORY_INITIALS[category]}
    </span>
  );
}

// ---------------------------------------------------------------------------

export function Card({
  title,
  right,
  children,
  className = "",
  pad,
}: {
  title?: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  pad?: number;
}) {
  return (
    <section className={`card ${className}`} style={pad ? { padding: pad } : undefined}>
      {title ? (
        <div className="card-t justify-between">
          <span>{title}</span>
          {right}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function Stat({
  label,
  value,
  unit,
  sub,
  color,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  sub?: ReactNode;
  color?: string;
}) {
  return (
    <div className="card" style={{ padding: 13 }}>
      <div className="card-t" style={{ marginBottom: 6 }}>
        {label}
      </div>
      <div className="flex items-baseline gap-1.5">
        <div className="num font-extrabold text-[26px]" style={{ color: color ?? "var(--text)" }}>
          {value}
        </div>
        {unit ? (
          <div className="text-[13px] font-semibold" style={{ color: "var(--text-2)" }}>
            {unit}
          </div>
        ) : null}
      </div>
      {sub ? (
        <div className="text-[9.5px] mt-1" style={{ color: "var(--text-3)" }}>
          {sub}
        </div>
      ) : null}
    </div>
  );
}

export function Bars({ filled, total }: { filled: number; total: number }) {
  return (
    <div className="flex gap-[2.5px] mt-2">
      {Array.from({ length: total }).map((_, i) => (
        <i
          key={i}
          className="h-[5px] flex-1 rounded-sm"
          style={{ background: i < filled ? "var(--volt)" : "var(--border-2)" }}
        />
      ))}
    </div>
  );
}

/** 単一系列のスパークライン。系列が1本なので凡例は置かない（タイトルが系列名を兼ねる） */
export function Sparkline({
  values,
  color = "var(--volt)",
  height = 40,
  labels,
  yFmt,
}: {
  values: number[];
  color?: string;
  height?: number;
  labels?: string[];
  yFmt?: (v: number) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  if (values.length === 0) {
    return (
      <p className="text-[11px]" style={{ color: "var(--text-3)" }}>
        データがありません
      </p>
    );
  }
  const w = 300;
  const padL = yFmt ? 30 : 4;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const px = (i: number) =>
    padL + (values.length === 1 ? 0 : (i / (values.length - 1)) * (w - padL - 6));
  const py = (v: number) => height - 8 - ((v - min) / range) * (height - 18);
  const d = values.map((v, i) => `${i === 0 ? "M" : "L"}${px(i)},${py(v)}`).join(" ");

  return (
    <div>
      <svg
        viewBox={`0 0 ${w} ${height}`}
        style={{ width: "100%", height }}
        onMouseLeave={() => setHover(null)}
      >
        {yFmt ? (
          <>
            <line x1={padL - 4} y1={py(max)} x2={w} y2={py(max)} stroke="var(--border)" />
            <line x1={padL - 4} y1={py(min)} x2={w} y2={py(min)} stroke="var(--border)" />
            <text x="0" y={py(max) + 3} fill="var(--text-3)" fontSize="8">
              {yFmt(max)}
            </text>
            <text x="0" y={py(min) + 3} fill="var(--text-3)" fontSize="8">
              {yFmt(min)}
            </text>
          </>
        ) : null}
        <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={px(values.length - 1)} cy={py(values[values.length - 1])} r={3.4} fill={color} stroke="var(--surface)" strokeWidth={2} />
        {values.map((v, i) => (
          <g key={i}>
            <rect
              x={px(i) - 7}
              y={0}
              width={14}
              height={height}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
            />
            {hover === i ? (
              <>
                <circle cx={px(i)} cy={py(v)} r={4} fill={color} stroke="var(--surface)" strokeWidth={2} />
                <text
                  x={Math.min(Math.max(px(i), 34), w - 34)}
                  y={9}
                  fontSize="9"
                  textAnchor="middle"
                  fill="var(--text)"
                >
                  {labels?.[i] ? `${labels[i]} ` : ""}
                  {yFmt ? yFmt(v) : v.toFixed(1)}
                </text>
              </>
            ) : null}
          </g>
        ))}
      </svg>
      {labels && labels.length > 1 ? (
        <div
          className="flex justify-between text-[8.5px]"
          style={{ color: "var(--text-3)", paddingLeft: padL }}
        >
          <span>{labels[0]}</span>
          <span>{labels[labels.length - 1]}</span>
        </div>
      ) : null}
    </div>
  );
}

/** 準備度ゲージ */
export function Gauge({ score, size = 118 }: { score: number; size?: number }) {
  const r = 41;
  const circ = 2 * Math.PI * r;
  const on = (score / 100) * circ;
  const color =
    score >= 75 ? "var(--volt)" : score >= 50 ? "var(--amber)" : "var(--red)";
  return (
    <svg viewBox="0 0 100 100" style={{ width: size, height: size }}>
      <circle cx="50" cy="50" r={r} fill="none" stroke="var(--border)" strokeWidth="9" />
      <circle
        cx="50"
        cy="50"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="9"
        strokeDasharray={`${on} ${circ}`}
        strokeLinecap="round"
        transform="rotate(-90 50 50)"
      />
      <text x="50" y="56" textAnchor="middle" fill="var(--text)" fontSize="25" fontWeight="800">
        {Math.round(score)}
      </text>
      <text x="50" y="69" textAnchor="middle" fill="var(--text-2)" fontSize="10">
        / 100
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------

const LEVEL: Record<string, { color: string; icon: string }> = {
  ERROR: { color: "var(--red)", icon: "⛔" },
  WARN: { color: "var(--amber)", icon: "⚠" },
  INFO: { color: "var(--cat-race-economy)", icon: "ℹ" },
};

export function ViolationList({
  violations,
  compact = false,
}: {
  violations: RuleViolation[];
  compact?: boolean;
}) {
  if (!violations || violations.length === 0) {
    return (
      <p className="text-[12px]" style={{ color: "var(--volt)" }}>
        ✓ ルール違反はありません
      </p>
    );
  }
  const list = compact ? violations.slice(0, 3) : violations;
  return (
    <ul className="space-y-2">
      {list.map((v, i) => (
        <li
          key={i}
          className="text-[12px] border-l-2 pl-2.5"
          style={{ borderColor: LEVEL[v.level].color }}
        >
          <span
            className="font-mono text-[10px] mr-1 font-bold"
            style={{ color: LEVEL[v.level].color }}
          >
            {LEVEL[v.level].icon} {v.level} {v.rule}
            {v.unavoidable ? "（回避不能）" : ""}
          </span>
          <div style={{ color: "var(--text)", lineHeight: 1.65, overflowWrap: "anywhere" }}>
            {v.message}
          </div>
          {v.suggestion ? (
            <div className="text-[11px] mt-0.5" style={{ color: "var(--text-2)", lineHeight: 1.6 }}>
              → {v.suggestion}
            </div>
          ) : null}
        </li>
      ))}
      {compact && violations.length > 3 ? (
        <li className="text-[11px]" style={{ color: "var(--text-3)" }}>
          ほか {violations.length - 3} 件
        </li>
      ) : null}
    </ul>
  );
}

/**
 * 変更差分の提示（仕様書 4-5-9）。
 * 数値を黙って書き換えないこと、および「変更を却下」できることが必須要件。
 * 却下時は理由を記録し、後から追跡できるようにする。
 */
export function ChangeList({ changes }: { changes: SessionChange[] }) {
  const [state, setState] = useState<Record<number, "accepted" | "rejected">>({});
  const [rejecting, setRejecting] = useState<number | null>(null);
  const [reason, setReason] = useState("");

  if (!changes || changes.length === 0) return null;

  const send = async (i: number, accepted: boolean, rejectReason?: string) => {
    setState((s) => ({ ...s, [i]: accepted ? "accepted" : "rejected" }));
    setRejecting(null);
    setReason("");
    try {
      await fetch("/api/changes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ change: changes[i], accepted, rejectReason }),
      });
    } catch {
      /* ローカル記録のみ失敗。UI状態は維持する */
    }
  };

  return (
    <div className="mt-2">
      <h3 className="text-[12px] font-bold mb-1.5">変更差分（変更前 → 変更後）</h3>
      <ul className="space-y-1.5">
        {changes.map((c, i) => (
          <li
            key={i}
            className="text-[11px] rounded-lg p-2.5 border"
            style={{
              background: "var(--surface-2)",
              borderColor: state[i] === "rejected" ? "var(--border-2)" : "var(--border)",
              opacity: state[i] === "rejected" ? 0.55 : 1,
            }}
          >
            <span className="font-mono font-bold" style={{ color: "var(--volt)" }}>
              [{c.triggeredBy}]
            </span>{" "}
            <span style={{ color: "var(--text-2)" }}>{String(c.before)}</span> →{" "}
            <b style={{ textDecoration: state[i] === "rejected" ? "line-through" : "none" }}>
              {String(c.after)}
            </b>
            <div style={{ color: "var(--text-3)", marginTop: 3 }}>理由: {c.reason}</div>

            {state[i] ? (
              <div
                className="mt-2 text-[10.5px] font-bold"
                style={{
                  color: state[i] === "accepted" ? "var(--volt)" : "var(--text-3)",
                }}
              >
                {state[i] === "accepted" ? "✓ 承認しました" : "✕ 却下しました（理由を記録）"}
              </div>
            ) : rejecting === i ? (
              <div className="mt-2 flex gap-1.5 flex-wrap items-center">
                <input
                  autoFocus
                  className="flex-1 min-w-[150px] !text-[11px] !py-1"
                  placeholder="却下の理由（例: 本人判断で実施したい）"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
                <button
                  className="btn-ghost !py-1 !px-2.5 !text-[11px]"
                  onClick={() => send(i, false, reason || "理由未記入")}
                >
                  記録して却下
                </button>
                <button
                  className="btn-ghost !py-1 !px-2.5 !text-[11px]"
                  onClick={() => setRejecting(null)}
                >
                  やめる
                </button>
              </div>
            ) : (
              <div className="mt-2 flex gap-1.5">
                <button
                  className="btn-volt !py-1 !px-3 !text-[11px]"
                  onClick={() => send(i, true)}
                >
                  承認
                </button>
                <button
                  className="btn-ghost !py-1 !px-3 !text-[11px]"
                  onClick={() => setRejecting(i)}
                >
                  変更を却下
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      <p className="text-[10px] mt-2" style={{ color: "var(--text-3)" }}>
        承認・却下はすべて記録され、分析画面の変更ログから追跡できます。
      </p>
    </div>
  );
}

export function SignalPill({
  signal,
  escalated,
}: {
  signal?: string;
  escalated?: boolean;
}) {
  const map: Record<string, { c: string; t: string }> = {
    green: { c: "var(--volt)", t: "良好" },
    yellow: { c: "var(--amber)", t: "注意" },
    red: { c: "var(--red)", t: "危険" },
  };
  const s = map[signal ?? "green"] ?? map.green;
  return (
    <div className="flex items-center gap-2.5">
      <span className="w-[9px] h-[9px] rounded-full inline-block" style={{ background: s.c }} />
      <span className="text-[26px] font-extrabold" style={{ color: s.c }}>
        {s.t}
      </span>
      {escalated ? (
        <span className="text-[10px]" style={{ color: "var(--red)" }}>
          黄連続
        </span>
      ) : null}
    </div>
  );
}

export function fmtSec(sec?: number | null): string {
  if (sec === undefined || sec === null || !isFinite(sec)) return "-";
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return m > 0 ? `${m}:${s.toFixed(1).padStart(4, "0")}` : s.toFixed(1);
}

export function fmtPace(secPerKm?: number): string {
  if (secPerKm === undefined || !isFinite(secPerKm)) return "-";
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm - m * 60);
  return `${m}:${String(s).padStart(2, "0")}/km`;
}

// ---------------------------------------------------------------------------
// 1-4. 確認ダイアログ + Undo
// ---------------------------------------------------------------------------

/**
 * 破壊的・不可逆になりやすい操作の前に確認を挟む。
 * 一度のタップで反映される操作は、トラックでの誤タップで簡単に起きるため。
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "実行する",
  danger = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" onClick={onCancel}>
      <div className="absolute inset-0 bg-black/70" />
      <div
        className="relative w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl border p-5 pb-8 sm:pb-5"
        style={{ background: "var(--surface)", borderColor: "var(--border-2)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-[15px] font-bold mb-2">{title}</h3>
        {message ? (
          <div className="text-[12.5px] leading-relaxed mb-4" style={{ color: "var(--text-2)" }}>
            {message}
          </div>
        ) : null}
        <div className="flex gap-2">
          <button
            className="btn-volt flex-1 justify-center min-h-[44px]"
            style={danger ? { background: "var(--red)", color: "#fff" } : undefined}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
          <button className="btn-ghost flex-1 min-h-[44px]" onClick={onCancel}>
            キャンセル
          </button>
        </div>
      </div>
    </div>
  );
}

/** 削除後に一定時間だけ出す取り消しバー（1-4） */
export function UndoBar({
  message,
  onUndo,
  onDismiss,
  seconds = 8,
}: {
  message: string;
  onUndo: () => void;
  onDismiss: () => void;
  seconds?: number;
}) {
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    if (left <= 0) {
      onDismiss();
      return;
    }
    const t = setTimeout(() => setLeft((v) => v - 1), 1000);
    return () => clearTimeout(t);
  }, [left, onDismiss]);

  return (
    <div
      className="fixed left-3 right-3 z-40 rounded-xl border px-4 py-3 flex items-center gap-3 shadow-lg"
      style={{
        bottom: "calc(var(--sab) + 78px)",
        background: "var(--surface-2)",
        borderColor: "var(--border-2)",
      }}
    >
      <span className="text-[12.5px] flex-1">{message}</span>
      <button
        className="btn-volt !py-2 !px-3.5 !text-[12px] min-h-[40px]"
        onClick={onUndo}
      >
        取り消す（{left}）
      </button>
    </div>
  );
}

/** 1-4. 確認つきボタン。ワンタップ即反映を防ぐ共通部品 */
export function ConfirmButton({
  label,
  title,
  message,
  onConfirm,
  className = "btn-volt",
  danger = false,
  disabled = false,
}: {
  label: ReactNode;
  title: string;
  message?: ReactNode;
  onConfirm: () => void;
  className?: string;
  danger?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className={className} disabled={disabled} onClick={() => setOpen(true)}>
        {label}
      </button>
      <ConfirmDialog
        open={open}
        title={title}
        message={message}
        danger={danger}
        onConfirm={() => {
          setOpen(false);
          onConfirm();
        }}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}

/** 2-2. 5段階セレクタ（片手で10秒以内に入力できるように大きめのタップ領域） */
export function Scale5({
  value,
  onChange,
  lowLabel,
  highLabel,
  invert = false,
}: {
  value?: number;
  onChange: (v: number) => void;
  lowLabel: string;
  highLabel: string;
  /** true = 数値が大きいほど悪い（疲労など）。false = 大きいほど良い（睡眠など） */
  invert?: boolean;
}) {
  return (
    <div>
      <div className="flex gap-1.5">
        {[1, 2, 3, 4, 5].map((n) => {
          const on = value === n;
          const bad = invert ? n >= 4 : n <= 2;
          return (
            <button
              key={n}
              type="button"
              onClick={() => onChange(n)}
              className="flex-1 rounded-lg font-bold text-[15px] border min-h-[44px]"
              style={{
                background: on ? (bad ? "var(--amber)" : "var(--volt)") : "var(--surface-2)",
                borderColor: on ? "transparent" : "var(--border-2)",
                color: on ? "var(--volt-ink)" : "var(--text-2)",
              }}
            >
              {n}
            </button>
          );
        })}
      </div>
      <div className="flex justify-between text-[10px] mt-1" style={{ color: "var(--text-3)" }}>
        <span>{lowLabel}</span>
        <span>{highLabel}</span>
      </div>
    </div>
  );
}

export function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`block text-[13px] ${className}`}>
      <span className="block text-[10.5px] mb-1" style={{ color: "var(--text-3)" }}>
        {label}
      </span>
      {children}
    </label>
  );
}
