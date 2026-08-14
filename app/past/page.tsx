"use client";
import { useCallback, useEffect, useState } from "react";
import { Card, ConfirmButton, StatusText, UndoBar, ViolationList, fmtSec } from "../components/ui";
import { apiRequest } from "../components/api-client";
import {
  PAST_KIND_LABELS,
  BACKFILL_WINDOW_WEEKS,
  type PastEntry,
  type PastEntryKind,
} from "@/lib/core/backfill";
import { localToday } from "@/lib/core/dates";
import { computeReady } from "@/lib/core/bulkImport";
import type { RestType, SessionCategory } from "@/lib/core/types";
import { askAssistant, getApiKey, getConsent } from "../components/assistant";
import { PhotoTranscribe } from "../components/photo-transcribe";
import {
  buildPhraseSuggestionRequest,
  parsePhraseSuggestion,
  PHRASE_SUGGESTION_SYSTEM_PROMPT,
  type PhraseSuggestion,
} from "@/lib/core/phraseSuggestion";

const KINDS: PastEntryKind[] = ["race", "timetrial", "interval", "continuous"];
const RACE_DISTANCES = [400, 600, 800, 1000, 1500, 3000];
const POINT_CATEGORIES: SessionCategory[] = [
  "high_lactate",
  "race_economy",
  "modeling",
  "cv",
  "threshold",
  "neural",
];
const CATEGORY_LABELS: Record<string, string> = {
  high_lactate: "高乳酸",
  race_economy: "経済走",
  modeling: "モデリング",
  cv: "CV",
  threshold: "閾値",
  neural: "神経系",
};

/**
 * 一覧に出す1行の要約。
 * 種類ごとに持っている値が違うので、無い項目は書かない。
 * 「undefinedm」のような表示が出ると、入力を間違えたのかアプリの不具合なのか
 * 本人には区別がつかない。
 */
function summaryOf(e: PastEntry): string {
  if (e.kind === "off") return "休養";
  if (e.kind === "interval") {
    const times = e.repTimesSec?.map((t) => t.toFixed(1)).join(" ") ?? "";
    const head = e.repDistanceM ? `${e.repDistanceM}m×${e.repTimesSec?.length ?? 0}` : "";
    return [head, times].filter(Boolean).join(" ") || "記録なし";
  }
  if (e.kind === "continuous") {
    return (
      [
        e.distanceKm !== undefined ? `${round1(e.distanceKm)}km` : "",
        e.durationMin !== undefined ? `${round1(e.durationMin)}分` : "",
      ]
        .filter(Boolean)
        .join(" ") || "記録なし"
    );
  }
  return (
    [e.distanceM ? `${e.distanceM}m` : "", e.timeSec !== undefined ? fmtSec(e.timeSec) : ""]
      .filter(Boolean)
      .join(" ") || "記録なし"
  );
}

/** 表示用に小数1桁へ丸める（割り算の結果をそのまま出さない） */
function round1(v?: number): string {
  if (v === undefined || !isFinite(v)) return "-";
  return String(Math.round(v * 10) / 10);
}

function parseTime(v: string): number | undefined {
  if (!v.trim()) return undefined;
  if (v.includes(":")) {
    const [m, s] = v.split(":");
    return Number(m) * 60 + Number(s);
  }
  const n = Number(v);
  return isNaN(n) ? undefined : n;
}

/** "43.2 43.5 44.0" / "43.2,43.5" のどちらでも受ける */
function parseTimes(v: string): number[] {
  return v
    .split(/[\s,、]+/)
    .map((x) => parseTime(x))
    .filter((n): n is number => n !== undefined && n > 0);
}

interface Assessment {
  estimated800mSec?: number;
  confidence: number;
  samples: {
    entryId: string;
    date: string;
    label: string;
    implied800mSec: number;
    weight: number;
    reliability: number;
    recencyWeight: number;
    heatFlagged: boolean;
    note: string;
  }[];
  excluded: { entryId: string; date: string; label: string; reason: string }[];
  notes: string[];
  deltaFromCfeSec?: number;
  currentCfeSec?: number;
  pastStructureIssues: any[];
  entryCount: number;
}

