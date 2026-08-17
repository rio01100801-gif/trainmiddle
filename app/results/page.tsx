"use client";
import { useCallback, useEffect, useState } from "react";
import {
  Card,
  CategoryBadge,
  CATEGORY_LABELS,
  ChangeList,
  ConfirmButton,
  Scale5,
  Sparkline,
  StatusText,
  UndoBar,
  ViolationList,
  fmtPace,
  fmtSec,
} from "../components/ui";
import { apiRequest } from "../components/api-client";
import { localToday } from "@/lib/core/dates";
import { useQueryParam } from "../components/route-query";
import {
  completeRunTriple,
  fmtPaceSecPerKm,
  formatTimeInput,
  parsePaceToSecPerKm,
} from "@/lib/core/inputFormat";
import { parseRest } from "@/lib/core/bulkImport";
import { avgPaceSecPerKm, buildRepResults, REST_LABELS } from "@/lib/core/workoutLog";
import { evaluateEnvironment, environmentNote, WIND_LABELS } from "@/lib/core/environment";
import {
  ABORT_CAUSE_OPTIONS,
  BODY_PARTS,
  BODY_PART_OPTIONS,
  ChipGroup,
  ChipMultiGroup,
  INJURY_STATUS_OPTIONS,
  LEGS_OPTIONS,
  REST_MODE_OPTIONS,
  REST_TYPE_OPTIONS,
  SKIP_OPTIONS,
  SUBJECTIVE_OPTIONS,
  SnapSlider,
  Stepper,
  WIND_OPTIONS,
  SURFACE_OPTIONS,
  SURFACE_TAGS,
  WEATHER_OPTIONS,
  WEATHER_TAGS,
  abortCauseHint,
  describePain,
  describeRpe,
} from "../components/inputs";
import {
  needsInjuryLog,
  normalizeAbortCause,
  type AbortCause,
} from "@/lib/core/abortCause";
import { normalizeConditions } from "@/lib/core/conditions";
import { checkResultDraft } from "@/lib/core/resultDraft";
import {
  buildContinuousPayload,
  buildIntervalPayload,
  parsePerRepRestInput,
  parseRepTime,
  parseRestInput,
} from "@/lib/core/resultPayload";
import { shoeChoices, type ShoeUsage } from "@/lib/core/shoes";
import {
  WARMUP_BREATHING_LABELS,
  WARMUP_LEGS_LABELS,
  WARMUP_SEGMENT_KINDS,
  WARMUP_SEGMENT_LABELS,
  WARMUP_SOURCE_LABELS,
  summarizeWarmup,
  warmupTotalsFromSegments,
  type WarmupBreathing,
  type WarmupLegs,
  type WarmupRecord,
} from "@/lib/core/warmup";
import { PAIN_MAX, PAIN_MIN, RPE_MAX, RPE_MIN, isValidRpe } from "@/lib/core/rpe";
import type {
  FitnessMarkerPurpose,
  NextDayLegs,
  RestType,
  RuleViolation,
  SessionCategory,
  SkipReason,
  Subjective,
} from "@/lib/core/types";
import type { AerobicProfile } from "@/lib/core/pace";
import { describeComposition, type PrescriptionStructure } from "@/lib/core/prescription";

// ---------------------------------------------------------------------------

/**
 * 記録タブ（改修指示書 フェーズD）
 *
 * 現行は4つの機能が1画面に縦積みで、目的の入力欄に届くまでスクロールが要った。
 * セグメントで分割し、その日にまだ入力していないものを初期表示にする。
 * 練習結果の期間制限（直近2週間＋今後1週間）は撤廃し、日付指定で任意の日を入れられる。
 */
const SEGMENTS = [
  { key: "condition", label: "コンディション" },
  { key: "result", label: "練習結果" },
  { key: "marker", label: "実測データ" },
  { key: "injury", label: "故障" },
] as const;
type SegKey = (typeof SEGMENTS)[number]["key"];

