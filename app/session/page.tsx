"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, Gauge, fmtSec } from "../components/ui";
import { useQueryParam, withQuery } from "../components/route-query";
import { localToday } from "@/lib/core/dates";
import { sessionView } from "@/lib/core/horizon";
import type { ShoeRecommendation } from "@/lib/core/shoeRecommend";

/**
 * おすすめシューズ。
 *
 * **判断はここでしない。** サービス層（`core/shoeRecommend.ts`）が出した順を
 * そのまま出す。画面で並べ替えると、記録画面と違う靴が出ることになる。
 *
 * 出すのは「おすすめ」だけではなく、**なぜそれなのか**と**代替**と**注意点**。
 * 理由が読めないと、違う靴を履きたいときに判断できない。
 */
function ShoeAdviceCard({ advice }: { advice: ShoeRecommendation }) {
  const [open, setOpen] = useState(false);
  if (!advice.best) {
    return (
      <Card title="おすすめシューズ">
        <p className="text-[12px] leading-relaxed" style={{ color: "var(--text-2)" }}>
          {advice.emptyNote}
        </p>
        <Link className="btn-ghost inline-flex mt-2" href="/settings">
          シューズを登録する
        </Link>
      </Card>
    );
  }
  const best = advice.best;
  return (
    <Card title="おすすめシューズ">
      <button
        className="w-full text-left min-h-[44px]"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="text-[15px] font-bold">{best.shoe.name}</span>
        <span className="text-[11.5px] ml-2" style={{ color: "var(--text-3)" }}>
          {open ? "▾ 理由をとじる" : "▸ 理由と代替を見る"}
        </span>
      </button>

      {/* 注意点は畳まない。履く前に読めないと意味がない */}
      {best.cautions.map((c, i) => (
        <p key={i} className="text-[11.5px] leading-relaxed mt-1" style={{ color: "var(--amber)" }}>
          {c}
        </p>
      ))}

      {open ? (
        <div className="mt-2">
          <div className="metric-label mb-1">この靴にした理由</div>
          {best.reasons.map((r, i) => (
            <p key={i} className="text-[12px] leading-relaxed" style={{ color: "var(--text-2)" }}>
              {r}
            </p>
          ))}

          {advice.alternatives.length > 0 ? (
            <>
              <div className="metric-label mt-2.5 mb-1">代替候補</div>
              {advice.alternatives.slice(0, 3).map((a) => (
                <div key={a.shoe.id} className="text-[12px] leading-relaxed">
                  <span className="font-semibold">{a.shoe.name}</span>
                  {a.cautions.length > 0 ? (
                    <span className="text-[11px] ml-1.5" style={{ color: "var(--amber)" }}>
                      {a.cautions[0]}
                    </span>
                  ) : null}
                </div>
              ))}
            </>
          ) : null}

          {/*
            実績がまだ少ないことを必ず断る。
            「学習済み」と受け取られると、根拠の薄い順位を信用させてしまう。
          */}
          {advice.dataNote ? (
            <p className="text-[11px] leading-relaxed mt-2.5" style={{ color: "var(--text-3)" }}>
              {advice.dataNote}
            </p>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

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
  /*
   * その日の練習に合う靴。判断はサービス層（core/shoeRecommend.ts）だけが持つ。
   * 画面で並べ替えたり足したりしない——ここで手を入れると、
   * 記録画面と違う靴が出ることになる。
   */
  const [shoeAdvice, setShoeAdvice] = useState<ShoeRecommendation | null>(null);
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

  useEffect(() => {
    if (!session?.id) return;
    fetch(`/api/shoes?sessionId=${encodeURIComponent(session.id)}`)
      .then((r) => r.json())
      .then((d) => setShoeAdvice(d.advice ?? null))
      .catch(() => setShoeAdvice(null));
  }, [session?.id]);

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
  // 確定範囲の外は素案として出す（判断は horizon.ts に集める）
  const view = sessionView(session, localToday());

  return (
    <div className="session-screen flex flex-col gap-3">
      {/*
        リファレンス（reference-ui/crops/ai-menu.jpeg）の構成。
        緑の小ラベル＋内容を積み重ね、最後に緑枠の開始ボタンを置く。
        中身は既存のデータをそのまま並べ替えただけで、生成ロジックには触っていない。
      */}
      <Card variant="hero" className="session-hero">
        <div className="flex items-center justify-between gap-2 mb-2.5">
          <span className="forge-label" style={{ color: "var(--forge)" }}>
            TODAY&apos;S FORGE
          </span>
          <span className="text-[11px] num" style={{ color: "var(--text-3)" }}>
            {session.date}
          </span>
        </div>

        <div className="flex items-center gap-2 flex-wrap mb-4">
          <h2
            className="font-extrabold leading-none"
            style={{ fontSize: "var(--num-lg)", letterSpacing: "-.02em" }}
          >
            {session.name}
          </h2>
          {view.badge ? (
            <span
              className="text-[10px] font-bold px-2 py-0.5 rounded"
              style={{ border: "1px solid var(--border)", color: "var(--text-3)" }}
            >
              {view.badge}
            </span>
          ) : session.generation?.repeatedForComparison ? null : (
            <span
              className="text-[10px] font-bold px-2 py-0.5 rounded"
              style={{ border: "1px solid var(--volt-line)", color: "var(--forge)" }}
            >
              推奨
            </span>
          )}
        </div>

        {/* REASON: 生成がこの形式を選んだ理由（既存の selectionReasons） */}
        {session.generation?.selectionReasons?.length ? (
          <div className="mb-4">
            <p className="forge-label" style={{ color: "var(--forge)" }}>
              REASON
            </p>
            <p className="text-[12.5px] leading-relaxed mt-1.5" style={{ color: "var(--text-2)" }}>
              {session.generation.selectionReasons[0]}
            </p>
          </div>
        ) : null}

        <div className="mb-4">
          <p className="forge-label" style={{ color: "var(--forge)" }}>
            MAIN SET
          </p>
          <p className="text-[13px] leading-relaxed mt-1.5">{view.prescription}</p>
          {/*
            確定範囲の外では設定ペースを出さない。
            この画面は「このメニューで開始」まで繋がっているので、
            まだ決まっていない数字を出すと、それで走れることになってしまう。
          */}
          {view.confirmed && session.targetPaces?.length > 0 ? (
            <div className="mt-1.5">
              {session.targetPaces.map((p: any, i: number) => (
                <div key={i} className="text-[12.5px] num" style={{ color: "var(--text-2)" }}>
                  {p.distanceM}m{" "}
                  <b style={{ color: "var(--text)" }}>
                    {fmtSec(p.targetSecFast)} 〜 {fmtSec(p.targetSecSlow)}
                  </b>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        {/* FOCUS: この練習の目的（既存の rationale.purpose） */}
        {r?.purpose ? (
          <div className="mb-4">
            <p className="forge-label" style={{ color: "var(--forge)" }}>
              FOCUS
            </p>
            <p className="text-[12.5px] leading-relaxed mt-1.5" style={{ color: "var(--text-2)" }}>
              {r.purpose}
            </p>
          </div>
        ) : null}

        <div className="flex gap-2 flex-col sm:flex-row">
          {view.confirmed && session.targetPaces?.length > 0 ? (
            <Link
              href={withQuery("/run", { sessionId: session.id })}
              className="btn-ghost justify-center flex-1"
              style={{ borderColor: "var(--volt-line)", color: "var(--forge)" }}
            >
              このメニューで開始<span aria-hidden>→</span>
            </Link>
          ) : null}
          <Link
            href={withQuery("/results", { date: session.date, sessionId: session.id })}
            className="btn-ghost justify-center flex-1"
          >
            この練習を記録する<span aria-hidden>→</span>
          </Link>
        </div>
      </Card>

      {shoeAdvice ? <ShoeAdviceCard advice={shoeAdvice} /> : null}

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

      {session.generation ? (
        <Card title="この形式を選んだ理由">
          <div className="flex flex-wrap gap-2 mb-3">
            <span
              className="text-[10px] font-bold px-2 py-1 rounded-md"
              style={{ background: "var(--surface-2)", color: "var(--text-2)" }}
            >
              進行段階 {session.generation.progressionStage}
            </span>
            <span
              className="text-[10px] font-bold px-2 py-1 rounded-md"
              style={{ background: "var(--surface-2)", color: "var(--text-2)" }}
            >
              判断材料 {session.generation.confidence === "high"
                ? "十分"
                : session.generation.confidence === "medium"
                  ? "一部あり"
                  : "不足"}
            </span>
          </div>
          <ul className="list-disc pl-5 space-y-1">
            {session.generation.selectionReasons.map((reason: string) => (
              <li key={reason} className="text-[12px] leading-relaxed" style={{ color: "var(--text-2)" }}>
                {reason}
              </li>
            ))}
          </ul>
          {session.generation.alternativeTemplateIds.length > 0 ? (
            <p className="text-[11px] leading-relaxed mt-3" style={{ color: "var(--text-3)" }}>
              代替候補も比較済みです。疲労や実施結果が変われば、次回は別形式を選ぶことがあります。
            </p>
          ) : null}
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
