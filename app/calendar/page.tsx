"use client";
import * as React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Card, CATEGORY_COLORS, CATEGORY_LABELS, ConfirmButton, StatusText, ViolationList } from "../components/ui";
import { withQuery } from "../components/route-query";
import {
  PrescriptionFields,
  prescriptionPayload,
  usePrescriptionFields,
} from "../components/prescription-fields";
import { shortPrescription } from "@/lib/core/prescriptionSummary";
import { SessionEditSheet } from "../components/session-edit-sheet";
import {
  loadCalendarAnchor,
  loadViewPref,
  saveCalendarAnchor,
  saveViewPref,
} from "../components/view-pref";
import { localToday } from "@/lib/core/dates";
import type { CoverageReview } from "@/lib/core/coverage";
import type { Race, Session, SessionResult } from "@/lib/core/types";
import { actualDiffersFromPlan, describeActualResult } from "@/lib/core/actualVsPlan";
import { sessionView } from "@/lib/core/horizon";
import { intensityMark, type IntensityMark } from "@/lib/core/trainingClassification";

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
/** 覚えてよい表示期間。ここに無い値が保存されていたら既定に戻す */
const CALENDAR_MODES = ["week", "month"] as const;
const CALENDAR_WEEKS = [1, 2, 4] as const;

function weekStart(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  const dow = d.getUTCDay();
  return addDays(dateStr, dow === 0 ? -6 : 1 - dow);
}
function monthStart(dateStr: string): string {
  return dateStr.slice(0, 8) + "01";
}
/**
 * 月を足し引きして、その月の1日を返す。
 *
 * 以前は `addDays(monthStart(a), dir * 30)` で代用していたが、31日ある月では
 * 1日 + 30日 = 同じ月の31日 になり、その monthStart がまた同じ月の1日に戻る。
 * 結果、8月・10月・12月などでは「→」を押しても永久に進まなかった。
 * 日数ではなく月そのものを動かす。
 */
function addMonths(dateStr: string, months: number): string {
  const year = Number(dateStr.slice(0, 4));
  const month = Number(dateStr.slice(5, 7)) - 1 + months;
  const d = new Date(Date.UTC(year, month, 1));
  return d.toISOString().slice(0, 10);
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

/**
 * 強度マーカー（reference-ui の calendar.jpeg）。
 * 高=四角 / 中=丸 / 低=三角 / 休=線。色は補助で、判別の主役は形。
 */
const INTENSITY_LABEL: Record<IntensityMark, string> = {
  high: "高",
  medium: "中",
  low: "低",
  off: "休",
};

function IntensityShape({ mark }: { mark: IntensityMark }) {
  const color = mark === "off" ? "var(--text-3)" : "var(--forge)";
  const common = { width: 9, height: 9, flexShrink: 0 } as const;
  if (mark === "off") {
    return <span aria-hidden style={{ ...common, height: 2, background: color, borderRadius: 1 }} />;
  }
  if (mark === "high") {
    return <span aria-hidden style={{ ...common, background: color, borderRadius: 1 }} />;
  }
  if (mark === "medium") {
    return <span aria-hidden style={{ ...common, background: color, borderRadius: "50%" }} />;
  }
  // 低: 三角。border で作る（SVGを増やさない）
  return (
    <span
      aria-hidden
      style={{
        width: 0,
        height: 0,
        flexShrink: 0,
        borderLeft: "5px solid transparent",
        borderRight: "5px solid transparent",
        borderBottom: `9px solid ${color}`,
      }}
    />
  );
}

function IntensityLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {(["high", "medium", "low", "off"] as IntensityMark[]).map((m) => (
        <span key={m} className="flex items-center gap-1.5 text-[10.5px]" style={{ color: "var(--text-3)" }}>
          <IntensityShape mark={m} />
          {INTENSITY_LABEL[m]}
        </span>
      ))}
    </div>
  );
}

interface EditConflict {
  sessionId: string;
  date: string;
  error?: string;
  newViolations?: { rule: string; message: string }[];
  alternatives?: { date: string; note: string }[];
}

