"use client";
import { useCallback, useEffect, useState } from "react";
import { Card, ConfirmButton } from "../components/ui";
import { useQueryParam, withQuery } from "../components/route-query";
import { ForgeTrack } from "../components/brand/forge-track";
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
  // RPEはこちらで埋めない（本人にしか分からず、CFEの補正に効く）。結果入力の欄と同じ扱い
  const [rpe, setRpe] = useState("");
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
    // 空のまま終えると Number("") が0になり、RPE0としてCFEの補正に入ってしまう
    const rpeValue = Number(rpe);
    if (!rpe.trim() || !isFinite(rpeValue) || rpeValue < 1 || rpeValue > 10) {
      alert("RPE（1〜10）を入れてください。きつさの感じ方は本人にしか分からないので、こちらでは埋めません。");
      return;
    }
    setBusy(true);
    try {
      const r = await fetch("/api/session-run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "finish",
          sessionId,
          rpe: rpeValue,
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
    <div className="run-screen flex flex-col gap-3">
      {/*
        リファレンス（reference-ui/crops/session-run.jpeg）の構成。
        走りながら見る画面なので、直近の1本を最大の数字で置き、設定を直下に添える。
        リファレンスにある NEXT REST は出していない——レスト時間は
        SessionProgress に持っていない。持っていない値を画面に作らない。
        タイマーも作っていない（自分の時計で測って入れる、という既存の使い方のまま）。
      */}
      <Card variant="hero" className="run-session-head">
        <div className="text-center">
          <p className="text-[12px] num" style={{ color: "var(--text-2)" }}>
            {progress.distanceM}m × {progress.plannedReps}
          </p>

          <p
            className="forge-label inline-block mt-3 pb-1.5"
            style={{ borderBottom: "2px solid var(--forge)" }}
          >
            SET {Math.min(reps.length + 1, progress.plannedReps)} / {progress.plannedReps}
          </p>

          <p
            className="num font-extrabold leading-none mt-4"
            style={{ fontSize: 54, letterSpacing: "-.03em", color }}
          >
            {/*
              未入力のときにダッシュ1本を巨大に出すと、白い棒が浮いて見えて
              「壊れている」ように読める。桁の形を保った空欄にする。
            */}
            {evaluation.lastSec !== undefined ? (
              fmt(evaluation.lastSec)
            ) : (
              <span style={{ color: "var(--text-3)" }}>--.-</span>
            )}
          </p>

          <p className="forge-label mt-3.5">TARGET</p>
          <p
            className="num font-bold leading-none mt-1"
            style={{ fontSize: 18, color: "var(--forge)" }}
          >
            {fmt(progress.targetSec)}
          </p>
        </div>

        <div className="today-track-band mt-4">
          <ForgeTrack />
        </div>

        <p className="text-[13px] mt-1 num text-center" style={{ color: "var(--text-2)" }}>
          {evaluation.lastDeviationSec !== undefined
            ? `設定との差 ${evaluation.lastDeviationSec >= 0 ? "+" : ""}${evaluation.lastDeviationSec.toFixed(1)}秒`
            : "まだ入力がありません"}
          {evaluation.fadeSec !== undefined && reps.length >= 2
            ? ` ／ 垂れ幅 ${evaluation.fadeSec >= 0 ? "+" : ""}${evaluation.fadeSec.toFixed(1)}秒`
            : ""}
        </p>

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

        <details className="mt-2.5">
          <summary className="text-[11px] cursor-pointer" style={{ color: "var(--text-3)" }}>
            中止の基準
          </summary>
          <p className="text-[11.5px] leading-relaxed mt-1.5" style={{ color: "var(--text-2)" }}>
            {criteria.text}
          </p>
        </details>
      </Card>

      <Card title={`${reps.length} / ${progress.plannedReps} 本`}>
        <div
          className="run-progress"
          role="progressbar"
          aria-label="完了した本数"
          aria-valuemin={0}
          aria-valuemax={progress.plannedReps}
          aria-valuenow={reps.length}
        >
          <i
            style={{
              width: `${Math.min(100, (reps.length / Math.max(1, progress.plannedReps)) * 100)}%`,
            }}
          />
        </div>
        <div className="flex gap-2 items-stretch">
          <input
            className="run-rep-input flex-1 min-w-0"
            inputMode="decimal"
            placeholder="41.6"
            aria-label="この本の実測タイム"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") push();
            }}
          />
          {/*
            リファレンスの LAP にあたる主操作。タイマーが無いので
            「打ち込んで入れる」だが、押す場所と見た目は LAP と同じ扱いにする。
          */}
          <button
            className="btn-ghost run-add-button flex-shrink-0 whitespace-nowrap"
            style={{ borderColor: "var(--volt-line)", color: "var(--forge)", letterSpacing: ".1em" }}
            onClick={push}
            disabled={busy || !input.trim()}
          >
            LAP
          </button>
          {reps.length > 0 ? (
            <button className="btn-ghost run-undo-button flex-shrink-0 whitespace-nowrap" onClick={undo}>
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