export default function ResultsPage() {
  const qDate = useQueryParam("date");
  const qSession = useQueryParam("sessionId");
  const [date, setDate] = useState(qDate ?? localToday());
  const [seg, setSeg] = useState<SegKey | null>(null);
  const [sessions, setSessions] = useState<any[]>([]);
  const [selected, setSelected] = useState<any | null>(null);
  const [out, setOut] = useState<any | null>(null);
  const [checks, setChecks] = useState<any[]>([]);
  const [results, setResults] = useState<any[]>([]);

  // カレンダーから日付付きで来たら、その日付を選択済みにして開く（D-2）
  useEffect(() => {
    if (qDate) setDate(qDate);
  }, [qDate]);

  const load = useCallback(() => {
    // D-2: 期間制限を撤廃。全セッションから日付で絞り込む
    fetch("/api/sessions")
      .then((r) => r.json())
      .then((d) =>
        setSessions(
          (d.sessions ?? []).filter((s: any) => s.category !== "off" && s.status !== "skipped")
        )
      );
    fetch("/api/daily").then((r) => r.json()).then((d) => setChecks(d.checks ?? []));
    fetch("/api/results").then((r) => r.json()).then((d) => setResults(d.results ?? []));
  }, []);
  useEffect(load, [load]);

  const daySessions = sessions.filter((s) => s.date === date);
  const recordedIds = new Set(results.map((r) => r.sessionId));
  const hasCheck = checks.some((c) => c.date === date);
  const hasResult = daySessions.some((s) => recordedIds.has(s.id));

  // D-1: その日に未入力のものを自動選択する
  useEffect(() => {
    if (seg !== null) return;
    if (qSession) setSeg("result");
    else if (!hasCheck) setSeg("condition");
    else if (daySessions.length > 0 && !hasResult) setSeg("result");
    else setSeg("condition");
  }, [seg, qSession, hasCheck, hasResult, daySessions.length]);

  // sessionId 指定で来たらそのセッションを選択済みにする
  useEffect(() => {
    if (!qSession || selected) return;
    const found = sessions.find((s) => s.id === qSession);
    if (found) setSelected(found);
  }, [qSession, sessions, selected]);

  const cur = seg ?? "condition";

  return (
    <div className="results-screen flex flex-col gap-3">
      <Card className="screen-controls" variant="quiet">
        <div className="flex items-center gap-2 mb-2.5">
          <label className="text-[11.5px] flex-shrink-0" style={{ color: "var(--text-3)" }}>
            日付
          </label>
          <input
            type="date"
            className="flex-1"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setSelected(null);
              setOut(null);
            }}
          />
        </div>
        <div className="seg" role="group" aria-label="記録する内容">
          {SEGMENTS.map((x) => {
            const done =
              x.key === "condition" ? hasCheck : x.key === "result" ? hasResult : false;
            return (
              <button
                key={x.key}
                aria-pressed={cur === x.key}
                data-on={cur === x.key ? "1" : "0"}
                onClick={() => setSeg(x.key)}
              >
                {x.label}
                {done ? <span style={{ color: "var(--forge)" }}> ✓</span> : null}
              </button>
            );
          })}
        </div>
      </Card>

      {cur === "condition" ? <DailyCheckCard date={date} /> : null}
      {cur === "marker" ? <AerobicMarkerForm defaultDate={date} /> : null}
      {cur === "injury" ? <InjuryCard sessions={daySessions} date={date} /> : null}

      {cur === "result" ? (
        <Card title="練習結果の入力">
          {daySessions.length === 0 ? (
            <p className="text-[12px] leading-relaxed" style={{ color: "var(--text-2)" }}>
              {date} に予定されたセッションがありません。日付を変えるか、
              「過去データ」からまとめて入力してください。
            </p>
          ) : (
            <>
              <div className="grid md:grid-cols-2 gap-1.5 mb-3">
                {daySessions.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => {
                      setSelected(s);
                      setOut(null);
                    }}
                    className="text-left text-[11px] rounded-lg p-2.5 border min-h-[44px]"
                    style={{
                      borderColor: selected?.id === s.id ? "var(--forge)" : "var(--border)",
                      background: selected?.id === s.id ? "var(--volt-dim)" : "transparent",
                    }}
                  >
                    <CategoryBadge category={s.category} />
                    <div className="truncate" style={{ color: "var(--text-2)" }}>
                      {s.name} {recordedIds.has(s.id) ? "✓済" : ""}
                    </div>
                  </button>
                ))}
              </div>
              {selected ? (
                <ResultForm
                  key={selected.id}
                  session={selected}
                  existing={results.find((r) => r.sessionId === selected.id)}
                  onDone={(o) => {
                    setOut(o);
                    load();
                  }}
                  onDeleted={() => {
                    setOut(null);
                    load();
                  }}
                />
              ) : null}
            </>
          )}
        </Card>
      ) : null}

      {/*
        入れたものがそのまま入っているかを本人が確かめる場所。
        保存直後の「補正結果」はCFEの前後しか出さないので、
        本ごとのタイムとレストが正しく残ったかは確認できなかった。
        複合セット（1000m×4＋200m×3、レストが本ごとに違う）で実際に困った箇所。
      */}
      {results.length > 0 ? <ResultAuditCard results={results} /> : null}

      {out ? (
        <Card title="補正結果（変更差分の提示）">
          <p className="text-[13px]">
            CFE: <b className="num">{fmtSec(out.cfeBefore)}</b> →{" "}
            <b className="num">{fmtSec(out.cfeAfter)}</b>
            {out.cfeApplied ? "" : "（今回の結果ではCFEは更新されません）"}
          </p>
          {(out.guardrailNotes ?? []).map((n: string, i: number) => (
            <p key={i} className="text-[11px] mt-0.5" style={{ color: "var(--text-2)" }}>
              {n}
            </p>
          ))}
          {out.economySignalNote ? (
            <p className="text-[11px] mt-1">{out.economySignalNote}</p>
          ) : null}
          <ChangeList changes={out.changes ?? []} />
          <div className="mt-3">
            <h3 className="text-[12px] font-bold mb-1.5">ルール再検証</h3>
            <ViolationList violations={out.violations ?? []} compact />
          </div>
        </Card>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 保存内容の確認（入れたものがそのまま入っているか）
// ---------------------------------------------------------------------------

/**
 * 保存された結果を本ごとに並べ直して見せる。
 *
 * 判定（CFEに使われたか等）はサービス層が本物の関数から取って返す。
 * ここで書き直すと、実際の処理と説明が食い違ったときに説明のほうが正しく見える。
 */
function ResultAuditCard({ results }: { results: any[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [audit, setAudit] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const open = async (id: string) => {
    if (openId === id) {
      setOpenId(null);
      setAudit(null);
      return;
    }
    setOpenId(id);
    setAudit(null);
    setLoading(true);
    try {
      const d = await fetch(`/api/result-audit?id=${encodeURIComponent(id)}`).then((r) => r.json());
      setAudit(d.audit ?? { error: d.error });
    } finally {
      setLoading(false);
    }
  };

  const recent = [...results].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);

  return (
    <Card title="保存内容の確認">
      <p className="text-[11.5px] leading-relaxed mb-2" style={{ color: "var(--text-3)" }}>
        入力したタイムとレストが、そのまま保存されているかを確認できます。
      </p>
      {recent.map((r) => (
        <div key={r.id} className="border-t pt-2" style={{ borderColor: "var(--border)" }}>
          <button
            className="btn-ghost !text-[11.5px] !py-1.5 w-full !justify-start"
            onClick={() => open(r.id)}
            aria-expanded={openId === r.id}
          >
            {r.date} の記録を{openId === r.id ? "閉じる" : "確認する"}
          </button>
          {openId === r.id ? (
            <div className="mt-1.5">
              {loading ? <p className="text-[11.5px]">読み込み中…</p> : null}
              {audit?.error ? (
                <StatusText kind="error" className="text-[11.5px]">
                  {audit.error}
                </StatusText>
              ) : null}
              {audit?.reps ? (
                <>
                  <p className="text-[11.5px] mb-1" style={{ color: "var(--text-2)" }}>
                    {audit.sessionName}／{audit.reps.length}本
                    {audit.rpe !== undefined ? `／RPE ${audit.rpe}` : ""}
                  </p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-[11.5px]">
                      <thead>
                        <tr style={{ color: "var(--text-3)" }}>
                          <th className="text-left font-normal">本</th>
                          <th className="text-left font-normal">距離</th>
                          <th className="text-left font-normal">タイム</th>
                          <th className="text-left font-normal">レスト</th>
                        </tr>
                      </thead>
                      <tbody className="num">
                        {audit.reps.map((rep: any) => (
                          <tr key={rep.index}>
                            <td>{rep.index}</td>
                            <td>
                              {rep.distanceM ?? "—"}m
                              {rep.plannedDistanceM ? `（予定${rep.plannedDistanceM}m）` : ""}
                            </td>
                            <td>{rep.timeSec ?? "—"}</td>
                            <td>{rep.restLabel ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {audit.mixedDistances ? (
                    <p className="text-[11px] mt-1" style={{ color: "var(--text-3)" }}>
                      距離の違う本が混ざっています。能力の推定には本数の多い距離だけを使います。
                    </p>
                  ) : null}
                  <p className="metric-label mt-2.5 mb-1">この記録の使われ方</p>
                  {(audit.usage ?? []).map((u: any, i: number) => (
                    <p key={i} className="text-[11.5px] leading-relaxed mb-0.5">
                      <b style={{ color: u.used ? "var(--forge)" : "var(--text-3)" }}>
                        {u.used ? "使う" : "使わない"}
                      </b>{" "}
                      <span style={{ color: "var(--text-2)" }}>
                        {u.label}
                        {u.note ? `／${u.note}` : ""}
                      </span>
                    </p>
                  ))}
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      ))}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// 2-2. 日次コンディション（4項目5段階 + 推移グラフ）
// ---------------------------------------------------------------------------

function DailyCheckCard({ date }: { date: string }) {
  const [hr, setHr] = useState("");
  const [legFatigue, setLeg] = useState<number | undefined>();
  const [overallFatigue, setOverall] = useState<number | undefined>();
  const [sleepQuality, setSleep] = useState<number | undefined>();
  const [motivation, setMotivation] = useState<number | undefined>();
  const [out, setOut] = useState<any | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState("");

  const loadHistory = useCallback(() => {
    fetch("/api/daily")
      .then((r) => r.json())
      .then((d) => setHistory(d.checks ?? []));
  }, []);
  useEffect(loadHistory, [loadHistory]);

  /*
   * M-1: その日の記録が既にあれば読み込んで表示したままにする。
   * 空欄で出すと「入力が消えた」ようにしか見えず、
   * 入れ直して二重に登録することになる。
   */
  useEffect(() => {
    const c = history.find((x) => x.date === date);
    setSaved(!!c);
    if (!c) return;
    setHr(c.restingHr !== undefined ? String(c.restingHr) : "");
    setLeg(c.legFatigue ?? c.muscleTightness);
    setOverall(c.overallFatigue);
    setSleep(c.sleepQuality);
    setMotivation(c.motivation);
  }, [date, history]);

  const submit = async () => {
    setSaveError("");
    try {
      const result = await apiRequest("/api/daily", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // D-2: 選択中の日付で記録する（過去日の入力もできるようにする）
          date,
          restingHr: hr ? Number(hr) : undefined,
          legFatigue,
          overallFatigue,
          sleepQuality,
          motivation,
          muscleTightness: legFatigue, // 旧項目との互換（脚の張りとして扱う）
        }),
      });
      setOut(result);
      setSaved(true);
      loadHistory();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "記録できませんでした");
    }
  };

  const color: Record<string, string> = {
    green: "var(--volt)",
    yellow: "var(--amber)",
    red: "var(--red)",
  };
  const icon: Record<string, string> = { green: "●", yellow: "▲", red: "■" };
  const recent = history.slice(-21);

  return (
    <Card title="今日のコンディション（10秒で入力）">
      {saved ? (
        <p className="text-[11.5px] mb-2" style={{ color: "var(--forge)" }}>
          {date} は登録済みです。値はそのまま残してあります。直して保存すれば上書きされます。
        </p>
      ) : null}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <div className="text-[11px] mb-1.5" style={{ color: "var(--text-2)" }}>
            脚の疲労
          </div>
          <Scale5 value={legFatigue} onChange={setLeg} lowLabel="軽い" highLabel="重い" invert />
        </div>
        <div>
          <div className="text-[11px] mb-1.5" style={{ color: "var(--text-2)" }}>
            全身疲労
          </div>
          <Scale5
            value={overallFatigue}
            onChange={setOverall}
            lowLabel="軽い"
            highLabel="重い"
            invert
          />
        </div>
        <div>
          <div className="text-[11px] mb-1.5" style={{ color: "var(--text-2)" }}>
            睡眠状態
          </div>
          <Scale5 value={sleepQuality} onChange={setSleep} lowLabel="悪い" highLabel="良い" />
        </div>
        <div>
          <div className="text-[11px] mb-1.5" style={{ color: "var(--text-2)" }}>
            モチベーション
          </div>
          <Scale5 value={motivation} onChange={setMotivation} lowLabel="低い" highLabel="高い" />
        </div>
      </div>

      <div className="flex gap-2 items-end mt-3 flex-wrap">
        <label className="text-[13px]">
          <span className="block text-[10.5px] mb-1" style={{ color: "var(--text-3)" }}>
            安静時HR（任意）
          </span>
          <input className="w-24" value={hr} onChange={(e) => setHr(e.target.value)} placeholder="48" inputMode="decimal" />
        </label>
        <ConfirmButton
          label={saved ? "上書きして保存する" : "記録する"}
          title="今日のコンディションを記録しますか？"
          message="記録すると、赤信号の場合は直後3日間の高負荷練習が自動で低強度有酸素に置き換わります。"
          className="btn-volt justify-center flex-1 sm:flex-none min-h-[44px]"
          onConfirm={submit}
        />
      </div>

      {saveError ? <StatusText kind="error">{saveError}</StatusText> : null}

      {out ? (
        <div className="mt-3 pt-3 border-t" style={{ borderColor: "var(--border)" }}>
          <p className="text-[13px]">
            <span style={{ color: color[out.signal] }} className="font-bold">
              {icon[out.signal]} {out.signal}
            </span>{" "}
            → {out.action}
          </p>
          {(out.reasons ?? []).map((r: string, i: number) => (
            <p key={i} className="text-[11px]" style={{ color: "var(--text-2)" }}>
              ・{r}
            </p>
          ))}
          {out.changes?.length > 0 ? (
            <StatusText kind="warning" className="text-[11px] mt-1">
              高負荷練習{out.changes.length}件を低強度有酸素に自動置換しました。
            </StatusText>
          ) : null}
        </div>
      ) : null}

      {recent.length >= 2 ? (
        <details className="mt-3 text-[11px]">
          <summary style={{ color: "var(--text-2)" }}>疲労度の推移（直近3週）</summary>
          <div className="mt-2 space-y-2">
            <TrendRow label="脚の疲労" values={recent.map((c) => c.legFatigue)} dates={recent.map((c) => c.date)} color="var(--cat-high-lactate)" />
            <TrendRow label="全身疲労" values={recent.map((c) => c.overallFatigue)} dates={recent.map((c) => c.date)} color="var(--amber)" />
            <TrendRow label="睡眠" values={recent.map((c) => c.sleepQuality)} dates={recent.map((c) => c.date)} color="var(--cat-race-economy)" />
            <TrendRow label="モチベーション" values={recent.map((c) => c.motivation)} dates={recent.map((c) => c.date)} color="var(--volt)" />
          </div>
        </details>
      ) : null}
    </Card>
  );
}

function TrendRow({
  label,
  values,
  dates,
  color,
}: {
  label: string;
  values: (number | undefined)[];
  dates: string[];
  color: string;
}) {
  const pairs = values
    .map((v, i) => ({ v, d: dates[i] }))
    .filter((p): p is { v: number; d: string } => typeof p.v === "number");
  if (pairs.length < 2) return null;
  return (
    <div>
      <div className="text-[10px] mb-0.5" style={{ color: "var(--text-3)" }}>
        {label}
      </div>
      <Sparkline
        values={pairs.map((p) => p.v)}
        labels={pairs.map((p) => p.d.slice(5))}
        color={color}
        height={34}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2-3. 故障ログ
// ---------------------------------------------------------------------------

function InjuryCard({ sessions, date }: { sessions: any[]; date: string }) {
  const [list, setList] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [bodyPart, setBodyPart] = useState("");
  const [painLevel, setPain] = useState("3");
  const [status, setStatus] = useState("onset");
  const [sessionId, setSessionId] = useState("");
  const [note, setNote] = useState("");
  const [undo, setUndo] = useState<any | null>(null);
  const [errorMessage, setErrorMessage] = useState("");

  const load = useCallback(() => {
    fetch("/api/injuries")
      .then((r) => r.json())
      .then((d) => setList(d.injuries ?? []));
  }, []);
  useEffect(load, [load]);

  const save = async () => {
    if (!bodyPart) return;
    setErrorMessage("");
    try {
      await apiRequest("/api/injuries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          bodyPart,
          painLevel: Number(painLevel),
          status,
          sessionId: sessionId || undefined,
          note: note || undefined,
        }),
      });
      setBodyPart("");
      setNote("");
      setOpen(false);
      load();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "故障ログを保存できませんでした");
    }
  };

  const remove = async (inj: any) => {
    try {
      await apiRequest(`/api/injuries?id=${encodeURIComponent(inj.id)}`, { method: "DELETE" });
      setUndo(inj);
      load();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "故障ログを削除できませんでした");
    }
  };

  const restore = async () => {
    if (!undo) return;
    try {
      await apiRequest("/api/injuries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(undo),
      });
      setUndo(null);
      load();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "故障ログを元に戻せませんでした");
    }
  };

  const statusLabel: Record<string, string> = {
    onset: "発生",
    ongoing: "継続",
    recovered: "回復",
  };
  const statusColor: Record<string, string> = {
    onset: "var(--red)",
    ongoing: "var(--amber)",
    recovered: "var(--volt)",
  };

  // 部位ごとにまとめる
  const byPart = new Map<string, any[]>();
  for (const i of list) {
    if (!byPart.has(i.bodyPart)) byPart.set(i.bodyPart, []);
    byPart.get(i.bodyPart)!.push(i);
  }

  return (
    <Card
      title="故障ログ"
      right={
        <button
          className="text-[11px] min-h-[44px] px-2"
          style={{ color: "var(--volt)" }}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "閉じる" : "+ 記録する"}
        </button>
      }
    >
      {errorMessage ? <StatusText kind="error">{errorMessage}</StatusText> : null}
      {open ? (
        <div className="flex flex-col gap-2 mb-3 pb-3 border-b" style={{ borderColor: "var(--border)" }}>
          {/*
            部位はチップで選ぶ。自由記述だと「右アキレス」「右アキレス腱」「Rアキレス」が
            別物として溜まり、同じ場所を繰り返し痛めているのかが後から分からない。
            一覧に無い場所のために自由記述も残す（消すと入れられない場所が出る）。
          */}
          <ChipGroup
            label="部位"
            value={BODY_PARTS.includes(bodyPart) ? bodyPart : undefined}
            onChange={(v) => setBodyPart(v ?? "")}
            options={BODY_PART_OPTIONS}
            columns={3}
            allowEmpty
            emptyLabel="未選択"
            testId="bodypart-chips"
          />
          <label className="text-[13px]">
            <span className="block text-[10.5px] mb-1" style={{ color: "var(--text-3)" }}>
              一覧に無い場所（自由記述）
            </span>
            <input
              className="w-full min-h-[44px]"
              value={BODY_PARTS.includes(bodyPart) ? "" : bodyPart}
              onChange={(e) => setBodyPart(e.target.value)}
              placeholder="例: 右第2中足骨"
            />
          </label>
          <ChipGroup
            label="状態"
            value={status as "onset" | "ongoing" | "recovered"}
            onChange={(v) => setStatus(v ?? "onset")}
            options={INJURY_STATUS_OPTIONS}
            columns={3}
          />
          <SnapSlider
            label="痛みの強さ"
            value={Number(painLevel)}
            onChange={(v) => setPain(String(v))}
            min={PAIN_MIN}
            max={PAIN_MAX}
            describe={describePain}
            emptyHint="0は痛みなしです。"
            testId="pain-slider"
          />
          <label className="text-[13px]">
            <span className="block text-[10.5px] mb-1" style={{ color: "var(--text-3)" }}>
              発生したセッション（任意）
            </span>
            <select
              className="w-full"
              value={sessionId}
              onChange={(e) => setSessionId(e.target.value)}
            >
              <option value="">紐づけない</option>
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.date.slice(5)} {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[13px]">
            <span className="block text-[10.5px] mb-1" style={{ color: "var(--text-3)" }}>
              メモ（任意）
            </span>
            <input className="w-full" value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <ConfirmButton
            label="故障を記録する"
            title="故障を記録しますか？"
            className="btn-volt justify-center min-h-[44px]"
            onConfirm={save}
            disabled={!bodyPart}
          />
        </div>
      ) : null}

      {list.length === 0 ? (
        <p className="text-[11px]" style={{ color: "var(--text-3)" }}>
          記録はありません。違和感の段階で残しておくと、直前の練習との関係が後から追えます。
        </p>
      ) : (
        <div className="space-y-3">
          {[...byPart.entries()].map(([part, items]) => (
            <div key={part}>
              <div className="text-[12px] font-bold mb-1">{part}</div>
              {items.map((i) => {
                const ses = sessions.find((s) => s.id === i.sessionId);
                return (
                  <div
                    key={i.id}
                    className="text-[11px] rounded-lg border p-2 mb-1 flex items-start gap-2"
                    style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}
                  >
                    <span className="num" style={{ color: "var(--text-3)" }}>
                      {i.date.slice(5)}
                    </span>
                    <span className="font-bold" style={{ color: statusColor[i.status] }}>
                      {statusLabel[i.status]}
                    </span>
                    <span className="num">痛み {i.painLevel}/10</span>
                    <span className="flex-1" style={{ color: "var(--text-2)" }}>
                      {ses ? `← ${ses.name}` : ""}
                      {i.note ? ` ${i.note}` : ""}
                    </span>
                    <ConfirmButton
                      label="削除"
                      title="この記録を削除しますか？"
                      message="削除後8秒間は取り消せます。"
                      danger
                      className="btn-ghost !py-1 !px-2 !text-[10px]"
                      onConfirm={() => remove(i)}
                    />
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {undo ? (
        <UndoBar
          message={`「${undo.bodyPart}」の記録を削除しました`}
          onUndo={restore}
          onDismiss={() => setUndo(null)}
        />
      ) : null}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// 有酸素の実測データ（2-4/2-5 の内訳表示つき）
// ---------------------------------------------------------------------------

function parseDuration(v: string): number | undefined {
  if (!v) return undefined;
  if (v.includes(":")) {
    const parts = v.split(":").map(Number);
    if (parts.some(isNaN)) return undefined;
    return parts.length === 3
      ? parts[0] * 3600 + parts[1] * 60 + parts[2]
      : parts[0] * 60 + parts[1];
  }
  const n = Number(v);
  return isNaN(n) ? undefined : n;
}

function AerobicMarkerForm({ defaultDate }: { defaultDate?: string }) {
  const [form, setForm] = useState({
    date: defaultDate ?? localToday(),
    type: "workout",
    description: "",
    distanceKm: "",
    time: "",
    avgHr: "",
    purpose: "threshold" as FitnessMarkerPurpose,
  });
  const [profile, setProfile] = useState<AerobicProfile | null>(null);
  const [msg, setMsg] = useState("");

  const load = useCallback(() => {
    fetch("/api/markers")
      .then((r) => r.json())
      .then((d) => setProfile(d.aerobicProfile));
  }, []);
  useEffect(load, [load]);

  const submit = async () => {
    const km = Number(form.distanceKm);
    const sec = parseDuration(form.time);
    if (!km || !sec) {
      setMsg("距離(km)とタイムは必須です（例: 8 と 30:40）");
      return;
    }
    if (km < 3) {
      setMsg("LT推定には合計3km以上の持続的な走行が必要です");
      return;
    }
    try {
      const d = await apiRequest<{ aerobicProfile?: AerobicProfile }>("/api/markers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: form.date,
          type: form.type,
          description: form.description || `${km}km 走`,
          resultLapsSec: [sec],
          lapDistancesM: [km * 1000],
          avgHr: form.avgHr ? Number(form.avgHr) : undefined,
          purpose: form.type === "race" ? "race" : form.purpose,
        }),
      });
      setProfile(d.aerobicProfile ?? null);
      setMsg("登録しました。「目標・レース」で再生成すると設定に反映されます。");
    } catch (error) {
      setMsg(error instanceof Error ? error.message : "登録できませんでした");
    }
  };

  const est = profile?.estimate;

  return (
    <Card title="有酸素の実測データ（閾値走・ペース走・距離走）">
      {profile?.refreshHint ? (
        <p
          role="status"
          className="text-[11.5px] mb-2 border-l-2 pl-2 leading-relaxed"
          style={{ color: "var(--amber)", borderColor: "var(--amber)" }}
        >
          <span aria-hidden="true">⚠</span> {profile.refreshHint}
        </p>
      ) : null}
      <div className="grid grid-cols-2 sm:flex gap-2 sm:flex-wrap sm:items-end">
        <label className="text-[13px] col-span-2 sm:col-auto">
          <span className="block text-[10.5px] mb-1" style={{ color: "var(--text-3)" }}>
            日付
          </span>
          <input
            type="date"
            className="w-full"
            value={form.date}
            onChange={(e) => setForm({ ...form, date: e.target.value })}
          />
        </label>
        <label className="text-[13px] col-span-2 sm:col-auto">
          <span className="block text-[10.5px] mb-1" style={{ color: "var(--text-3)" }}>
            種別
          </span>
          <select
            className="w-full"
            value={form.type}
            onChange={(e) =>
              setForm({
                ...form,
                type: e.target.value,
                purpose: e.target.value === "race" ? "race" : form.purpose,
              })
            }
          >
            <option value="workout">練習（ペース走・閾値走）</option>
            <option value="test">テスト走</option>
            <option value="race">レース（3000m以上）</option>
          </select>
        </label>
        <label className="text-[13px] col-span-2 sm:col-auto">
          <span className="block text-[10.5px] mb-1" style={{ color: "var(--text-3)" }}>
            この走行の目的
          </span>
          <select
            className="w-full"
            value={form.type === "race" ? "race" : form.purpose}
            disabled={form.type === "race"}
            onChange={(e) =>
              setForm({ ...form, purpose: e.target.value as FitnessMarkerPurpose })
            }
          >
            <option value="threshold">閾値走</option>
            <option value="tempo">テンポ・ペース走</option>
            <option value="cv">CV</option>
            <option value="race">3000〜5000mレース</option>
            <option value="long_run">ロングラン</option>
            <option value="easy">イージー走</option>
            <option value="recovery">回復ジョグ</option>
            <option value="unknown">不明（LT推定に使わない）</option>
          </select>
        </label>
        <label className="text-[13px]">
          <span className="block text-[10.5px] mb-1" style={{ color: "var(--text-3)" }}>
            距離(km)
          </span>
          <input
            className="w-full sm:w-20"
            value={form.distanceKm}
            onChange={(e) => setForm({ ...form, distanceKm: e.target.value })}
            placeholder="8"
            inputMode="decimal"
          />
        </label>
        <label className="text-[13px]">
          <span className="block text-[10.5px] mb-1" style={{ color: "var(--text-3)" }}>
            合計タイム
          </span>
          <input
            className="w-full sm:w-24"
            value={form.time}
            onChange={(e) => setForm({ ...form, time: e.target.value })}
            /* D-3: 数字だけ打てば 3040 → 30:40 に整形する */
            onBlur={(e) => setForm({ ...form, time: formatTimeInput(e.target.value) })}
            placeholder="30:40"
            inputMode="decimal"
          />
        </label>
        <label className="text-[13px]">
          <span className="block text-[10.5px] mb-1" style={{ color: "var(--text-3)" }}>
            平均HR
          </span>
          <input
            className="w-full sm:w-20"
            value={form.avgHr}
            onChange={(e) => setForm({ ...form, avgHr: e.target.value })}
            placeholder="186"
            inputMode="decimal"
          />
        </label>
        <ConfirmButton
          label="登録"
          title="実測データを登録しますか？"
          message="登録後、プランを再生成すると有酸素の設定ペースに反映されます。"
          className="btn-volt justify-center col-span-2 sm:col-auto min-h-[44px]"
          onConfirm={submit}
        />
      </div>
      {msg ? <p className="text-[12px] mt-2">{msg}</p> : null}

      {profile ? (
        <div className="mt-3 pt-3 border-t text-[13px]" style={{ borderColor: "var(--border)" }}>
          現在の有酸素設定
          {profile.isEstimated ? (
            <span style={{ color: "var(--amber)" }}>（⚠ 推定値。実測の入力を推奨）</span>
          ) : (
            <span style={{ color: "var(--volt)" }}>
              （実測ベース・信頼度{profile.confidence === "high" ? "高" : profile.confidence === "medium" ? "中" : "低"}）
            </span>
          )}
          <ul className="text-[11px] mt-1.5 space-y-0.5 num" style={{ color: "var(--text-2)" }}>
            <li>閾値(LT): {fmtPace(profile.ltPaceSecPerKm)}</li>
            <li>
              CV: {fmtPace(profile.cvPaceSecPerKm?.fast)} 〜 {fmtPace(profile.cvPaceSecPerKm?.slow)}
            </li>
            <li style={{ color: "var(--text-3)" }}>CV根拠: {profile.cvSourceDescription}</li>
            <li>
              ジョグ: {fmtPace(profile.jogPaceSecPerKm?.fast)} 〜{" "}
              {fmtPace(profile.jogPaceSecPerKm?.slow)}
            </li>
          </ul>
          {est ? (
            <details className="text-[10.5px] mt-2">
              <summary style={{ color: "var(--text-3)" }}>
                算出の内訳（採用{est.samples.length}本 / 除外{est.excluded.length}本）
              </summary>
              <div className="mt-1 space-y-0.5">
                {est.samples.map((s, i) => (
                  <div key={i} style={{ color: "var(--text-2)" }}>
                    ✓ {s.date} {s.description} → {fmtPace(s.ltPaceSecPerKm)}（重み{" "}
                    {s.weight.toFixed(2)}）
                  </div>
                ))}
                {est.excluded.map((s, i) => (
                  <div key={`e${i}`} style={{ color: "var(--text-3)" }}>
                    ✕ {s.date} {s.description} — {s.excluded}
                  </div>
                ))}
              </div>
            </details>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// 練習結果フォーム（1-1 ジョグ / 1-2 インターバル / 2-1 環境）
// ---------------------------------------------------------------------------

type Mode = "interval" | "continuous" | "skip";

/** 秒を入力欄に戻す。60の倍数なら分で書く（打ったとおりに近い形にする） */
function fmtRestInput(sec: number): string {
  return sec % 60 === 0 ? `${sec / 60}分` : `${sec}秒`;
}

function asRestType(value: unknown, fallback: RestType): RestType {
  return value === "jog" || value === "walk" || value === "full" ? value : fallback;
}

/**
 * ラベル付きの入力欄。
 *
 * これをコンポーネントの中で定義してはいけない（N-1）。
 * 中で定義すると再描画のたびに別の関数になり、Reactが「別の種類の要素」として
 * 中身の <input> を作り直す。作り直された入力欄はフォーカスを失うので、
 * iOSでは1文字打つたびにキーボードが閉じる。
 * 見た目には何も出ないので、気づくまでに時間がかかる種類の不具合。
 */
function L({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="text-[13px]">
      <span className="block text-[10.5px] mb-1" style={{ color: "var(--text-3)" }}>
        {label}
      </span>
      {children}
    </label>
  );
}

/**
 * 感じ方の欄（RPE・主観・翌日の脚・途中でやめた理由）。
 *
 * **モジュール直下に置くこと。** ResultForm の中で定義すると、
 * 再描画のたびに別の関数になって React が input を作り直す。
 * 入力中にフォーカスが外れ、iOSでは1文字ごとにキーボードが閉じる。
 * 画面には何も出ないので、E2Eの N-1 でしか気づけない。
 */
function SubjectiveFields({
  rpe,
  setRpe,
  subjective,
  setSubjective,
  legs,
  setLegs,
  shortOfPlan,
  cause,
  setCause,
  causeNote,
  setCauseNote,
  prescribedReps,
  repsCount,
}: {
  rpe?: number;
  setRpe: (v: number) => void;
  subjective?: Subjective;
  setSubjective: (v: Subjective | undefined) => void;
  legs?: NextDayLegs;
  setLegs: (v: NextDayLegs | undefined) => void;
  /** 処方より本数が少ない。理由を必須にするかどうかがこれで決まる */
  shortOfPlan: boolean;
  cause?: AbortCause;
  setCause: (v: AbortCause | undefined) => void;
  causeNote: string;
  setCauseNote: (v: string) => void;
  prescribedReps?: number;
  repsCount: number;
}) {
  return (
    <>
            <SnapSlider
              label="RPE（きつさ）"
              value={rpe}
              onChange={setRpe}
              min={RPE_MIN}
              max={RPE_MAX}
              describe={describeRpe}
              emptyHint="スライダーを動かして選んでください。きつさの感じ方は本人にしか分からないので、こちらでは埋めません。"
              testId="rpe-slider"
            />
            <ChipGroup
              label="主観"
              value={subjective}
              onChange={setSubjective}
              options={SUBJECTIVE_OPTIONS}
              /*
                主観は必須なので、選んだあとに外せるようにしない。
                allowEmpty を付けていたら、選んだチップをもう一度押したときに
                未入力へ戻り、保存が止まる。任意の欄（翌日の脚）とは扱いを分ける。
              */
              testId="subjective-chips"
            />
            <ChipGroup
              label="翌日の脚"
              value={legs}
              onChange={setLegs}
              options={LEGS_OPTIONS}
              allowEmpty
              emptyLabel="未入力（任意）"
              testId="legs-chips"
            />
            {/*
              処方より本数が少ないときだけ出す。
              ここは記録ではなく**判定に効く**——設定・疲労で止めたときだけ、
              設定ペースを見直す材料に数える（abortCause.ts）。
              空のまま保存できると「設定が高すぎた」として数えられるので必須にする。
            */}
            {shortOfPlan || cause !== undefined ? (
              <div className="flex flex-col gap-1.5">
                <ChipGroup
                  label={
                    shortOfPlan
                      ? `途中でやめた理由（予定${prescribedReps}本に対して${repsCount}本）`
                      : "途中でやめた理由"
                  }
                  value={cause}
                  onChange={setCause}
                  options={ABORT_CAUSE_OPTIONS}
                  columns={2}
                  testId="abort-cause-chips"
                />
                <p
                  className="text-[11.5px] leading-relaxed"
                  style={{ color: cause ? "var(--text-2)" : "var(--amber)" }}
                  data-testid="abort-cause-hint"
                  role="status"
                >
                  {cause
                    ? abortCauseHint(cause)
                    : "理由で扱いが変わります。設定・疲労で止めたときだけ設定ペースを見直す材料に数えます。"}
                </p>
                {cause === "other" ? (
                  <input
                    className="w-full"
                    aria-label="打ち切りの内容"
                    placeholder="何があったか（任意）"
                    value={causeNote}
                    onChange={(e) => setCauseNote(e.target.value)}
                  />
                ) : null}
                {needsInjuryLog(cause) ? (
                  <p className="text-[11.5px] leading-relaxed" style={{ color: "var(--amber)" }}>
                    痛みは下の故障ログにも部位と強さを残してください。打ち切りの記録だけでは、
                    どこがどれだけ痛いか分からないので次のメニューの判定に届きません。
                  </p>
                ) : null}
              </div>
            ) : null}
    </>
  );
}

/**
 * レストの欄（内容・指定方法・値）。
 *
 * 秒と距離で刻みを変えている。実際に使う刻みでないと押す回数が減らない。
 * ここもモジュール直下に置く（理由は `SubjectiveFields` と同じ）。
 */
function RestFields({
  restType,
  setRestType,
  restMode,
  setRestMode,
  restValue,
  setRestValue,
}: {
  restType: RestType;
  setRestType: (v: RestType) => void;
  restMode: "time" | "distance";
  setRestMode: (v: "time" | "distance") => void;
  restValue: string;
  setRestValue: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <ChipGroup
        label="レスト内容"
        value={restType}
        onChange={(v) => setRestType((v ?? "jog") as RestType)}
        options={REST_TYPE_OPTIONS}
        columns={3}
      />
      <div className="grid grid-cols-2 gap-2 items-end">
        <ChipGroup
          label="レスト指定"
          value={restMode}
          onChange={(v) => setRestMode((v ?? "time") as "time" | "distance")}
          options={REST_MODE_OPTIONS}
          columns={2}
        />
        {/* 秒は5刻み・距離は50刻み。実際に使う刻みでないと押す回数が減らない */}
        <Stepper
          label={restMode === "time" ? "レスト(秒)" : "レスト(m)"}
          value={restValue}
          onChange={setRestValue}
          min={0}
          max={restMode === "time" ? 1800 : 3000}
          step={restMode === "time" ? 5 : 50}
        />
      </div>
    </div>
  );
}

/**
 * その日の条件（天候・路面・シューズ）。
 *
 * **記録であって判定材料ではない。** 暑熱条件は今までどおり気温と湿度から決める。
 * ここを判定に混ぜると、タグの付け忘れが能力の変化として現れる。
 */
function ConditionFields({
  conditions,
  setConditions,
  shoeId,
  setShoeId,
  shoes,
  recommendedShoeId,
}: {
  conditions: string[];
  setConditions: (v: string[]) => void;
  shoeId?: string;
  setShoeId: (v: string | undefined) => void;
  shoes: ShoeUsage[];
  /** その日の練習に薦められた靴。印を付けるだけで、選択は絞らない */
  recommendedShoeId?: string;
}) {
  return (
    <>
            {/*
              その日の条件。複数選べる（雨で、かつトラックが濡れていた、など）。
              あとで「同じ設定なのにRPEが上がった」の理由を見分けるための記録で、
              **設定の判定には使わない**。
            */}
            <ChipMultiGroup
              label="天候"
              values={conditions.filter((c) => WEATHER_TAGS.includes(c))}
              onChange={(next) =>
                setConditions(
                  normalizeConditions([
                    ...next,
                    ...conditions.filter((c) => !WEATHER_TAGS.includes(c)),
                  ])
                )
              }
              options={WEATHER_OPTIONS}
              testId="weather-chips"
            />
            <ChipMultiGroup
              label="路面"
              values={conditions.filter((c) => SURFACE_TAGS.includes(c))}
              onChange={(next) =>
                setConditions(
                  normalizeConditions([
                    ...next,
                    ...conditions.filter((c) => !SURFACE_TAGS.includes(c)),
                  ])
                )
              }
              options={SURFACE_OPTIONS}
              hint="同じ設定でもRPEが上がった理由を、あとで見分けるための記録です。設定の判定には使いません。"
              testId="surface-chips"
            />
            {shoes.length > 0 ? (
              <ChipGroup
                label="シューズ"
                value={shoeId}
                onChange={setShoeId}
                /*
                  おすすめには印を付けるが、**選択肢は絞らない**。
                  薦めたものと違う靴を履くのは普通のことで、
                  そのときに選べないと記録が実際と食い違う。
                */
                options={shoes.map((u) => ({
                  value: u.shoe.id,
                  label:
                    (u.shoe.id === recommendedShoeId ? "★ " : "") +
                    `${u.shoe.name}${u.totalKm > 0 ? ` ${u.totalKm}km` : ""}`,
                }))}
                allowEmpty
                emptyLabel="未選択（任意）"
                columns={2}
                testId="shoe-chips"
              />
            ) : null}
    </>
  );
}


/** `/api/warmup?sessionId=` が返す選択肢。前回・型・FITから */
interface WarmupOptionsData {
  previous?: { date: string; warmup: WarmupRecord };
  templates: { key: string; label: string; warmup: WarmupRecord }[];
  fromFit: { fitId: string; fileName: string; date?: string; warmup: WarmupRecord }[];
}

const WARMUP_LEGS_OPTIONS = (Object.keys(WARMUP_LEGS_LABELS) as WarmupLegs[]).map((v) => ({
  value: v,
  label: WARMUP_LEGS_LABELS[v],
}));

const WARMUP_BREATHING_OPTIONS = (
  Object.keys(WARMUP_BREATHING_LABELS) as WarmupBreathing[]
).map((v) => ({ value: v, label: WARMUP_BREATHING_LABELS[v] }));

/**
 * ポイント練習前のアップ（任意）。
 *
 * **既定では畳んである。** アップは毎回同じことが多く、
 * 全部の欄を常に開いておくと主練習の入力が画面の下に押し出される。
 * 畳んだ状態では「何をやったか」の1行だけを出し、
 * 直す必要があるときだけ開く。
 *
 * 中身もさらに二段にしてある——合計と区間までが上、
 * 心拍・主練習までの間隔・脚・呼吸・靴は「詳しく」の中。
 * 測っていない項目のほうが多いので、全部を最初から見せると
 * 「埋めないといけない」ように見えてしまう。
 *
 * ⚠️ ここでコンポーネントを定義しないこと（再描画のたびに作り直され、
 * iOSでは1文字打つたびにキーボードが閉じる）。`npm run ci:nested` が見張っている。
 */
function WarmupFields({
  warmup,
  setWarmup,
  options,
  shoes,
}: {
  warmup?: WarmupRecord;
  setWarmup: (w: WarmupRecord | undefined) => void;
  options?: WarmupOptionsData;
  shoes: ShoeUsage[];
}) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState(false);

  /*
   * 合計を手で直したか。
   *
   * **手で入れた値を計算で上書きしない。** 区間を足しただけで
   * 本人が測った合計が書き換わると、どちらが実測なのか分からなくなる。
   * 区間から計算して入れたときだけ、次も計算で更新する。
   */
  const [totalsAuto, setTotalsAuto] = useState(true);
  /*
   * ペースは打っている途中が数値にならない（"4:" など）。
   * 打った文字をそのまま持っておかないと、コロンを打った瞬間に消える。
   */
  const [paceDrafts, setPaceDrafts] = useState<Record<number, string>>({});

  const w: WarmupRecord = warmup ?? { segments: [], source: "manual" };
  const patch = (over: Partial<WarmupRecord>) => setWarmup({ ...w, ...over });

  /**
   * 区間を変えたときの更新。
   *
   * 区間から合計を出して入れる（totalsAuto のときだけ）。
   * 距離とペースが分かっていれば時間まで出るので、
   * **合計時間を手で計算して入れる必要がなくなる**。
   */
  const patchSegments = (segments: WarmupRecord["segments"]) => {
    if (!totalsAuto) {
      setWarmup({ ...w, segments });
      return;
    }
    const t = warmupTotalsFromSegments(segments);
    setWarmup({
      ...w,
      segments,
      totalDistanceKm: t.distanceKm > 0 ? t.distanceKm : undefined,
      totalDurationMin: t.durationMin > 0 ? t.durationMin : undefined,
    });
  };

  /** 合計を手で直したら、そこから先は計算で触らない */
  const patchTotal = (over: Partial<WarmupRecord>) => {
    setTotalsAuto(false);
    patch(over);
  };

  const segTotals = warmupTotalsFromSegments(w.segments);
  const numOrUndef = (v: string) => {
    const t = v.trim();
    if (!t) return undefined;
    const n = Number(t);
    return isFinite(n) ? n : undefined;
  };
  const str = (v: number | undefined) => (v === undefined ? "" : String(v));
  const summary = summarizeWarmup(warmup);

  return (
    <div className="border-t pt-3 mt-3" style={{ borderColor: "var(--border)" }}>
      {/*
        押せる場所だと分かる形にする（forge-v110）。
        以前は文字が並んでいるだけで、**タップできるのかどうか分からなかった**
        （実際に指摘された）。枠と開閉のしるしを付け、押せる面を見せる。
      */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="w-full flex items-center gap-2 min-h-[48px] text-left rounded-lg border px-3 py-2"
        style={{
          borderColor: open ? "var(--forge)" : "var(--border-2)",
          background: "var(--surface-2)",
        }}
        data-testid="warmup-toggle"
      >
        <span
          aria-hidden
          className="text-[13px] flex-shrink-0"
          style={{ color: "var(--forge)" }}
        >
          {open ? "▾" : "▸"}
        </span>
        <span className="text-[13px] font-semibold flex-shrink-0">アップ</span>
        <span
          className="text-[10px] px-1.5 py-0.5 rounded flex-shrink-0"
          style={{ background: "var(--surface-3)", color: "var(--text-3)" }}
        >
          任意
        </span>
        <span
          className="text-[11.5px] flex-1 text-right truncate min-w-0"
          style={{ color: summary ? "var(--text-2)" : "var(--text-3)" }}
        >
          {summary ?? "タップして入力"}
        </span>
      </button>

      {open ? (
        <div className="mt-3 flex flex-col gap-3" data-testid="warmup-fields">
          <p className="text-[11.5px] leading-relaxed" style={{ color: "var(--text-3)" }}>
            主練習の一部として記録します。距離・時間・負荷・シューズの走行距離には足しますが、
            週の練習回数やカテゴリ配分、CFEには使いません。
          </p>

          {/* 毎回ゼロから入力させない。押した中身はそのまま直せる */}
          <div className="flex flex-wrap gap-2" data-testid="warmup-presets">
            {options?.previous ? (
              <button
                type="button"
                className="text-[11.5px] rounded-lg border px-2.5 min-h-[36px]"
                style={{ borderColor: "var(--border-2)" }}
                onClick={() => setWarmup(options.previous!.warmup)}
              >
                前回と同じ（{options.previous.date}）
              </button>
            ) : null}
            {(options?.templates ?? []).map((t) => (
              <button
                key={t.key}
                type="button"
                className="text-[11.5px] rounded-lg border px-2.5 min-h-[36px]"
                style={{ borderColor: "var(--border-2)" }}
                onClick={() => setWarmup(t.warmup)}
              >
                {t.label}
              </button>
            ))}
            {(options?.fromFit ?? []).map((f) => (
              <button
                key={f.fitId}
                type="button"
                className="text-[11.5px] rounded-lg border px-2.5 min-h-[36px]"
                style={{ borderColor: "var(--forge)", color: "var(--forge)" }}
                onClick={() => setWarmup(f.warmup)}
              >
                FITから（{f.fileName}）
              </button>
            ))}
            {warmup ? (
              <button
                type="button"
                className="text-[11.5px] rounded-lg border px-2.5 min-h-[36px]"
                style={{ borderColor: "var(--border-2)", color: "var(--text-3)" }}
                onClick={() => setWarmup(undefined)}
                data-testid="warmup-clear"
              >
                消す
              </button>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Stepper
              label="合計距離"
              unit="km"
              inputMode="decimal"
              step={0.1}
              value={str(w.totalDistanceKm)}
              onChange={(v) => patchTotal({ totalDistanceKm: numOrUndef(v) })}
            />
            <Stepper
              label="合計時間"
              unit="分"
              inputMode="decimal"
              step={0.1}
              value={str(w.totalDurationMin)}
              onChange={(v) => patchTotal({ totalDurationMin: numOrUndef(v) })}
            />
          </div>

          {/*
            計算で入ったのか手で入れたのかを出す。
            **黙って数値を書き換えない**——あとで合わないときに、
            どちらの値を疑えばいいのか分かるようにしておく。
          */}
          {w.segments.length > 0 ? (
            <div className="flex items-center justify-between gap-2 -mt-1">
              <span className="text-[11px]" style={{ color: "var(--text-3)" }}>
                {totalsAuto
                  ? segTotals.missingPace > 0
                    ? `区間から計算（ペース未入力が${segTotals.missingPace}区間あるので時間は短めです）`
                    : "区間から計算しています"
                  : "手で入れた合計を使っています"}
              </span>
              {!totalsAuto ? (
                <button
                  type="button"
                  className="text-[11px] min-h-[36px] px-2 flex-shrink-0"
                  style={{ color: "var(--forge)" }}
                  onClick={() => {
                    setTotalsAuto(true);
                    const t = warmupTotalsFromSegments(w.segments);
                    patch({
                      totalDistanceKm: t.distanceKm > 0 ? t.distanceKm : undefined,
                      totalDurationMin: t.durationMin > 0 ? t.durationMin : undefined,
                    });
                  }}
                  data-testid="warmup-recalc"
                >
                  区間から計算し直す
                </button>
              ) : null}
            </div>
          ) : null}

          {/* 区間。押した種別だけ足す。最初から全部の欄を出さない */}
          <div>
            <div className="text-[11.5px] mb-1" style={{ color: "var(--text-3)" }}>
              区間（やったものだけ）
            </div>
            <div className="flex flex-wrap gap-2 mb-2" data-testid="warmup-segment-add">
              {WARMUP_SEGMENT_KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  className="text-[11.5px] rounded-lg border px-2.5 min-h-[36px]"
                  style={{ borderColor: "var(--border-2)" }}
                  onClick={() => patchSegments([...w.segments, { kind: k }])}
                >
                  ＋{WARMUP_SEGMENT_LABELS[k]}
                </button>
              ))}
            </div>
            {w.segments.map((seg, i) => (
              <div
                key={`${seg.kind}-${i}`}
                className="rounded-lg border p-2 mb-2"
                style={{ borderColor: "var(--border)" }}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[12px] font-semibold">
                    {WARMUP_SEGMENT_LABELS[seg.kind]}
                  </span>
                  <button
                    type="button"
                    className="text-[11px] min-h-[36px] px-2"
                    style={{ color: "var(--text-3)" }}
                    onClick={() => patchSegments(w.segments.filter((_, j) => j !== i))}
                  >
                    削除
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Stepper
                    label="距離"
                    unit="m"
                    step={50}
                    value={str(seg.distanceM)}
                    onChange={(v) =>
                      patchSegments(
                        w.segments.map((s, j) =>
                          j === i ? { ...s, distanceM: numOrUndef(v) } : s
                        )
                      )
                    }
                  />
                  <Stepper
                    label="本数"
                    value={str(seg.reps)}
                    onChange={(v) =>
                      patchSegments(
                        w.segments.map((s, j) => (j === i ? { ...s, reps: numOrUndef(v) } : s))
                      )
                    }
                  />
                </div>
                {/*
                  ペース。入れると合計時間が計算される。
                  「4:30」でも「270」でも読む（`parsePaceToSecPerKm`）。
                  **入れなくてよい**——入っていない区間は時間に入らないだけ。
                */}
                <label className="block mt-2">
                  <span className="metric-label block mb-1">
                    ペース<span style={{ color: "var(--text-3)" }}>（分:秒/km・任意）</span>
                  </span>
                  <input
                    className="w-full min-h-[44px]"
                    inputMode="numeric"
                    placeholder="例 4:30"
                    aria-label={`${WARMUP_SEGMENT_LABELS[seg.kind]}のペース`}
                    value={paceDrafts[i] ?? (seg.paceSecPerKm !== undefined ? fmtPaceSecPerKm(seg.paceSecPerKm) : "")}
                    onChange={(e) => {
                      const text = e.target.value;
                      setPaceDrafts((prev) => ({ ...prev, [i]: text }));
                      patchSegments(
                        w.segments.map((s, j) =>
                          j === i ? { ...s, paceSecPerKm: parsePaceToSecPerKm(text) } : s
                        )
                      );
                    }}
                    data-testid={`warmup-pace-${i}`}
                  />
                </label>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setDetail(!detail)}
            className="text-[11.5px] text-left min-h-[36px]"
            style={{ color: "var(--forge)" }}
            data-testid="warmup-detail-toggle"
          >
            {detail ? "詳しい記録を閉じる" : "詳しく記録する（心拍・脚・呼吸・靴）"}
          </button>

          {detail ? (
            <div className="flex flex-col gap-3" data-testid="warmup-detail">
              <div className="grid grid-cols-2 gap-2">
                <Stepper
                  label="平均心拍"
                  unit="bpm"
                  value={str(w.avgHr)}
                  onChange={(v) => patch({ avgHr: numOrUndef(v) })}
                />
                <Stepper
                  label="最大心拍"
                  unit="bpm"
                  value={str(w.maxHr)}
                  onChange={(v) => patch({ maxHr: numOrUndef(v) })}
                />
              </div>
              <Stepper
                label="アップ終了から主練習開始まで"
                unit="分"
                value={str(w.gapToMainMin)}
                onChange={(v) => patch({ gapToMainMin: numOrUndef(v) })}
              />
              <ChipGroup
                label="アップ後の脚"
                value={w.legs}
                onChange={(v) => patch({ legs: v })}
                options={WARMUP_LEGS_OPTIONS}
                allowEmpty
                emptyLabel="未入力"
                testId="warmup-legs"
              />
              <ChipGroup
                label="呼吸"
                value={w.breathing}
                onChange={(v) => patch({ breathing: v })}
                options={WARMUP_BREATHING_OPTIONS}
                allowEmpty
                emptyLabel="未入力"
                testId="warmup-breathing"
              />
              {shoes.length > 0 ? (
                <ChipGroup
                  label="アップのシューズ"
                  value={w.shoeId}
                  onChange={(v) => patch({ shoeId: v })}
                  options={shoes.map((u) => ({ value: u.shoe.id, label: u.shoe.name }))}
                  allowEmpty
                  emptyLabel="主練習と同じ"
                  columns={2}
                  testId="warmup-shoe"
                />
              ) : null}
              {/*
                FITを丸ごと取り込んだ日は、主練習の距離にアップが既に入っている。
                そのまま足すと距離が倍になるので、ここで断れるようにしておく。
              */}
              <label className="flex items-start gap-2 text-[11.5px]">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={!!w.includedInMainTotals}
                  onChange={(e) => patch({ includedInMainTotals: e.target.checked || undefined })}
                  data-testid="warmup-included"
                />
                <span style={{ color: "var(--text-3)" }}>
                  この距離・時間は主練習側にも入っている（合計に二重で足さない）
                </span>
              </label>
              <div className="text-[11px]" style={{ color: "var(--text-3)" }}>
                入力元: {WARMUP_SOURCE_LABELS[w.source]}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ResultForm({
  session,
  existing,
  onDone,
  onDeleted,
}: {
  session: any;
  existing?: any;
  onDone: (out: any) => void;
  onDeleted?: () => void;
}) {
  const aerobicDefault = ["aerobic"].includes(session.category);
  const [mode, setMode] = useState<Mode>(
    existing?.continuous ? "continuous" : existing?.interval ? "interval" : aerobicDefault ? "continuous" : "interval"
  );
  const [busy, setBusy] = useState(false);
  const [showEnv, setShowEnv] = useState(false);
  const [sessionCategory, setSessionCategory] = useState<SessionCategory>(session.category);

  /*
   * M-1: 既に登録済みならその値を初期値にする。
   * 空欄で出すと入力が消えたようにしか見えず、入れ直すことになる。
   * 保存は上書きなので、直して押せばそのまま置き換わる。
   */
  const num = (v: number | undefined) => (v === undefined ? "" : String(v));

  // 共通
  // RPEはこちらで埋めない（本人にしか分からず、CFEの補正に効くため）。登録済みならその値を出す
  /*
   * RPEも主観もこちらで埋めない（本人にしか分からず、CFEの補正に効く）。
   * 未入力は undefined で持つ——空文字だと Number("") が 0 になって
   * 「0点として記録に混ざる」経路がまた開く。
   */
  const [rpe, setRpe] = useState<number | undefined>(
    existing && isValidRpe(existing.rpe) ? existing.rpe : undefined
  );
  const [subjective, setSubjective] = useState<Subjective | undefined>(
    existing?.subjective
  );
  const [legs, setLegs] = useState<NextDayLegs | undefined>(existing?.nextDayLegs);

  // 1-1 ジョグ
  const [distanceKm, setDistanceKm] = useState(num(existing?.continuous?.distanceKm));
  const [durationMin, setDurationMin] = useState(num(existing?.continuous?.durationMin));
  const [paceOverride, setPaceOverride] = useState("");
  const [avgHr, setAvgHr] = useState(num(existing?.continuous?.avgHr));
  const [maxHr, setMaxHr] = useState(num(existing?.continuous?.maxHr));

  // 1-2 インターバル
  const prescribedDist = session.targetPaces?.[0]?.distanceM ?? 400;
  const prescribedTarget = session.targetPaces?.[0]
    ? (session.targetPaces[0].targetSecFast + session.targetPaces[0].targetSecSlow) / 2
    : undefined;
  const ex = existing?.interval;
  const [reps, setReps] = useState(ex ? String(ex.reps ?? 5) : "5");
  const [distM, setDistM] = useState(String(ex?.distanceM ?? prescribedDist));
  const [targetSec, setTargetSec] = useState(
    ex?.targetSec !== undefined
      ? String(ex.targetSec)
      : prescribedTarget
      ? prescribedTarget.toFixed(1)
      : ""
  );
  const [restType, setRestType] = useState<RestType>(ex?.restType ?? "jog");
  const [restMode, setRestMode] = useState<"time" | "distance">(
    ex?.restDistanceM !== undefined ? "distance" : "time"
  );
  const [restValue, setRestValue] = useState(
    String(ex?.restSec ?? ex?.restDistanceM ?? 300)
  );
  const [times, setTimes] = useState(
    existing?.actualLapsSec?.length ? existing.actualLapsSec.join(", ") : ""
  );
  /*
   * N-2: メニュー本文の構造に合わせて1本ずつの欄を出す。
   * 処方の解釈は一括入力・編集シートと同じものを使う（/api/prescription）。
   */
  const [perRep, setPerRep] = useState(true);
  const [structure, setStructure] = useState<PrescriptionStructure | null>(null);
  const [repTimes, setRepTimes] = useState<string[]>(
    existing?.actualLapsSec?.length
      ? existing.actualLapsSec.map((t: number) => String(Math.round(t * 100) / 100))
      : []
  );
  const [repDistances, setRepDistances] = useState<string[]>(
    (ex?.results ?? []).map((result: { distanceM: number }) => String(result.distanceM))
  );
  const [withActualDistance, setWithActualDistance] = useState<boolean>(
    (ex?.results ?? []).some(
      (result: { plannedDistanceM?: number }) => result.plannedDistanceM !== undefined
    )
  );
  /*
   * Q-1: 1本ごとの平均心拍。任意。
   * 既定では出さない。時計から拾える人だけが入れる項目なのに常時2欄にすると、
   * iPhone幅で実施タイムの欄まで狭くなる。
   * 既に心拍が入っている記録を開いたときは、隠すと消したように見えるので出す。
   */
  const [repHrs, setRepHrs] = useState<string[]>(
    (ex?.results ?? []).map((r: any) => (r.avgHr !== undefined ? String(r.avgHr) : ""))
  );
  const [withHr, setWithHr] = useState<boolean>(
    (ex?.results ?? []).some((r: any) => r.avgHr !== undefined)
  );
  /*
   * S-4: その本のあとのレスト。任意。
   * 300+600+300 のように区間ごとにレストが違うメニューがあるので、
   * セッションに1つのレストだけでは記録できない。
   */
  const [repRests, setRepRests] = useState<string[]>(
    (ex?.results ?? []).map((r: { restAfterDistanceM?: number; restAfterSec?: number }) =>
      r.restAfterDistanceM !== undefined
        ? `${r.restAfterDistanceM}m ${REST_LABELS[asRestType(ex?.restType, "walk")]}`
        : r.restAfterSec !== undefined
          ? fmtRestInput(r.restAfterSec)
          : ""
    )
  );
  const [withRest, setWithRest] = useState<boolean>(
    (ex?.results ?? []).some(
      (r: { restAfterDistanceM?: number; restAfterSec?: number }) =>
        r.restAfterSec !== undefined || r.restAfterDistanceM !== undefined
    )
  );

  useEffect(() => {
    fetch("/api/prescription", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: session.prescription ?? "" }),
    })
      .then((r) => r.json())
      .then((d: PrescriptionStructure) => {
        const next = d?.recognized ? d : null;
        setStructure(next);
        // 初回入力では本文の構造をフォーム初期値にも反映する。
        // 400+300+200を「400m×5」のまま表示すると、欄数も設定も誤解させる。
        if (!existing?.interval && next?.kind === "interval" && next.slots.length > 0) {
          setReps(String(next.slots.length));
          setDistM(String(next.slots[0].distanceM));
          if (!next.mixed && next.slots[0].targetSec !== undefined) {
            setTargetSec(String(next.slots[0].targetSec));
          }
          /*
           * レストも処方から入れる。
           *
           * これまでは既定値の300秒に落ちていたので、処方が「r207秒」でも
           * 欄には300秒と出ていた。**画面に出ている2つの数字が食い違う**状態で、
           * どちらが今日やる内容なのか本人に判断できなかった。
           * 読み取れなかったときだけ、これまでどおり既定値のままにする。
           */
          if (next.restDistanceM !== undefined) {
            setRestMode("distance");
            setRestValue(String(next.restDistanceM));
          } else if (next.restSec !== undefined) {
            setRestMode("time");
            setRestValue(String(next.restSec));
          }
          if (next.restType) setRestType(next.restType);
        }
      })
      .catch(() => setStructure(null));
  }, [existing?.interval, session.id, session.prescription]);

  const slotDistances = (structure?.slots ?? []).map((slot) => slot.distanceM);
  const slotTargets = (structure?.slots ?? []).map((slot) => slot.targetSec);
  const slotRestDistances = (structure?.slots ?? []).map(
    (slot) => slot.restAfterDistanceM
  );
  const structureRestType = (structure?.slots ?? []).find((slot) => slot.restType)?.restType;
  const hasStructuredPerRepRest = slotRestDistances.some((distance) => distance !== undefined);

  useEffect(() => {
    if (hasStructuredPerRepRest) setWithRest(true);
  }, [hasStructuredPerRepRest]);
  /*
   * 処方の本数。本数がこれより少なければ「途中でやめた」とみなして理由を聞く。
   * 読み取れなかったときは undefined のままにする——本数を勝手に決めない。
   */
  const prescribedReps =
    structure?.kind === "interval" && structure.slots.length > 0
      ? structure.slots.length
      : undefined;
  const shortOfPlan =
    mode === "interval" &&
    prescribedReps !== undefined &&
    Number(reps) >= 1 &&
    Number(reps) < prescribedReps;

  // 欄の数は「処方の本数」と「既に入れた本数」の多い方。
  // 打ち切って本数が減っても、入れた値が消えないようにする
  const slotCount = Math.max(
    slotDistances.length,
    Number(reps) || 0,
    repTimes.length,
    1
  );

  // 2-1 環境
  const [tempC, setTempC] = useState(num(existing?.weatherTempC));
  const [humidity, setHumidity] = useState(num(existing?.humidityPct));
  const [wind, setWind] = useState(existing?.wind ?? "");
  /*
   * 天候・路面のタグと、履いた靴。
   * 「設定は同じなのにRPEが上がった」の理由を、あとから見分けるための記録。
   * 判定には使わない（暑熱条件は今までどおり気温と湿度のWBGTだけ）。
   */
  const [conditions, setConditions] = useState<string[]>(
    normalizeConditions(existing?.conditions)
  );
  const [shoeId, setShoeId] = useState<string | undefined>(existing?.shoeId);
  const [shoes, setShoes] = useState<ShoeUsage[]>([]);
  /** その日の練習に薦められた靴。印を付けるだけで、選択は絞らない */
  const [recommendedShoeId, setRecommendedShoeId] = useState<string | undefined>(undefined);
  const [rain, setRain] = useState(!!existing?.rain);

  /*
   * ポイント練習前のアップ（任意・主練習の子データ）。
   * 既に記録があればその値。**既定値は入れない**——
   * やっていないアップが記録に残ると、あとで相性を見るときに数が合わなくなる。
   */
  const [warmup, setWarmup] = useState<WarmupRecord | undefined>(existing?.warmup);
  const [warmupOptions, setWarmupOptions] = useState<WarmupOptionsData | undefined>(undefined);

  /*
   * 途中でやめた理由。天候タグと違い、これは判定に効く。
   * 既定値は置かない——なぜ止めたかは本人にしか分からない。
   */
  const [cause, setCause] = useState<AbortCause | undefined>(
    normalizeAbortCause(existing?.abortCause)
  );
  const [causeNote, setCauseNote] = useState(existing?.abortNote ?? "");

  // スキップ
  const [skipReason, setSkipReason] = useState("fatigue");

  // D-3: 「前回と同じ」と「メニューとして保存」
  const [prev, setPrev] = useState<any | null>(null);
  const [loadedFrom, setLoadedFrom] = useState<string>("");
  const [savedMsg, setSavedMsg] = useState("");

  useEffect(() => {
    setLoadedFrom("");
    setSavedMsg("");
    fetch(`/api/results?previousFor=${encodeURIComponent(session.id)}`)
      .then((r) => r.json())
      .then((d) => setPrev(d.previous ?? null))
      .catch(() => setPrev(null));
  }, [session.id]);

  /**
   * 直近の同カテゴリの記録を初期値として読み込む。
   * どのセッションから読んだかを必ず画面に出す。
   * 中身を見ずに登録されると、そのままCFE更新に流れてしまうため。
   */
  const applyPrevious = () => {
    if (!prev) return;
    const r = prev.result;
    if (r.interval) {
      setMode("interval");
      setReps(String(r.interval.reps ?? r.interval.results?.length ?? ""));
      setDistM(String(r.interval.distanceM ?? ""));
      setTargetSec(r.interval.targetSec !== undefined ? String(r.interval.targetSec) : "");
      setRestType(r.interval.restType ?? "jog");
      if (r.interval.restSec !== undefined) {
        setRestMode("time");
        setRestValue(String(r.interval.restSec));
      } else if (r.interval.restDistanceM !== undefined) {
        setRestMode("distance");
        setRestValue(String(r.interval.restDistanceM));
      }
      // 実施タイムは前回の値であって今日の結果ではないので、あえて空のままにする
      setTimes("");
      setRepTimes([]);
      setRepDistances([]);
      setWithActualDistance(false);
    } else if (r.continuous) {
      setMode("continuous");
      setDistanceKm(String(r.continuous.distanceKm ?? ""));
      setDurationMin(String(r.continuous.durationMin ?? ""));
    }
    // 前回の記録から引き継ぐ。範囲外の旧データは持ち込まない
    if (isValidRpe(r.rpe)) setRpe(r.rpe);
    if (r.subjective) setSubjective(r.subjective);
    setLoadedFrom(prev.label);
  };

  /** この内容を自作メニュー（3-2）として保存する。別ストアは作らず既存に寄せる */
  const saveAsMenu = async () => {
    const name =
      mode === "interval"
        ? `${distM}m×${reps}${restMode === "time" ? ` r${Math.round(Number(restValue) / 60)}分` : ""}`
        : `${distanceKm}km 持続走`;
    const prescription =
      mode === "interval"
        ? `${distM}m×${reps} ${REST_LABELS[restType]}${
            restMode === "time" ? ` ${restValue}秒` : ` ${restValue}m`
          }${targetSec ? ` 設定${targetSec}秒` : ""}`
        : `${distanceKm}km ${durationMin}分`;
    try {
      await apiRequest("/api/plan-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customMenu: {
            name,
            category: session.category,
            source: "self",
            prescription,
            distanceM: mode === "interval" ? Number(distM) : undefined,
            reps: mode === "interval" ? Number(reps) : undefined,
            restNote: mode === "interval" ? `${REST_LABELS[restType]} ${restValue}` : undefined,
          },
        }),
      });
      setSavedMsg(
        `「${name}」をメニューに保存しました。次回の生成から候補に入ります（メニュー設定で確認・削除できます）。`
      );
    } catch (error) {
      setSavedMsg(error instanceof Error ? error.message : "メニューへ保存できませんでした");
    }
  };

  /*
   * S-2: 距離・時間・平均ペースは、どれか2つ入れれば残り1つが決まる。
   *
   * これまでは「距離＋時間 → ペース」の向きしか無く、
   * 時計から平均ペースを見て入れる人は距離を自分で割る必要があった。
   * 計算は一括入力と同じ completeRunTriple を使う（解釈を1か所に集める）。
   * 3つとも入っていて食い違うときは、どれかが違うと出すだけで、勝手に直さない。
   */
  const triple = completeRunTriple({
    distanceKm: Number(distanceKm) > 0 ? Number(distanceKm) : undefined,
    durationSec: Number(durationMin) > 0 ? Number(durationMin) * 60 : undefined,
    paceSecPerKm: parseDuration(paceOverride) ?? undefined,
  });
  const autoPace = triple.paceSecPerKm;

  const env = evaluateEnvironment({
    tempC: tempC ? Number(tempC) : undefined,
    humidityPct: humidity ? Number(humidity) : undefined,
  });
  /*
   * 登録済みのシューズ。
   *
   * 並びは**その日の練習の推薦順**。判断はサービス層（core/shoeRecommend.ts）が
   * 持っていて、ここでは並べ替えない——画面ごとに理屈を書くと、
   * 練習詳細で薦められた靴と記録画面の1番目が食い違う。
   *
   * 推薦が取れないときは、これまでどおり最後に使ったものを先頭にする。
   */
  useEffect(() => {
    Promise.all([
      fetch("/api/shoes").then((r) => r.json()),
      fetch(`/api/shoes?sessionId=${encodeURIComponent(session.id)}`)
        .then((r) => r.json())
        .catch(() => ({})),
    ])
      .then(([all, adv]) => {
        const usage: ShoeUsage[] = all.usage ?? [];
        const order: string[] = adv?.advice?.best
          ? [adv.advice.best, ...(adv.advice.alternatives ?? [])].map(
              (s: { shoe: { id: string } }) => s.shoe.id
            )
          : [];
        setRecommendedShoeId(order[0]);
        if (order.length === 0) {
          setShoes(shoeChoices(usage));
          return;
        }
        const byId = new Map(usage.map((u) => [u.shoe.id, u]));
        setShoes(order.map((id) => byId.get(id)).filter((u): u is ShoeUsage => !!u));
      })
      .catch(() => {
        /* 靴は任意。取れなくても記録は入れられる */
      });
  }, [session.id]);

  /*
   * アップの選択肢（前回と同じ・型・FITから）。
   *
   * `mode` を送るのは**二重計上の判断に要る**から。
   * 持続走はファイル全体を1本として取り込むので、主練習の距離に
   * アップが既に入っている。インターバルはメインの周だけなので入っていない。
   */
  useEffect(() => {
    fetch(
      `/api/warmup?sessionId=${encodeURIComponent(session.id)}&mode=${
        mode === "continuous" ? "continuous" : "interval"
      }`
    )
      .then((r) => r.json())
      .then((d) => setWarmupOptions(d.options))
      .catch(() => {
        /* 選択肢は補助。取れなくても手で入れられる */
      });
  }, [session.id, mode]);

  const envNotes = environmentNote({
    tempC: tempC ? Number(tempC) : undefined,
    humidityPct: humidity ? Number(humidity) : undefined,
    wind: (wind || undefined) as any,
    rain,
  });

  const submit = async () => {
    setBusy(true);
    try {
      if (mode === "skip") {
        const d = await apiRequest<{
          decision?: { triggeredBy?: string; message?: string };
          violations?: RuleViolation[];
        }>("/api/skip", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: session.id, reason: skipReason }),
        });
        onDone({
          cfeBefore: 0,
          cfeAfter: 0,
          cfeApplied: false,
          guardrailNotes: [`[${d.decision?.triggeredBy}] ${d.decision?.message}`],
          changes: [],
          violations: d.violations ?? [],
        });
        return;
      }

      /*
       * 保存させるかどうかは `checkResultDraft` が1か所で決める。
       * ここに `alert` と `return` を散らすと、何を止めているのか一覧できず、
       * 単体テストからも触れない（理由は core/resultDraft.ts に書いてある）。
       */
      const draftError = checkResultDraft({
        mode: mode === "continuous" ? "continuous" : "interval",
        rpe,
        subjective,
        shortOfPlan,
        abortCause: cause,
        // 持続走の2値は S-2 が補ったあとの値を渡す
        distanceKm: mode === "continuous" ? triple.distanceKm : undefined,
        durationMin:
          mode === "continuous" && triple.durationSec !== undefined
            ? triple.durationSec / 60
            : undefined,
      });
      if (draftError) {
        setBusy(false);
        alert(draftError);
        return;
      }
      const rpeValue = rpe!;

      const common = {
        sessionId: session.id,
        sessionCategory,
        date: session.date,
        rpe: rpeValue,
        subjective: subjective!,
        nextDayLegs: legs || undefined,
        weatherTempC: tempC ? Number(tempC) : undefined,
        humidityPct: humidity ? Number(humidity) : undefined,
        wind: wind || undefined,
        rain: rain || undefined,
        conditions: conditions.length > 0 ? conditions : undefined,
        shoeId: shoeId || undefined,
        /*
         * 一度選んだ理由は、本数の見え方が変わっても残す。
         * run画面で終えた記録は interval.reps に**予定の**本数が入るので、
         * ここで shortOfPlan だけを条件にすると、開き直して保存した瞬間に
         * 理由が消える（＝設定を緩める材料に戻ってしまう）。
         */
        abortCause: cause,
        abortNote: cause === "other" ? causeNote.trim() || undefined : undefined,
        // アップは主練習の子データ。結果と一緒に送る（別の保存口を作らない）
        warmup,
      };

      /*
       * 保存する中身は core/resultPayload.ts が組み立てる。
       * モードごとに引数の型が別なので、**表示していないほうの値は渡しようがない**。
       * 入力欄の state は残したまま（切り替えで打ち直しにならないように）、
       * 混ざるのはここで止める。
       */
      const payload =
        mode === "continuous"
          ? buildContinuousPayload(common, {
              distanceKm: triple.distanceKm ?? 0,
              durationMin: triple.durationSec !== undefined ? triple.durationSec / 60 : 0,
              paceSecPerKm: triple.paceSecPerKm,
              derived: triple.derived,
              // 元は文字列の真偽で見ていた（どの欄を上書きしたかは使っていない）
              paceOverride: !!paceOverride,
              avgHr: avgHr ? Number(avgHr) : undefined,
              maxHr: maxHr ? Number(maxHr) : undefined,
            })
          : buildIntervalPayload(common, {
              reps: Number(reps),
              distanceM: Number(distM),
              targetSec: targetSec ? Number(targetSec) : undefined,
              mixed: !!structure?.mixed,
              perRep,
              repTimes,
              times,
              slotCount,
              slotDistances,
              slotTargets,
              slotRestDistances,
              structureRestType,
              withRest,
              repRests,
              withActualDistance,
              repDistances,
              withHr,
              repHrs,
              hasStructuredPerRepRest,
              restType,
              restMode,
              restValue,
            });

      const result = await apiRequest("/api/results", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      onDone(result);
    } catch (error) {
      setSavedMsg(error instanceof Error ? error.message : "練習結果を保存できませんでした");
    } finally {
      setBusy(false);
    }
  };

  /** 不具合4対応: 誤って登録した結果を削除する。CFEへの寄与もサービス層で取り消される */
  const handleDelete = async () => {
    if (!existing) return;
    setBusy(true);
    try {
      await apiRequest(`/api/results?id=${encodeURIComponent(existing.id)}`, { method: "DELETE" });
      onDeleted?.();
    } catch (error) {
      setSavedMsg(error instanceof Error ? error.message : "練習結果を削除できませんでした");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border-t pt-3" style={{ borderColor: "var(--border)" }}>
      <p className="text-[13px] mb-2">
        <b className="num">{session.date}</b> {session.name}
      </p>
      <p className="text-[11px] mb-3 num" style={{ color: "var(--text-2)" }}>
        {session.prescription}
      </p>
      {existing ? (
        <p className="text-[11.5px] mb-3" style={{ color: "var(--forge)" }}>
          登録済みです。前回入力した内容をそのまま表示しています。直して保存すれば上書きされ、記録は増えません。
        </p>
      ) : null}

      <L label="実際に行ったメニューの種類">
        <select
          className="w-full mb-3"
          value={sessionCategory}
          onChange={(event) => setSessionCategory(event.target.value as SessionCategory)}
        >
          {(
            [
              "high_lactate",
              "race_economy",
              "modeling",
              "neural",
              "cv",
              "threshold",
              "aerobic",
            ] as SessionCategory[]
          ).map((category) => (
            <option key={category} value={category}>
              {CATEGORY_LABELS[category]}
            </option>
          ))}
        </select>
      </L>
      {existing && sessionCategory !== session.category ? (
        <p className="text-[11px] mb-3" style={{ color: "var(--amber)" }}>
          保存すると分類を変更し、CFE・負荷・4週間バランス・警告・次回メニューを新しい分類で再計算します。
        </p>
      ) : null}

      {/* モード切替 */}
      <div className="grid grid-cols-3 gap-1.5 mb-3">
        {(
          [
            ["interval", "インターバル"],
            ["continuous", "ジョグ・持続走"],
            ["skip", "スキップ"],
          ] as [Mode, string][]
        ).map(([m, label]) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className="rounded-lg border text-[12px] font-semibold min-h-[44px]"
            style={{
              background: mode === m ? "var(--volt)" : "var(--surface-2)",
              borderColor: mode === m ? "transparent" : "var(--border-2)",
              color: mode === m ? "var(--volt-ink)" : "var(--text-2)",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* D-3: 前回と同じ。出典を必ず見せる（中身を見ずに登録させない） */}
      {prev && mode !== "skip" ? (
        <div
          className="flex items-center gap-2 flex-wrap mb-3 p-2.5 rounded-lg"
          style={{ background: "var(--surface-2)" }}
        >
          <button className="btn-ghost !py-1.5 !px-3 !text-[11.5px]" onClick={applyPrevious}>
            前回と同じ
          </button>
          <span className="text-[11px]" style={{ color: "var(--text-3)" }}>
            {loadedFrom
              ? `${loadedFrom} の内容を読み込みました（実施タイムは空のままです）`
              : `直近の同カテゴリ: ${prev.label}`}
          </span>
        </div>
      ) : null}

      {mode === "continuous" ? (
        <div className="grid grid-cols-2 gap-2">
          {/* S-2: 3つのうち2つ入れれば、残りは自動で埋まる */}
          <div className="col-span-2 text-[11px] -mb-1" style={{ color: "var(--text-3)" }}>
            距離・時間・平均ペースのうち<b style={{ color: "var(--text-2)" }}>2つ</b>を入れると、
            残りの1つは自動で計算されます。
          </div>
          <L label={`距離(km)${triple.derived === "distanceKm" ? "・自動計算" : ""}`}>
            <input
              className="w-full"
              value={distanceKm}
              onChange={(e) => setDistanceKm(e.target.value)}
              placeholder={
                triple.derived === "distanceKm" && triple.distanceKm
                  ? String(triple.distanceKm)
                  : "11.2"
              }
              inputMode="decimal"
            />
          </L>
          <L label={`時間(分)${triple.derived === "durationSec" ? "・自動計算" : ""}`}>
            <input
              className="w-full"
              value={durationMin}
              onChange={(e) => setDurationMin(e.target.value)}
              placeholder={
                triple.derived === "durationSec" && triple.durationSec
                  ? String(Math.round((triple.durationSec / 60) * 10) / 10)
                  : "50"
              }
              inputMode="decimal"
            />
          </L>
          <L label={`平均ペース${triple.derived === "paceSecPerKm" ? "・自動計算" : ""}`}>
            <input
              className="w-full"
              value={paceOverride}
              onChange={(e) => setPaceOverride(e.target.value)}
              placeholder={autoPace ? fmtPace(autoPace).replace("/km", "") : "4:28"}
            />
          </L>
          <L label="平均HR">
            <input
              className="w-full"
              value={avgHr}
              onChange={(e) => setAvgHr(e.target.value)}
              placeholder="145"
              inputMode="numeric"
            />
          </L>
          <L label="最大HR">
            <input
              className="w-full"
              value={maxHr}
              onChange={(e) => setMaxHr(e.target.value)}
              inputMode="numeric"
            />
          </L>
          {autoPace ? (
            <div className="text-[11px] self-end pb-2" style={{ color: "var(--volt)" }}>
              平均ペース {fmtPace(autoPace)}
              {triple.distanceKm !== undefined && triple.derived === "distanceKm"
                ? ` ／ 距離 ${triple.distanceKm}km`
                : ""}
              {triple.durationSec !== undefined && triple.derived === "durationSec"
                ? ` ／ 時間 ${Math.round((triple.durationSec / 60) * 10) / 10}分`
                : ""}
            </div>
          ) : null}
          {/* 3つとも入っていて食い違うとき。勝手に直さず、どれかが違うと出すだけ */}
          {triple.mismatch ? (
            <StatusText kind="warning" className="col-span-2 text-[11px] leading-relaxed">
              {triple.mismatch}
            </StatusText>
          ) : null}
        </div>
      ) : mode === "interval" ? (
        <div className="flex flex-col gap-2">
          {structure?.mixed ? (
            /*
             * 複合（1000×4＋200×3）では、距離も設定も本ごとに違う。
             * 1組しか無い欄に何を入れればいいのか決まらないので出さない
             * （本数に7と入れるしかなく、距離1000mが全部に効いて見える。実際に指摘された）。
             * 距離と設定は下の「1本目 予定◯m／設定◯秒」が本ごとに持っている。
             */
            <div
              className="rounded-lg p-2.5"
              style={{ background: "var(--surface-2)" }}
              data-testid="mixed-composition"
            >
              <span className="block text-[10.5px] mb-1" style={{ color: "var(--text-3)" }}>
                予定の構成
              </span>
              <b className="text-[13px] num">{describeComposition(structure.slots)}</b>
              <p className="text-[11px] mt-1.5 leading-relaxed" style={{ color: "var(--text-3)" }}>
                距離と設定は本ごとに違うので、下の1本ずつの欄に出しています。
                途中で打ち切った場合だけ合計本数を直してください。
              </p>
              <label className="block text-[13px] mt-2" style={{ maxWidth: 140 }}>
                <span className="block text-[10.5px] mb-1" style={{ color: "var(--text-3)" }}>
                  合計本数
                </span>
                <input
                  className="w-full"
                  value={reps}
                  onChange={(e) => setReps(e.target.value)}
                  inputMode="numeric"
                  aria-label="合計本数"
                />
              </label>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {/*
                本数とレストは「だいたい決まっていて1つ足す・引く」が多いのでステッパー。
                距離と設定は値の幅が広く、押して合わせると回数がかさむのでテンキーのまま。

                **ステッパーを3列に入れない。** −と＋で88pt要るので、
                iPhone幅の3列（1列105pt前後）だと入力欄に十数ptしか残らない。
                数字が見えず押せもしない欄になり、しかも＋が隣の列にはみ出す。
                行を分けて、本数だけ横幅を持たせる。
              */}
              <div style={{ maxWidth: 220 }}>
                <Stepper label="本数" value={reps} onChange={setReps} min={1} max={40} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <L label="距離(m)">
                  <input className="w-full min-h-[44px]" value={distM} onChange={(e) => setDistM(e.target.value)} inputMode="numeric" />
                </L>
                <L label="設定(秒)">
                  <input
                    className="w-full min-h-[44px]"
                    value={targetSec}
                    onChange={(e) => setTargetSec(e.target.value)}
                    inputMode="decimal"
                  />
                </L>
              </div>
            </div>
          )}
          <RestFields
            restType={restType}
            setRestType={setRestType}
            restMode={restMode}
            setRestMode={setRestMode}
            restValue={restValue}
            setRestValue={setRestValue}
          />
          {/* N-2: メニューの構造に合わせて1本ずつの欄を出す。
              貼り付けたい場合のために、まとめて入れる方式も残す */}
          <div className="seg mb-2">
            <button data-on={perRep ? "1" : "0"} onClick={() => setPerRep(true)}>
              1本ずつ
            </button>
            <button data-on={!perRep ? "1" : "0"} onClick={() => setPerRep(false)}>
              まとめて
            </button>
          </div>
          {perRep ? (
            <>
              <label
                className="flex items-center gap-1.5 text-[11px] mb-1"
                style={{ color: "var(--text-3)" }}
              >
                <input
                  type="checkbox"
                  checked={withActualDistance}
                  onChange={(event) => setWithActualDistance(event.target.checked)}
                  style={{ width: 16, height: 16, padding: 0 }}
                />
                実施距離が予定と違う本がある（途中中断など）
              </label>
              {/*
                Q-1: 心拍の欄は既定では出さない。
                常時出すと1行に6欄（3本×2欄）並び、iPhone幅では
                実施タイムの欄まで押しつぶされる。出すときは2列に落として幅を確保する。
              */}
              <label
                className="flex items-center gap-1.5 text-[11px] mb-1"
                style={{ color: "var(--text-3)" }}
              >
                <input
                  type="checkbox"
                  checked={withHr}
                  onChange={(e) => setWithHr(e.target.checked)}
                  style={{ width: 16, height: 16, padding: 0 }}
                />
                1本ごとの平均心拍も入れる（任意）
              </label>
              {/*
                S-4: レストが本ごとに違うメニュー（300+600+300 で 6分・10分 など）は、
                セッションに1つのレストでは表せない。ここも既定では出さない。
              */}
              <label
                className="flex items-center gap-1.5 text-[11px] mb-1.5"
                style={{ color: "var(--text-3)" }}
              >
                <input
                  type="checkbox"
                  checked={withRest}
                  onChange={(e) => setWithRest(e.target.checked)}
                  style={{ width: 16, height: 16, padding: 0 }}
                />
                レストが本ごとに違う（任意）
              </label>
              {/*
                欄が増えるほど1行あたりの幅が減る。
                3欄になったら横並びをやめて1本1行にする（iPhone幅で潰さない）。
              */}
              <div
                className={`grid gap-1.5 ${
                  withActualDistance || (withHr && withRest)
                    ? "grid-cols-1"
                    : withHr || withRest ? "grid-cols-2" : "grid-cols-3"
                }`}
              >
                {Array.from({ length: slotCount }, (_, i) => {
                  const plannedDistance = slotDistances[i] ?? Number(distM);
                  return <div key={`rep-${i}`}>
                    <span
                      className="block mb-0.5 num text-[10px]"
                      style={{ color: "var(--text-3)" }}
                    >
                      {i + 1}本目 予定{plannedDistance}m
                      {slotTargets[i] !== undefined ? `／設定 ${slotTargets[i]}秒` : ""}
                      {slotRestDistances[i] !== undefined
                        ? `／次まで ${slotRestDistances[i]}m walk`
                        : ""}
                    </span>
                    <div className="flex gap-1">
                      {withActualDistance ? (
                        <label className="flex-1 min-w-0">
                          <input
                            className="w-full !text-[12px] !py-1"
                            inputMode="numeric"
                            aria-label={`${i + 1}本目 実施距離`}
                            value={repDistances[i] ?? String(plannedDistance)}
                            onChange={(event) => {
                              const value = event.target.value;
                              setRepDistances((previous) => {
                                const next = [...previous];
                                while (next.length <= i) next.push("");
                                next[i] = value;
                                return next;
                              });
                            }}
                          />
                        </label>
                      ) : null}
                      <label className="flex-1 min-w-0">
                        <input
                          className="w-full !text-[12px] !py-1"
                          inputMode="decimal"
                          aria-label={`${i + 1}本目 実施タイム`}
                          value={repTimes[i] ?? ""}
                          onChange={(e) => {
                            const v = e.target.value;
                            setRepTimes((prev) => {
                              const next = [...prev];
                              while (next.length <= i) next.push("");
                              next[i] = v;
                              return next;
                            });
                          }}
                        />
                      </label>
                      {withHr ? (
                        <label className="flex-1 min-w-0">
                          <input
                            className="w-full !text-[12px] !py-1"
                            inputMode="numeric"
                            placeholder="bpm"
                            aria-label={`${i + 1}本目 平均心拍`}
                            value={repHrs[i] ?? ""}
                            onChange={(e) => {
                              const v = e.target.value;
                              setRepHrs((prev) => {
                                const next = [...prev];
                                while (next.length <= i) next.push("");
                                next[i] = v;
                                return next;
                              });
                            }}
                          />
                        </label>
                      ) : null}
                      {withRest ? (
                        <label className="flex-1 min-w-0">
                          <input
                            className="w-full !text-[12px] !py-1"
                            placeholder={
                              slotRestDistances[i] !== undefined
                                ? `${slotRestDistances[i]}m walk`
                                : "r 6分"
                            }
                            aria-label={`${i + 1}本目のあとのレスト`}
                            value={repRests[i] ?? ""}
                            onChange={(e) => {
                              const v = e.target.value;
                              setRepRests((prev) => {
                                const next = [...prev];
                                while (next.length <= i) next.push("");
                                next[i] = v;
                                return next;
                              });
                            }}
                          />
                        </label>
                      ) : null}
                    </div>
                  </div>
                })}
              </div>
              {withActualDistance ? (
                <p className="text-[10.5px] mt-1" style={{ color: "var(--text-3)" }}>
                  例: 500m予定の3本目を400mで止めた場合は、実施距離400・タイム56.0と入力します。
                </p>
              ) : null}
              {withRest ? (
                <p className="text-[10.5px] mt-1" style={{ color: "var(--text-3)" }}>
                  「6分」「90秒」「300m walk」のように書けます。メニューに「次の距離walk」がある場合は自動で入ります。
                </p>
              ) : null}
            </>
          ) : (
            <L label="実施タイム（本数分をカンマ区切り）">
              <input
                className="w-full"
                value={times}
                onChange={(e) => setTimes(e.target.value)}
                placeholder="39.2, 39.6, 40.1, 40.8"
              />
            </L>
          )}
          <p className="text-[10.5px]" style={{ color: "var(--text-3)" }}>
            入力した本数から達成度・垂れ幅を自動判定します（中断した場合は入れた本数だけでOK）。
          </p>
        </div>
      ) : (
        <ChipGroup
          label="スキップ理由"
          value={skipReason as SkipReason}
          onChange={(v) => setSkipReason(v ?? "fatigue")}
          options={SKIP_OPTIONS}
          columns={3}
          testId="skip-chips"
        />
      )}

      {mode !== "skip" ? (
        <>
          <div className="flex flex-col gap-3 mt-3">
            <SubjectiveFields
              rpe={rpe}
              setRpe={setRpe}
              subjective={subjective}
              setSubjective={setSubjective}
              legs={legs}
              setLegs={setLegs}
              shortOfPlan={shortOfPlan}
              cause={cause}
              setCause={setCause}
              causeNote={causeNote}
              setCauseNote={setCauseNote}
              prescribedReps={prescribedReps}
              repsCount={Number(reps)}
            />
            <ConditionFields
              conditions={conditions}
              setConditions={setConditions}
              shoeId={shoeId}
              setShoeId={setShoeId}
              shoes={shoes}
              recommendedShoeId={recommendedShoeId}
            />
            {/*
              アップ（任意）。主練習の子データなので、独立した記録にはしない。
              既定では畳んである——毎回同じことが多く、
              常に開いておくと主練習の入力が画面の下に押し出される。
            */}
            <WarmupFields
              warmup={warmup}
              setWarmup={setWarmup}
              options={warmupOptions}
              shoes={shoes}
            />
          </div>

          {/* 2-1 環境条件（任意項目なので折りたたみ） */}
          <button
            className="text-[11.5px] mt-3 min-h-[44px] w-full text-left"
            style={{ color: "var(--text-2)" }}
            onClick={() => setShowEnv((v) => !v)}
          >
            {showEnv ? "▾" : "▸"} 環境条件（気温・湿度・風・雨）
            {env?.isHeatFlagged ? (
              <span style={{ color: "var(--amber)" }}> ⚠ 暑熱条件</span>
            ) : null}
          </button>
          {showEnv ? (
            <div className="grid grid-cols-2 gap-2">
              <L label="気温(℃)">
                <input className="w-full" value={tempC} onChange={(e) => setTempC(e.target.value)} inputMode="decimal" />
              </L>
              <L label="湿度(%)">
                <input
                  className="w-full"
                  value={humidity}
                  onChange={(e) => setHumidity(e.target.value)}
                  inputMode="numeric"
                />
              </L>
              <div className="col-span-2">
                <ChipGroup
                  label="風（記録用）"
                  value={wind as "calm" | "light" | "strong"}
                  onChange={(v) => setWind(v ?? "")}
                  options={WIND_OPTIONS}
                  allowEmpty
                  columns={3}
                />
              </div>
              <label className="text-[13px] flex items-end gap-2 pb-2">
                <input
                  type="checkbox"
                  checked={rain}
                  onChange={(e) => setRain(e.target.checked)}
                  className="w-5 h-5"
                />
                雨（記録用）
              </label>
              {/*
                風と雨がどこまで効くのかを書く。

                効くのは上の注意書き（`environmentNote`）まで。
                暑熱条件フラグ＝**その練習を能力推定から外すかどうか**は、
                気温と湿度から出すWBGTだけで決めていて、風雨は入っていない。

                入れていないのは根拠が無いから。風雨は「体感が下がるので
                能力推定から外すべきでない」方向にも、「条件が悪いので外すべき」方向にも
                効きうる。どちらか決められないまま係数を置くと、
                その数字がどこから来たのか説明できなくなる。
                根拠が出たら `evaluateEnvironment` に足す。
              */}
              <p
                className="col-span-2 text-[10.5px] leading-relaxed"
                style={{ color: "var(--text-3)" }}
              >
                風と雨は、達成度を読むときの注意として上に出すだけです。
                暑熱条件（その練習を能力推定から外すかどうか）は気温と湿度のWBGTだけで決めていて、
                風雨は入れていません——どちらに効かせるべきかの根拠が無いためです。
              </p>
              {envNotes.length > 0 ? (
                <div
                  role="status"
                  className="col-span-2 text-[10.5px] leading-relaxed"
                  style={{ color: "var(--amber)" }}
                >
                  {envNotes.map((n, i) => (
                    <p key={i}>
                      <span aria-hidden="true">⚠</span> {n}
                    </p>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}

      <div className="mt-3">
        <ConfirmButton
          label={
            busy
              ? "処理中…"
              : mode === "skip"
              ? "スキップとして登録"
              : existing
              ? "上書きして保存する"
              : "登録して補正を実行"
          }
          title={mode === "skip" ? "スキップとして登録しますか？" : "この内容で登録しますか？"}
          message={
            mode === "skip"
              ? "理由によっては後ろ倒しせず削除されます（疲労・故障・赤信号の場合）。"
              : existing
              ? "前回の登録を上書きします。前回この練習で動いたぶんのCFEは一度取り消してから、今回の内容で入れ直します。"
              : "登録するとCFEが更新され、以降のメニューのペースが自動で組み変わります。変更内容は理由つきで表示されます。"
          }
          className="btn-volt w-full justify-center min-h-[48px]"
          disabled={busy}
          onConfirm={submit}
        />
        {/* D-3: 頻出メニューのテンプレート保存。
            別ストアを作らず自作メニュー（3-2）に寄せて二重管理を避ける */}
        {mode !== "skip" ? (
          <ConfirmButton
            label="この内容をメニューとして保存"
            title="自作メニューとして保存しますか？"
            message="「メニュー設定」の自作メニューに登録され、次回以降のプラン生成で優先して使われます。あとから一時停止・削除できます。"
            className="btn-ghost w-full text-center mt-2"
            onConfirm={saveAsMenu}
          />
        ) : null}
        {existing ? (
          <ConfirmButton
            label="この記録を削除する"
            title="この記録を削除しますか？"
            message="この練習で動いたCFEの変化も取り消されます。予定枠自体は残ります（過去データ由来の枠は一緒に消えます）。この操作は取り消せません。"
            danger
            className="btn-ghost w-full text-center mt-2"
            disabled={busy}
            onConfirm={handleDelete}
          />
        ) : null}
        {savedMsg ? (
          <p className="text-[11.5px] mt-2" style={{ color: "var(--forge)" }}>
            {savedMsg}
          </p>
        ) : null}
      </div>
    </div>
  );
}