export default function PastPage() {
  const [entries, setEntries] = useState<PastEntry[]>([]);
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [msg, setMsg] = useState("");
  const [undo, setUndo] = useState<PastEntry | null>(null);
  const [mode, setMode] = useState<"single" | "bulk">("single");
  // 辞書に語を足したら「覚えた書き方」を読み直す
  const [phraseVersion, setPhraseVersion] = useState(0);

  const load = useCallback(() => {
    fetch("/api/past")
      .then((r) => r.json())
      .then((d) => {
        setEntries(d.entries ?? []);
        setAssessment(d.assessment ?? null);
      });
  }, []);
  useEffect(load, [load]);

  const save = async (entry: PastEntry) => {
    const r = await fetch("/api/past", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entry, today: localToday() }),
    });
    const d = await r.json();
    if (d.error) {
      setMsg(d.error);
      return false;
    }
    setEntries(d.entries ?? []);
    setAssessment(d.assessment ?? null);
    setMsg("登録しました。");
    return true;
  };

  const remove = async (e: PastEntry) => {
    const r = await fetch(`/api/past?id=${encodeURIComponent(e.id)}`, { method: "DELETE" });
    const d = await r.json();
    setEntries(d.entries ?? []);
    setAssessment(d.assessment ?? null);
    setUndo(e);
  };

  return (
    <div className="flex flex-col gap-3">
      <AssessmentCard assessment={assessment} onApplied={load} />

      {/* F-2: まとめて入力と1件ずつ入力を併存させる。既存のフォームは残す */}
      <div className="seg">
        <button data-on={mode === "single" ? "1" : "0"} onClick={() => setMode("single")}>
          1件ずつ入力
        </button>
        <button data-on={mode === "bulk" ? "1" : "0"} onClick={() => setMode("bulk")}>
          まとめて入力
        </button>
      </div>

      {mode === "single" ? <PastEntryForm onSave={save} msg={msg} /> : null}
      {mode === "bulk" ? (
        <>
          <BulkForm
            onImported={(d) => {
              setEntries(d.entries ?? []);
              setAssessment(d.assessment ?? null);
            }}
            onTaught={() => setPhraseVersion((v) => v + 1)}
          />
          <PhraseCard version={phraseVersion} />
        </>
      ) : null}

      <EntryList entries={entries} onDelete={remove} />
      {undo && (
        <UndoBar
          message="過去データを削除しました"
          onUndo={async () => {
            await save(undo);
            setUndo(null);
          }}
          onDismiss={() => setUndo(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 現在地
// ---------------------------------------------------------------------------

function AssessmentCard({
  assessment,
  onApplied,
}: {
  assessment: Assessment | null;
  onApplied: () => void;
}) {
  const [msg, setMsg] = useState("");
  const [open, setOpen] = useState(false);

  const apply = async () => {
    const r = await fetch("/api/past", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apply: true, today: localToday() }),
    });
    const d = await r.json();
    if (d.error) {
      setMsg(d.error);
      return;
    }
    setMsg(
      `CFEを ${fmtSec(d.before)} → ${fmtSec(d.after)} に更新しました。` +
        (d.changes?.length ? `設定ペースを${d.changes.length}件再計算しました。` : "")
    );
    onApplied();
  };

  const est = assessment?.estimated800mSec;

  return (
    <Card title="現在地（過去データからの推定）">
      {!assessment || assessment.entryCount === 0 ? (
        <p className="text-[12px] leading-relaxed" style={{ color: "var(--text-2)" }}>
          過去{BACKFILL_WINDOW_WEEKS}週ぶんの実測を下のフォームから登録すると、
          今の800m能力を推定します。CFEの初期値は「800mPB + 1.5秒」で置かれているため、
          PBが古い場合は設定ペース全体が実力より速くなります。
          レースかタイムトライアルを1本入れるだけでも精度が大きく変わります。
        </p>
      ) : est === undefined ? (
        <>
          <p className="text-[13px] font-semibold mb-2">推定できていません</p>
          {assessment.notes.map((n, i) => (
            <p key={i} className="text-[12px] leading-relaxed mb-1" style={{ color: "var(--text-2)" }}>
              {n}
            </p>
          ))}
        </>
      ) : (
        <>
          <div className="flex items-baseline gap-3 flex-wrap mb-2">
            <div>
              <div className="text-[10px] tracking-wider mb-0.5" style={{ color: "var(--text-3)" }}>
                推定800m
              </div>
              <div className="hero num">{fmtSec(est)}</div>
            </div>
            {assessment.currentCfeSec !== undefined && (
              <div>
                <div className="text-[10px] tracking-wider mb-0.5" style={{ color: "var(--text-3)" }}>
                  現在のCFE
                </div>
                <div className="text-[22px] font-bold num" style={{ color: "var(--text-2)" }}>
                  {fmtSec(assessment.currentCfeSec)}
                </div>
              </div>
            )}
            {assessment.deltaFromCfeSec !== undefined && (
              <div
                className="chip"
                style={{
                  color:
                    assessment.deltaFromCfeSec > 1.5
                      ? "var(--red)"
                      : assessment.deltaFromCfeSec < -1.5
                      ? "var(--volt)"
                      : "var(--text-2)",
                  borderColor: "var(--border-2)",
                  background: "transparent",
                }}
              >
                差 {assessment.deltaFromCfeSec > 0 ? "+" : ""}
                {assessment.deltaFromCfeSec.toFixed(1)}秒
              </div>
            )}
          </div>

          <p className="text-[11.5px] mb-2" style={{ color: "var(--text-3)" }}>
            信頼度 {Math.round(assessment.confidence * 100)}% ／ 採用
            {assessment.samples.length}件・除外{assessment.excluded.length}件
          </p>

          {assessment.notes.map((n, i) => (
            <p
              key={i}
              className="text-[12px] leading-relaxed mb-1.5 pl-2.5 border-l-2"
              style={{ color: "var(--text-2)", borderColor: "var(--amber)" }}
            >
              {n}
            </p>
          ))}

          <button
            className="btn-ghost !text-[11.5px] !py-1.5 !px-3 mt-1"
            onClick={() => setOpen(!open)}
          >
            {open ? "内訳を隠す" : "内訳を見る"}
          </button>

          {open && (
            <div className="mt-2.5 flex flex-col gap-1.5">
              {assessment.samples.map((s) => (
                <div
                  key={s.entryId}
                  className="p-2.5 rounded-lg text-[11.5px]"
                  style={{ background: "var(--surface-2)" }}
                >
                  <div className="flex justify-between gap-2 flex-wrap">
                    <b className="num">
                      {s.date} {s.label}
                    </b>
                    <span className="num" style={{ color: "var(--volt)" }}>
                      → {fmtSec(s.implied800mSec)}
                    </span>
                  </div>
                  <div className="mt-0.5" style={{ color: "var(--text-3)" }}>
                    {s.note}
                  </div>
                  <div className="mt-0.5 num" style={{ color: "var(--text-3)" }}>
                    重み {s.weight.toFixed(2)}（信頼度 {s.reliability.toFixed(2)} × 直近性{" "}
                    {s.recencyWeight.toFixed(2)}）
                  </div>
                </div>
              ))}
              {assessment.excluded.map((x) => (
                <div key={x.entryId} className="text-[11px] pl-2.5" style={{ color: "var(--text-3)" }}>
                  ✕ {x.date} {x.label} — {x.reason}
                </div>
              ))}
            </div>
          )}

          <div className="mt-3">
            <ConfirmButton
              label="この推定をCFEに反映する"
              title="CFEを実測ベースに置き換えます"
              message={`CFEを ${fmtSec(assessment.currentCfeSec)} から ${fmtSec(
                est
              )} に更新し、未実施セッションの設定ペースをすべて再計算します。よろしいですか？`}
              onConfirm={apply}
            />
          </div>
          {msg && (
            <p className="text-[12px] mt-2" style={{ color: "var(--volt)" }}>
              {msg}
            </p>
          )}
        </>
      )}

      {assessment && assessment.pastStructureIssues?.length > 0 && (
        <div className="mt-3.5 pt-3 border-t" style={{ borderColor: "var(--border)" }}>
          <p className="text-[11.5px] mb-2" style={{ color: "var(--text-2)" }}>
            過去の練習構成の問題点（今のプランではなく、入力された過去データの並びに対する診断です）
          </p>
          <ViolationList violations={assessment.pastStructureIssues} compact />
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// 入力フォーム
// ---------------------------------------------------------------------------

function PastEntryForm({
  onSave,
  msg,
}: {
  onSave: (e: PastEntry) => Promise<boolean>;
  msg: string;
}) {
  const [kind, setKind] = useState<PastEntryKind>("race");
  const [date, setDate] = useState(localToday());
  const [distanceM, setDistanceM] = useState(800);
  const [timeStr, setTimeStr] = useState("");
  const [lapsStr, setLapsStr] = useState("");
  const [category, setCategory] = useState<SessionCategory>("high_lactate");
  const [repDistanceM, setRepDistanceM] = useState(300);
  const [repTimesStr, setRepTimesStr] = useState("");
  const [restMin, setRestMin] = useState("");
  const [restType, setRestType] = useState<RestType>("jog");
  const [distanceKm, setDistanceKm] = useState("");
  const [durationMin, setDurationMin] = useState("");
  const [avgHr, setAvgHr] = useState("");
  const [rpe, setRpe] = useState("");
  const [tempC, setTempC] = useState("");
  const [humidity, setHumidity] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");

  const submit = async () => {
    setErr("");
    const base: PastEntry = {
      id: `pe-${Date.now()}`,
      date,
      kind,
      rpe: rpe ? Number(rpe) : undefined,
      tempC: tempC ? Number(tempC) : undefined,
      humidityPct: humidity ? Number(humidity) : undefined,
      note: note || undefined,
    };

    if (kind === "race" || kind === "timetrial") {
      const t = parseTime(timeStr);
      if (!t) return setErr("記録を入力してください（例 1:49.51 または 49.51）");
      base.distanceM = distanceM;
      base.timeSec = t;
      const laps = parseTimes(lapsStr);
      if (laps.length > 0) {
        base.lapsSec = laps;
        base.lapDistanceM = Math.round(distanceM / laps.length);
      }
    } else if (kind === "interval") {
      const times = parseTimes(repTimesStr);
      if (times.length === 0)
        return setErr("各本のタイムを入力してください（例 43.2 43.5 44.0）");
      base.category = category;
      base.repDistanceM = repDistanceM;
      base.repTimesSec = times;
      base.reps = times.length;
      base.restType = restType;
      if (restMin) base.restSec = Math.round(Number(restMin) * 60);
    } else {
      const km = Number(distanceKm);
      const min = Number(durationMin);
      if (!km || !min) return setErr("距離と時間を入力してください");
      base.distanceKm = km;
      base.durationMin = min;
      base.avgHr = avgHr ? Number(avgHr) : undefined;
    }

    const ok = await onSave(base);
    if (ok) {
      setTimeStr("");
      setLapsStr("");
      setRepTimesStr("");
      setDistanceKm("");
      setDurationMin("");
      setAvgHr("");
      setNote("");
    }
  };

  const paceHint =
    kind === "continuous" && Number(distanceKm) > 0 && Number(durationMin) > 0
      ? `平均 ${Math.floor((Number(durationMin) * 60) / Number(distanceKm) / 60)}:${String(
          Math.round(((Number(durationMin) * 60) / Number(distanceKm)) % 60)
        ).padStart(2, "0")}/km`
      : "";

  return (
    <Card title="過去データの入力">
      <div className="flex flex-wrap gap-1.5 mb-3">
        {KINDS.map((k) => (
          <button
            key={k}
            onClick={() => setKind(k)}
            className="min-h-[44px] px-3 rounded-lg text-[12.5px] font-bold"
            style={{
              background: kind === k ? "var(--volt)" : "var(--surface-2)",
              color: kind === k ? "var(--volt-ink)" : "var(--text-2)",
              border: `1px solid ${kind === k ? "var(--volt)" : "var(--border-2)"}`,
            }}
          >
            {PAST_KIND_LABELS[k]}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
        <label className="flex flex-col gap-1 text-[11.5px]">
          日付
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>

        {(kind === "race" || kind === "timetrial") && (
          <>
            <label className="flex flex-col gap-1 text-[11.5px]">
              距離
              <select
                value={distanceM}
                onChange={(e) => setDistanceM(Number(e.target.value))}
              >
                {RACE_DISTANCES.map((d) => (
                  <option key={d} value={d}>
                    {d}m
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[11.5px]">
              記録
              <input
                placeholder="1:49.51"
                value={timeStr}
                onChange={(e) => setTimeStr(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-[11.5px] col-span-2 md:col-span-1">
              区間ラップ（任意）
              <input
                placeholder="52.8 56.7"
                value={lapsStr}
                onChange={(e) => setLapsStr(e.target.value)}
              />
            </label>
          </>
        )}

        {kind === "interval" && (
          <>
            <label className="flex flex-col gap-1 text-[11.5px]">
              カテゴリ
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as SessionCategory)}
              >
                {POINT_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[11.5px]">
              1本の距離(m)
              <input
                type="number" inputMode="decimal"
                value={repDistanceM}
                onChange={(e) => setRepDistanceM(Number(e.target.value))}
              />
            </label>
            <label className="flex flex-col gap-1 text-[11.5px]">
              レスト(分)
              <input
                type="number" inputMode="decimal"
                step="0.5"
                placeholder="4"
                value={restMin}
                onChange={(e) => setRestMin(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-[11.5px]">
              レスト種別
              <select value={restType} onChange={(e) => setRestType(e.target.value as RestType)}>
                <option value="jog">ジョグ</option>
                <option value="walk">ウォーク</option>
                <option value="full">完全休息</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[11.5px] col-span-2 md:col-span-4">
              各本のタイム（スペース区切り）
              <input
                placeholder="43.2 43.5 44.0 44.3 45.1"
                value={repTimesStr}
                onChange={(e) => setRepTimesStr(e.target.value)}
              />
            </label>
          </>
        )}

        {kind === "continuous" && (
          <>
            <label className="flex flex-col gap-1 text-[11.5px]">
              距離(km)
              <input
                type="number" inputMode="decimal"
                step="0.1"
                value={distanceKm}
                onChange={(e) => setDistanceKm(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-[11.5px]">
              時間(分)
              <input
                type="number" inputMode="decimal"
                step="0.1"
                value={durationMin}
                onChange={(e) => setDurationMin(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-[11.5px]">
              平均HR（任意）
              <input type="number" inputMode="decimal" value={avgHr} onChange={(e) => setAvgHr(e.target.value)} />
            </label>
          </>
        )}

        <label className="flex flex-col gap-1 text-[11.5px]">
          RPE（任意）
          <input
            type="number" inputMode="decimal"
            min={1}
            max={10}
            value={rpe}
            onChange={(e) => setRpe(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-[11.5px]">
          気温(℃)
          <input type="number" inputMode="decimal" value={tempC} onChange={(e) => setTempC(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-[11.5px]">
          湿度(%)
          <input type="number" inputMode="decimal" value={humidity} onChange={(e) => setHumidity(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-[11.5px] col-span-2 md:col-span-4">
          メモ（任意）
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>

      {paceHint && (
        <p className="text-[11.5px] mt-2 num" style={{ color: "var(--volt)" }}>
          {paceHint}
        </p>
      )}

      <p className="text-[11px] leading-relaxed mt-2.5" style={{ color: "var(--text-3)" }}>
        {kind === "interval"
          ? "全力に近い練習でないと能力は測れません。RPE6未満の記録は推定に使わず、負荷（ACWR）にだけ反映します。レストは正直に入れてください（長いレストのタイムは自動で割り引きます）。"
          : kind === "continuous"
          ? "ジョグ・持続走は800m能力の推定には使いません。LTペースの推定と、直近28日の負荷比（ACWR）の下地になります。"
          : "気温を入れておくと、暑熱下の記録を能力推定から自動で除外します（暑熱下の記録は実力を過小評価するため）。"}
      </p>

      {err && (
        <StatusText kind="error" className="text-[12px] mt-2">
          {err}
        </StatusText>
      )}
      <div className="mt-3">
        <button className="btn-volt justify-center w-full sm:w-auto" onClick={submit}>
          この記録を登録
        </button>
      </div>
      {msg && (
        <p className="text-[12px] mt-2" style={{ color: "var(--volt)" }}>
          {msg}
        </p>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// 一覧
// ---------------------------------------------------------------------------

function EntryList({
  entries,
  onDelete,
}: {
  entries: PastEntry[];
  onDelete: (e: PastEntry) => void;
}) {
  if (entries.length === 0) return null;
  return (
    <Card title={`登録済み（${entries.length}件）`}>
      <div className="flex flex-col">
        {entries.map((e) => (
          <div
            key={e.id}
            className="flex items-center gap-2 py-2.5 border-b last:border-0"
            style={{ borderColor: "var(--border)" }}
          >
            <div className="min-w-0 flex-1">
              <div className="text-[12.5px] font-semibold num truncate">
                {e.date} {PAST_KIND_LABELS[e.kind]}
              </div>
              <div className="text-[11px] num" style={{ color: "var(--text-3)" }}>
                {summaryOf(e)}
                {e.tempC !== undefined ? ` ／ ${e.tempC}℃` : ""}
              </div>
            </div>
            <button
              className="btn-ghost !text-[11.5px] !py-1.5 !px-3"
              onClick={() => onDelete(e)}
            >
              削除
            </button>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// F-2. まとめて入力
// ---------------------------------------------------------------------------

const KIND_OPTIONS: { value: PastEntryKind; label: string }[] = [
  { value: "race", label: "レース" },
  { value: "timetrial", label: "タイムトライアル" },
  { value: "interval", label: "ポイント練習" },
  { value: "continuous", label: "ジョグ・持続走" },
  { value: "strength", label: "補強" },
  { value: "off", label: "オフ（休養）" },
];

const STRENGTH_OPTIONS: { value: string; label: string }[] = [
  { value: "strength", label: "ウェイト・筋トレ" },
  { value: "plyometrics", label: "プライオ" },
  { value: "medicine_ball", label: "メディシンボール" },
  { value: "core", label: "体幹" },
];

/**
 * 覚えさせる語の候補を本文から拾う。
 * 数値・単位・レスト表記を落とした残りで、いちばん長い連続した語を出す。
 * あくまで候補で、確定は本人がする。こちらで勝手に辞書を作らない。
 */
function guessPhrase(raw: string): string {
  const body = String(raw ?? "")
    .replace(/^\s*\S+\s/, "") // 行頭の日付
    .replace(/[（(][^）)]*[）)]/g, " ")
    .replace(/[rR]\d+\s*\S*/g, " ")
    .replace(/[0-9０-９:：.．\-〜~×xX＋+\/]+/g, " ")
    .replace(/(km|km\/|min|分|秒|本|m|jog|walk|ジョグ|平均心拍|最大)/g, " ");
  const words = body.split(/[\s、,]+/).filter((w) => w.length >= 2);
  return words.sort((a, b) => b.length - a.length)[0] ?? "";
}

const SAMPLE_TEXT = `7/4 2kmジョグ 8:40
7/5 オフ
7/6 300(42)＋600(1:26)＋600(1:26) r15min
42 1:26 1:25
7/13 レース 800m 1:56.0(56.0-60.0)
7/16 65minジョグ　11.8km 平均心拍154
7/18 1000(3:15-25)×4 r200jog 3:27 3:26 3:27 3:27 平均心拍180`;

function BulkForm({
  onImported,
  onTaught,
}: {
  onImported: (d: any) => void;
  onTaught: () => void;
}) {
  const [text, setText] = useState("");
  const [rows, setRows] = useState<any[] | null>(null);
  const [selected, setSelected] = useState<Record<number, boolean>>({});
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  /*
   * すでに覚えている語。候補出しに渡して、同じものを二度提案させない。
   * 解釈のたびに取り直すのは、直前に登録したぶんを反映するため。
   */
  const [knownPhrases, setKnownPhrases] = useState<string[]>([]);
  const loadPhrases = useCallback(() => {
    fetch("/api/phrases")
      .then((r) => r.json())
      .then((d: { phrases?: { phrase?: unknown }[] }) =>
        setKnownPhrases((d.phrases ?? []).map((p) => String(p.phrase ?? "")).filter(Boolean))
      )
      .catch(() => setKnownPhrases([]));
  }, []);
  useEffect(loadPhrases, [loadPhrases]);

  const preview = async () => {
    setBusy(true);
    setMsg("");
    try {
      const r = await fetch("/api/past", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ previewText: text, today: localToday() }),
      });
      const d = await r.json();
      // 解釈できなかった行を覚えておく。人が直したあとに
      // 「この書き方を覚えさせますか」を出す対象がこれ
      const list = ((d.rows ?? []) as any[]).map((row) => ({
        ...row,
        needsTeaching: !!row.categoryUncertain || !row.kind,
        phraseDraft: guessPhrase(row.raw ?? ""),
      }));
      setRows(list);
      // 登録できる行だけ最初からチェックを入れる
      const sel: Record<number, boolean> = {};
      list.forEach((row, i) => (sel[i] = !!row.ready));
      setSelected(sel);
    } finally {
      setBusy(false);
    }
  };

  /** プレビュー表の1セルを直したら、その行の登録可否を再判定する */
  const patch = (i: number, changes: Record<string, any>) => {
    setRows((prev) => {
      if (!prev) return prev;
      const next = [...prev];
      const row = { ...next[i], ...changes };
      // カテゴリを人が選んだら未確定を解除する
      if (changes.category !== undefined && changes.category !== "") {
        row.categoryUncertain = false;
        row.issues = (row.issues ?? []).filter(
          (m: string) => !m.includes("カテゴリを選んで")
        );
      }
      row.ready = computeReady(row);
      next[i] = row;
      return next;
    });
  };

  const commit = async () => {
    if (!rows) return;
    const target = rows.filter((_, i) => selected[i]);
    setBusy(true);
    try {
      const r = await fetch("/api/past", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rows: target, today: localToday() }),
      });
      const d = await r.json();
      setMsg(
        d.error
          ? d.error
          : `${d.imported}件を登録しました${
              d.strengthCount ? `（うち補強${d.strengthCount}件）` : ""
            }${d.skipped ? `（未確定の${d.skipped}件は登録していません）` : ""}。`
      );
      if (!d.error) {
        onImported(d);
        setRows(null);
        setText("");
      }
    } finally {
      setBusy(false);
    }
  };

  const readyCount = rows?.filter((r) => r.ready).length ?? 0;
  const selectedCount = rows ? Object.values(selected).filter(Boolean).length : 0;

  return (
    <Card title="まとめて入力">
      <p className="text-[12px] leading-relaxed mb-2.5" style={{ color: "var(--text-2)" }}>
        練習日誌をそのまま貼り付けてください。行頭が日付なら、あとは自由な書き方で構いません。
        実施タイムが次の行にあっても、括弧に設定と区間ラップが混ざっていても読みます。
        <b style={{ color: "var(--text)" }}>貼っただけでは保存されません。</b>
        解釈結果を確認して、登録する行を選んでから確定します。
      </p>
      <details className="text-[11px] mb-2.5">
        <summary style={{ color: "var(--text-3)" }}>読み取れる書き方の例</summary>
        <pre
          className="mt-1.5 p-2 rounded-lg overflow-x-auto"
          style={{ background: "var(--surface-2)", color: "var(--text-2)", fontSize: 11 }}
        >
{`7/4 2kmジョグ 8:40
7/5 オフ
7/6 300(42)＋600(1:26)＋600(1:26) r15min
42 1:26 1:25          ← 実施タイムは次の行でもよい
7/10 300(41-42)×2×2 r100walk R12min
41.6 41.8 40.0 41.8
7/13 レース 800m 1:56.0(56.0-60.0)   ← 括弧は前後半ラップ
7/16 65minジョグ 11.8km 平均心拍154
7/18 1000(3:15-25)×4 r200jog 3:27 3:26 3:27 3:27 平均心拍180 最大195`}
        </pre>
        <p className="mt-1.5 leading-relaxed" style={{ color: "var(--text-3)" }}>
          括弧の設定タイムがあると、それが現在のGRPの何%かでカテゴリ（高乳酸／経済走／CV等）を
          自動で判定します。設定が書かれていない場合だけ、こちらで選んでもらいます。
        </p>
      </details>

      {/*
        写真からの文字起こし。入る先はこの下の欄で、解釈はこれまでどおり
        「解釈する」を押したあと。既に書いてある内容は消さずに足す
        （手で打った途中の行を写真1枚で消されると、打ち直しになる）。
      */}
      <PhotoTranscribe
        onText={(t) => setText((prev) => (prev.trim() ? `${prev.replace(/\s+$/, "")}\n${t}` : t))}
      />

      <textarea
        className="w-full"
        rows={7}
        style={{ fontFamily: "ui-monospace, monospace", fontSize: 12 }}
        placeholder={SAMPLE_TEXT}
        value={text}
        onChange={(e) => setText(e.target.value)}
        data-testid="bulk-text"
      />

      <div className="flex gap-2 mt-2.5 flex-wrap">
        <button className="btn-volt justify-center" onClick={preview} disabled={busy || !text.trim()}>
          {busy ? "解釈中…" : "解釈する"}
          <span aria-hidden>→</span>
        </button>
        {rows ? (
          <button
            className="btn-ghost"
            onClick={() => {
              setRows(null);
              setMsg("");
            }}
          >
            やり直す
          </button>
        ) : null}
      </div>

      {rows ? (
        <div className="mt-3.5">
          <p className="text-[11.5px] mb-2" style={{ color: "var(--text-3)" }}>
            {rows.length}行を解釈しました（登録できる行: {readyCount}）。
            読み取れなかった項目は空欄のままにしてあります。こちらで推測して埋めることはしません。
          </p>

          <div className="flex flex-col gap-2">
            {rows.map((r, i) => (
              <div
                key={i}
                className="rounded-lg border p-2.5"
                style={{
                  borderColor: r.ready ? "var(--border)" : "rgba(255,193,7,0.4)",
                  background: "var(--surface-2)",
                }}
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <input
                    type="checkbox"
                    checked={!!selected[i]}
                    disabled={!r.ready}
                    onChange={(e) => setSelected({ ...selected, [i]: e.target.checked })}
                    style={{ width: 18, height: 18, padding: 0 }}
                  />
                  <b className="text-[12px] num">{r.date ?? "日付不明"}</b>
                  <select
                    className="!text-[11px] !py-1"
                    value={r.kind ?? ""}
                    onChange={(e) => patch(i, { kind: e.target.value })}
                  >
                    <option value="">種類を選ぶ</option>
                    {KIND_OPTIONS.map((k) => (
                      <option key={k.value} value={k.value}>
                        {k.label}
                      </option>
                    ))}
                  </select>
                  {r.kind === "interval" ? (
                    <select
                      className="!text-[11px] !py-1"
                      value={r.category ?? ""}
                      onChange={(e) => patch(i, { category: e.target.value })}
                      style={{
                        borderColor: r.categoryUncertain ? "var(--amber)" : undefined,
                      }}
                    >
                      <option value="">カテゴリ</option>
                      {POINT_CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {CATEGORY_LABELS[c]}
                        </option>
                      ))}
                    </select>
                  ) : null}
                </div>

                <div className="text-[11px] mb-1.5 truncate" style={{ color: "var(--text-3)" }}>
                  {r.raw}
                </div>

                <div className="grid grid-cols-3 gap-1.5">
                  {r.kind === "off" ? (
                    <div className="col-span-3 text-[11.5px]" style={{ color: "var(--text-3)" }}>
                      休養日として記録します（能力推定には使いません）
                    </div>
                  ) : r.kind === "strength" ? (
                    <>
                      <label className="text-[10px]" style={{ color: "var(--text-3)" }}>
                        <span className="block mb-0.5">種別</span>
                        <select
                          className="w-full !text-[12px] !py-1"
                          value={r.strengthType ?? "strength"}
                          onChange={(e) => patch(i, { strengthType: e.target.value })}
                        >
                          {STRENGTH_OPTIONS.map((s) => (
                            <option key={s.value} value={s.value}>
                              {s.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <Cell
                        label="接地回数"
                        value={r.contactCount}
                        onChange={(v) => patch(i, { contactCount: v })}
                      />
                      <Cell
                        label="時間分"
                        value={
                          r.durationSec !== undefined
                            ? Math.round((r.durationSec / 60) * 10) / 10
                            : undefined
                        }
                        onChange={(v) => patch(i, { durationSec: v !== undefined ? v * 60 : undefined })}
                      />
                      <div className="col-span-3 text-[10.5px]" style={{ color: "var(--text-3)" }}>
                        補強として記録します（走練習の負荷とは別枠。800m能力の推定には使いません）
                      </div>
                    </>
                  ) : r.kind === "continuous" ? (
                    <>
                      <Cell label="距離km" value={r.distanceKm} onChange={(v) => patch(i, { distanceKm: v })} />
                      <Cell
                        label="時間分"
                        value={r.durationSec !== undefined ? Math.round((r.durationSec / 60) * 10) / 10 : undefined}
                        onChange={(v) => patch(i, { durationSec: v !== undefined ? v * 60 : undefined })}
                      />
                      <Cell label="平均HR" value={r.avgHr} onChange={(v) => patch(i, { avgHr: v })} />
                    </>
                  ) : r.kind === "interval" ? (
                    <>
                      <Cell label="1本の距離m" value={r.repDistanceM} onChange={(v) => patch(i, { repDistanceM: v })} />
                      <Cell label="本数" value={r.reps} onChange={(v) => patch(i, { reps: v })} />
                      <Cell label="平均HR" value={r.avgHr} onChange={(v) => patch(i, { avgHr: v })} />
                    </>
                  ) : (
                    <>
                      <Cell label="距離m" value={r.raceDistanceM} onChange={(v) => patch(i, { raceDistanceM: v })} />
                      <Cell
                        label="記録秒"
                        value={r.raceTimeSec}
                        onChange={(v) => patch(i, { raceTimeSec: v })}
                      />
                      <Cell label="平均HR" value={r.avgHr} onChange={(v) => patch(i, { avgHr: v })} />
                    </>
                  )}
                </div>

                {r.kind === "interval" && r.repTimesSec?.length ? (
                  <p className="text-[10.5px] mt-1.5 num" style={{ color: "var(--text-3)" }}>
                    実施タイム {r.repTimesSec.join(" / ")}
                    {r.targetSec !== undefined ? `（設定 ${r.targetSec}秒）` : ""}
                    {r.restNote ? ` ${r.restNote}` : ""}
                  </p>
                ) : null}
                {r.kind === "race" && r.lapsSec?.length ? (
                  <p className="text-[10.5px] mt-1.5 num" style={{ color: "var(--text-3)" }}>
                    区間ラップ {r.lapsSec.join(" / ")}（レース配分の材料になります）
                  </p>
                ) : null}
                {r.supplementNote ? (
                  <p className="text-[10.5px] mt-1.5" style={{ color: "var(--text-3)" }}>
                    {r.supplementNote} は主セッションから切り離しています（能力推定には使いません）
                  </p>
                ) : null}

                {(r.issues ?? []).map((m: string, k: number) => (
                  <p
                    key={k}
                    className="text-[10.5px] mt-1"
                    style={{ color: m.startsWith("要確認") ? "var(--red)" : "var(--amber)" }}
                  >
                    {m}
                  </p>
                ))}

                {r.needsTeaching ? (
                  <SuggestPhrase
                    row={r}
                    knownPhrases={knownPhrases}
                    onAccept={(s) =>
                      patch(i, {
                        kind: s.kind,
                        category: s.category ?? r.category,
                        strengthType: s.strengthType ?? r.strengthType,
                        phraseDraft: s.phrase,
                      })
                    }
                  />
                ) : null}
                {r.needsTeaching && r.kind ? (
                  /*
                   * 候補で phraseDraft が変わったら入れ直したいので key に混ぜる。
                   * TeachPhrase は初期値を useState で1度だけ読むため、
                   * key を変えないと埋めた語が欄に出ない。
                   */
                  <TeachPhrase
                    key={r.phraseDraft ?? ""}
                    row={r}
                    onDone={(phrase) => {
                      patch(i, { needsTeaching: false, taught: phrase });
                      loadPhrases();
                      onTaught();
                    }}
                  />
                ) : null}
                {r.taught ? (
                  <p className="text-[10.5px] mt-1" style={{ color: "var(--forge)" }}>
                    「{r.taught}」を辞書に登録しました。次からは自動で判定します
                  </p>
                ) : null}
              </div>
            ))}
          </div>

          <div className="mt-3">
            <ConfirmButton
              label={`選択した${selectedCount}件を登録する`}
              title="過去データとして登録しますか？"
              message="登録後、現在地の推定が再計算されます。CFEへの反映は別途「この推定をCFEに反映する」を押したときだけ行われます。"
              className="btn-volt w-full justify-center"
              disabled={selectedCount === 0 || busy}
              onConfirm={commit}
            />
          </div>
        </div>
      ) : null}

      {msg ? (
        <p className="text-[12px] mt-2" style={{ color: "var(--forge)" }}>
          {msg}
        </p>
      ) : null}
    </Card>
  );
}

/**
 * 読めなかった行について、辞書に入れる語の案を出す。
 *
 * **出すだけ。登録するのは本人。** 押すと下の「この書き方を覚えさせる」に
 * 語・種類・カテゴリが入るだけで、そこから先はこれまでと同じ手順を通る。
 * 登録されたあとは辞書で決定的に読まれるので、この機能は
 * 「まだ知らない書き方に初めて出会ったとき」しか動かない（使うほど呼ばれなくなる）。
 *
 * 検査は `phraseSuggestion.ts` にある。行に書かれていない語は通さない。
 */
function SuggestPhrase({
  row,
  knownPhrases,
  onAccept,
}: {
  /** 使うのは本文だけ。行の他の項目には触らない */
  row: { raw?: string };
  knownPhrases: string[];
  onAccept: (s: PhraseSuggestion) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [s, setS] = useState<PhraseSuggestion | undefined>();
  const [ready, setReady] = useState(false);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    setOnline(navigator.onLine);
    try {
      setReady(!!getApiKey() && getConsent());
    } catch {
      setReady(false);
    }
  }, []);

  const run = useCallback(async () => {
    let apiKey: string | undefined;
    try {
      apiKey = getApiKey();
    } catch {
      apiKey = undefined;
    }
    if (!apiKey) return;
    setBusy(true);
    setErr("");
    setS(undefined);
    const r = await askAssistant({
      apiKey,
      system: PHRASE_SUGGESTION_SYSTEM_PROMPT,
      user: buildPhraseSuggestionRequest(String(row.raw ?? ""), knownPhrases),
    });
    setBusy(false);
    if (!r.ok) {
      setErr(r.message);
      return;
    }
    const parsed = parsePhraseSuggestion(r.text, String(row.raw ?? ""), knownPhrases);
    if (parsed.error || !parsed.suggestion) {
      setErr(parsed.error ?? "候補になりませんでした。");
      return;
    }
    setS(parsed.suggestion);
  }, [row.raw, knownPhrases]);

  // 設定していない・オフラインなら、そもそも出さない（押せないボタンを残さない）
  if (!ready || !online) return null;

  return (
    <div className="mt-1.5">
      {!s ? (
        <button
          className="btn-ghost !text-[10.5px] !py-1"
          disabled={busy}
          onClick={run}
          data-testid="suggest-phrase"
        >
          {busy ? "候補を考えています…" : "読み方の候補を出す"}
        </button>
      ) : (
        <div
          className="rounded-lg p-2 text-[10.5px] leading-relaxed"
          style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
          data-testid="suggest-result"
        >
          <div className="mb-1">
            <b>{s.phrase}</b> →{" "}
            {KIND_OPTIONS.find((k) => k.value === s.kind)?.label ?? s.kind}
            {s.category ? `／${CATEGORY_LABELS[s.category] ?? s.category}` : ""}
          </div>
          <p style={{ color: "var(--text-3)" }}>{s.reason}</p>
          <div className="flex gap-1.5 mt-1.5 flex-wrap">
            <button
              className="btn-volt !text-[10.5px] !py-1"
              onClick={() => onAccept(s)}
              data-testid="suggest-accept"
            >
              これで埋める
            </button>
            <button className="btn-ghost !text-[10.5px] !py-1" onClick={() => setS(undefined)}>
              使わない
            </button>
          </div>
          <p className="mt-1.5" style={{ color: "var(--text-3)" }}>
            埋めるだけです。登録は下の「この書き方を覚えさせる」で行います。
          </p>
        </div>
      )}
      {err ? (
        <StatusText kind="warning" className="text-[10.5px] mt-1 leading-relaxed">
          <span data-testid="suggest-error">{err}</span>
        </StatusText>
      ) : null}
    </div>
  );
}

/**
 * 読めなかった行を人が直したあとに、その書き方を辞書へ入れる。
 *
 * 組み込みの語彙をこちらで足し続けても、所属チーム固有の呼び方には追いつかない。
 * 一度直したものが次から通るようにしておけば、
 * 手直しの回数は使うほど減っていく。
 */
function TeachPhrase({ row, onDone }: { row: any; onDone: (phrase: string) => void }) {
  const [open, setOpen] = useState(false);
  const [phrase, setPhrase] = useState<string>(row.phraseDraft ?? "");
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  if (!open) {
    return (
      <button
        className="btn-ghost !text-[10.5px] !py-1 mt-1.5"
        onClick={() => setOpen(true)}
      >
        この書き方を覚えさせる
      </button>
    );
  }

  const save = async () => {
    const w = phrase.trim();
    if (!w) return;
    setBusy(true);
    setErrorMessage("");
    try {
      await apiRequest("/api/phrases", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          phrase: {
            phrase: w,
            kind: row.kind,
            category: row.kind === "interval" || row.kind === "continuous" ? row.category : undefined,
            strengthType: row.kind === "strength" ? row.strengthType : undefined,
          },
        }),
      });
      onDone(w);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "表記を保存できませんでした");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
      <input
        className="!text-[11px] !py-1"
        style={{ width: 130 }}
        value={phrase}
        onChange={(e) => setPhrase(e.target.value)}
        placeholder="覚えさせる語"
      />
      <span className="text-[10.5px]" style={{ color: "var(--text-3)" }}>
        →{" "}
        {KIND_OPTIONS.find((k) => k.value === row.kind)?.label}
        {row.category ? `／${CATEGORY_LABELS[row.category] ?? row.category}` : ""}
      </span>
      <button className="btn-volt !text-[10.5px] !py-1" disabled={busy || !phrase.trim()} onClick={save}>
        登録
      </button>
      <button className="btn-ghost !text-[10.5px] !py-1" onClick={() => setOpen(false)}>
        やめる
      </button>
      {errorMessage ? <StatusText kind="error">{errorMessage}</StatusText> : null}
    </div>
  );
}

/** 登録済みの表記を確認・削除する */
function PhraseCard({ version }: { version: number }) {
  const [phrases, setPhrases] = useState<any[]>([]);
  const load = useCallback(() => {
    fetch("/api/phrases")
      .then((r) => r.json())
      .then((d) => setPhrases(d.phrases ?? []));
  }, []);
  useEffect(load, [load, version]);

  if (phrases.length === 0) return null;

  return (
    <Card title="覚えた書き方">
      <p className="text-[11.5px] mb-2" style={{ color: "var(--text-2)" }}>
        まとめて入力で登録した語です。組み込みの判定より優先されます。
      </p>
      <div className="flex flex-col gap-1">
        {phrases.map((p) => (
          <div
            key={p.id}
            className="flex items-center justify-between text-[12px] py-1.5 border-b"
            style={{ borderColor: "var(--border)" }}
          >
            <span>
              <b>{p.phrase}</b>{" "}
              <span style={{ color: "var(--text-3)" }}>
                → {KIND_OPTIONS.find((k) => k.value === p.kind)?.label ?? p.kind}
                {p.category ? `／${CATEGORY_LABELS[p.category] ?? p.category}` : ""}
              </span>
            </span>
            <button
              className="btn-ghost !text-[10.5px] !py-1"
              onClick={async () => {
                await fetch(`/api/phrases?id=${encodeURIComponent(p.id)}`, { method: "DELETE" });
                load();
              }}
            >
              削除
            </button>
          </div>
        ))}
      </div>
    </Card>
  );
}

function Cell({
  label,
  value,
  onChange,
}: {
  label: string;
  value?: number;
  onChange: (v: number | undefined) => void;
}) {
  return (
    <label className="text-[10px]" style={{ color: "var(--text-3)" }}>
      <span className="block mb-0.5">{label}</span>
      <input
        className="w-full !text-[12px] !py-1"
        inputMode="decimal"
        value={value ?? ""}
        onChange={(e) => {
          const v = e.target.value.trim();
          onChange(v === "" ? undefined : Number(v));
        }}
        style={{ borderColor: value === undefined ? "var(--border-2)" : undefined }}
      />
    </label>
  );
}
