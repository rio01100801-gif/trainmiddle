"use client";
import * as React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Card, CATEGORY_COLORS, CATEGORY_LABELS, ConfirmButton, ViolationList } from "../components/ui";
import { withQuery } from "../components/route";
import {
  PrescriptionFields,
  prescriptionPayload,
  usePrescriptionFields,
} from "../components/prescription-fields";
import { localToday } from "@/lib/core/dates";

/**
 * カレンダー（改修指示書 フェーズC）
 *
 * 最大の変更点はジェスチャーの再定義（C-1）。
 * 現行はセッションをタップすると「日付変更モード」に入っていた。
 * これは「日付を見て記録を入れる」という自然な操作を塞いでいた。
 *   タップ   → その日の詳細を開く。記録がなければ入力フォームへ（日付は入力済み）
 *   長押し   → 日付変更モード（従来のタップの機能をここへ移す）
 *   固定枠   → 長押ししても動かせないことをその場で返す
 */

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function weekStart(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  const dow = d.getUTCDay();
  return addDays(dateStr, dow === 0 ? -6 : 1 - dow);
}
function monthStart(dateStr: string): string {
  return dateStr.slice(0, 8) + "01";
}
const DOW = ["月", "火", "水", "木", "金", "土", "日"];
function dowOf(s: string) {
  const i = new Date(s + "T00:00:00Z").getUTCDay();
  return DOW[i === 0 ? 6 : i - 1];
}

/** C-2: 日付の状態。色とアイコンの両方で区別する（色だけに頼らない） */
type DayState =
  | "recorded"
  | "planned"
  | "rest"
  | "race"
  | "injury"
  | "heat"
  | "empty";

const STATE_MARK: Record<DayState, { icon: string; label: string; color: string }> = {
  recorded: { icon: "✓", label: "記録済み", color: "var(--forge)" },
  planned: { icon: "•", label: "未記録（予定あり）", color: "var(--text-2)" },
  rest: { icon: "—", label: "休養", color: "var(--text-3)" },
  race: { icon: "▲", label: "レース", color: "var(--cat-modeling)" },
  injury: { icon: "!", label: "故障発生日", color: "var(--red)" },
  heat: { icon: "△", label: "暑熱条件", color: "var(--amber)" },
  empty: { icon: "", label: "予定なし", color: "var(--text-3)" },
};

const LONG_PRESS_MS = 450;

