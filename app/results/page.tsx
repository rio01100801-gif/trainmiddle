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
import { completeRunTriple, formatTimeInput } from "@/lib/core/inputFormat";
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
import { shoeChoices, type ShoeUsage } from "@/lib/core/shoes";
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

/** 実施タイム1本ぶん。「41.6」「1:26.5」いずれも受ける */
function parseRepTime(v: string): number | undefined {
  const t = v.trim();
  if (!t) return undefined;
  if (t.includes(":")) {
    const [m, sec] = t.split(":");
    const n = Number(m) * 60 + Number(sec);
    return isFinite(n) ? n : undefined;
  }
  const n = Number(t);
  return isFinite(n) && n > 0 ? n : undefined;
}

/**
 * S-4: 「6分」「90秒」「300」のようなレストの書き方を秒に直す。
 *
 * 解釈は一括入力と同じ `parseRest` に任せる（同じ文字列が画面によって違う意味に
 * ならないようにする）。単位が無いものは分でも秒でも決められないので、
 * ここでは日誌でよく使われる「分」として読む——のではなく、
 * **入力欄なので数字だけなら秒として読む**。
 * 日誌の解釈（読めなければ埋めない）と、入力欄（本人が今打っている）は事情が違う。
 */
function parseRestInput(v: string): number | undefined {
  const t = v.trim();
  if (!t) return undefined;
  const parsed = parseRest(t);
  if (parsed.restSec !== undefined) return parsed.restSec;
  if (parsed.restDistanceM !== undefined) return undefined; // 距離指定はここでは扱わない
  const n = Number(t.replace(/[^\d.]/g, ""));
  return isFinite(n) && n > 0 ? n : undefined;
}