export default function CalendarPage() {
  const todayStr = localToday();
  /*
   * 表示期間は端末に覚えさせる（`view-pref.ts`）。
   * 既定を2週間から1週間に変えたのは、1週間ぶんが1画面に収まって
   * 「今週なにをやるか」が最初に目に入るため。長い範囲は見たいときに選ぶ。
   *
   * 保存キーに `.v2` を付けているのは、既定を1週間に変える前に端末へ
   * 保存された値（2週間・4週間）がそのまま残り、既定を変えても端末側は
   * 4週間で開き続けていたため。キーを変えることで一度だけ既定に戻す。
   * 変えたあとの選択はこれまで通り覚える。
   *
   * 読み込みはマウント後の useEffect でやる。useState の初期値で
   * localStorage を読むと、Next.js側（サーバーで一度描く）と食い違って
   * hydration エラーになる。
   */
  const [mode, setMode] = useState<"week" | "month">("week");
  const [anchor, setAnchor] = useState(weekStart(todayStr));
  const [weeks, setWeeks] = useState(1);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [results, setResults] = useState<any[]>([]);
  const [injuries, setInjuries] = useState<any[]>([]);
  const [races, setRaces] = useState<Race[]>([]);
  const [violationsByDate, setViolationsByDate] = useState<Record<string, number>>({});
  const [violations, setViolations] = useState<any[]>([]);
  const [moving, setMoving] = useState<any | null>(null);
  const [editing, setEditing] = useState<any | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [conflict, setConflict] = useState<EditConflict | null>(null);
  const [msg, setMsg] = useState("");
  const loadSequence = useRef(0);

  const from = mode === "week" ? anchor : monthStart(anchor);
  const span = mode === "week" ? weeks * 7 : 42;

  // 覚えてある表示期間を復元する（マウント時の1回だけ）
  useEffect(() => {
    setMode(loadViewPref("calendar.mode", CALENDAR_MODES, "week"));
    setWeeks(loadViewPref("calendar.weeks.v2", CALENDAR_WEEKS, 1));
    /*
     * 見ていた週へ戻す。
     * 先の週を見て日付をタップ → メニューを見て戻ると、画面が作り直されて
     * 今週に戻っていた。予定を組んでいる最中だと、毎回そこまで送り直すことになる。
     */
    const remembered = loadCalendarAnchor(todayStr);
    if (remembered) setAnchor(remembered);
  }, [todayStr]);

  /*
   * 見ている週を覚える。
   * setAnchor を呼ぶ場所ごとに保存を書くと、経路が増えたときに書き忘れて
   * 「送った週が戻る」がまた起きる。変化を1か所で拾う。
   */
  useEffect(() => {
    saveCalendarAnchor(anchor);
  }, [anchor]);

  const changeMode = (next: "week" | "month") => {
    setMode(next);
    saveViewPref("calendar.mode", next);
  };
  const changeWeeks = (next: number) => {
    setWeeks(next);
    saveViewPref("calendar.weeks.v2", next);
  };

  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    const to = addDays(from, span - 1);
    try {
      const [sessionResponse, resultResponse, injuryResponse, dashboardResponse] =
        await Promise.all([
          fetch(`/api/sessions?from=${from}&to=${to}`, { cache: "no-store" }),
          fetch("/api/results", { cache: "no-store" }),
          fetch("/api/injuries", { cache: "no-store" }),
          fetch("/api/dashboard", { cache: "no-store" }),
        ]);
      const [sessionData, resultData, injuryData, dashboardData] = await Promise.all([
        sessionResponse.json(),
        resultResponse.json(),
        injuryResponse.json(),
        dashboardResponse.json(),
      ]);
      // 表示期間の切替や保存直後の再取得が競合しても、最後に開始した取得だけを反映する。
      if (sequence !== loadSequence.current) return;
      setSessions(sessionData.sessions ?? []);
      setResults(resultData.results ?? []);
      setInjuries(injuryData.injuries ?? []);
      setViolationsByDate(dashboardData.violationsByDate ?? {});
      setViolations(dashboardData.violations ?? []);
      setRaces(
        dashboardData.races ??
          (dashboardData.targetRace ? [dashboardData.targetRace] : [])
      );
    } catch (error) {
      if (sequence === loadSequence.current) {
        setMsg(`カレンダーを再取得できませんでした: ${String(error)}`);
      }
    }
  }, [from, span]);

  useEffect(() => {
    void load();
  }, [load]);

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

  /** 中止した予定を戻す（押し間違いの取り消し） */
  const restoreSkipped = async (s: Session) => {
    const res = await fetch(
      `/api/skip?sessionId=${encodeURIComponent(s.id)}&date=${todayStr}`,
      { method: "DELETE" }
    );
    const d = await res.json();
    setMsg(d.error ?? `${s.name} を予定に戻しました。`);
    if (!d.error) setViolations(d.violations ?? []);
    load();
  };

  const days: string[] = [];
  for (let i = 0; i < span; i++) days.push(addDays(from, i));

  const sessionsByDate = new Map<string, Session[]>();
  for (const s of sessions) {
    if (!sessionsByDate.has(s.date)) sessionsByDate.set(s.date, []);
    sessionsByDate.get(s.date)!.push(s);
  }
  const resultBySessionId = new Map<string, SessionResult>(
    results.map((r: SessionResult) => [r.sessionId, r])
  );
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

  /**
   * C-3: 横スワイプでの週送り。
   *
   * 以前は指の横移動だけを見て 60px 超えたら週を送っていた。
   * この画面は日付が縦に何十行も並ぶので実際の操作はほぼ縦スクロールで、
   * 指が弧を描いて横に60px流れることが普通に起きる。
   * 結果「スクロールしただけなのに週が飛ぶ」状態になっていた。
   *
   * 横送りと判定するのは、次を全部満たしたときだけにする。
   *   - 指が1本（ピンチ・二本指スクロールを除く）
   *   - 横に60px以上（誤差では届かない距離）
   *   - 横が縦の1.5倍以上（縦スクロールのついでの横流れを弾く）
   *   - 600ms以内（ゆっくり指を這わせる動きはスワイプではない）
   */
  const touchStart = useRef<{ x: number; y: number; t: number } | null>(null);
  const onTouchStart = (e: any) => {
    if (e.touches.length !== 1) {
      touchStart.current = null;
      return;
    }
    touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
  };
  const onTouchEnd = (e: any) => {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start) return;
    if (e.changedTouches.length !== 1) return;
    const dx = e.changedTouches[0].clientX - start.x;
    const dy = e.changedTouches[0].clientY - start.y;
    if (Math.abs(dx) < 60) return;
    if (Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (Date.now() - start.t > 600) return;
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

  /*
   * 起点を動かすのはここだけにする。
   * setAnchor を直に呼ぶ場所が増えると、覚えるのを書き忘れて
   * 「送った週が戻る」が別の経路でまた起きる。
   */
  const shift = (dir: number) =>
    setAnchor((a) => (mode === "week" ? addDays(a, dir * 7) : addMonths(a, dir)));

  return (
    <div className="calendar-screen flex flex-col gap-3">
      <Card className="calendar-controls">
        <div className="flex gap-2 items-center flex-wrap">
          <button
            className="btn-ghost !py-1.5 !px-2.5 !text-[12px] min-w-[44px]"
            aria-label="前の期間"
            onClick={() => shift(-1)}
          >
            ←
          </button>
          <span className="text-[13px] font-semibold num flex-1 text-center">
            {from} 〜 {addDays(from, span - 1)}
          </span>
          <button
            className="btn-ghost !py-1.5 !px-2.5 !text-[12px] min-w-[44px]"
            aria-label="次の期間"
            onClick={() => shift(1)}
          >
            →
          </button>
        </div>
        <div className="flex gap-2 items-center flex-wrap mt-2">
          <div className="seg flex-1" role="group" aria-label="カレンダー表示期間">
            <button
              aria-pressed={mode === "week"}
              data-on={mode === "week" ? "1" : "0"}
              onClick={() => changeMode("week")}
            >
              週
            </button>
            <button
              aria-pressed={mode === "month"}
              data-on={mode === "month" ? "1" : "0"}
              onClick={() => changeMode("month")}
            >
              月
            </button>
          </div>
          {mode === "week" ? (
            <select
              className="!text-[12px] !py-1.5"
              value={weeks}
              onChange={(e) => changeWeeks(Number(e.target.value))}
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
        {/*
          操作の説明は毎回読むものではない。常時3行を占有していたのを畳んだ。
          初見で迷わないよう、見出し自体は残す。
        */}
        <details className="mt-2.5">
          <summary className="text-[11px] cursor-pointer" style={{ color: "var(--text-3)" }}>
            操作のしかた
          </summary>
          <p className="text-[11px] leading-relaxed mt-1.5" style={{ color: "var(--text-3)" }}>
            日付の行をタップするとその日の記録を入力できます。
            ✎ でメニューの変更・移動・削除、＋ でその日に練習を足せます（セッションの長押しでも同じです）。
          </p>
        </details>
      </Card>

      {msg ? (
        <Card>
          <p className="text-[12.5px]">{msg}</p>
        </Card>
      ) : null}

      {/*
        S-12: 4週間のバランスはカレンダーで気づけると効く。
        予定を組み替えるのはこの画面なので、「何が足りないか」をここに1行で出し、
        詳しい内訳と入れ替えは分析タブに任せる（ここに全部置くと日付が見えなくなる）。
      */}
      <CoverageStrip />

      {editing ? (
        <SessionEditSheet
          session={editing}
          today={todayStr}
          onClose={() => setEditing(null)}
          onMove={() => {
            setMoving(editing);
            setEditing(null);
            setMsg(`${editing.name} の移動先の日付をタップしてください。`);
          }}
          onDone={(m, savedSession) => {
            if (savedSession) {
              setSessions((current) =>
                current.map((session) =>
                  session.id === savedSession.id ? savedSession : session
                )
              );
            }
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
            <StatusText key={i} kind="error" className="text-[12px] leading-relaxed mb-1.5">
              {v.rule}: {v.message}
            </StatusText>
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

      <div
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        className="calendar-day-list flex flex-col gap-1.5"
      >
        {days.map((date) => (
          <DayRow
            key={date}
            date={date}
            today={todayStr}
            sessions={sessionsByDate.get(date) ?? []}
            races={races.filter((race) => race.dateStart === date)}
            resultBySessionId={resultBySessionId}
            state={stateOf(date)}
            warnCount={violationsByDate[date] ?? 0}
            moving={moving}
            /*
             * 固定枠もシートを開く。中身は変えられないが（RULE-15）、
             * 「やらなかった」ことは起きるので、そこだけは本人が記録できる必要がある。
             * 以前はここで断って何もできなかったため、流れたチーム練習が
             * 予定として残り続けていた。断り文はシート側に移してある。
             */
            onLongPress={(s) => {
              scrollToTop();
              setEditing(s);
              setMsg("");
            }}
            onAdd={(d) => {
              scrollToTop();
              setAdding(d);
            }}
            onPickDate={(d) => moving && moveSession(moving.id, d)}
            onRestore={restoreSkipped}
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
        <p className="forge-label mb-2" style={{ fontSize: 10 }}>
          強度
        </p>
        <IntensityLegend />
        <p className="forge-label mt-3.5 mb-2" style={{ fontSize: 10 }}>
          その日の状態
        </p>
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

const COVERAGE_JP: Record<string, string> = {
  high_lactate: "高乳酸",
  race_economy: "経済走",
  modeling: "モデリング",
  neural: "神経系",
  cv: "CV",
  threshold: "閾値",
  aerobic: "有酸素",
  off: "休養",
};

/**
 * S-12 4週間のバランスの要約（1行）。
 *
 * 予定を組み替えるのはカレンダーなので、「何が足りていないか」はここで気づけるべき。
 * ただし内訳の表まで置くと日付が押し出されるので、
 * 出すのは不足しているもの1つと、分析タブへの導線だけにする。
 */
function CoverageStrip() {
  const [d, setD] = useState<CoverageReview | null>(null);

  useEffect(() => {
    fetch("/api/coverage")
      .then((r) => r.json())
      .then((x) => setD(x.review ?? null))
      .catch(() => setD(null));
  }, []);

  if (!d) return null;
  const topSignal = d.balance.signals.find((signal) => signal.level === "warn");
  const top = d.proposals[0];

  return (
    <Card>
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="metric-label">4週間のバランス</span>
        <Link href="/analysis" className="text-[11px]" style={{ color: "var(--text-3)" }}>
          内訳を見る →
        </Link>
      </div>
      {/*
        結論と「で、どうするのか」を2行に分ける（S-12: 行動が出ていること）。
        以前は1つの段落で3行に折り返していて、予定が画面外へ押し出されていた。
        行動を削るのは不可——何が足りないかだけ言って終わる画面にはしない。
      */}
      {topSignal ? (
        <>
          <p className="text-[12.5px] truncate">
            <b style={{ color: "var(--amber)" }}>{topSignal.message}</b>
          </p>
          <p className="text-[11.5px] truncate mt-0.5" style={{ color: "var(--text-3)" }}>
            次の行動: {topSignal.action}
          </p>
        </>
      ) : top ? (
        <>
          <p className="text-[12.5px] truncate">
            <b style={{ color: "var(--amber)" }}>
              {COVERAGE_JP[top.category] ?? top.category}が{top.shortfall}回 足りていません
            </b>
          </p>
          <p className="text-[11.5px] truncate mt-0.5" style={{ color: "var(--text-3)" }}>
            入れ替えるなら分析タブから選べます
          </p>
        </>
      ) : (
        <p className="text-[12.5px]" style={{ color: "var(--text-2)" }}>
          予定と実施の4週推移に、今すぐ直す警告はありません。
        </p>
      )}
    </Card>
  );
}

function DayRow({
  date,
  today,
  sessions,
  races,
  resultBySessionId,
  state,
  warnCount,
  moving,
  onLongPress,
  onPickDate,
  onAdd,
  onRestore,
}: {
  date: string;
  today: string;
  sessions: Session[];
  races: Race[];
  resultBySessionId: Map<string, SessionResult>;
  state: DayState;
  warnCount: number;
  moving: any | null;
  onLongPress: (s: any) => void;
  onPickDate: (date: string) => void;
  onAdd: (date: string) => void;
  onRestore: (s: Session) => void;
}) {
  const timer = useRef<any>(null);
  const longFired = useRef(false);
  const isToday = date === today;
  const mark = STATE_MARK[state];
  /*
   * 中止した予定は一覧から外す。
   * やらなかったチーム練習が予定として並び続けると、カレンダーが
   * これからやることの一覧ではなくなる。消してはいない（実施率には残る）ので、
   * 下に小さく件数を出して戻せるようにする。
   */
  /*
   * 2部練習の日は午前を先に出す。
   *
   * これまで並べ替えていなかったので、保存された順によっては
   * **午後の本練習が先、午前のジョグが後**に並んでいた。
   * その日を上から読むと逆順になり、朝に何をやるのかが下にある。
   * 実際にやる順に並べる。
   */
  const activeSessions = sessions
    .filter((s) => s.status !== "skipped")
    .slice()
    .sort((a, b) => (a.timeOfDay === b.timeOfDay ? 0 : a.timeOfDay === "am" ? -1 : 1));
  const skippedSessions = sessions.filter((s) => s.status === "skipped");
  /**
   * ✎を出すセッション。
   * 不具合: 1日に複数セッションがあるとき、✎ボタンが最初の1件しか
   * 対象にしていなかった。長押しは行ごとに正しく対象を拾えているが、
   * iOSでは長押しが取りこぼされることがあるため、確実な✎導線も
   * セッションの数だけ出す。
   * 固定枠も対象にする——内容は変えられないが「やらなかった」は記録できる。
   */
  const editableSessions = activeSessions;

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
      /* 1画面に入る日数を増やすため、行の余白を詰める（予定そのものを主役にする） */
      className="card !px-3 !py-2"
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
            {activeSessions.length === 0 && races.length === 0 ? (
              <span className="text-[12px]" style={{ color: "var(--text-3)" }}>
                予定なし
              </span>
            ) : (
              <>
                {races.map((race) => (
                  <span key={race.id} className="block text-[12.5px] truncate">
                    <b style={{ color: "var(--cat-modeling)" }}>レース {race.priority}</b>{" "}
                    <span style={{ color: "var(--text-2)" }}>{race.name}</span>
                  </span>
                ))}
                {activeSessions.map((s: Session) => {
                  const result = resultBySessionId.get(s.id);
                  const diverged = actualDiffersFromPlan(s, result);
                  const actualText = diverged ? describeActualResult(result) : undefined;
                  // 確定範囲の外は設定ペースを出さない（素案。horizon.ts が唯一の判断）
                  const view = sessionView(s, today);
                  return (
                    <span
                      key={s.id}
                      className="block text-[12.5px] truncate"
                      /*
                        1日の行は1つのリンクの中に複数セッションが並ぶ。
                        並び順（午前が先）を検査するために、1件ずつ目印を付ける。
                        リンク単位では数えられない。
                      */
                      data-calendar-session={s.timeOfDay}
                      onPointerDown={() => start(s)}
                      onPointerUp={cancel}
                      onPointerCancel={cancel}
                      onPointerLeave={cancel}
                      onContextMenu={(e) => e.preventDefault()}
                      style={{ WebkitTouchCallout: "none" } as any}
                    >
                      {/*
                        強度は形で示す（色だけに頼らない）。
                        カテゴリ名は色つきの文字で残す——形は4段階しかなく、
                        「高乳酸」と「経済走」の区別は形からは付かないため。
                      */}
                      <span className="inline-flex items-center gap-1.5 align-middle mr-1.5">
                        {/*
                          2部練習の日だけ「午前」を出す。
                          普段の練習は午後なので、午後側には何も付けない——
                          全部に付けると、印が付いていること自体が情報でなくなる。
                        */}
                        {s.timeOfDay === "am" ? (
                          <span
                            className="text-[10px] px-1 py-0.5 rounded"
                            style={{ background: "var(--surface-2)", color: "var(--text-2)" }}
                          >
                            午前
                          </span>
                        ) : null}
                        <IntensityShape mark={intensityMark(s.category)} />
                        <b style={{ color: CATEGORY_COLORS[s.category as keyof typeof CATEGORY_COLORS] }}>
                          {CATEGORY_LABELS[s.category as keyof typeof CATEGORY_LABELS] ?? s.category}
                        </b>
                      </span>
                      <span
                        style={{ color: "var(--text-2)" }}
                        className={diverged ? "line-through" : undefined}
                      >
                        {s.name}
                      </span>
                      {s.isFixed ? (
                        <span className="text-[10px] ml-1" style={{ color: "var(--text-3)" }}>
                          固定
                        </span>
                      ) : null}
                      {view.badge ? (
                        <span className="text-[10px] ml-1" style={{ color: "var(--text-3)" }}>
                          {view.badge}
                        </span>
                      ) : null}
                      {diverged && actualText ? (
                        <span
                          className="block text-[10.5px] truncate"
                          style={{ color: "var(--forge)" }}
                        >
                          実際: {actualText}
                        </span>
                      ) : view.prescription ? (
                        <span
                          className="block text-[10.5px] truncate"
                          style={{ color: "var(--text-3)" }}
                        >
                          {/*
                            距離×本数と設定タイムだけに詰める。
                            原文をそのまま置いて CSS で切ると、
                            `@300m 41.2〜41.6秒` の手前で切れて
                            **一番見たい設定タイムが真っ先に消える**。
                            読み取れない形なら原文をそのまま出す。
                          */}
                          {shortPrescription(view.prescription) ?? view.prescription}
                        </span>
                      ) : null}
                    </span>
                  );
                })}
              </>
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
            {/*
              長押しはiOSだと取りこぼすことがあるので、押せる場所も置く。
              セッションが複数ある日は、それぞれに届くようボタンも複数出す
              （色をカテゴリと揃えて、どの行に対応するか分かるようにする）。
            */}
            {editableSessions.map((s) => (
              <button
                key={s.id}
                className="btn-ghost !py-1.5 !px-2 !text-[12px] flex-shrink-0"
                style={editableSessions.length > 1 ? { borderColor: CATEGORY_COLORS[s.category as keyof typeof CATEGORY_COLORS], color: CATEGORY_COLORS[s.category as keyof typeof CATEGORY_COLORS] } : undefined}
                onClick={() => onLongPress(s)}
                aria-label={`「${s.name}」を変更`}
                title={`「${s.name}」の変更・移動・削除`}
              >
                ✎
              </button>
            ))}
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

      {/*
        中止した予定。一覧からは外してあるが、押し間違いに気づけるよう
        ここに小さく残す。「戻す」で予定に復帰する（固定枠は手で作り直せないため必須）。
      */}
      {skippedSessions.length > 0 && !moving ? (
        <div className="flex items-center gap-2 flex-wrap mt-1 pl-[52px]">
          <span className="text-[10.5px] line-through" style={{ color: "var(--text-3)" }}>
            中止 {skippedSessions.map((s) => s.name).join("・")}
          </span>
          {skippedSessions.map((s) => (
            <button
              key={s.id}
              className="btn-ghost !py-0.5 !px-1.5 !text-[10.5px] flex-shrink-0"
              onClick={() => onRestore(s)}
              aria-label={`「${s.name}」の中止を取り消す`}
            >
              戻す
            </button>
          ))}
        </div>
      ) : null}
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
      <div className="flex gap-2 flex-wrap">
        <button className="btn-volt" disabled={busy} onClick={add}>
          追加する
        </button>
        <button className="btn-ghost" onClick={onClose}>
          やめる
        </button>
      </div>
      <p className="text-[11px] mt-3 mb-1.5" style={{ color: "var(--text-3)" }}>
        新しい予定を足すのではなく、{date.slice(5).replace("-", "/")}
        に既にやった練習の結果を記録したい場合はこちら。
      </p>
      <Link href={withQuery("/results", { date })} className="btn-ghost inline-block">
        この日を記録する
      </Link>
    </Card>
  );
}
