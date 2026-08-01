"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Card } from "../components/ui";
import { useQueryParam, withQuery } from "../components/route-query";
import {
  buildSessionSummary,
  fmtClock,
  fmtLap,
  type SessionSummaryView,
} from "@/lib/core/sessionSummary";
import type { Session, SessionResult } from "@/lib/core/types";

/**
 * 記録サマリー（reference-ui/crops/session-summary.jpeg）。
 *
 * 1回の練習を振り返るだけの読み取り専用画面。入力は記録画面の担当で、
 * ここでは何も書き換えない——「見に来た」ときに誤って値を変えないため。
 * 集計は `src/lib/core/sessionSummary.ts` にあり、ここは表示だけ。
 */
export default function SummaryPage() {
  const sessionId = useQueryParam("sessionId");
  const [view, setView] = useState<SessionSummaryView | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing">("loading");

  const load = useCallback(() => {
    if (!sessionId) {
      setState("missing");
      return;
    }
    Promise.all([
      fetch("/api/sessions").then((r) => r.json()),
      fetch("/api/results").then((r) => r.json()),
    ])
      .then(([sRes, rRes]) => {
        const s: Session | undefined = (sRes.sessions ?? []).find(
          (x: Session) => x.id === sessionId
        );
        const result: SessionResult | undefined = (rRes.results ?? []).find(
          (x: SessionResult) => x.sessionId === sessionId
        );
        if (!s || !result) {
          setState("missing");
          return;
        }
        setSession(s);
        setView(buildSessionSummary(s, result));
        setState("ready");
      })
      .catch(() => setState("missing"));
  }, [sessionId]);
  useEffect(load, [load]);

  if (state === "loading") return <p className="text-[13px]">読み込み中…</p>;
  if (state === "missing" || !view) {
    return (
      <Card>
        <p className="text-[13px] mb-3">この練習の記録が見つかりませんでした。</p>
        <Link href="/calendar" className="btn-ghost inline-block">
          カレンダーへ
        </Link>
      </Card>
    );
  }

  return (
    <div className="summary-screen flex flex-col gap-3">
      <Card>
        <div className="flex items-center justify-between gap-2 mb-3">
          <span className="text-[11px] num" style={{ color: "var(--text-3)" }}>
            {view.date}
          </span>
          {view.rpe !== undefined ? (
            <span className="text-[11px] num" style={{ color: "var(--text-3)" }}>
              RPE {view.rpe}
            </span>
          ) : null}
        </div>

        <h1
          className="font-extrabold leading-none"
          style={{ fontSize: "var(--num-xl)", letterSpacing: "-.02em" }}
        >
          {view.headline}
        </h1>
        <p className="text-[12.5px] leading-relaxed mt-2" style={{ color: "var(--text-2)" }}>
          {view.prescription}
        </p>

        {/* TOTAL TIME / AVG / BEST。値が無いものは枠ごと出さない（0で埋めない） */}
        <div className="grid grid-cols-3 gap-2 mt-4">
          {[
            { label: "TOTAL TIME", value: view.totalSec !== undefined ? fmtClock(view.totalSec) : undefined },
            { label: view.avgLabel, value: view.avgSec !== undefined ? fmtLap(view.avgSec) : undefined },
            { label: "BEST", value: view.bestSec !== undefined ? fmtLap(view.bestSec) : undefined },
          ].map((it) => (
            <div
              key={it.label}
              className="rounded-lg px-2.5 py-2.5"
              style={{ border: "1px solid var(--border)", background: "var(--surface-2)" }}
            >
              <p className="text-[9px] font-bold" style={{ color: "var(--text-3)", letterSpacing: ".1em" }}>
                {it.label}
              </p>
              <p className="num font-bold leading-none mt-1.5" style={{ fontSize: 19 }}>
                {it.value ?? "-"}
              </p>
            </div>
          ))}
        </div>
      </Card>

      {view.reps.length > 0 ? (
        <Card>
          {view.reps.map((rep) => (
            <div key={rep.index} className="py-2">
            <div className="flex items-center gap-3">
              <span
                className="num text-[12.5px] w-[14px] flex-shrink-0"
                style={{ color: "var(--text-3)" }}
              >
                {rep.index}
              </span>
              <span className="num text-[15px] font-bold w-[62px] flex-shrink-0">
                {fmtLap(rep.sec)}
              </span>
              {/* 本ごとの差を長さで見せる。数字だけだと差が読み取りにくい */}
              <span className="flex-1 min-w-0 h-[3px] rounded-full" style={{ background: "var(--surface-3)" }}>
                <i
                  className="block h-full rounded-full"
                  style={{
                    width: `${rep.ratio * 100}%`,
                    background: rep.isBest ? "var(--forge)" : "rgba(182,255,0,.45)",
                  }}
                />
              </span>
              {rep.isBest ? (
                <span
                  className="text-[9px] font-bold flex-shrink-0"
                  style={{ color: "var(--forge)", letterSpacing: ".1em" }}
                >
                  BEST
                </span>
              ) : null}
            </div>
            {/* 1本の中を刻んで走った場合の通過。合計だけだと前後半どちらで落ちたか分からない */}
            {rep.splitsSec ? (
              <div
                className="num text-[11px] mt-1 ml-[26px]"
                style={{ color: "var(--text-3)" }}
              >
                {rep.splitsSec.map((s) => fmtLap(s)).join(" - ")}
              </div>
            ) : null}
            </div>
          ))}
        </Card>
      ) : null}

      <Card>
        <p className="forge-label mb-2">NOTES</p>
        {view.note ? (
          <p className="text-[12.5px] leading-relaxed">{view.note}</p>
        ) : (
          <p className="text-[12px]" style={{ color: "var(--text-3)" }}>
            メモはありません。
          </p>
        )}
        {session ? (
          <Link
            href={withQuery("/results", { date: view.date, sessionId: session.id })}
            className="btn-ghost inline-flex mt-3"
          >
            この記録を直す
          </Link>
        ) : null}
      </Card>
    </div>
  );
}
