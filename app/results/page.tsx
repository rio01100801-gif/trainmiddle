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
import { localToday } from "@/lib/core/dates";
import { useQueryParam } from "../components/route-query";
import { completeRunTriple, formatTimeInput } from "@/lib/core/inputFormat";
import { parseRest } from "@/lib/core/bulkImport";
import { avgPaceSecPerKm, buildRepResults, REST_LABELS } from "@/lib/core/workoutLog";
import { evaluateEnvironment, environmentNote, WIND_LABELS } from "@/lib/core/environment";
import type { FitnessMarkerPurpose, RestType, SessionCategory } from "@/lib/core/types";
import type { AerobicProfile } from "@/lib/core/pace";
import type { PrescriptionStructure } from "@/lib/core/prescription";

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
    const res = await fetch("/api/daily", {
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
    setOut(await res.json());
    setSaved(true);
    loadHistory();
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

  const load = useCallback(() => {
    fetch("/api/injuries")
      .then((r) => r.json())
      .then((d) => setList(d.injuries ?? []));
  }, []);
  useEffect(load, [load]);

  const save = async () => {
    if (!bodyPart) return;
    await fetch("/api/injuries", {
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
  };

  const remove = async (inj: any) => {
    await fetch(`/api/injuries?id=${encodeURIComponent(inj.id)}`, { method: "DELETE" });
    setUndo(inj);
    load();
  };

  const restore = async () => {
    if (!undo) return;
    await fetch("/api/injuries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(undo),
    });
    setUndo(null);
    load();
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
      {open ? (
        <div className="flex flex-col gap-2 mb-3 pb-3 border-b" style={{ borderColor: "var(--border)" }}>
          <div className="flex gap-2 flex-wrap items-end">
            <label className="text-[13px] flex-1 min-w-[130px]">
              <span className="block text-[10.5px] mb-1" style={{ color: "var(--text-3)" }}>
                部位
              </span>
              <input
                className="w-full"
                value={bodyPart}
                onChange={(e) => setBodyPart(e.target.value)}
                placeholder="例: 右アキレス腱"
              />
            </label>
            <label className="text-[13px]">
              <span className="block text-[10.5px] mb-1" style={{ color: "var(--text-3)" }}>
                状態
              </span>
              <select value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="onset">発生</option>
                <option value="ongoing">継続</option>
                <option value="recovered">回復</option>
              </select>
            </label>
          </div>
          <div>
            <div className="text-[10.5px] mb-1" style={{ color: "var(--text-3)" }}>
              痛みの程度: <b style={{ color: "var(--text)" }}>{painLevel}</b> / 10
            </div>
            <input
              type="range"
              min={0}
              max={10}
              value={painLevel}
              onChange={(e) => setPain(e.target.value)}
              className="w-full !p-0 !border-0 !bg-transparent"
              style={{ accentColor: "var(--volt)", minHeight: 44 }}
            />
          </div>
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
    const res = await fetch("/api/markers", {
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
    const d = await res.json();
    setProfile(d.aerobicProfile);
    setMsg("登録しました。「目標・レース」で再生成すると設定に反映されます。");
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
  const [rpe, setRpe] = useState(existing ? String(existing.rpe ?? 7) : "7");
  const [subjective, setSubjective] = useState(existing?.subjective ?? "moderate");
  const [legs, setLegs] = useState(existing?.nextDayLegs ?? "");

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
  const [rain, setRain] = useState(!!existing?.rain);

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
    if (r.rpe !== undefined) setRpe(String(r.rpe));
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
    const res = await fetch("/api/plan-settings", {
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
    const d = await res.json();
    setSavedMsg(
      d.error
        ? d.error
        : `「${name}」をメニューに保存しました。次回の生成から候補に入ります（メニュー設定で確認・削除できます）。`
    );
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
        const res = await fetch("/api/skip", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: session.id, reason: skipReason }),
        });
        const d = await res.json();
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

      const envPayload = {
        weatherTempC: tempC ? Number(tempC) : undefined,
        humidityPct: humidity ? Number(humidity) : undefined,
        wind: wind || undefined,
        rain: rain || undefined,
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
          rpe: Number(rpe),
          subjective,
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
          rpe: Number(rpe),
          subjective,
          nextDayLegs: legs || undefined,
          ...envPayload,
        };
      }

      const res = await fetch("/api/results", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      onDone(await res.json());
    } finally {
      setBusy(false);
    }
  };

  /** 不具合4対応: 誤って登録した結果を削除する。CFEへの寄与もサービス層で取り消される */
  const handleDelete = async () => {
    if (!existing) return;
    setBusy(true);
    try {
      await fetch(`/api/results?id=${encodeURIComponent(existing.id)}`, { method: "DELETE" });
      onDeleted?.();
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
          <div className="grid grid-cols-3 gap-2">
            <L label="本数">
              <input className="w-full" value={reps} onChange={(e) => setReps(e.target.value)} inputMode="numeric" />
            </L>
            <L label="距離(m)">
              <input className="w-full" value={distM} onChange={(e) => setDistM(e.target.value)} inputMode="numeric" />
            </L>
            <L label="設定(秒)">
              <input
                className="w-full"
                value={targetSec}
                onChange={(e) => setTargetSec(e.target.value)}
                inputMode="decimal"
              />
            </L>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <L label="レスト内容">
              <select
                className="w-full"
                value={restType}
                onChange={(e) => setRestType(e.target.value as RestType)}
              >
                {(["jog", "walk", "full"] as RestType[]).map((r) => (
                  <option key={r} value={r}>
                    {REST_LABELS[r]}
                  </option>
                ))}
              </select>
            </L>
            <L label="レスト指定">
              <select
                className="w-full"
                value={restMode}
                onChange={(e) => setRestMode(e.target.value as "time" | "distance")}
              >
                <option value="time">時間(秒)</option>
                <option value="distance">距離(m)</option>
              </select>
            </L>
            <L label={restMode === "time" ? "レスト(秒)" : "レスト(m)"}>
              <input
                className="w-full"
                value={restValue}
                onChange={(e) => setRestValue(e.target.value)}
                inputMode="numeric"
              />
            </L>
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
        <L label="スキップ理由">
          <select
            className="w-full"
            value={skipReason}
            onChange={(e) => setSkipReason(e.target.value)}
          >
            <option value="fatigue">疲労</option>
            <option value="red_signal">赤信号</option>
            <option value="injury">故障</option>
            <option value="schedule">予定</option>
            <option value="weather">天候</option>
            <option value="other">その他</option>
          </select>
        </L>
      )}

      {mode !== "skip" ? (
        <>
          <div className="grid grid-cols-3 gap-2 mt-2">
            <L label="RPE(1-10)">
              <input className="w-full" value={rpe} onChange={(e) => setRpe(e.target.value)} inputMode="numeric" />
            </L>
            <L label="主観">
              <select
                className="w-full"
                value={subjective}
                onChange={(e) => setSubjective(e.target.value)}
              >
                <option value="easy">余裕</option>
                <option value="moderate">普通</option>
                <option value="hard">きつい</option>
                <option value="very_hard">非常にきつい</option>
              </select>
            </L>
            <L label="翌日の脚">
              <select className="w-full" value={legs} onChange={(e) => setLegs(e.target.value)}>
                <option value="">-</option>
                <option value="fresh">軽い</option>
                <option value="normal">普通</option>
                <option value="heavy">重い</option>
              </select>
            </L>
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
              <L label="風">
                <select className="w-full" value={wind} onChange={(e) => setWind(e.target.value)}>
                  <option value="">-</option>
                  {Object.entries(WIND_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </L>
              <label className="text-[13px] flex items-end gap-2 pb-2">
                <input
                  type="checkbox"
                  checked={rain}
                  onChange={(e) => setRain(e.target.checked)}
                  className="w-5 h-5"
                />
                雨
              </label>
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
