"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { localToday } from "@/lib/core/dates";
import { Card, Sparkline, fmtSec } from "./components/ui";
import { withQuery } from "./components/route";
import { SessionEditSheet } from "./components/session-edit-sheet";

/**
 * ホーム画面（改修指示書 フェーズA）
 *
 * 構造は上から3つだけ。
 *   ① TODAY        固定。スクロールなしで全体が見える。今やることだけ。
 *   ② 週ストリップ  固定。月〜日の横並び。
 *   ③ 分析セクション 横スワイプ3枚（PERFORMANCE / RECOVERY / RACE）
 *
 * TODAY を横スワイプの1枚目にしない理由（A-2）:
 * スワイプで画面外に消えると「今やるべきことに集中させる」という目的と矛盾する。
 * TODAY は常に最上部の固定領域とし、スワイプ対象は残り3枚だけにする。
 */

const DOW = ["日", "月", "火", "水", "木", "金", "土"];
const SECTIONS = ["PERFORMANCE", "RECOVERY", "RACE"] as const;
type SectionKey = (typeof SECTIONS)[number];

function ymd(d: Date) {
  return d.toISOString().slice(0, 10);
}
function addDays(s: string, n: number) {
  const d = new Date(s + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return ymd(d);
}
function dowOf(s: string) {
  return DOW[new Date(s + "T00:00:00Z").getUTCDay()];
}

const CATEGORY_LABEL: Record<string, string> = {
  high_lactate: "高乳酸",
  race_economy: "経済走",
  modeling: "モデリング",
  neural: "神経系",
  cv: "CV",
  threshold: "閾値",
  aerobic: "有酸素",
  off: "休養",
};

export default function Home() {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const today = localToday();

  const load = useCallback(() => {
    fetch("/api/dashboard")
      .then((r) => r.json())
      .then((x) => (x.error ? setErr(x.error) : setD(x)))
      .catch((e) => setErr(String(e)));
  }, []);

  useEffect(load, [load]);

  if (err) {
    return (
      <Card>
        <p className="text-[13px] mb-3">{err}</p>
        <p className="text-[13px] leading-relaxed" style={{ color: "var(--text-2)" }}>
          <Link className="underline" href="/setup" style={{ color: "var(--forge)" }}>
            プロフィール
          </Link>
          {" を登録し、"}
          <Link className="underline" href="/goal" style={{ color: "var(--forge)" }}>
            目標・レース
          </Link>
          {" を設定するとここにホームが出ます。"}
        </p>
      </Card>
    );
  }
  if (!d) return <p className="text-[13px]">読み込み中…</p>;

  return (
    <div className="flex flex-col gap-3">
      <Today d={d} today={today} onChanged={load} />
      <TodayAdjust sessionId={d.todaySession?.id} today={today} />
      <Notices today={today} />
      <WeekStrip d={d} today={today} />
      <AnalysisSwipe d={d} today={today} />
    </div>
  );
}


// ---------------------------------------------------------------------------
// M-2 今日の調整 / M-3 中止基準
// ---------------------------------------------------------------------------

/**
 * 直近の出来・当日のコンディション・ジョグの心拍から作り直した設定を出す。
 * 適用するかどうかは本人が決める。黙って書き換えない。
 */
function TodayAdjust({ sessionId, today }: { sessionId?: string; today: string }) {
  const [d, setD] = useState<any>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => {
    const q = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : "";
    fetch(`/api/adaptive${q}`)
      .then((r) => r.json())
      .then(setD)
      .catch(() => setD(null));
  };
  useEffect(load, [sessionId]);

  if (!d?.session) return null;
  const p = d.proposal;
  const blocked = d.context?.daily?.blocked;
  if (!p?.hasChange && !blocked && !d.criteria) return null;

  const act = async (action: "apply" | "reject") => {
    setBusy(true);
    try {
      const r = await fetch("/api/adaptive", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: d.session.id, action, today }),
      });
      const out = await r.json();
      setMsg(
        out.error
          ? out.error
          : action === "apply"
          ? "設定を更新しました。CFE（能力の推定）は変えていません"
          : "設定はそのままにしました"
      );
      load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="metric-label">
          {p?.hasChange
            ? "設定の調整案"
            : d.session.date === today
            ? "この練習の進め方"
            : "次のポイント練習の進め方"}
        </span>
        <span className="text-[11px] num" style={{ color: "var(--text-3)" }}>
          {d.session.date.slice(5).replace("-", "/")}
        </span>
      </div>

      {blocked ? (
        <p className="text-[13px] leading-relaxed mb-2" style={{ color: "var(--red)" }}>
          赤信号です。この日に質練習は入れません。有酸素か休養に置き換えてください。
        </p>
      ) : null}

      {p?.hasChange ? (
        <>
          <div className="text-[14px] font-semibold mb-1 num">
            1本あたり {p.offsetSecPerRep > 0 ? "+" : ""}
            {p.offsetSecPerRep.toFixed(1)}秒
            {p.afterReps !== p.beforeReps ? ` ／ 本数 ${p.beforeReps} → ${p.afterReps}` : ""}
          </div>
          <ul className="mb-2.5">
            {p.reasons.map((r: string, i: number) => (
              <li key={i} className="text-[12px] leading-relaxed" style={{ color: "var(--text-2)" }}>
                ・{r}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {d.criteria ? (
        <div
          className="text-[12px] leading-relaxed rounded-lg p-2.5 mb-2.5"
          style={{ background: "var(--surface-2)", color: "var(--text-2)" }}
        >
          {d.criteria.text}
        </div>
      ) : null}

      {p?.hasChange && !d.rejected ? (
        <div className="flex gap-2 flex-col sm:flex-row">
          <button className="btn-volt justify-center" disabled={busy} onClick={() => act("apply")}>
            この設定にする
          </button>
          <button className="btn-ghost" disabled={busy} onClick={() => act("reject")}>
            元の設定のままでいく
          </button>
        </div>
      ) : null}
      {d.rejected ? (
        <p className="text-[11.5px]" style={{ color: "var(--text-3)" }}>
          {d.rejected.at} に見送った提案です。
        </p>
      ) : null}
      {msg ? (
        <p className="text-[11.5px] mt-2" style={{ color: "var(--forge)" }}>
          {msg}
        </p>
      ) : null}
    </Card>
  );
}

/**
 * M-6 テーパーの予告 と M-12 書き出しの催促。
 * どちらも1行で出す。ホームに置くものは「今やるべきこと」だけなので、
 * 詳細はそれぞれの画面に置く。
 */
function Notices({ today }: { today: string }) {
  const [taper, setTaper] = useState<any>(null);
  const [backup, setBackup] = useState<any>(null);
  useEffect(() => {
    fetch("/api/taper").then((r) => r.json()).then(setTaper).catch(() => {});
    fetch("/api/backup").then((r) => r.json()).then(setBackup).catch(() => {});
  }, [today]);

  const items: { text: string; href: string; label: string; color: string }[] = [];
  if (taper?.stage && taper.stage !== "none" && taper.adjustments?.some((a: any) => a.next)) {
    items.push({
      text: taper.notice,
      href: "/plan-settings",
      label: "調整内容を見る",
      color: "var(--amber)",
    });
  }
  if (backup?.remind) {
    items.push({
      text: backup.message,
      href: "/data",
      label: "書き出す",
      color: "var(--text-2)",
    });
  }
  if (items.length === 0) return null;

  return (
    <Card>
      {items.map((it, i) => (
        <div
          key={i}
          className="flex items-center justify-between gap-2 flex-wrap"
          style={{ marginTop: i > 0 ? 10 : 0 }}
        >
          <p className="text-[12px] leading-relaxed flex-1" style={{ color: it.color }}>
            {it.text}
          </p>
          <Link href={it.href} className="btn-ghost !text-[11.5px] !py-1.5">
            {it.label}
          </Link>
        </div>
      ))}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// ① TODAY（A-3）
// ---------------------------------------------------------------------------

function Today({ d, today, onChanged }: { d: any; today: string; onChanged: () => void }) {
  const s = d.todaySession;
  const r = d.readiness;
  const result = d.todayResult;
  const violations = (d.todayViolations ?? []) as any[];
  /**
   * P-1: TODAYから直接メニューを直せるようにする。
   * カレンダーの編集シートと同じ実装（SessionEditSheet）をそのまま開く。
   * 「今日のメニューが合っていない」と気づくのはホームを見た瞬間なので、
   * そこからカレンダーへ回り道させない。
   */
  const [editing, setEditing] = useState(false);
  const [msg, setMsg] = useState("");

  // 主アクションは「状態が変わっても位置が変わらない」ことが条件（A-3）。
  // 押す場所を毎日探し直さずに済むよう、必ずカード末尾の同じ位置に出す。
  let action: { label: string; href?: string; kind: "primary" | "done" | "rest" };
  if (!s && d.todayIsOff) {
    action = { label: "休養日", kind: "rest" };
  } else if (!s) {
    action = { label: "メニューを生成する", href: "/goal", kind: "primary" };
  } else if (result) {
    const ach =
      result.achievement === "achieved"
        ? "達成"
        : result.achievement === "partial"
        ? "一部達成"
        : "未達";
    action = { label: `記録済み ／ ${ach}`, href: "/results", kind: "done" };
  } else {
    action = { label: "記録する", href: "/results", kind: "primary" };
  }

  if (s && editing) {
    return (
      <SessionEditSheet
        session={s}
        today={today}
        title={`今日のメニューを変更 ／ ${s.name}`}
        onClose={() => setEditing(false)}
        onDone={(m) => {
          setEditing(false);
          setMsg(m);
          onChanged();
        }}
      />
    );
  }

  return (
    <Card>
      <div className="flex items-center justify-between gap-2 mb-2.5">
        <span className="metric-label">TODAY</span>
        <span className="text-[11px] num" style={{ color: "var(--text-3)" }}>
          {today.slice(5).replace("-", "/")}（{dowOf(today)}）
        </span>
      </div>
      {msg ? (
        <p className="text-[11.5px] mb-2" style={{ color: "var(--text-3)" }}>
          {msg}
        </p>
      ) : null}

      {s ? (
        <>
          <div className="flex items-center gap-1.5 flex-wrap mb-2">
            <span
              className="text-[10px] font-bold px-2 py-1 rounded-md"
              style={{ background: "var(--surface-2)", color: "var(--text-2)" }}
            >
              {CATEGORY_LABEL[s.category] ?? s.category}
            </span>
            {d.currentPhase ? (
              <span className="text-[10px] font-semibold" style={{ color: "var(--text-3)" }}>
                {d.currentPhase} 期
              </span>
            ) : null}
          </div>

          {/* メニュー本文は1回だけ（E-4: 現行の二重表示を解消） */}
          <p className="text-[15px] font-semibold leading-snug mb-1">{s.name}</p>
          <p className="text-[12.5px] leading-relaxed mb-3" style={{ color: "var(--text-2)" }}>
            {s.prescription}
          </p>

          {/* 準備度・転移度・リスクを1行に。リングは詳細画面へ（A-3） */}
          <div
            className="flex items-center gap-x-6 gap-y-2 flex-wrap py-3 border-t border-b mb-3"
            style={{ borderColor: "var(--border)" }}
          >
            <MiniMetric
              label="準備度"
              value={r ? String(r.score) : "-"}
              unit="/100"
              color={
                r?.level === "low"
                  ? "var(--red)"
                  : r?.level === "caution"
                  ? "var(--amber)"
                  : "var(--forge)"
              }
            />
            <MiniMetric label="800m転移度" value={`${s.transfer800m}`} unit="/5" />
            <MiniMetric
              label="リスク"
              value={s.riskLevel === "high" ? "高" : s.riskLevel === "mid" ? "中" : "低"}
              color={s.riskLevel === "high" ? "var(--amber)" : undefined}
            />
          </div>

          {/* 当日・翌日のセッションに関する警告だけをここに1〜2行（A-3） */}
          {violations.slice(0, 2).map((v: any, i: number) => (
            <p
              key={i}
              className="text-[12px] leading-snug mb-1.5 pl-2.5 border-l-2"
              style={{
                color: "var(--text-2)",
                borderColor: v.level === "ERROR" ? "var(--red)" : "var(--amber)",
              }}
            >
              {v.message}
            </p>
          ))}
          {violations.length > 2 ? (
            <Link
              href="/warnings"
              className="text-[11.5px] underline"
              style={{ color: "var(--text-3)" }}
            >
              ほか{violations.length - 2}件の警告を見る
            </Link>
          ) : null}

          <div className="flex gap-2 mt-3 flex-col sm:flex-row">
            <ActionButton action={action} />
            {/* M-4: 1本ごとに入れながら、続けるかどうかをその場で見る */}
            {!result && s.targetPaces?.length > 0 ? (
              <Link href={withQuery("/run", { sessionId: s.id })} className="btn-ghost text-center">
                走りながら入力する
              </Link>
            ) : null}
            {/* P-1: 固定枠（チーム練習等）は動かせないので出さない */}
            {!s.isFixed ? (
              <button className="btn-ghost text-center" onClick={() => setEditing(true)}>
                メニューを変更
              </button>
            ) : null}
            <Link href={withQuery("/session", { id: s.id })} className="btn-ghost text-center">
              メニューの根拠を確認
            </Link>
          </div>
        </>
      ) : (
        <>
          <p className="text-[15px] font-semibold mb-1">
            {d.todayIsOff ? "完全休養日" : "今日のメニューがありません"}
          </p>
          <p className="text-[12.5px] leading-relaxed mb-3" style={{ color: "var(--text-2)" }}>
            {d.todayIsOff
              ? "回復も練習の一部です。ジョグで埋めないでください。"
              : "「目標・レース」でプランを生成すると、ここに今日やる練習が出ます。"}
          </p>
          <div className="flex gap-2 flex-col sm:flex-row">
            <ActionButton action={action} />
          </div>
        </>
      )}
    </Card>
  );
}

function ActionButton({
  action,
}: {
  action: { label: string; href?: string; kind: "primary" | "done" | "rest" };
}) {
  if (action.kind === "rest") {
    return (
      <div
        className="btn-ghost text-center cursor-default flex-1"
        style={{ color: "var(--text-3)" }}
      >
        {action.label}
      </div>
    );
  }
  if (action.kind === "done") {
    return (
      <Link
        href={action.href!}
        className="btn-ghost text-center flex-1"
        style={{ color: "var(--forge)", borderColor: "rgba(182,255,0,0.35)" }}
      >
        {action.label}
      </Link>
    );
  }
  return (
    <Link href={action.href!} className="btn-volt justify-center flex-1">
      {action.label}
      <span aria-hidden>→</span>
    </Link>
  );
}

function MiniMetric({
  label,
  value,
  unit,
  color,
}: {
  label: string;
  value: string;
  unit?: string;
  color?: string;
}) {
  return (
    <div>
      <div className="metric-label mb-1">{label}</div>
      <div className="flex items-baseline gap-1">
        <span className="metric" style={{ color: color ?? "var(--text)" }}>
          {value}
        </span>
        {unit ? (
          <span className="text-[11px] font-semibold" style={{ color: "var(--text-3)" }}>
            {unit}
          </span>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ② 週ストリップ（固定）
// ---------------------------------------------------------------------------

const CAT_LETTER: Record<string, string> = {
  high_lactate: "H",
  race_economy: "R",
  modeling: "M",
  neural: "N",
  cv: "C",
  threshold: "T",
  aerobic: "A",
  off: "—",
};

function WeekStrip({ d, today }: { d: any; today: string }) {
  const start = d.weeklySummary?.weekStart ?? today;
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const byDate = new Map<string, any[]>();
  for (const s of d.weekSessions ?? []) {
    if (!byDate.has(s.date)) byDate.set(s.date, []);
    byDate.get(s.date)!.push(s);
  }
  return (
    <Card>
      <div className="flex items-center justify-between mb-2.5">
        <span className="metric-label">今週</span>
        <Link href="/calendar" className="text-[11.5px]" style={{ color: "var(--text-3)" }}>
          カレンダーへ →
        </Link>
      </div>
      <div className="grid grid-cols-7 gap-1">
        {days.map((date) => {
          const list = byDate.get(date) ?? [];
          const main =
            list.find((s) => s.category !== "off" && s.category !== "aerobic") ?? list[0];
          const isToday = date === today;
          return (
            <Link
              key={date}
              href="/calendar"
              className="flex flex-col items-center gap-1 py-2 rounded-lg min-h-[56px]"
              style={{
                background: isToday ? "var(--volt-dim)" : "transparent",
                border: `1px solid ${isToday ? "rgba(182,255,0,0.3)" : "transparent"}`,
              }}
            >
              <span
                className="text-[9.5px] font-bold"
                style={{ color: isToday ? "var(--forge)" : "var(--text-3)" }}
              >
                {dowOf(date)}
              </span>
              <span
                className="text-[13px] font-bold num"
                style={{ color: main ? "var(--text)" : "var(--text-3)" }}
              >
                {main ? CAT_LETTER[main.category] ?? "?" : "—"}
              </span>
            </Link>
          );
        })}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// ③ 分析セクション（横スワイプ3枚 / A-5・A-6）
// ---------------------------------------------------------------------------

function AnalysisSwipe({ d, today }: { d: any; today: string }) {
  const [idx, setIdx] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  // レース当日・前日は RACE を初期表示にする（A-5の昇格と整合）
  useEffect(() => {
    if (d.daysToRace !== undefined && d.daysToRace >= 0 && d.daysToRace <= 1) {
      go(2);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.daysToRace]);

  const go = (i: number) => {
    setIdx(i);
    const el = ref.current;
    if (el) el.scrollTo({ left: el.clientWidth * i, behavior: "smooth" });
  };

  const onScroll = () => {
    const el = ref.current;
    if (!el || el.clientWidth === 0) return;
    const i = Math.round(el.scrollLeft / el.clientWidth);
    if (i !== idx) setIdx(i);
  };

  return (
    <div className="flex flex-col gap-2">
      {/* セグメントタブ。スワイプでしか到達できないUIにしない（禁止事項） */}
      <div className="seg" role="tablist">
        {SECTIONS.map((k, i) => (
          <button
            key={k}
            role="tab"
            aria-selected={i === idx}
            data-on={i === idx ? "1" : "0"}
            onClick={() => go(i)}
          >
            {k}
          </button>
        ))}
      </div>

      <div ref={ref} className="swipe" onScroll={onScroll}>
        <section>
          <Performance d={d} />
        </section>
        <section>
          <Recovery d={d} />
        </section>
        <section>
          <Race d={d} today={today} />
        </section>
      </div>

      <div className="dots" aria-hidden>
        {SECTIONS.map((k, i) => (
          <i key={k} data-on={i === idx ? "1" : "0"} />
        ))}
      </div>
    </div>
  );
}

/** E-1: 低信頼度の推定値は主指標サイズで出さない */
const CONFIDENCE_THRESHOLD = 0.6;

function Performance({ d }: { d: any }) {
  const cfe = d.cfe;
  const conf = cfe?.confidence ?? 0;
  const lowConfidence = !cfe || conf < CONFIDENCE_THRESHOLD;
  const hist = (cfe?.history ?? []) as any[];
  const vals = hist.map((h) => h.after);
  const uniqueDates = new Set(hist.map((h) => h.date));
  // E-1: 2点未満、または全点が同一日ならグラフを描かない（推移になっていない）
  const drawable = hist.length >= 2 && uniqueDates.size >= 2;
  const improving = (d.cfeDelta ?? 0) < 0;
  const s = d.weeklySummary;

  return (
    <Card>
      <div className="metric-label mb-2">CFE（推定800mタイム）</div>
      {lowConfidence ? (
        <>
          <div className="text-[22px] font-bold" style={{ color: "var(--text-2)" }}>
            推定中
          </div>
          <p className="text-[12px] leading-relaxed mt-1.5" style={{ color: "var(--text-3)" }}>
            信頼度 {conf.toFixed(2)}（有効になるのは {CONFIDENCE_THRESHOLD.toFixed(1)} 以上）。
            レースかタイムトライアルの実測をあと1件入れると有効になります。
            {cfe ? (
              <>
                {" "}
                参考値 <span className="num">{fmtSec(cfe.estimated800mSec)}</span>
              </>
            ) : null}
          </p>
          <Link
            href="/past"
            className="btn-ghost inline-block mt-2.5 !text-[11.5px] !py-1.5 !px-3"
          >
            過去データを入力する
          </Link>
        </>
      ) : (
        <>
          <div className="flex items-baseline gap-2.5 flex-wrap">
            <div className="hero">{fmtSec(cfe.estimated800mSec)}</div>
            {d.cfeDelta !== undefined && d.cfeDelta !== null ? (
              // E-2: 改善（数値が下がる）を良好色、悪化を警告色。矢印でも方向を示す
              <div
                className="num text-[13px] font-bold"
                style={{ color: improving ? "var(--forge)" : "var(--amber)" }}
              >
                {improving ? "▼" : "▲"} {Math.abs(d.cfeDelta).toFixed(1)}秒
              </div>
            ) : null}
          </div>
          <div className="text-[11px] mt-1.5" style={{ color: "var(--text-3)" }}>
            {/* H: 幅で示す。0.48という信頼度の数字だけでは判断材料にならない */}
            {d.cfeRange
              ? `予測レンジ ${fmtSec(d.cfeRange.lowSec)} 〜 ${fmtSec(d.cfeRange.highSec)} ／ `
              : ""}
            信頼度 {conf.toFixed(2)}
          </div>
          {drawable ? (
            <div className="mt-2.5">
              <Sparkline values={vals} labels={hist.map((h) => h.date.slice(5))} />
              <p className="text-[10px] mt-1" style={{ color: "var(--text-3)" }}>
                下がるほど良い
              </p>
            </div>
          ) : (
            <p className="text-[11.5px] mt-2.5" style={{ color: "var(--text-3)" }}>
              推移のグラフは記録が2日分たまると表示されます。
            </p>
          )}
        </>
      )}

      <div className="grid grid-cols-3 gap-3 mt-4 pt-3.5 border-t" style={{ borderColor: "var(--border)" }}>
        <MiniMetric
          label="週間転移度"
          value={s ? s.transfer800mScore.toFixed(1) : "-"}
          unit="/5"
        />
        <MiniMetric
          label="高乳酸28日"
          value={s ? String(s.highLactateLast28d) : "-"}
          unit="回"
        />
        <MiniMetric
          label="今週の距離"
          value={s ? s.totalDistanceKm.toFixed(0) : "-"}
          unit="km"
        />
      </div>

      <Link
        href="/analysis"
        className="block text-center text-[11.5px] mt-3"
        style={{ color: "var(--text-3)" }}
      >
        分析でCFEの詳細を見る →
      </Link>
    </Card>
  );
}

const SIGNAL_LABEL: Record<string, string> = {
  green: "良好",
  yellow: "注意",
  red: "警戒",
};
const SIGNAL_COLOR: Record<string, string> = {
  green: "var(--forge)",
  yellow: "var(--amber)",
  red: "var(--red)",
};

function Recovery({ d }: { d: any }) {
  const sig = d.signal ?? "green";
  const acwr = d.acwr;
  return (
    <Card>
      {/* A-5: 疲労シグナルと総合疲労を1つのカードに統合（現行は2枚に分散） */}
      <div className="metric-label mb-2">疲労シグナル</div>
      <div className="flex items-baseline gap-3 flex-wrap">
        <div className="hero" style={{ color: SIGNAL_COLOR[sig] }}>
          {SIGNAL_LABEL[sig] ?? sig}
        </div>
        {d.overallFatigue !== undefined ? (
          <div className="num text-[15px] font-bold" style={{ color: "var(--text-2)" }}>
            総合疲労 {d.overallFatigue}/5
          </div>
        ) : null}
      </div>
      {d.signalEscalated ? (
        <p className="text-[11.5px] mt-1.5" style={{ color: "var(--amber)" }}>
          黄信号が続いているため警戒に引き上げています。
        </p>
      ) : null}

      <div className="grid grid-cols-3 gap-3 mt-4 pt-3.5 border-t" style={{ borderColor: "var(--border)" }}>
        <MiniMetric
          label="ACWR"
          value={acwr?.acwr !== undefined ? acwr.acwr.toFixed(2) : "-"}
          color={
            acwr?.rating === "high_risk"
              ? "var(--red)"
              : acwr?.rating === "caution"
              ? "var(--amber)"
              : undefined
          }
        />
        <MiniMetric
          label="前回ポイント"
          value={d.daysSinceQuality !== undefined ? String(d.daysSinceQuality) : "-"}
          unit="日前"
        />
        <MiniMetric
          label="未回復の故障"
          value={String(d.openInjuryCount ?? 0)}
          unit="件"
          color={(d.openInjuryCount ?? 0) > 0 ? "var(--amber)" : undefined}
        />
      </div>

      <p className="text-[11px] leading-relaxed mt-2.5" style={{ color: "var(--text-3)" }}>
        {acwr?.acwr === undefined
          ? // E-3: 空状態で終わらせず、次の行動を出す
            "ACWRはまだ有効ではありません。あと2週間ぶんの記録で有効になります（過去データの入力でも埋められます）。"
          : "ACWRは単独で判断根拠にしないでください。疲労シグナルと併せて見ます。"}
      </p>
      {(d.openInjuryCount ?? 0) > 0 ? (
        <p className="text-[12px] mt-2 pl-2.5 border-l-2" style={{ color: "var(--text-2)", borderColor: "var(--amber)" }}>
          未回復の故障記録があります。強度を上げる前に「記録 → 故障」を確認してください。
        </p>
      ) : null}
      <Link
        href="/heat"
        className="block text-center text-[11.5px] mt-3"
        style={{ color: "var(--text-3)" }}
      >
        暑熱順化の詳細 →
      </Link>
    </Card>
  );
}

function Race({ d, today }: { d: any; today: string }) {
  const race = d.targetRace;
  const gapSec =
    d.goal && d.cfe ? d.cfe.estimated800mSec - d.goal.targetTimeSec : undefined;
  const isRaceWindow = d.daysToRace !== undefined && d.daysToRace >= 0 && d.daysToRace <= 1;

  return (
    <Card>
      <div className="metric-label mb-2">次のレースまで</div>
      {race ? (
        <>
          <div className="flex items-baseline gap-2">
            <div className="hero">{d.daysToRace}</div>
            <div className="text-[15px] font-bold" style={{ color: "var(--text-2)" }}>
              日
            </div>
          </div>
          <p className="text-[12.5px] mt-1.5" style={{ color: "var(--text-2)" }}>
            {race.name}
            <span className="num" style={{ color: "var(--text-3)" }}>
              {" "}
              {race.dateStart}
            </span>
          </p>

          <div className="grid grid-cols-3 gap-3 mt-4 pt-3.5 border-t" style={{ borderColor: "var(--border)" }}>
            <MiniMetric label="フェーズ" value={d.currentPhase ?? "-"} />
            <MiniMetric
              label="目標"
              value={d.goal ? fmtSec(d.goal.targetTimeSec) : "-"}
            />
            <MiniMetric
              label="目標との差"
              value={gapSec !== undefined ? `${gapSec > 0 ? "+" : ""}${gapSec.toFixed(1)}` : "-"}
              unit="秒"
              color={gapSec !== undefined && gapSec <= 0 ? "var(--forge)" : "var(--amber)"}
            />
          </div>

          {isRaceWindow ? (
            <Link href="/meet" className="btn-volt justify-center mt-3">
              大会モードを開く<span aria-hidden>→</span>
            </Link>
          ) : (
            <Link
              href="/goal"
              className="block text-center text-[11.5px] mt-3"
              style={{ color: "var(--text-3)" }}
            >
              ラウンド構成を見る →
            </Link>
          )}
        </>
      ) : (
        <>
          <p className="text-[15px] font-semibold mb-1">目標レースが未設定です</p>
          <p className="text-[12.5px] leading-relaxed mb-3" style={{ color: "var(--text-2)" }}>
            レース日を入れると、期分けとテーパーが自動で組まれます。
          </p>
          <Link href="/goal" className="btn-volt justify-center">
            目標・レースを設定する<span aria-hidden>→</span>
          </Link>
        </>
      )}
    </Card>
  );
}
