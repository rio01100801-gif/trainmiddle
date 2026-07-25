"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, Gauge, fmtSec } from "../components/ui";
import { useQueryParam, withQuery } from "../components/route";
import { localToday } from "@/lib/core/dates";

/**
 * セッション詳細（メニューの根拠）
 *
 * A-3: ホームの「セッション準備度」リングはここへ移す。
 * ホームでは数値だけで足りる。内訳のような「読み込む情報」は詳細側に置く。
 */
export default function SessionPage() {
  const id = useQueryParam("id");
  const [session, setSession] = useState<any>(null);
  const [readiness, setReadiness] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/sessions").then((r) => r.json()),
      fetch("/api/dashboard").then((r) => r.json()),
    ])
      .then(([s, d]) => {
        const list = (s.sessions ?? []) as any[];
        const found = id ? list.find((x) => x.id === id) : d.todaySession;
        setSession(found ?? null);
        // 準備度は「今日のセッション」に対してのみ算出される値なので、
        // 今日以外を開いたときは出さない（他日の数値を流用すると嘘になる）
        if (found && d.todaySession && found.id === d.todaySession.id) setReadiness(d.readiness);
      })
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <p className="text-[13px]">読み込み中…</p>;
  if (!session) {
    return (
      <Card>
        <p className="text-[13px] mb-2">セッションが見つかりませんでした。</p>
        <Link href="/calendar" className="btn-ghost inline-block">
          カレンダーへ
        </Link>
      </Card>
    );
  }

  const r = session.rationale;

  return (
    <div className="flex flex-col gap-3">
      <Card>
        <div className="metric-label mb-2">{session.date}</div>
        <h2 className="text-[19px] font-extrabold leading-tight mb-1.5">{session.name}</h2>
        <p className="text-[13px] leading-relaxed" style={{ color: "var(--text-2)" }}>
          {session.prescription}
        </p>

        {session.targetPaces?.length > 0 ? (
          <div className="mt-3 pt-3 border-t" style={{ borderColor: "var(--border)" }}>
            <div className="metric-label mb-1.5">設定タイム</div>
            {session.targetPaces.map((p: any, i: number) => (
              <div key={i} className="text-[13px] num">
                {p.distanceM}m{" "}
                <b>
                  {fmtSec(p.targetSecFast)} 〜 {fmtSec(p.targetSecSlow)}
                </b>
              </div>
            ))}
          </div>
        ) : null}

        <div className="flex gap-2 mt-3.5 flex-col sm:flex-row">
          <Link
            href={withQuery("/results", { date: session.date, sessionId: session.id })}
            className="btn-volt justify-center flex-1"
          >
            この練習を記録する<span aria-hidden>→</span>
          </Link>
        </div>
      </Card>

      {readiness ? (
        <Card title="セッション準備度">
          <div className="flex flex-col sm:flex-row gap-4 items-center">
            <Gauge score={readiness.score} />
            <div className="flex-1 min-w-0 w-full">
              <p className="text-[11.5px] leading-relaxed mb-2" style={{ color: "var(--text-3)" }}>
                「その練習がどれだけキツいか」ではなく、
                設定どおりの質を出せる条件が揃っているかを表します。100点からの減点方式です。
              </p>
              {(readiness.breakdown ?? []).map((b: any, i: number) => (
                <div
                  key={i}
                  className="flex justify-between gap-2 text-[12px] py-1 border-b last:border-0"
                  style={{ borderColor: "var(--border)" }}
                >
                  <span style={{ color: "var(--text-2)" }}>{b.label}</span>
                  <span className="num flex-shrink-0" style={{ color: b.delta < 0 ? "var(--amber)" : "var(--text-3)" }}>
                    {b.delta === 0 ? "±0" : b.delta}
                  </span>
                </div>
              ))}
              {(readiness.breakdown ?? []).some((b: any) => b.detail) ? (
                <div className="mt-2 text-[11px] leading-relaxed" style={{ color: "var(--text-3)" }}>
                  {(readiness.breakdown ?? [])
                    .filter((b: any) => b.detail)
                    .map((b: any, i: number) => (
                      <div key={i}>
                        {b.label}: {b.detail}
                      </div>
                    ))}
                </div>
              ) : null}
            </div>
          </div>
        </Card>
      ) : null}

      {r ? (
        <Card title="この練習をやる理由">
          <Row label="目的" value={r.purpose} />
          <Row label="狙う能力" value={r.targetAbility} />
          <Row label="生理学的根拠" value={r.physiologicalBasis} />
          <Row label="メリット" value={r.merit} />
          <Row label="デメリット" value={r.demerit} />
          <Row label="実施方法" value={r.execution} />
          <div className="mt-3 pt-3 border-t" style={{ borderColor: "var(--border)" }}>
            <Row label="800mのどの局面が改善するか" value={r.improves800mPhase} />
            <Row label="なぜ今やるべきか" value={r.whyNow} />
            <Row label="他の練習より優先する理由" value={r.whyPriority} />
            <Row label="やらない場合のデメリット" value={r.costOfSkipping} />
          </div>
        </Card>
      ) : (
        <Card>
          <p className="text-[12.5px]" style={{ color: "var(--text-2)" }}>
            このセッションには根拠データが登録されていません（手動追加したセッションなど）。
          </p>
        </Card>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className="mb-2.5">
      <div className="metric-label mb-1">{label}</div>
      <p className="text-[12.5px] leading-relaxed">{value}</p>
    </div>
  );
}