export default function CalendarPage() {
  const todayStr = localToday();
  const [mode, setMode] = useState<"week" | "month">("week");
  const [anchor, setAnchor] = useState(weekStart(todayStr));
  const [weeks, setWeeks] = useState(2);
  const [sessions, setSessions] = useState<any[]>([]);
  const [results, setResults] = useState<any[]>([]);
  const [injuries, setInjuries] = useState<any[]>([]);
  const [races, setRaces] = useState<any[]>([]);
  const [violationsByDate, setViolationsByDate] = useState<Record<string, number>>({});
  const [violations, setViolations] = useState<any[]>([]);
  const [moving, setMoving] = useState<any | null>(null);
  const [editing, setEditing] = useState<any | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [conflict, setConflict] = useState<any | null>(null);
  const [msg, setMsg] = useState("");

  const from = mode === "week" ? anchor : monthStart(anchor);
  const span = mode === "week" ? weeks * 7 : 42;

  const load = useCallback(() => {
    const to = addDays(from, span - 1);
    fetch(`/api/sessions?from=${from}&to=${to}`)
      .then((r) => r.json())
      .then((d) => setSessions(d.sessions ?? []));
    fetch("/api/results")
      .then((r) => r.json())
      .then((d) => setResults(d.results ?? []))
      .catch(() => {});
    fetch("/api/injuries")
      .then((r) => r.json())
      .then((d) => setInjuries(d.injuries ?? []))
      .catch(() => {});
    fetch("/api/dashboard")
      .then((r) => r.json())
      .then((d) => {
        setViolationsByDate(d.violationsByDate ?? {});
        setViolations(d.violations ?? []);
        setRaces(d.targetRace ? [d.targetRace] : []);
      })
      .catch(() => {});
  }, [from, span]);

  useEffect(load, [load]);

  /**
   * M-5: 移動は必ずルール検査を通す。
   * 動かせるようにするだけでは足りない。高乳酸を前倒しして間隔が4日になった、
   * ということが普通に起きるので、何が壊れるかと代わりに置ける日を出す。
   */
  const moveSession = async (id: string, date: string, force = false) => {
    const res = await fetch("/api/plan-edit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: id, updates: { date }, force, today: todayStr }),
    });
    const d = await res.json();
    if (!d.applied && (d.newViolations?.length || d.error)) {
      setConflict({ ...d, sessionId: id, date });
      setMoving(null);
      scrollToTop();
      return;
    }
    setConflict(null);
    setMsg(d.error ?? "移動しました。ルールを再チェックしました。");
    if (!d.error) setViolations(d.violations ?? []);
    setMoving(null);
    load();
  };

  const days: string[] = [];
  for (let i = 0; i < span; i++) days.push(addDays(from, i));

  const sessionsByDate = new Map<string, any[]>();
  for (const s of sessions) {
    if (!sessionsByDate.has(s.date)) sessionsByDate.set(s.date, []);
    sessionsByDate.get(s.date)!.push(s);
  }
  const resultDates = new Set(results.map((r) => r.date));
  const injuryDates = new Set(injuries.map((i) => i.date));
  const heatDates = new Set(results.filter((r) => r.heatFlagged).map((r) => r.date));
  const raceDates = new Set(races.map((r) => r.dateStart));

  const stateOf = (date: string): DayState => {
    if (injuryDates.has(date)) return "injury";
    if (raceDates.has(date)) return "race";
    const list = sessionsByDate.get(date) ?? [];
    if (resultDates.has(date)) return heatDates.has(date) ? "heat" : "recorded";
    if (list.length === 0) return "empty";
    if (list.every((s) => s.category === "off")) return "rest";
    return "planned";
  };

  // C-3: 横スワイプでの週送り
  const touchX = useRef<number | null>(null);
  const onTouchStart = (e: any) => (touchX.current = e.touches[0].clientX);
  const onTouchEnd = (e: any) => {
    if (touchX.current === null) return;
    const dx = e.changedTouches[0].clientX - touchX.current;
    touchX.current = null;
    if (Math.abs(dx) < 60) return;
    shift(dx > 0 ? -1 : 1);
  };
  /**
   * 編集・追加のシートは日付リストの上に出す。
   * 日付が何十行も並ぶ画面なので下に出すと画面外に出てしまい、
   * 「押しても何も起きない」ように見える。
   */
  const scrollToTop = () => {
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const shift = (dir: number) =>
    setAnchor((a) => (mode === "week" ? addDays(a, dir * 7) : addDays(monthStart(a), dir * 30)));

  return (
    <div className="flex flex-col gap-3">
      <Card>
        <div className="flex gap-2 items-center flex-wrap">
          <button className="btn-ghost !py-1.5 !px-2.5 !text-[12px]" onClick={() => shift(-1)}>
            ←
          </button>
          <span className="text-[13px] font-semibold num flex-1 text-center">
            {from} 〜 {addDays(from, span - 1)}
          </span>
          <button className="btn-ghost !py-1.5 !px-2.5 !text-[12px]" onClick={() => shift(1)}>
            →
          </button>
        </div>
        <div className="flex gap-2 items-center flex-wrap mt-2">
          <div className="seg flex-1">
            <button data-on={mode === "week" ? "1" : "0"} onClick={() => setMode("week")}>
              週
            </button>
            <button data-on={mode === "month" ? "1" : "0"} onClick={() => setMode("month")}>
              月
            </button>
          </div>
          {mode === "week" ? (
            <select
              className="!text-[12px] !py-1.5"
              value={weeks}
              onChange={(e) => setWeeks(Number(e.target.value))}
            >
              <option value={1}>1週間</option>
              <option value={2}>2週間</option>
              <option value={4}>4週間</option>
            </select>
          ) : null}
          <button
            className="btn-ghost !py-1.5 !px-2.5 !text-[12px]"
            onClick={() => setAnchor(weekStart(todayStr))}
          >
            今日
          </button>
        </div>
        <p className="text-[11px] leading-relaxed mt-2.5" style={{ color: "var(--text-3)" }}>
          日付の行をタップするとその日の記録を入力できます。
          ✎ でメニューの変更・移動・削除、＋ でその日に練習を足せます（セッションの長押しでも同じです）。
        </p>
      </Card>

      {msg ? (
        <Card>
          <p className="text-[12.5px]">{msg}</p>
        </Card>
      ) : null}

      {editing ? (
        <EditSheet
          session={editing}
          today={todayStr}
          onClose={() => setEditing(null)}
          onMove={() => {
            setMoving(editing);
            setEditing(null);
            setMsg(`${editing.name} の移動先の日付をタップしてください。`);
          }}
          onDone={(m) => {
            setEditing(null);
            setMsg(m);
            load();
          }}
        />
      ) : null}

      {adding ? (
        <AddSheet
          date={adding}
          today={todayStr}
          onClose={() => setAdding(null)}
          onDone={(m) => {
            setAdding(null);
            setMsg(m);
            load();
          }}
        />
      ) : null}

      {conflict ? (
        <Card title="この移動はルールに反します">
          {(conflict.newViolations ?? []).map((v: any, i: number) => (
            <p key={i} className="text-[12px] leading-relaxed mb-1.5" style={{ color: "var(--red)" }}>
              {v.rule}: {v.message}
            </p>
          ))}
          {conflict.alternatives?.length ? (
            <>
              <p className="text-[11.5px] mt-2 mb-1" style={{ color: "var(--text-3)" }}>
                代わりにこの日なら置けます
              </p>
              <div className="flex gap-1.5 flex-wrap">
                {conflict.alternatives.map((a: any) => (
                  <button
                    key={a.date}
                    className="btn-ghost !text-[11.5px] !py-1.5"
                    onClick={() => moveSession(conflict.sessionId, a.date)}
                  >
                    {a.date.slice(5).replace("-", "/")}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <p className="text-[11.5px] mt-1" style={{ color: "var(--text-3)" }}>
              前後7日に置ける日が見つかりませんでした。
            </p>
          )}
          <div className="flex gap-2 mt-3 flex-wrap">
            <button
              className="btn-ghost"
              style={{ color: "var(--amber)" }}
              onClick={() => moveSession(conflict.sessionId, conflict.date, true)}
            >
              承知のうえで {conflict.date.slice(5).replace("-", "/")} に動かす
            </button>
            <button className="btn-ghost" onClick={() => setConflict(null)}>
              やめる
            </button>
          </div>
        </Card>
      ) : null}

      <div onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} className="flex flex-col gap-1.5">
        {days.map((date) => (
          <DayRow
            key={date}
            date={date}
            today={todayStr}
            sessions={sessionsByDate.get(date) ?? []}
            state={stateOf(date)}
            warnCount={violationsByDate[date] ?? 0}
            moving={moving}
            onLongPress={(s) => {
              scrollToTop();
              if (s.isFixed) {
                setMsg(
                  `${s.name} は固定セッション（チーム練習等）なので変更できません。前後の自由枠を組み替えてください。`
                );
                return;
              }
              setEditing(s);
              setMsg("");
            }}
            onAdd={(d) => {
              scrollToTop();
              setAdding(d);
            }}
            onPickDate={(d) => moving && moveSession(moving.id, d)}
          />
        ))}
      </div>

      {moving ? (
        <Card>
          <p className="text-[12.5px] mb-2">
            <b>{moving.name}</b> を移動中です。移動先の日付をタップしてください。
          </p>
          <button className="btn-ghost" onClick={() => setMoving(null)}>
            やめる
          </button>
        </Card>
      ) : null}

      <Card title="凡例">
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {(Object.keys(STATE_MARK) as DayState[])
            .filter((k) => k !== "empty")
            .map((k) => (
              <span key={k} className="text-[11px] flex items-center gap-1.5">
                <b style={{ color: STATE_MARK[k].color }}>{STATE_MARK[k].icon}</b>
                <span style={{ color: "var(--text-3)" }}>{STATE_MARK[k].label}</span>
              </span>
            ))}
        </div>
      </Card>

      {violations.length > 0 ? (
        <Card title="ルール警告">
          <ViolationList violations={violations} compact />
          <Link
            href="/warnings"
            className="block text-center text-[11.5px] mt-3"
            style={{ color: "var(--text-3)" }}
          >
            警告一覧で全文を見る →
          </Link>
        </Card>
      ) : null}
    </div>
  );
}

function DayRow({
  date,
  today,
  sessions,
  state,
  warnCount,
  moving,
  onLongPress,
  onPickDate,
  onAdd,
}: {
  date: string;
  today: string;
  sessions: any[];
  state: DayState;
  warnCount: number;
  moving: any | null;
  onLongPress: (s: any) => void;
  onPickDate: (date: string) => void;
  onAdd: (date: string) => void;
}) {
  const timer = useRef<any>(null);
  const longFired = useRef(false);
  const isToday = date === today;
  const mark = STATE_MARK[state];
  /** 変更できるセッション（固定枠は対象外） */
  const editable = sessions.find((s) => !s.isFixed);

  const start = (s: any) => {
    longFired.current = false;
    timer.current = setTimeout(() => {
      longFired.current = true;
      onLongPress(s);
    }, LONG_PRESS_MS);
  };
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
  };

  return (
    <div
      className="card !p-3"
      style={{
        borderColor: isToday ? "rgba(182,255,0,0.35)" : "var(--border)",
        background: moving ? "var(--surface-2)" : "var(--surface)",
      }}
    >
      <div className="flex items-center gap-2.5">
        {/*
          日付をタップしたらその日の記録へ。
          移動中だけは「移動先を選ぶ」に変える。
          長押しで編集シートが開いたときは、そのままだと記録画面にも飛んでしまうので
          クリックを止める（longFired）。
        */}
        <RowBody
          as={moving ? "button" : "link"}
          href={withQuery("/results", { date })}
          onClick={(e: any) => {
            if (longFired.current) {
              longFired.current = false;
              e.preventDefault();
              return;
            }
            if (moving) onPickDate(date);
          }}
        >
          <span
            className="text-[13px] font-bold num w-[52px] flex-shrink-0"
            style={{ color: isToday ? "var(--forge)" : "var(--text)" }}
          >
            {date.slice(5).replace("-", "/")}
          </span>
          <span className="text-[11px] w-[18px] flex-shrink-0" style={{ color: "var(--text-3)" }}>
            {dowOf(date)}
          </span>
          <span className="text-[13px] font-bold w-[16px] flex-shrink-0" style={{ color: mark.color }}>
            {mark.icon}
          </span>
          <span className="min-w-0 flex-1">
            {sessions.length === 0 ? (
              <span className="text-[12px]" style={{ color: "var(--text-3)" }}>
                予定なし
              </span>
            ) : (
              sessions.map((s) => (
                <span
                  key={s.id}
                  className="block text-[12.5px] truncate"
                  onPointerDown={() => start(s)}
                  onPointerUp={cancel}
                  onPointerCancel={cancel}
                  onPointerLeave={cancel}
                  onContextMenu={(e) => e.preventDefault()}
                  style={{ WebkitTouchCallout: "none" } as any}
                >
                  <b style={{ color: CATEGORY_COLORS[s.category as keyof typeof CATEGORY_COLORS] }}>
                    {CATEGORY_LABELS[s.category as keyof typeof CATEGORY_LABELS] ?? s.category}
                  </b>{" "}
                  <span style={{ color: "var(--text-2)" }}>{s.name}</span>
                  {s.isFixed ? (
                    <span className="text-[10px] ml-1" style={{ color: "var(--text-3)" }}>
                      固定
                    </span>
                  ) : null}
                </span>
              ))
            )}
          </span>
        </RowBody>

        {warnCount > 0 ? (
          <Link
            href="/warnings"
            className="text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0"
            style={{ background: "rgba(255,193,7,0.14)", color: "var(--amber)" }}
          >
            !{warnCount}
          </Link>
        ) : null}

        {!moving ? (
          <>
            {/* 長押しはiOSだと取りこぼすことがあるので、押せる場所も置く */}
            {editable ? (
              <button
                className="btn-ghost !py-1.5 !px-2 !text-[12px] flex-shrink-0"
                onClick={() => onLongPress(editable)}
                aria-label="このメニューを変更"
                title="メニューの変更・移動・削除"
              >
                ✎
              </button>
            ) : null}
            <button
              className="btn-ghost !py-1.5 !px-2 !text-[12px] flex-shrink-0"
              onClick={() => onAdd(date)}
              aria-label="この日に練習を足す"
              title="この日に練習を足す"
            >
              ＋
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}

/**
 * 行の本体。
 * 通常はリンク（タップでその日の記録へ）、移動中はボタン（移動先の選択）。
 * リンクとボタンを状況で入れ替えるだけなので、中身は共通にする。
 */
function RowBody({
  as,
  href,
  onClick,
  children,
}: {
  as: "link" | "button";
  href: string;
  onClick: (e: any) => void;
  children: React.ReactNode;
}) {
  const cls = "flex items-center gap-2 min-h-[44px] flex-1 text-left min-w-0";
  if (as === "button") {
    return (
      <button className={cls} onClick={onClick}>
        {children}
      </button>
    );
  }
  return (
    <Link className={cls} href={href} onClick={onClick}>
      {children}
    </Link>
  );
}

// ---------------------------------------------------------------------------
// M-5 予定の編集・追加
// ---------------------------------------------------------------------------

function EditSheet({
  session,
  today,
  onClose,
  onMove,
  onDone,
}: {
  session: any;
  today: string;
  onClose: () => void;
  onMove: () => void;
  onDone: (msg: string) => void;
}) {
  const [prescription, setPrescription] = useState(session.prescription ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [violations, setViolations] = useState<any[]>([]);

  // N-2: 本文に合わせた入力欄。追加シートと同じ実装を使う
  const fields = usePrescriptionFields(prescription, {
    category: session.category ?? "",
    distanceKm: session.distanceKm !== undefined ? String(session.distanceKm) : "",
    durationMin: session.durationMin !== undefined ? String(session.durationMin) : "",
    fallbackKind: session.category === "aerobic" ? "continuous" : "interval",
  });
  const { setSlotTargets } = fields;

  // 初期表示: 保存済みの設定タイムを欄に入れる
  useEffect(() => {
    const tps = session.targetPaces ?? [];
    if (tps.length === 0) return;
    setSlotTargets((prev) =>
      prev.length > 0
        ? prev
        : tps.map((tp: any) => String(Math.round(((tp.targetSecFast + tp.targetSecSlow) / 2) * 10) / 10))
    );
  }, [session.id, setSlotTargets]);

  const save = async (force = false) => {
    setBusy(true);
    setErr("");
    try {
      const updates: any = { prescription, ...prescriptionPayload(fields) };
      if (fields.category) updates.category = fields.category;

      const r = await fetch("/api/plan-edit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: session.id, updates, today, force }),
      });
      const out = await r.json();
      if (out.error) {
        setErr(out.error);
        setViolations(out.newViolations ?? []);
        return;
      }
      onDone("メニューを変更しました。");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    const r = await fetch(
      `/api/plan-edit?sessionId=${encodeURIComponent(session.id)}&date=${today}`,
      { method: "DELETE" }
    );
    const out = await r.json();
    onDone(out.error ?? "予定を削除しました。");
  };

  return (
    <Card title={`${session.date.slice(5).replace("-", "/")} ${session.name}`}>
      <label className="block text-[10.5px] mb-1" style={{ color: "var(--text-3)" }}>
        メニュー本文
      </label>
      <textarea
        rows={3}
        className="w-full mb-1.5"
        style={{ fontSize: 12 }}
        value={prescription}
        onChange={(e) => setPrescription(e.target.value)}
      />

      <PrescriptionFields state={fields} emptyCategoryLabel="カテゴリ" />

      {err ? (
        <p className="text-[11.5px] mb-2" style={{ color: "var(--red)" }}>
          {err}
        </p>
      ) : null}
      {violations.length > 0 ? (
        <div className="mb-2">
          {violations.map((v: any, i: number) => (
            <p key={i} className="text-[11px] mb-1" style={{ color: "var(--red)" }}>
              {v.rule}: {v.message}
            </p>
          ))}
          <button className="btn-ghost !text-[11.5px]" style={{ color: "var(--amber)" }} onClick={() => save(true)}>
            承知のうえで保存する
          </button>
        </div>
      ) : null}

      <div className="flex gap-2 flex-wrap">
        <button className="btn-volt" disabled={busy} onClick={() => save(false)}>
          保存する
        </button>
        <button className="btn-ghost" onClick={onMove}>
          日付を変える
        </button>
        <a className="btn-ghost" href={withQuery("/run", { sessionId: session.id })}>
          走りながら入力
        </a>
        <ConfirmButton
          label="削除"
          title="この予定を削除しますか？"
          message="記録済みの結果は消えません。予定だけを消します。"
          className="btn-ghost"
          onConfirm={remove}
        />
        <button className="btn-ghost" onClick={onClose}>
          閉じる
        </button>
      </div>
    </Card>
  );
}

function AddSheet({
  date,
  today,
  onClose,
  onDone,
}: {
  date: string;
  today: string;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const [name, setName] = useState("");
  const [prescription, setPrescription] = useState("");
  const [timeOfDay, setTimeOfDay] = useState("am");
  const [busy, setBusy] = useState(false);

  /**
   * N-2: 編集シートとまったく同じ入力欄を使う。
   * 本文がまだ読めていない間は有酸素（＝距離と時間の欄）を出す。
   * カテゴリを手で変えれば追従するので、本文なしでも入れられる。
   */
  const fields = usePrescriptionFields(prescription, {
    category: "aerobic",
    fallbackKind: "continuous",
  });

  const add = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/plan-edit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "add",
          today,
          session: {
            date,
            category: fields.category || "aerobic",
            name: name || "手動で追加した練習",
            prescription,
            timeOfDay,
            ...prescriptionPayload(fields),
          },
        }),
      });
      const out = await r.json();
      onDone(out.error ?? "予定を追加しました。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title={`${date.slice(5).replace("-", "/")} に練習を足す`}>
      <p className="text-[11.5px] mb-2.5" style={{ color: "var(--text-2)" }}>
        同じ日に午前と午後の2本を残したいときにも使います。
      </p>
      <input
        className="w-full mb-2 !text-[12px]"
        placeholder="名前（例: 朝ジョグ）"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <input
        className="w-full mb-2 !text-[12px]"
        placeholder="内容（例: 30分ジョグ / 300m×5 @41.5秒 r5分）"
        value={prescription}
        onChange={(e) => setPrescription(e.target.value)}
      />

      <PrescriptionFields state={fields} />

      <label className="text-[10px] block mb-2.5" style={{ color: "var(--text-3)" }}>
        <span className="block mb-0.5">時間帯</span>
        <select
          className="!text-[12px] !py-1"
          style={{ width: 90 }}
          value={timeOfDay}
          onChange={(e) => setTimeOfDay(e.target.value)}
        >
          <option value="am">午前</option>
          <option value="pm">午後</option>
        </select>
      </label>
      <div className="flex gap-2">
        <button className="btn-volt" disabled={busy} onClick={add}>
          追加する
        </button>
        <button className="btn-ghost" onClick={onClose}>
          やめる
        </button>
      </div>
    </Card>
  );
}