function parsePerRepRestInput(v: string): {
  restSec?: number;
  restDistanceM?: number;
  restType?: RestType;
} {
  const parsed = parseRest(v.trim());
  if (parsed.restSec !== undefined || parsed.restDistanceM !== undefined) return parsed;
  const restSec = parseRestInput(v);
  return restSec !== undefined ? { restSec, restType: parsed.restType } : parsed;
}

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
  const [rain, setRain] = useState(!!existing?.rain);

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
  // 登録済みのシューズ。最後に使ったものが先頭に来る（毎回同じ靴なら1タップ）
  useEffect(() => {
    fetch("/api/shoes")
      .then((r) => r.json())
      .then((d) => setShoes(shoeChoices(d.usage ?? [])))
      .catch(() => {
        /* 靴は任意。取れなくても記録は入れられる */
      });
  }, []);

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
       * RPEは本人にしか分からない値なので、こちらで埋めない。
       *
       * 以前は新規入力でも 7 が入っていた。数字が入っている欄は「入力済み」に見えるので、
       * そのまま保存されうる。RPEはCFEの補正に効く（RPE_ADJUST_SEC_PER_POINT）ため、
       * こちらが置いた既定値が能力の推定に混ざることになる。
       * 空欄にして、入っていなければ保存させない（推測で埋めない・黙って混ぜない）。
       */
      // スライダーは範囲外を作れないが、旧データの読み込み経路もあるので確かめる
      if (!isValidRpe(rpe)) {
        setBusy(false);
        alert("RPEを選んでください。きつさの感じ方は本人にしか分からないので、こちらでは埋めません。");
        return;
      }
      const rpeValue = rpe;
      if (subjective === undefined) {
        setBusy(false);
        alert("主観を選んでください。");
        return;
      }

      // 理由を推測で埋めない。空のまま送ると「設定が高すぎた」として数えられてしまう
      if (shortOfPlan && cause === undefined) {
        setBusy(false);
        alert(
          "途中でやめた理由を選んでください。理由によって設定ペースの扱いが変わります。"
        );
        return;
      }

      const envPayload = {
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
      };

      let payload: any;
      if (mode === "continuous") {
        // S-2: 3つのうち2つ入っていれば足りる。足りないものは補われている
        const km = triple.distanceKm ?? 0;
        const min = triple.durationSec !== undefined ? triple.durationSec / 60 : 0;
        if (!km || !min) {
          setBusy(false);
          alert("距離・時間・平均ペースのうち2つを入力してください");
          return;
        }
        payload = {
          sessionId: session.id,
          sessionCategory,
          date: session.date,
          continuous: {
            distanceKm: Math.round(km * 100) / 100,
            durationMin: Math.round(min * 10) / 10,
            avgPaceSecPerKm: triple.paceSecPerKm ?? avgPaceSecPerKm(km, min),
            // 手で入れたペースが計算値の代わりに使われた場合だけ「上書き」とする。
            // ペースから距離を出したときは上書きではなく、それが実測そのもの
            paceOverridden: paceOverride && triple.derived !== "distanceKm" ? true : undefined,
            avgHr: avgHr ? Number(avgHr) : undefined,
            maxHr: maxHr ? Number(maxHr) : undefined,
          },
          achievement: "achieved",
          rpe: rpeValue,
          subjective: subjective!,
          nextDayLegs: legs || undefined,
          durationMin: min,
          ...envPayload,
        };
      } else {
        const source = perRep ? repTimes.join(",") : times;
        // 心拍と「何本目か」で対応させるため、間引く前の並びも残す
        const parsedTimes = source.split(",").map((x: string) => parseRepTime(x) ?? 0);
        const t = targetSec ? Number(targetSec) : undefined;
        // S-4: 区間ごとのレスト。空欄の本はセッション共通の設定を使う（undefinedのまま）
        const perRepRests =
          perRep && withRest
            ? Array.from({ length: slotCount }, (_, index) => {
                const entered = repRests[index]?.trim();
                return entered
                  ? parsePerRepRestInput(entered)
                  : { restDistanceM: slotRestDistances[index], restType: structureRestType };
              })
            : [];
        // 予定距離と実距離を分ける。500m予定を400mで止めた本も400m実測として残す。
        const plannedDists = perRep
          ? Array.from({ length: slotCount }, (_, index) =>
              slotDistances[index] ?? Number(distM)
            )
          : [];
        const dists = perRep
          ? plannedDists.map((plannedDistance, index) => {
              if (!withActualDistance) return plannedDistance;
              const entered = Number(repDistances[index]);
              return isFinite(entered) && entered > 0 ? entered : plannedDistance;
            })
          : [];
        const hrs =
          perRep && withHr
            ? repHrs.map((v) => {
                const n = Number(v);
                return v.trim() && isFinite(n) && n > 0 ? n : undefined;
              })
            : [];
        const builtResults = buildRepResults(
          Number(distM),
          parsedTimes,
          structure?.mixed ? undefined : t,
          hrs,
          dists,
          perRepRests.map((rest) => rest.restSec),
          slotTargets,
          perRepRests.map((rest) => rest.restDistanceM),
          plannedDists
        );
        payload = {
          sessionId: session.id,
          sessionCategory,
          date: session.date,
          interval: {
            reps: Number(reps),
            distanceM: Number(distM),
            targetSec: structure?.mixed ? undefined : t,
            restType: structureRestType ?? restType,
            restSec:
              !hasStructuredPerRepRest && restMode === "time"
                ? Number(restValue)
                : undefined,
            restDistanceM:
              !hasStructuredPerRepRest && restMode === "distance"
                ? Number(restValue)
                : undefined,
            results: builtResults,
          },
          actualLapsSec: builtResults.map((result) => result.actualSec),
          lapDistancesM: builtResults.map((result) => result.distanceM),
          achievement: "achieved", // サービス層が実測から上書きする
          rpe: rpeValue,
          subjective: subjective!,
          nextDayLegs: legs || undefined,
          ...envPayload,
        };
      }

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
            <div className="grid grid-cols-3 gap-2">
              {/*
                本数とレストは「だいたい決まっていて1つ足す・引く」が多いのでステッパー。
                距離と設定は値の幅が広く、押して合わせると回数がかさむのでテンキーのまま。
              */}
              <Stepper label="本数" value={reps} onChange={setReps} min={1} max={40} />
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
          )}
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
                      ? `途中でやめた理由（予定${prescribedReps}本に対して${Number(reps)}本）`
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
                options={shoes.map((u) => ({
                  value: u.shoe.id,
                  label: `${u.shoe.name}${u.totalKm > 0 ? ` ${u.totalKm}km` : ""}`,
                }))}
                allowEmpty
                emptyLabel="未選択（任意）"
                columns={2}
                testId="shoe-chips"
              />
            ) : null}
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
