"use client";
import { useCallback, useEffect, useState } from "react";
import { Card, ConfirmButton } from "../components/ui";
import { useQueryParam, withQuery } from "../components/route-query";
import { localToday } from "@/lib/core/dates";

/**
 * M-4 セッション中の入力
 *
 * 走っている最中に見る画面なので、出すのは3つだけにする。
 *   ・直近の1本
 *   ・設定との差
 *   ・続行か中止か
 * 情報を足したくなるが、レストの間に読める量には限りがある。
 */
function fmt(sec: number): string {
  if (!isFinite(sec)) return "-";
  if (sec < 60) return sec.toFixed(1);
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}

/** 「41.6」「1:26.5」「12650」いずれも受ける */
function parseRep(v: string): number | undefined {
  const t = v.trim();
  if (!t) return undefined;
  if (t.includes(":")) {
    const [m, s] = t.split(":");
    const n = Number(m) * 60 + Number(s);
    return isFinite(n) ? n : undefined;
  }
  const n = Number(t);
  return isFinite(n) && n > 0 ? n : undefined;
}

export default function RunPage() {
  const sessionId = useQueryParam("sessionId");
  const [view, setView] = useState<any | null>(null);
  const [session, setSession] = useState<any | null>(null);
  const [input, setInput] = useState("");
  const [rpe, setRpe] = useState("8");
  const [subjective, setSubjective] = useState("hard");
  const [out, setOut] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (!sessionId) return;
    fetch(`/api/session-run?sessionId=${encodeURIComponent(sessionId)}`)
      .then((r) => r.json())
      .then((d) => setView(d.error ? null : d));
    fetch("/api/sessions")
      .then((r) => r.json())
      .then((d) => setSession((d.sessions ?? []).find((s: any) => s.id === sessionId) ?? null));
  }, [sessionId]);
  useEffect(load, [load]);

  if (!sessionId) {
    return (
      <Card title="セッション中の入力">
        <p className="text-[12px]" style={{ color: "var(--text-2)" }}>
          ホームかカレンダーから、走るセッションを選んでください。
        </p>
      </Card>
    );
  }
  if (!view) {
    return (
      <Card title="セッション中の入力">
        <p className="text-[12px]" style={{ color: "var(--text-2)" }}>
          読み込み中、またはこのセッションには設定タイムがありません。
        </p>
      </Card>
    );
  }

  const { progress, criteria, evaluation } = view;
  const reps: number[] = progress.reps ?? [];

  const push = async () => {
    const v = parseRep(input);
    if (v === undefined) return;
    setBusy(true);
    try {
      const r = await fetch("/api/session-run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, reps: [...reps, v], today: localToday() }),
      });
      const d = await r.json();
      if (!d.error) setView(d);
      setInput("");
    } finally {
      setBusy(false);
    }
  };

  const undo = async () => {
    const r = await fetch("/api/session-run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId, reps: reps.slice(0, -1), today: localToday() }),
    });
    const d = await r.json();
    if (!d.error) setView(d);
  };

  const finish = async (aborted: boolean) => {
    setBusy(true);
    try {
      const r = await fetch("/api/session-run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "finish",
          sessionId,
          rpe: Number(rpe),
          subjective,
          aborted,
          today: localToday(),
        }),
      });
      setOut(await r.json());
      load();
    } finally {
      setBusy(false);
    }
  };

  const stop = evaluation.verdict === "stop";
  const done = evaluation.verdict === "done";
  const color = stop ? "var(--red)" : done ? "var(--forge)" : "var(--text)";

  return (
    <div className="flex flex-col gap-3">
      <Card title={session?.name ?? "セッション"}>
        <div className="text-[11.5px] num mb-2" style={{ color: "var(--text-2)" }}>
          {progress.distanceM}m × {progress.plannedReps} ／ 設定 {fmt(progress.targetSec)}
        </div>
        <div
          className="text-[11.5px] rounded-lg p-2.5"
          style={{ background: "var(--surface-2)", color: "var(--text-2)" }}
        >
          {criteria.text}
        </div>
      </Card>

      {/* 出すのは3つだけ */}
      <Card>
        <div className="metric-label">直近の1本</div>
        <div className="metric" style={{ color }}>
          {evaluation.lastSec !== undefined ? fmt(evaluation.lastSec) : "—"}
        </div>
        <div className="text-[13px] mt-1 num" style={{ color: "var(--text-2)" }}>
          {evaluation.lastDeviationSec !== undefined
            ? `設定との差 ${evaluation.lastDeviationSec >= 0 ? "+" : ""}${evaluation.lastDeviationSec.toFixed(1)}秒`
            : "まだ入力がありません"}
          {evaluation.fadeSec !== undefined && reps.length >= 2
            ? ` ／ 垂れ幅 ${evaluation.fadeSec >= 0 ? "+" : ""}${evaluation.fadeSec.toFixed(1)}秒`
            : ""}
        </div>
        <div
          className="mt-2.5 rounded-lg p-2.5 text-[12.5px] leading-relaxed"
          style={{
            background: stop ? "rgba(255,77,77,0.12)" : "var(--surface-2)",
            color: stop ? "var(--red)" : "var(--text-2)",
            border: stop ? "1px solid rgba(255,77,77,0.4)" : "none",
          }}
        >
          {evaluation.message}
        </div>
      </Card>

      <Card title={`${reps.length} / ${progress.plannedReps} 本`}>
        <div className="flex gap-2 items-stretch">
          <input
            className="flex-1 min-w-0"
            inputMode="decimal"
            placeholder="41.6"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") push();
            }}
          />
          <button
            className="btn-volt flex-shrink-0 whitespace-nowrap"
            onClick={push}
            disabled={busy || !input.trim()}
          >
            入れる
          </button>
          {reps.length > 0 ? (
            <button className="btn-ghost flex-shrink-0 whitespace-nowrap" onClick={undo}>
              1本戻す
            </button>
          ) : null}
        </div>
        {reps.length > 0 ? (
          <p className="text-[11.5px] mt-2 num" style={{ color: "var(--text-3)" }}>
            {reps.map((t) => fmt(t)).join(" / ")}
          </p>
        ) : null}
        <p className="text-[10.5px] mt-2" style={{ color: "var(--text-3)" }}>
          入力は端末に残ります。画面を閉じても消えません。
        </p>
      </Card>

      {reps.length > 0 && !out ? (
        <Card title="終える">
          <div className="grid grid-cols-2 gap-2 mb-2.5">
            <label className="text-[11px]" style={{ color: "var(--text-3)" }}>
              <span className="block mb-1">RPE（1〜10）</span>
              <input value={rpe} onChange={(e) => setRpe(e.target.value)} inputMode="decimal" />
            </label>
            <label className="text-[11px]" style={{ color: "var(--text-3)" }}>
              <span className="block mb-1">主観</span>
              <select value={subjective} onChange={(e) => setSubjective(e.target.value)}>
                <option value="easy">楽</option>
                <option value="moderate">ふつう</option>
                <option value="hard">きつい</option>
                <option value="very_hard">かなりきつい</option>
              </select>
            </label>
          </div>
          <ConfirmButton
            label={stop ? "ここで打ち切って記録する" : "終えて記録する"}
            title="この内容で記録しますか？"
            message={
              stop
                ? "打ち切りとして記録します。失敗ではありません。中止基準にしたがって止めた本数はCFEの未達には数えません。"
                : "そのまま練習結果になります。あとから記録画面で直せます。"
            }
            className="btn-volt w-full justify-center min-h-[48px]"
            disabled={busy}
            onConfirm={() => finish(stop)}
          />
        </Card>
      ) : null}

      {out ? (
        <Card title="記録しました">
          {(out.guardrailNotes ?? []).map((n: string, i: number) => (
            <p key={i} className="text-[11.5px] leading-relaxed mb-1" style={{ color: "var(--text-2)" }}>
              {n}
            </p>
          ))}
          <a className="btn-ghost inline-flex mt-2" href={withQuery("/results", { date: session?.date })}>
            記録画面で内容を直す
          </a>
        </Card>
      ) : null}
    </div>
  );
}
