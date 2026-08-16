"use client";
import { useCallback, useEffect, useState } from "react";
import { Card, CATEGORY_COLORS, CATEGORY_LABELS, StatusText, fmtSec } from "../components/ui";
import RaceAnalysis from "../race/page";
import type { CoverageReview } from "@/lib/core/coverage";
import type { SessionCategory } from "@/lib/core/types";
import type { TimelineDay } from "@/lib/core/timeline";
import { describeAbortSummary, type AbortSummary } from "@/lib/core/abortSummary";
import {
  formatPeriodRange,
  PERIOD_LABELS,
  type PeriodSummary,
} from "@/lib/core/periodSummary";

/** 単一系列の折れ線（1系列のみなので凡例なし・タイトルが系列名を兼ねる） */
function LineChart({
  points,
  color = "var(--cat-race-economy)",
  height = 120,
  yFmt = (v: number) => v.toFixed(1),
  empty,
}: {
  points: { x: string; y: number }[];
  color?: string;
  height?: number;
  yFmt?: (v: number) => string;
  /** E-3: 空のときは「データがありません」で終わらせず、次の行動を出す */
  empty?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  // E-1/E-3: データ有無の判定を1箇所に統一する。
  // 点が2つ未満、または全点が同じ日付なら「推移」になっていないので描かない。
  // 現行はグラフを描いたうえで「データがありません」も出しており、矛盾していた。
  const uniqueX = new Set(points.map((p) => p.x));
  const drawable = points.length >= 2 && uniqueX.size >= 2;
  if (!drawable)
    return (
      <p className="text-[11.5px] leading-relaxed" style={{ color: "var(--text-3)" }}>
        {empty ?? "記録が2日分たまると推移が表示されます。"}
      </p>
    );
  const w = 560;
  const pad = 30;
  const ys = points.map((p) => p.y);
  const ymin = Math.min(...ys);
  const ymax = Math.max(...ys);
  const yr = ymax - ymin || 1;
  const px = (i: number) =>
    pad + (points.length === 1 ? 0 : (i / (points.length - 1)) * (w - pad * 2));
  const py = (y: number) => height - 20 - ((y - ymin) / yr) * (height - 35);
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${px(i)},${py(p.y)}`).join(" ");
  return (
    <svg
      viewBox={`0 0 ${w} ${height}`}
      className="w-full"
      onMouseLeave={() => setHover(null)}
    >
      <line x1={pad} y1={height - 20} x2={w - pad} y2={height - 20} stroke="#e5e5e3" />
      <text x={4} y={py(ymax) + 4} fontSize="10" fill="var(--text-2)">{yFmt(ymax)}</text>
      <text x={4} y={py(ymin) + 4} fontSize="10" fill="var(--text-2)">{yFmt(ymin)}</text>
      <path d={path} fill="none" stroke={color} strokeWidth={2} />
      {points.map((p, i) => (
        <g key={i}>
          <rect
            x={px(i) - 8}
            y={0}
            width={16}
            height={height}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
          />
          {hover === i ? (
            <>
              <circle cx={px(i)} cy={py(p.y)} r={4} fill={color} stroke="#fff" strokeWidth={2} />
              <text
                x={Math.min(Math.max(px(i), 40), w - 60)}
                y={12}
                fontSize="10"
                textAnchor="middle"
                fill="var(--text)"
              >
                {p.x}: {yFmt(p.y)}
              </text>
            </>
          ) : null}
        </g>
      ))}
    </svg>
  );
}

/**
 * P-5 セグメントは3つ。
 *
 * 6つ（推移/負荷/バランス/レース/現在地/週報）を横に等分すると、
 * iPhone幅では1つ約59pxで「バランス」「現在地」が詰まり、
 * どれが今選ばれているかも読み取りにくかった。
 *
 * 数を減らすために機能を消すのではなく、問いの単位でまとめる。
 *   現在地 … 今どこにいるか（現在地 + 週報）
 *   推移   … どう変わってきたか（CFE・経済走 + 負荷 + バランス）
 *   レース … レースに向けて何をするか
 * 中身のカードは縦に並ぶだけなので、まとまっても迷わない。
 */
/*
 * PERFORMANCE（リファレンスの期間サマリー）は4つ目のタブにしない。
 * セグメントを増やすとiPhone幅で詰まる、というのが上のP-5の判断で、
 * 実際に4つにすると「PERFORMANCE」が幅を食って残り3つが読みにくくなった。
 * 「どれだけ積み上げたか」は「どう変わってきたか」の問いに含まれるので、
 * 推移の先頭に置く。既存の3つは置き換えない——置き換えると制限因子・
 * 600m通過・同一処方比較・CFE推移・ACWR・カバレッジ・レース分析が全部消える。
 */
const ANALYSIS_SEGMENTS = [
  { key: "now", label: "現在地" },
  { key: "trend", label: "推移" },
  { key: "race", label: "レース" },
] as const;
type AnalysisSeg = (typeof ANALYSIS_SEGMENTS)[number]["key"];

export default function AnalysisPage() {
  const [data, setData] = useState<any | null>(null);
  const [seg, setSeg] = useState<AnalysisSeg>("now");

  useEffect(() => {
    fetch("/api/analysis")
      .then((r) => r.json())
      .then(setData);
  }, []);

  if (!data) return <p className="text-sm">読み込み中…</p>;

  const trendColor: Record<string, string> = {
    progress: "var(--forge)",
    repeat: "var(--text-2)",
    fatigue: "var(--amber)",
    insufficient_data: "var(--text-2)",
  };

  const lastWeek = data.weeks?.[data.weeks.length - 1];

  return (
    <div className="analysis-screen flex flex-col gap-3">
      {/*
        B-2: レース分析を分析タブのセグメントとして統合する。
        あわせて既存の6カードもセグメントに振り分け、1画面に縦積みするのをやめた
        （現行は目的のグラフまでスクロールが要った）。
      */}
      <div className="seg" role="group" aria-label="分析カテゴリ">
        {ANALYSIS_SEGMENTS.map((x) => (
          <button
            key={x.key}
            aria-pressed={seg === x.key}
            data-on={seg === x.key ? "1" : "0"}
            onClick={() => setSeg(x.key)}
          >
            {x.label}
          </button>
        ))}
      </div>

      {seg === "race" ? <RaceAnalysis /> : null}
      {seg === "now" ? <GapPanel /> : null}
      {seg === "now" ? <CoveragePanel /> : null}
      {seg === "now" ? <ReviewPanel /> : null}

      <div className={seg === "trend" ? "flex flex-col gap-3" : "hidden"}>
        <PerformancePanel periods={data.performance ?? []} />
        <BalanceCard balance={data.balance} />
        <AbortBreakdownCard summary={data.abortBreakdown} />
        <ConditionCard />
        <TimelineCard days={data.timeline ?? []} />
      </div>

      <div className={seg === "trend" ? "grid md:grid-cols-2 gap-3" : "hidden"}>
      <Card title="CFE（推定800mタイム）の推移">
        <LineChart
          points={(data.cfeHistory ?? []).map((h: any) => ({ x: h.date, y: h.after }))}
          yFmt={(v) => fmtSec(v)}
          empty="CFEの更新が2回たまると推移が出ます。レースかタイムトライアルの記録で更新されます。"
        />
        <details className="text-xs mt-1">
          <summary style={{ color: "var(--text-2)" }}>更新履歴（なぜこの設定になったか）</summary>
          <table className="w-full mt-1">
            <tbody>
              {(data.cfeHistory ?? []).slice().reverse().map((h: any, i: number) => (
                <tr key={i} className="border-b last:border-0" style={{ borderColor: "var(--border)" }}>
                  <td className="py-0.5 pr-2 whitespace-nowrap num">{h.date}</td>
                  <td className="py-0.5 pr-2 whitespace-nowrap">{fmtSec(h.before)} → {fmtSec(h.after)}</td>
                  <td className="py-0.5" style={{ overflowWrap: "anywhere", color: "var(--text-2)" }}>{h.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </Card>

      <SamePrescriptionCard groups={data.samePrescription ?? []} />

      <Card title="経済走のRPE推移（同設定でより楽になっているか）">
        <LineChart
          points={(data.economyPoints ?? []).map((p: any) => ({ x: p.date, y: p.rpe }))}
          color="var(--cat-race-economy)"
          yFmt={(v) => `RPE ${v.toFixed(0)}`}
          empty="同一設定の経済走が2回そろうと比較を開始します。"
        />
        {data.economyTrend ? (
          <p className="text-sm mt-1" style={{ color: trendColor[data.economyTrend.judgement] }}>
            {data.economyTrend.message}
          </p>
        ) : null}
      </Card>
      </div>

      <div className={seg === "trend" ? "grid md:grid-cols-2 gap-3" : "hidden"}>
      <Card title="日次負荷（RPE×分）とACWR">
        <LineChart
          points={(data.loadSeries ?? [])
            .filter((p: any) => p.load > 0)
            .map((p: any) => ({ x: p.date, y: p.load }))}
          yFmt={(v) => v.toFixed(0)}
          empty="練習結果をあと2日分記録すると、日次負荷の推移が出ます。"
        />
        <LineChart
          points={(data.loadSeries ?? [])
            .filter((p: any) => p.acwr !== undefined && p.acwr !== null)
            .map((p: any) => ({ x: p.date, y: p.acwr }))}
          color="var(--cat-high-lactate)"
          height={90}
          yFmt={(v) => v.toFixed(2)}
          empty="ACWRは直近28日のうち14日以上の記録が必要です。過去データの入力でも埋められます。"
        />
        {data.acwrNow ? (
          <div className="text-sm mt-1">
            現在のACWR: <b>{data.acwrNow.acwr?.toFixed(2) ?? "-"}</b>
            {" "}（{data.acwrNow.label}／信頼度
            {data.acwrNow.confidence === "high"
              ? "高"
              : data.acwrNow.confidence === "medium"
                ? "中"
                : "低"}
            ・28日中{data.acwrNow.recordedDays}日）
            <p className="text-xs mt-1" style={{ color: "var(--text-2)" }}>
              {data.acwrNow.note}
            </p>
          </div>
        ) : null}
        <p className="text-xs" style={{ color: "var(--text-2)" }}>
          上: 実施した日次負荷 ／ 下: ACWR。未実施予定は含めません。ACWRは単独で判断せず、睡眠・疲労・筋肉痛・完遂度と併せて確認してください。
        </p>
      </Card>

      </div>

      <div className={seg === "trend" ? "grid md:grid-cols-2 gap-3" : "hidden"}>
      <Card title="転移度バランス（今週のカテゴリ構成）">
        {lastWeek ? (
          <div>
            <div className="flex flex-wrap gap-3 text-sm mb-2">
              {Object.entries(lastWeek.categoryCounts as Record<string, number>)
                .filter(([, n]) => n > 0)
                .map(([cat, n]) => (
                  <span key={cat} className="inline-flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: (CATEGORY_COLORS as any)[cat] }} />
                    {(CATEGORY_LABELS as any)[cat]}: {n}回
                  </span>
                ))}
            </div>
            <p className="text-sm">
              週間800m転移度スコア: <b>{lastWeek.transfer800mScore.toFixed(2)} / 5</b>
              ／ 高乳酸 直近28日: <b>{lastWeek.highLactateLast28d}回</b>
              ／ 週あたり高乳酸(28日平均): <b>{data.hlPerWeek28d?.toFixed(2)}回</b>
            </p>
          </div>
        ) : (
          <p className="text-xs">プランを生成すると表示されます。</p>
        )}
      </Card>

      <Card title="安静時HRトレンド">
        <p className="text-sm">
          {data.restingHrTrend?.trend === "rising"
            ? "⚠ 上昇傾向です。自律神経系の疲労蓄積の可能性があります。"
            : data.restingHrTrend?.trend === "insufficient"
              ? "データ不足（7日以上の記録が必要）"
              : `トレンド: ${data.restingHrTrend?.trend}`}
        </p>
      </Card>

      <Card title="変更ログ（補正の監査記録）">
        <div className="max-h-72 overflow-y-auto flex flex-col gap-1.5">
          {(data.changeLog ?? []).length === 0 ? (
            <p className="text-[11px]" style={{ color: "var(--text-3)" }}>まだ記録がありません</p>
          ) : null}
          {(data.changeLog ?? []).map((c: any, i: number) => (
            <div
              key={i}
              className="text-[11px] rounded-lg border p-2"
              style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}
            >
              <div className="flex justify-between gap-2 flex-wrap">
                <span className="font-mono font-bold" style={{ color: "var(--volt)" }}>
                  [{c.triggeredBy}]
                </span>
                {c.accepted === true ? (
                  <span style={{ color: "var(--volt)" }}>✓ 承認</span>
                ) : c.accepted === false ? (
                  <span style={{ color: "var(--text-3)" }}>✕ 却下{c.rejectReason ? `（${c.rejectReason}）` : ""}</span>
                ) : null}
              </div>
              <div style={{ overflowWrap: "anywhere" }}>
                <span style={{ color: "var(--text-2)" }}>{String(c.before)}</span> → <b>{String(c.after)}</b>
              </div>
              <div style={{ color: "var(--text-3)", marginTop: 2 }}>{c.reason}</div>
            </div>
          ))}
        </div>
      </Card>
      </div>
    </div>
  );
}


/**
 * PERFORMANCE（reference-ui/crops/analytics.jpeg）。
 *
 * 期間の総距離とその積み上がり方を1画面で見る。
 * 集計は `src/lib/core/periodSummary.ts` に置いてあり、ここは表示だけ。
 * グラフは既存の LineChart を使わず専用に描く——薄いグリッド線・小さい点・
 * 軸ラベルという構成がリファレンス固有で、汎用の折れ線に足すと他の画面が変わる。
 */
/**
 * 直近4週の「予定と実際のズレ」。
 *
 * 隣の PerformancePanel（期間サマリー）と役割を分ける。
 *   ・PerformancePanel = 距離・時間・強度の**合計**。伸びたかを見る
 *   ・ここ             = 予定に対して**どれだけ実施できたか**。守れているかを見る
 * 同じ週の合計を2か所に出さない（数字が食い違って見える）。
 *
 * 守れているかを見る意味は、それが処方の組み立てに効いているから
 * （`recentTrend` が同じことをカテゴリ単位で見て、本数とレストを動かしている）。
 * 自動で動いている判断の材料を、本人も同じ形で見返せるようにする。
 */
interface BalanceWeekView {
  weekStart: string;
  plannedSessions: number;
  completedSessions: number;
  skippedSessions: number;
  adherencePct?: number;
  highLoadDays: number;
  glycolyticSessions: number;
  recoveryDays: number;
}
interface BalanceView {
  weeks: BalanceWeekView[];
  adherencePct?: number;
  signals: { code: string; level: string; message: string; action: string }[];
}


/**
 * 同じ練習を、条件で分けて見る。
 *
 * 「設定は同じでも雨でRPEが上がった」を数字にするためのもの。
 * **これで設定は動かさない**——見て本人が判断する材料。
 * 自動で補正すると、タグの付け忘れが能力の変化として現れる。
 */
function ConditionCard() {
  const [splits, setSplits] = useState<any[]>([]);
  useEffect(() => {
    fetch("/api/shoes")
      .then((r) => r.json())
      .then((d) => setSplits(d.conditionSplits ?? []))
      .catch(() => {
        /* 参考情報。取れなくても分析の他は出る */
      });
  }, []);
  if (splits.length === 0) return null;
  return (
    <Card title="条件でRPEがどれだけ変わるか">
      <p className="text-[11px] mb-2 leading-relaxed" style={{ color: "var(--text-2)" }}>
        記録に付けた天候・路面のタグで分けた平均RPEです。
        <strong>設定はこれで動かしません</strong>——「きつかったのは条件のせいか、能力が落ちたのか」を
        見分けるための材料です。両方が2回以上たまったタグだけ出します。
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["条件", "あり", "なし", "差"].map((h) => (
                <th key={h} className="metric-label text-left py-1 pr-2" style={{ borderBottom: "1px solid var(--border)" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {splits.map((s) => (
              <tr key={s.tag} style={{ borderBottom: "1px solid var(--border)" }}>
                <td className="py-1.5 pr-2 whitespace-nowrap">{s.label}</td>
                <td className="py-1.5 pr-2 num whitespace-nowrap">
                  {s.withRpe.toFixed(1)}
                  <small style={{ color: "var(--text-3)" }}> ({s.withCount})</small>
                </td>
                <td className="py-1.5 pr-2 num whitespace-nowrap">
                  {s.withoutRpe.toFixed(1)}
                  <small style={{ color: "var(--text-3)" }}> ({s.withoutCount})</small>
                </td>
                <td
                  className="py-1.5 num whitespace-nowrap font-bold"
                  style={{ color: s.deltaRpe > 0 ? "var(--amber)" : "var(--forge)" }}
                >
                  {s.deltaRpe > 0 ? "+" : ""}
                  {s.deltaRpe.toFixed(1)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/**
 * 打ち切りの理由別の内訳。
 *
 * 理由は forge-v98 から記録していたが、**貯まっても誰も見ていなかった**。
 * 理由ごとに扱いが違う（設定を緩める材料になるもの／ならないもの）ので、
 * 数と扱いを並べて出す。
 */
function AbortBreakdownCard({ summary }: { summary?: AbortSummary | null }) {
  // 1回も無いなら出さない（空のカードを並べても読むものが増えるだけ）
  if (!summary || summary.total === 0) return null;
  return (
    <Card title="途中でやめた練習">
      <p className="text-[11.5px] leading-relaxed mb-2" style={{ color: "var(--text-2)" }}>
        {describeAbortSummary(summary)}
      </p>
      <div className="flex flex-col gap-1">
        {summary.counts.map((c) => (
          <div key={c.cause} className="flex items-baseline justify-between gap-2 text-[12.5px]">
            <span>{c.label}</span>
            <span className="flex items-baseline gap-2">
              {/* 扱いの違いを数字の隣に出す。色だけに頼らない */}
              <span className="text-[10.5px]" style={{ color: "var(--text-3)" }}>
                {c.countsTowardPaceEase ? "設定に反映" : "記録のみ"}
              </span>
              <b className="num">{c.count}回</b>
            </span>
          </div>
        ))}
      </div>
      {summary.tooFastReached ? (
        <StatusText kind="warning" className="text-[11.5px] leading-relaxed mt-2.5">
          「出力が出すぎた」が{summary.tooFastCount}回たまりました。設定を上げる材料にするか
          検討する時期です（`BACKLOG.md` の A-2b）。
          **ただしこの数だけでは動かしません。** 実行可能率の測定と両方そろってから判断します。
        </StatusText>
      ) : null}
    </Card>
  );
}

function BalanceCard({ balance }: { balance?: BalanceView | null }) {
  if (!balance || !balance.weeks?.length) return null;
  const md = (d: string) => {
    const [, m, day] = d.split("-");
    return `${Number(m)}/${Number(day)}`;
  };
  return (
    <Card title="予定どおりにできたか（直近4週）">
      <p className="text-[11px] mb-2 leading-relaxed" style={{ color: "var(--text-2)" }}>
        合計の伸びは上の期間サマリーで見ます。ここは
        <strong>予定に対して実施できた割合</strong>。
        設定を守れているかは、次の処方の本数とレストに効いています。
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["週", "実施/予定", "達成率", "高負荷", "高乳酸", "回復"].map((h) => (
                <th
                  key={h}
                  className="metric-label text-left py-1 pr-2 whitespace-nowrap"
                  style={{ borderBottom: "1px solid var(--border)" }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {balance.weeks.map((w, i) => {
              const last = i === balance.weeks.length - 1;
              const pct = w.adherencePct;
              return (
                <tr
                  key={w.weekStart}
                  style={{
                    borderBottom: "1px solid var(--border)",
                    background: last ? "var(--surface-2)" : "transparent",
                  }}
                >
                  <td className="py-1.5 pr-2 whitespace-nowrap num">
                    {md(w.weekStart)}
                    {last ? <small style={{ color: "var(--text-3)" }}>（今週）</small> : null}
                  </td>
                  <td className="py-1.5 pr-2 num whitespace-nowrap">
                    {w.completedSessions}/{w.plannedSessions}
                    {w.skippedSessions > 0 ? (
                      <small style={{ color: "var(--text-3)" }}> 欠{w.skippedSessions}</small>
                    ) : null}
                  </td>
                  <td
                    className="py-1.5 pr-2 num whitespace-nowrap"
                    style={{
                      color:
                        pct === undefined
                          ? "var(--text-3)"
                          : pct < 70
                            ? "var(--amber)"
                            : "var(--forge)",
                    }}
                  >
                    {pct === undefined ? "—" : `${Math.round(pct)}%`}
                  </td>
                  <td className="py-1.5 pr-2 num">{w.highLoadDays}</td>
                  <td className="py-1.5 pr-2 num">{w.glycolyticSessions}</td>
                  <td className="py-1.5 num">{w.recoveryDays}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {/*
        気づきは「出たときだけ」出す。毎回同じ行が出ると読まれなくなる
        （午前枠の助言と同じ考え方）。断定せず、対処案まで書く。
      */}
      {balance.signals?.length ? (
        <div className="mt-2 flex flex-col gap-1.5">
          {balance.signals.map((s, i) => (
            <div key={i} className="rounded-lg p-2.5" style={{ background: "var(--surface-2)" }}>
              <p
                className="text-[12px] leading-relaxed"
                style={{ color: s.level === "warn" ? "var(--amber)" : "var(--text)" }}
              >
                {s.message}
              </p>
              <p className="text-[11px] mt-1 leading-relaxed" style={{ color: "var(--text-3)" }}>
                {s.action}
              </p>
            </div>
          ))}
        </div>
      ) : null}
    </Card>
  );
}

function PerformancePanel({ periods }: { periods: PeriodSummary[] }) {
  const [idx, setIdx] = useState(1); // 既定は MONTH
  if (!periods || periods.length === 0) {
    return (
      <Card title="PERFORMANCE">
        <p className="text-[11.5px] leading-relaxed" style={{ color: "var(--text-3)" }}>
          練習を記録すると、週・月・年ごとの積み上げが出ます。
        </p>
      </Card>
    );
  }
  const p = periods[Math.min(idx, periods.length - 1)];
  const paceText =
    p.avgPaceSecPerKm !== undefined
      ? `${Math.floor(p.avgPaceSecPerKm / 60)}:${String(Math.round(p.avgPaceSecPerKm % 60)).padStart(2, "0")}`
      : "-";
  const h = Math.floor(p.totalDurationMin / 60);
  const m = p.totalDurationMin % 60;

  return (
    <Card>
      {/* 期間の切り替え。選択中だけ下線（リファレンスの表現） */}
      <div className="flex items-stretch mb-4" role="group" aria-label="集計期間">
        {periods.map((x, i) => (
          <button
            key={x.kind}
            className="flex-1 min-h-[44px] text-[11.5px] font-bold"
            aria-pressed={i === idx}
            onClick={() => setIdx(i)}
            style={{
              color: i === idx ? "#fff" : "var(--text-3)",
              letterSpacing: ".12em",
              borderBottom: `2px solid ${i === idx ? "var(--forge)" : "transparent"}`,
            }}
          >
            {PERIOD_LABELS[x.kind]}
          </button>
        ))}
      </div>

      <p className="text-[12px] num text-center mb-4" style={{ color: "var(--text-2)" }}>
        {formatPeriodRange(p)}
      </p>

      <p className="forge-label">TOTAL DISTANCE</p>
      <div className="flex items-end justify-between gap-3 mt-1.5 mb-4">
        <p className="num font-extrabold leading-none" style={{ fontSize: "var(--num-xl)" }}>
          {p.totalDistanceKm.toFixed(1)}
          <span className="text-[15px] font-bold ml-1.5" style={{ color: "var(--text-2)" }}>
            km
          </span>
        </p>
        {p.deltaPct !== undefined ? (
          <div className="text-right">
            <p
              className="num text-[14px] font-bold leading-none"
              style={{ color: p.deltaPct >= 0 ? "var(--forge)" : "var(--amber)" }}
            >
              {p.deltaPct > 0 ? "+" : ""}
              {p.deltaPct.toFixed(1)}%
            </p>
            <p className="text-[10px] num mt-1" style={{ color: "var(--text-3)" }}>
              vs {formatPeriodRange({ ...p, from: p.prevFrom, to: p.prevTo })}
            </p>
          </div>
        ) : null}
      </div>

      <CumulativeChart points={p.points} />

      <div className="grid grid-cols-3 gap-2 mt-5">
        {[
          { label: "AVG PACE", value: paceText, unit: "/km" },
          { label: "TOTAL TIME", value: `${h}:${String(m).padStart(2, "0")}`, unit: "h" },
          { label: "INTENSITY", value: p.totalLoad.toLocaleString(), unit: "pt" },
        ].map((it) => (
          <div key={it.label}>
            <p className="text-[9.5px] font-bold" style={{ color: "var(--text-3)", letterSpacing: ".1em" }}>
              {it.label}
            </p>
            <p className="num font-bold leading-none mt-1.5" style={{ fontSize: "var(--num-md)" }}>
              {it.value}
            </p>
            <p className="text-[10px] mt-1" style={{ color: "var(--text-3)" }}>
              {it.unit}
            </p>
          </div>
        ))}
      </div>
    </Card>
  );
}

/** 累積距離の折れ線。薄い横グリッド・小さい点・両端の日付だけの軸 */
function CumulativeChart({ points }: { points: PeriodSummary["points"] }) {
  if (points.length < 2) {
    return (
      <p className="text-[11.5px]" style={{ color: "var(--text-3)" }}>
        記録が2日分たまると推移が出ます。
      </p>
    );
  }
  const w = 330;
  const h = 132;
  const padL = 30;
  const padB = 18;
  const padT = 6;
  const max = Math.max(...points.map((p) => p.cumulativeKm), 1);
  // 目盛りはキリのよい4本にする（データ最大に合わせた半端な数字を出さない）
  const step = niceStep(max / 4);
  const top = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = 0; v <= top + 0.0001; v += step) ticks.push(Math.round(v * 10) / 10);

  const px = (i: number) => padL + (i / (points.length - 1)) * (w - padL - 6);
  const py = (v: number) => padT + (1 - v / top) * (h - padT - padB);
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${px(i)},${py(p.cumulativeKm)}`).join(" ");

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img" aria-label="期間内の累積距離">
      {ticks.map((v) => (
        <g key={v}>
          <line x1={padL} y1={py(v)} x2={w - 6} y2={py(v)} stroke="var(--border)" strokeWidth="1" />
          <text x={padL - 5} y={py(v) + 3.5} fontSize="8.5" textAnchor="end" fill="var(--text-3)">
            {v}
          </text>
        </g>
      ))}
      <path d={path} fill="none" stroke="var(--forge)" strokeWidth="1.8" strokeLinejoin="round" />
      {points.map((p, i) => (
        <circle key={i} cx={px(i)} cy={py(p.cumulativeKm)} r="2" fill="var(--forge)" />
      ))}
      <text x={padL} y={h - 4} fontSize="8.5" fill="var(--text-3)">
        {points[0].date.slice(5).replace("-", "/")}
      </text>
      <text x={w - 6} y={h - 4} fontSize="8.5" textAnchor="end" fill="var(--text-3)">
        {points[points.length - 1].date.slice(5).replace("-", "/")}
      </text>
    </svg>
  );
}

/** 目盛り幅を 1/2/5×10^n に丸める */
function niceStep(raw: number): number {
  if (raw <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
}

/**
 * 28日間統合タイムライン。
 *
 * これまで負荷/ACWR・睡眠・脚疲労・張り・安静時心拍・シグナルは別々のカードに
 * 分かれていたため、「負荷を上げた数日後に脚が重くなった」のような時間差のある
 * 関係を画面上で見比べられなかった。同じ日付軸に並べ直すだけで、新しい判定や
 * 推定は一切増やさない（すべて既存カードの値をそのまま使う）。
 */
/**
 * 欠測を含む点列からSVGパスを作る。
 * 先頭が欠測でも次に有効な点を必ず "M"（始点）にする
 * （元配列のindexで M/L を決めると、先頭が欠測のとき "L" から始まり不正なpathになる）。
 */
function sparsePath(
  points: { x: number; v: number | undefined }[],
  toY: (v: number) => number
): string {
  let started = false;
  const parts: string[] = [];
  for (const p of points) {
    if (typeof p.v !== "number") continue;
    parts.push(`${started ? "L" : "M"}${p.x},${toY(p.v)}`);
    started = true;
  }
  return parts.join(" ");
}

function TimelineCard({ days }: { days: TimelineDay[] }) {
  if (!days || days.length < 2) {
    return (
      <Card title="28日間タイムライン">
        <p className="text-[11.5px] leading-relaxed" style={{ color: "var(--text-3)" }}>
          記録がたまると、負荷・睡眠・脚疲労・張り・安静時心拍を同じ日付軸で見比べられます。
        </p>
      </Card>
    );
  }
  const w = 560;
  const pad = 28;
  const n = days.length;
  const px = (i: number) => pad + (n === 1 ? 0 : (i / (n - 1)) * (w - pad * 2));
  const colW = (w - pad * 2) / n;

  const loadTop = 6;
  const loadH = 56;
  const maxLoad = Math.max(...days.map((d) => d.load), 1);
  const acwrVals = days.map((d) => d.acwr).filter((v) => typeof v === "number") as number[];
  const maxAcwr = Math.max(...acwrVals, 1.5, 0.001);
  const acwrY = (v: number) => loadTop + loadH - (v / maxAcwr) * loadH;

  const dotRowY = { sleep: 84, leg: 106, tight: 128 } as const;
  const hrTop = 142;
  const hrH = 26;
  const hrVals = days.map((d) => d.restingHr).filter((v) => typeof v === "number") as number[];
  const hrMin = hrVals.length ? Math.min(...hrVals) : 0;
  const hrMax = hrVals.length ? Math.max(...hrVals) : 1;
  const hrRange = hrMax - hrMin || 1;
  const hrY = (v: number) => hrTop + hrH - ((v - hrMin) / hrRange) * hrH;

  const axisY = 172;
  const totalH = axisY + 16;

  const badDot = (v: number, invert: boolean) => (invert ? v <= 2 : v >= 4);

  return (
    <Card title="28日間タイムライン">
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${w} ${totalH}`} className="w-full" style={{ minWidth: 480 }}>
          {/* 背景帯: 休養日・シグナル日 */}
          {days.map((d, i) =>
            d.isRest || d.signal === "yellow" || d.signal === "red" ? (
              <rect
                key={`bg-${i}`}
                x={px(i) - colW / 2}
                y={0}
                width={colW}
                height={totalH - 12}
                fill={
                  d.signal === "red"
                    ? "rgba(255,80,80,0.10)"
                    : d.signal === "yellow"
                    ? "rgba(255,193,7,0.10)"
                    : "var(--surface-2)"
                }
              />
            ) : null
          )}

          {/* 負荷バー */}
          {days.map((d, i) => {
            const h = (d.load / maxLoad) * loadH;
            return (
              <rect
                key={`load-${i}`}
                x={px(i) - colW * 0.28}
                y={loadTop + loadH - h}
                width={colW * 0.56}
                height={h}
                fill="var(--text-3)"
              />
            );
          })}
          {/* ACWR折れ線 */}
          <path
            d={sparsePath(
              days.map((d, i) => ({ x: px(i), v: d.acwr })),
              acwrY
            )}
            fill="none"
            stroke="var(--forge)"
            strokeWidth={1.5}
          />
          <text x={2} y={loadTop + 8} fontSize="9" fill="var(--text-3)">負荷/ACWR</text>

          {/* 睡眠・脚疲労・張り: 5段階を点の色で表す（濃いグレー=通常、アンバー=要注意） */}
          {(
            [
              ["sleep", "睡眠", true],
              ["leg", "脚疲労", false],
              ["tight", "張り", false],
            ] as const
          ).map(([key, label, invert]) => (
            <g key={key}>
              <text x={2} y={dotRowY[key] + 3} fontSize="9" fill="var(--text-3)">{label}</text>
              {days.map((d, i) => {
                const v = key === "sleep" ? d.sleepQuality : key === "leg" ? d.legFatigue : d.muscleTightness;
                if (typeof v !== "number") return null;
                return (
                  <circle
                    key={i}
                    cx={px(i)}
                    cy={dotRowY[key]}
                    r={2.6}
                    fill={badDot(v, invert) ? "var(--amber)" : "var(--text-2)"}
                  />
                );
              })}
            </g>
          ))}

          {/* 安静時心拍 */}
          <text x={2} y={hrTop + 8} fontSize="9" fill="var(--text-3)">安静時HR</text>
          <path
            d={sparsePath(
              days.map((d, i) => ({ x: px(i), v: d.restingHr })),
              hrY
            )}
            fill="none"
            stroke="var(--text-2)"
            strokeWidth={1.5}
          />

          {/* 軸: レース・休養日マーカー */}
          <line x1={pad} y1={axisY} x2={w - pad} y2={axisY} stroke="var(--border)" />
          {days.map((d, i) =>
            d.isRace ? (
              <circle key={`race-${i}`} cx={px(i)} cy={axisY} r={3} fill="var(--forge)" />
            ) : null
          )}
          {days
            .map((d, i) => (i % Math.ceil(n / 6) === 0 ? (
              <text key={`x-${i}`} x={px(i)} y={totalH - 2} fontSize="8" textAnchor="middle" fill="var(--text-3)">
                {d.date.slice(5)}
              </text>
            ) : null))}
        </svg>
      </div>
      <p className="text-[10.5px] mt-2 leading-relaxed" style={{ color: "var(--text-3)" }}>
        上から: 負荷（灰棒）とACWR（緑線）／睡眠・脚疲労・張り（点。アンバーは要注意の値）／安静時心拍。
        黄・赤の背景はその日のシグナル、灰色の背景は休養日、軸上の緑丸はレース日。
      </p>
    </Card>
  );
}

/**
 * G: 同一処方の経時比較
 *
 * 平均タイムと垂れ幅を必ず別々に出す。
 * 平均が速くなっていても垂れ幅が広がっていれば、
 * それは1本目を突っ込んだだけで後半維持は悪化している。
 */
function SamePrescriptionCard({ groups }: { groups: any[] }) {
  const [idx, setIdx] = useState(0);
  if (!groups || groups.length === 0) {
    return (
      <Card title="同じ処方の推移">
        <p className="text-[11.5px] leading-relaxed" style={{ color: "var(--text-3)" }}>
          同じ内容の練習（カテゴリ・1本の距離・本数が一致するもの）を2回以上こなすと、
          平均タイムと垂れ幅の推移がここに出ます。800mの後半維持が改善しているかは、
          平均タイムより垂れ幅の変化に表れます。
        </p>
      </Card>
    );
  }
  const g = groups[Math.min(idx, groups.length - 1)];
  const trendColor = (j: string) =>
    j === "improving" ? "var(--forge)" : j === "worsening" ? "var(--amber)" : "var(--text-2)";

  return (
    <Card title="同じ処方の推移">
      {groups.length > 1 ? (
        <select
          className="!text-[12px] mb-2.5 w-full"
          value={idx}
          onChange={(e) => setIdx(Number(e.target.value))}
        >
          {groups.map((x: any, i: number) => (
            <option key={i} value={i}>
              {x.label}（{x.occurrences.length}回）
            </option>
          ))}
        </select>
      ) : (
        <p className="text-[13px] font-semibold mb-2">{g.label}</p>
      )}

      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <div className="metric-label mb-1">平均タイム</div>
          <div className="metric" style={{ color: trendColor(g.avgTrend.judgement) }}>
            {g.occurrences[g.occurrences.length - 1].avgSec.toFixed(1)}
            <span className="text-[11px] font-semibold" style={{ color: "var(--text-3)" }}>
              {" "}秒
            </span>
          </div>
        </div>
        <div>
          <div className="metric-label mb-1">垂れ幅（最終本−1本目）</div>
          <div className="metric" style={{ color: trendColor(g.fadeTrend.judgement) }}>
            {g.occurrences[g.occurrences.length - 1].fadeSec > 0 ? "+" : ""}
            {g.occurrences[g.occurrences.length - 1].fadeSec.toFixed(1)}
            <span className="text-[11px] font-semibold" style={{ color: "var(--text-3)" }}>
              {" "}秒
            </span>
          </div>
        </div>
      </div>

      <p className="text-[11.5px] leading-relaxed mb-1" style={{ color: trendColor(g.avgTrend.judgement) }}>
        {g.avgTrend.message}
      </p>
      <p className="text-[11.5px] leading-relaxed mb-1" style={{ color: trendColor(g.fadeTrend.judgement) }}>
        {g.fadeTrend.message}
      </p>
      {/* Q-1: 心拍は任意項目なので、入っている回が2回以上あるときだけ出す */}
      <p
        className="text-[11.5px] leading-relaxed mb-3"
        style={{
          color:
            g.hrTrend && g.hrTrend.judgement !== "insufficient_data"
              ? trendColor(g.hrTrend.judgement)
              : "var(--text-3)",
        }}
      >
        {g.hrTrend?.message ?? "同じ処方で心拍を2回以上入れると、心拍の推移が出ます。"}
      </p>

      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr style={{ color: "var(--text-3)" }}>
              <th className="text-left py-1">実施日</th>
              <th className="text-right">平均</th>
              <th className="text-right">1本目</th>
              <th className="text-right">最終本</th>
              <th className="text-right">垂れ</th>
              <th className="text-right">心拍</th>
              <th className="text-right">ピッチ</th>
              <th className="text-right">RPE</th>
              <th className="text-right">翌日脚</th>
              <th className="text-right">レスト</th>
              <th className="text-right">気温</th>
            </tr>
          </thead>
          <tbody>
            {g.occurrences.map((o: any, i: number) => (
              <tr key={i} className="border-t" style={{ borderColor: "var(--border)" }}>
                <td className="py-1 num">
                  {o.date.slice(5)}
                  {o.heatFlagged ? (
                    <span style={{ color: "var(--amber)" }} title="暑熱条件">
                      {" "}△
                    </span>
                  ) : null}
                </td>
                <td className="text-right num">{o.avgSec.toFixed(1)}</td>
                <td className="text-right num">{o.firstSec.toFixed(1)}</td>
                <td className="text-right num">{o.lastSec.toFixed(1)}</td>
                <td className="text-right num" style={{ color: o.fadeSec > 1.5 ? "var(--amber)" : undefined }}>
                  {o.fadeSec > 0 ? "+" : ""}
                  {o.fadeSec.toFixed(1)}
                </td>
                <td className="text-right num">
                  {o.avgHr !== undefined ? Math.round(o.avgHr) : "-"}
                </td>
                <td className="text-right num" style={{ color: "var(--text-3)" }}>
                  {o.avgCadenceSpm !== undefined ? `${Math.round(o.avgCadenceSpm)}spm` : "-"}
                </td>
                <td className="text-right num" style={{ color: "var(--text-3)" }}>
                  {o.rpe ?? "-"}
                </td>
                <td
                  className="text-right num"
                  style={{
                    color:
                      o.nextDayLegs === "heavy"
                        ? "var(--amber)"
                        : "var(--text-3)",
                  }}
                >
                  {o.nextDayLegs === "heavy"
                    ? "重い"
                    : o.nextDayLegs === "fresh"
                    ? "軽い"
                    : o.nextDayLegs === "normal"
                    ? "普通"
                    : "-"}
                </td>
                <td className="text-right num" style={{ color: "var(--text-3)" }}>
                  {o.restNote ?? "-"}
                </td>
                <td className="text-right num" style={{ color: "var(--text-3)" }}>
                  {o.tempC !== undefined ? `${o.tempC}℃` : "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[10.5px] mt-2" style={{ color: "var(--text-3)" }}>
        △ は暑熱条件下の回です。比較のため除外はしていません。
        レストが違う回は同じ条件ではないので、表の値を見て判断してください。
      </p>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// M-7 制限因子 / M-8 600m通過 / M-10 接地時間
// ---------------------------------------------------------------------------

function useInsights() {
  const [d, setD] = useState<any>(null);
  useEffect(() => {
    fetch("/api/insights")
      .then((r) => r.json())
      .then(setD)
      .catch(() => setD(null));
  }, []);
  return d;
}

function fmtT(sec?: number): string {
  if (sec === undefined) return "-";
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return m > 0 ? `${m}:${s.toFixed(2).padStart(5, "0")}` : s.toFixed(2);
}

/**
 * Q-2 足りていないカテゴリの提案。
 *
 * ホームには出さない。「今日やること」ではなく4週の振り返りなので、
 * ホームの原則（今やるべきことだけ）を崩さないよう分析タブの「現在地」に置く。
 * 固定曜日設定そのものは変えない。入れ替えるのはその週の予定1件だけ。
 */
/**
 * 押した候補ごとの結果。
 *
 * 以前は結果をカード末尾の1行（`msg`）にだけ出していた。
 * 候補は数件ぶん縦に並ぶので、押したボタンから結果までが画面2つぶん離れ、
 * しかもルール違反で止まったときは灰色の一文しか出なかった。
 * 「押しても反応しない」ように見えていたのはこれ。
 * 結果は必ず押したボタンの直下に、止まった理由（ルール名と内容）ごと出す。
 */
type SwapOutcome = {
  ok: boolean;
  message: string;
  violations: { rule: string; message: string }[];
  /** ルール違反で止まった場合だけ、本人の判断で押し切れるようにする */
  canForce: boolean;
};

function CoveragePanel() {
  const [d, setD] = useState<CoverageReview | null>(null);
  const [outcomes, setOutcomes] = useState<Record<string, SwapOutcome>>({});
  const [busy, setBusy] = useState("");

  const load = useCallback(() => {
    fetch("/api/coverage")
      .then((r) => r.json())
      .then((x) => setD(x.review ?? null))
      .catch(() => setD(null));
  }, []);
  useEffect(load, [load]);

  if (!d) return null;

  const apply = async (sessionId: string, category: SessionCategory, force = false) => {
    const key = `${sessionId}:${category}`;
    setBusy(key);
    try {
      const r = await fetch("/api/coverage", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, category, force }),
      });
      const out = await r.json();
      const violations = (out.newViolations ?? []) as { rule: string; message: string }[];
      setOutcomes((prev) => ({
        ...prev,
        [key]: {
          ok: out.applied === true,
          message: out.applied
            ? force
              ? "入れ替えました（警告を承知のうえ）。固定曜日の設定は変えていません。"
              : "入れ替えました。固定曜日の設定は変えていません。"
            : (out.error ?? "入れ替えできませんでした"),
          violations,
          canForce: out.applied !== true && violations.length > 0,
        },
      }));
      if (out.review) setD(out.review);
    } catch (e) {
      setOutcomes((prev) => ({
        ...prev,
        [key]: {
          ok: false,
          message: `通信できませんでした: ${String(e)}`,
          violations: [],
          canForce: false,
        },
      }));
    } finally {
      setBusy("");
    }
  };

  const top = (d.proposals ?? [])[0];

  /*
   * もう候補一覧に無いのに結果だけ残っているもの＝入れ替えが通ったぶん。
   * 行が消えても、何をしたのかは画面に残す。
   */
  const candidateKeys = new Set(
    (d.proposals ?? []).flatMap((p) => p.candidates.map((c) => `${c.sessionId}:${p.category}`))
  );
  const doneOutcomes = Object.entries(outcomes).filter(
    ([key, outcome]) => outcome.ok && !candidateKeys.has(key)
  );

  return (
    <Card title="4週間のバランス">
      {/*
        S-12: 表だけ出しても何を見ればいいのか伝わらない。
        「何のための画面か」「で、どうするのか」を先に書く。
      */}
      <p className="text-[11.5px] leading-relaxed mb-2.5" style={{ color: "var(--text-3)" }}>
        予定と実施を分け、週ごとの量・高負荷・回復・中止傾向を確認します。
        距離だけで異なる刺激を同じ負荷とはみなさず、実施負荷とカテゴリ回数も併記します。
        <b style={{ color: "var(--text-2)" }}>
          {" "}
          今日の設定を変える話（ホームの「今日の設定」）とは別で、こちらは1か月の組み立ての話です。
        </b>
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
        <div className="rounded-lg p-2" style={{ background: "var(--surface-2)" }}>
          <div className="metric-label">実施距離 / 予定</div>
          <div className="text-[14px] num">
            {d.balance.totalCompletedDistanceKm.toFixed(1)} / {d.balance.totalPlannedDistanceKm.toFixed(1)}km
          </div>
        </div>
        <div className="rounded-lg p-2" style={{ background: "var(--surface-2)" }}>
          <div className="metric-label">実施率</div>
          <div className="text-[14px] num">
            {d.balance.adherencePct === undefined ? "記録不足" : `${d.balance.adherencePct}%`}
          </div>
        </div>
        <div className="rounded-lg p-2" style={{ background: "var(--surface-2)" }}>
          <div className="metric-label">完了した高負荷日</div>
          <div className="text-[14px] num">{d.balance.totalHighLoadDays}日</div>
        </div>
        <div className="rounded-lg p-2" style={{ background: "var(--surface-2)" }}>
          <div className="metric-label">回復・完全休養</div>
          <div className="text-[14px] num">{d.balance.totalRecoveryDays}日</div>
        </div>
      </div>

      <div className="overflow-x-auto mb-3">
        <table className="w-full text-[11px]">
          <thead>
            <tr style={{ color: "var(--text-3)" }}>
              <th className="text-left py-1">週</th>
              <th className="text-right">距離 実/予</th>
              <th className="text-right">高負荷</th>
              <th className="text-right">実施率</th>
              <th className="text-right">変更/中止/未達/未実施</th>
            </tr>
          </thead>
          <tbody>
            {d.balance.weeks.map((week) => (
              <tr key={week.weekStart} className="border-t" style={{ borderColor: "var(--border)" }}>
                <td className="py-1 num">{week.weekStart.slice(5).replace("-", "/")}〜</td>
                <td className="text-right num">
                  {week.completedDistanceKm.toFixed(1)}/{week.plannedDistanceKm.toFixed(1)}
                </td>
                <td className="text-right num">{week.highLoadDays}</td>
                <td className="text-right num">
                  {week.adherencePct === undefined ? "-" : `${week.adherencePct}%`}
                </td>
                <td className="text-right num">
                  {week.modifiedSessions}/{week.skippedSessions}/{week.unmetSessions}/{week.overdueSessions}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5 mb-3 text-[11px]">
        <div>高乳酸・解糖系 <b className="num">{d.balance.totalGlycolytic}</b></div>
        <div>中距離特異的 <b className="num">{d.balance.totalMiddleDistanceSpecific}</b></div>
        <div>有酸素高強度 <b className="num">{d.balance.totalAerobicHigh}</b></div>
        <div>ロング走 <b className="num">{d.balance.totalLongRuns}</b></div>
        <div>回復日 <b className="num">{d.balance.totalRecoveryDays}</b></div>
      </div>

      {d.balance.raceProgress ? (
        <p className="text-[11.5px] mb-3" style={{ color: "var(--text-2)" }}>
          レースまで <b className="num">{d.balance.raceProgress.daysToRace}日</b>
          {" "}／ 現在 {d.balance.raceProgress.phase}期
        </p>
      ) : null}

      {d.balance.signals.map((signal) => (
        <div
          key={`${signal.code}-${signal.dates.join("-")}`}
          className="rounded-lg p-2.5 mb-2"
          style={{
            background: "var(--surface-2)",
            border: signal.level === "warn" ? "1px solid var(--amber)" : "1px solid var(--border)",
          }}
        >
          <p className="text-[12px] leading-relaxed font-semibold">{signal.message}</p>
          <p className="text-[11.5px] leading-relaxed mt-1" style={{ color: "var(--text-2)" }}>
            次の行動: {signal.action}
          </p>
        </div>
      ))}

      {/* おすすめを1つだけ先に出す。表を読んでから考えさせない */}
      <div
        className="rounded-lg p-2.5 mb-3"
        style={{ background: "var(--surface-2)" }}
      >
        <div className="metric-label mb-1">おすすめ</div>
        {top ? (
          <>
            <div className="text-[14px] font-semibold leading-snug mb-1">
              {COVERAGE_JP[top.category] ?? top.category}を あと{top.shortfall}回 増やす
            </div>
            <p className="text-[11.5px] leading-relaxed" style={{ color: "var(--text-2)" }}>
              {top.reason}
            </p>
          </>
        ) : (
          <div className="text-[13px] font-semibold leading-snug">
            いまの配分で足りています。変える必要はありません
          </div>
        )}
      </div>

      <div className="overflow-x-auto mb-3">
        <table className="w-full text-[11px]">
          <thead>
            <tr style={{ color: "var(--text-3)" }}>
              <th className="text-left py-1">種類</th>
              <th className="text-right">やった</th>
              <th className="text-right">目安</th>
              <th className="text-right">不足</th>
            </tr>
          </thead>
          <tbody>
            {d.targets.map((t) => (
              <tr key={t.category} className="border-t" style={{ borderColor: "var(--border)" }}>
                <td className="py-1">{COVERAGE_JP[t.category] ?? t.category}</td>
                <td className="text-right num">{t.actual}</td>
                <td className="text-right num">{t.wanted}</td>
                <td
                  className="text-right num"
                  style={{ color: t.shortfall >= 2 ? "var(--amber)" : "var(--text-3)" }}
                >
                  {t.shortfall > 0 ? `-${t.shortfall}` : "±0"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/*
        入れ替えが**通った**予定は、もう提案の候補ではなくなるので行ごと消える。
        結果の一文は行の内側に出していたので、一緒に消えていた——
        押した本人からは「押したのに何も起きない」に見える（止まったときだけ文が残る）。
        消えた行のぶんはここに残す。
      */}
      {doneOutcomes.length > 0 ? (
        <div className="mb-2">
          {doneOutcomes.map(([key, outcome]) => (
            <StatusText key={key} kind="success" className="text-[11.5px] leading-relaxed">
              {outcome.message}
            </StatusText>
          ))}
        </div>
      ) : null}

      {d.proposals.length > 0 ? (
        <div className="metric-label mb-1">入れ替えるなら</div>
      ) : null}
      {d.proposals.map((p) => (
        <div
          key={p.category}
          className="border-t pt-2.5 mt-2.5"
          style={{ borderColor: "var(--border)" }}
        >
          <p className="text-[12px] leading-relaxed mb-2">{p.reason}</p>
          {p.note ? (
            <p className="text-[11.5px] leading-relaxed" style={{ color: "var(--text-3)" }}>
              {p.note}
            </p>
          ) : null}
          {p.candidates.map((c) => {
            const key = `${c.sessionId}:${p.category}`;
            const outcome = outcomes[key];
            const pending = busy === key;
            /*
             * data-candidate は E2E 用の目印。
             * 「結果が押したボタンの直下に出る」ことを、カード全体ではなく
             * この候補の内側だけを読んで確かめるために要る。
             * カード全体を読む検査だと、結果がカード末尾に出る（＝直したかった状態）
             * でも通ってしまい、何も見ていない検査になる。
             */
            return (
              <div key={c.sessionId} className="mb-2" data-candidate={key}>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[11.5px] num" style={{ color: "var(--text-2)" }}>
                    {c.date.slice(5).replace("-", "/")} {c.name}
                  </span>
                  <button
                    className="btn-ghost !text-[11.5px] !py-1.5"
                    disabled={busy !== ""}
                    onClick={() => apply(c.sessionId, p.category)}
                  >
                    {pending ? "確認中…" : `${COVERAGE_JP[p.category] ?? p.category}に替える`}
                  </button>
                </div>
                {c.cost ? (
                  <StatusText kind="warning" className="text-[11px] leading-relaxed mt-1">
                    {c.cost}
                  </StatusText>
                ) : null}
                {outcome ? (
                  <div className="mt-1.5">
                    <StatusText
                      kind={outcome.ok ? "success" : "error"}
                      className="text-[11.5px] leading-relaxed"
                    >
                      {outcome.message}
                    </StatusText>
                    {outcome.violations.map((v, i) => (
                      <StatusText
                        key={i}
                        kind="error"
                        className="text-[11px] leading-relaxed mt-0.5"
                      >
                        {v.rule}: {v.message}
                      </StatusText>
                    ))}
                    {outcome.canForce ? (
                      <button
                        className="btn-ghost !text-[11.5px] !py-1.5 mt-1.5"
                        style={{ color: "var(--amber)" }}
                        disabled={busy !== ""}
                        onClick={() => apply(c.sessionId, p.category, true)}
                      >
                        承知のうえで替える
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ))}
    </Card>
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
 * 畳める補足。
 *
 * `<details>` を使わないのは、閉じていても中身が箱として残り、
 * 画面最下部の要素がタブバーの裏に入るため（E2EのP-4が捕まえた）。
 * 閉じているあいだは DOM から外す。
 */
function Collapsible({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={className}>
      <button
        className="text-[11.5px] text-left"
        aria-expanded={open}
        style={{ color: "var(--text-3)" }}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? "▾ " : "▸ "}
        {label}
      </button>
      {open ? children : null}
    </div>
  );
}

interface SecRange {
  fastSec: number;
  slowSec: number;
}

/**
 * 400m側・1500m側の妥当域と、いまのPB・目標を1本の数直線に並べる。
 *
 * 「400mから見た妥当域 1:48.00〜1:51.00」「1500mから見た 1:48.09〜1:50.59」と
 * 数字を2つ置いても、PBがその中のどこにいるのか、目標が域の内側なのかは
 * 読み取れない。同じ軸に置けば、どちら側から外れているかが一目で分かる。
 *
 * 軸は表示する値の実測の最小・最大から取る（固定幅にしない）。
 * 妥当域は数秒の幅しかないので、固定幅だと全部が同じ位置に潰れる。
 */
function LimiterScale({
  from400,
  from1500,
  pb800Sec,
  targetSec,
}: {
  from400?: SecRange;
  from1500?: SecRange;
  pb800Sec: number;
  targetSec?: number;
}) {
  const values = [pb800Sec];
  if (targetSec !== undefined) values.push(targetSec);
  for (const r of [from400, from1500]) {
    if (r) values.push(r.fastSec, r.slowSec);
  }
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  // 端に貼りつかないよう、幅の8%を左右に足す。幅0（値が1つ）でも割り算が壊れないようにする
  const pad = Math.max(0.3, (hi - lo) * 0.08);
  const min = lo - pad;
  const span = hi - lo + pad * 2;
  const at = (sec: number) => ((sec - min) / span) * 100;

  const rows: { label: string; range?: SecRange }[] = [
    { label: "400mから", range: from400 },
    { label: "1500mから", range: from1500 },
  ].filter((r) => r.range !== undefined);

  return (
    <div className="mt-3">
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-2 mb-1.5">
          <span className="text-[10px] w-[52px] flex-shrink-0" style={{ color: "var(--text-3)" }}>
            {r.label}
          </span>
          <span
            className="relative flex-1 min-w-0 h-[6px] rounded-full"
            style={{ background: "var(--surface-3)" }}
          >
            <i
              className="absolute top-0 h-full rounded-full"
              style={{
                left: `${at(r.range!.fastSec)}%`,
                width: `${at(r.range!.slowSec) - at(r.range!.fastSec)}%`,
                background: "rgba(182,255,0,.28)",
              }}
            />
            {/* いまのPB。妥当域の中か外かが、この点の位置で分かる */}
            <i
              className="absolute top-[-2px] w-[2px] h-[10px] rounded-full"
              style={{ left: `${at(pb800Sec)}%`, background: "var(--text)" }}
            />
            {targetSec !== undefined ? (
              <i
                className="absolute top-[-2px] w-[2px] h-[10px] rounded-full"
                style={{ left: `${at(targetSec)}%`, background: "var(--forge)" }}
              />
            ) : null}
          </span>
          <span className="num text-[10.5px] w-[86px] text-right flex-shrink-0" style={{ color: "var(--text-3)" }}>
            {fmtT(r.range!.fastSec)}〜{fmtT(r.range!.slowSec)}
          </span>
        </div>
      ))}
      <div className="flex gap-3 pl-[60px] mt-1 text-[10px]" style={{ color: "var(--text-3)" }}>
        <span>
          <i className="inline-block w-[2px] h-[8px] align-middle mr-1" style={{ background: "var(--text)" }} />
          PB {fmtT(pb800Sec)}
        </span>
        {targetSec !== undefined ? (
          <span>
            <i className="inline-block w-[2px] h-[8px] align-middle mr-1" style={{ background: "var(--forge)" }} />
            目標 {fmtT(targetSec)}
          </span>
        ) : null}
        <span>帯 = 妥当域</span>
      </div>
    </div>
  );
}

interface HrLine {
  date: string;
  verdict: string;
  note: string;
  bpm?: number;
  pct?: number;
  band?: { min: number; max: number };
  blockedReason?: string;
}

/*
 * 心拍の相対強度の軸。%HRmaxで60〜100だけを描く。
 * 0から描くと帯（65〜97%）が右端に潰れて、狙いから外れているかが見えない。
 * ジョグの下限が65%なので、60を下端にすれば「下に外れた」も表示に入る。
 */
const HR_AXIS_MIN = 60;
const HR_AXIS_MAX = 100;
const hrAxis = (pct: number) =>
  Math.max(0, Math.min(100, ((pct - HR_AXIS_MIN) / (HR_AXIS_MAX - HR_AXIS_MIN)) * 100));

const HR_VERDICT_LABEL: Record<string, string> = {
  in_band: "狙い通り",
  below: "弱い",
  above: "強い",
};

/**
 * 心拍1日ぶん。
 *
 * 以前は判定文（一文）をそのまま縦に並べていた。同じ言い回しが8日ぶん続くので、
 * 「どの日が狙いから外れているか」を知るのに全部読む必要があった。
 * 狙いの帯を線で描き、その上に実測の位置を打つ。外れている日は目で分かる。
 * 文は畳んで残す（理由まで読みたいときのため。捨ててはいない）。
 */
function HrRow({ line }: { line: HrLine }) {
  const [open, setOpen] = useState(false);
  const judged = line.pct !== undefined && line.band !== undefined;
  const color =
    line.verdict === "in_band"
      ? "var(--forge)"
      : line.verdict === "below" || line.verdict === "above"
      ? "var(--amber)"
      : "var(--text-3)";

  return (
    <div className="py-1.5 border-b last:border-b-0" style={{ borderColor: "var(--border)" }}>
      <button
        className="flex items-center gap-2 w-full text-left"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="num text-[11px] w-[34px] flex-shrink-0" style={{ color: "var(--text-3)" }}>
          {line.date.slice(5).replace("-", "/")}
        </span>
        {judged ? (
          <>
            <span className="num text-[13px] font-bold w-[42px] flex-shrink-0">
              {line.bpm}
              <span className="text-[9px] font-normal" style={{ color: "var(--text-3)" }}>
                bpm
              </span>
            </span>
            {/* 狙いの帯と実測の位置 */}
            <span
              className="relative flex-1 min-w-0 h-[6px] rounded-full"
              style={{ background: "var(--surface-3)" }}
            >
              <i
                className="absolute top-0 h-full rounded-full"
                style={{
                  left: `${hrAxis(line.band!.min)}%`,
                  width: `${hrAxis(line.band!.max) - hrAxis(line.band!.min)}%`,
                  background: "rgba(182,255,0,.22)",
                }}
              />
              <i
                className="absolute top-[-2px] w-[2px] h-[10px] rounded-full"
                style={{ left: `${hrAxis(line.pct!)}%`, background: color }}
              />
            </span>
            <span className="num text-[11.5px] w-[30px] text-right flex-shrink-0" style={{ color }}>
              {line.pct!.toFixed(0)}%
            </span>
            <span className="text-[10px] w-[44px] text-right flex-shrink-0" style={{ color }}>
              {HR_VERDICT_LABEL[line.verdict] ?? ""}
            </span>
          </>
        ) : (
          <span className="flex-1 text-[11px]" style={{ color: "var(--text-3)" }}>
            {line.blockedReason ?? "判定できません"}
          </span>
        )}
      </button>
      {open ? (
        <p className="text-[11px] leading-relaxed mt-1 pl-[34px]" style={{ color: "var(--text-3)" }}>
          {line.note}
        </p>
      ) : null}
    </div>
  );
}

function GapPanel() {
  const d = useInsights();
  if (!d) return <p className="text-[13px]">読み込み中…</p>;
  if (d.empty) return <Card><p className="text-[12px]">プロフィールを登録すると出ます。</p></Card>;

  const lim = d.limiter?.assessment;
  const split = d.split;
  const contact = d.contact;

  return (
    <div className="grid md:grid-cols-2 gap-3">
      <Card title="制限因子">
        {lim ? (
          <>
            <div className="metric-label">いま足りていないのは</div>
            <div className="metric" style={{ fontSize: 26 }}>
              {LIMITER_JP[lim.limiter] ?? lim.limiter}
            </div>
            {/*
              妥当域とPB・目標を同じ数直線に置く。
              以前は「1:48.00〜1:51.00」という2つの数字と、それを言い直した
              長い文だけだった。数字の並びからは、PBがその中のどこにいるのか、
              目標が域の内側なのか外側なのかが読み取れない。
            */}
            <LimiterScale
              from400={lim.from400}
              from1500={lim.from1500}
              pb800Sec={lim.pb800Sec}
              targetSec={d.limiter.targetSec}
            />
            {/* 根拠の文は畳む。同じ数字を言い直しているので毎回は読まない */}
            <Collapsible label="この判定の根拠" className="mt-2.5">
              <p className="text-[12px] leading-relaxed mt-1.5" style={{ color: "var(--text-2)" }}>
                {lim.narrative}
              </p>
            </Collapsible>
            <p className="text-[11.5px] leading-relaxed mt-2" style={{ color: "var(--text-3)" }}>
              {d.limiter.appliedNote}
            </p>
          </>
        ) : null}
      </Card>

      <Card title="600m通過からの残り200m">
        {split?.enough ? (
          <>
            <div className="grid grid-cols-2 gap-2 mb-2.5">
              <div>
                <div className="metric-label">直近の600m通過</div>
                <div className="text-[18px] font-bold num">{fmtT(split.latest?.pass600Sec)}</div>
                <div className="text-[11px] num" style={{ color: "var(--text-3)" }}>
                  基準比 {split.pass600GapSec >= 0 ? "+" : ""}
                  {split.pass600GapSec?.toFixed(1)}秒
                </div>
              </div>
              <div>
                <div className="metric-label">残り200m</div>
                <div className="text-[18px] font-bold num">
                  {split.latest?.last200Sec !== undefined ? split.latest.last200Sec.toFixed(1) : "-"}
                </div>
                <div className="text-[11px] num" style={{ color: "var(--text-3)" }}>
                  {split.last200GapSec !== undefined
                    ? `基準比 ${split.last200GapSec >= 0 ? "+" : ""}${split.last200GapSec.toFixed(1)}秒`
                    : ""}
                </div>
              </div>
            </div>
            <div className="flex flex-col gap-1 mb-2.5">
              {split.samples.map((s: any) => (
                <div key={s.date + s.pass600Sec} className="text-[11.5px] num flex justify-between">
                  <span style={{ color: "var(--text-3)" }}>{s.date.slice(5).replace("-", "/")}</span>
                  <span>
                    {fmtT(s.pass600Sec)}
                    {s.last200Sec !== undefined ? ` → ${s.last200Sec.toFixed(1)}` : ""}
                    {s.estimated ? " (推定)" : ""}
                  </span>
                </div>
              ))}
            </div>
            {/*
              上の表と同じ数字を文にし直したもの。毎回は読まないので畳む。
              材料が足りないとき（下の分岐）は**畳まない**——
              あれは「何を入れれば出せるか」を伝える文で、初めて見る内容だから。
            */}
            <Collapsible label="この判定の根拠" className="mt-1">
              <p
                className="text-[12px] leading-relaxed mt-1.5"
                style={{ color: "var(--text-2)" }}
              >
                {split.narrative}
              </p>
            </Collapsible>
          </>
        ) : (
          <p className="text-[12px] leading-relaxed" style={{ color: "var(--text-2)" }}>
            {split?.narrative}
          </p>
        )}
      </Card>

      <Card title="接地時間">
        <p
          className="text-[12px] leading-relaxed"
          style={{ color: contact?.fatigued ? "var(--amber)" : "var(--text-2)" }}
        >
          {contact?.narrative}
        </p>
      </Card>

      {/*
        R-1: 心拍が何に効いているかを画面で確かめられるようにする。
        「保存されているか」ではなく「使われているか」を見るための枠なので、
        心拍が無い記録は判定できないと出す（空欄を良い状態として扱わない）。
      */}
      <Card title="心拍の使われ方">
        <p className="text-[11.5px] leading-relaxed mb-2.5" style={{ color: "var(--text-3)" }}>
          {d.hr?.reference?.note ??
            "最大心拍の基準がありません。プロフィールに入れるか、最大心拍つきの記録を1件入れると相対強度が出ます。"}
        </p>
        {(d.hr?.lines ?? []).length === 0 ? (
          <p className="text-[12px]" style={{ color: "var(--text-2)" }}>
            記録がまだありません。
          </p>
        ) : (
          <div className="flex flex-col">
            {(d.hr.lines ?? []).map((l: HrLine, i: number) => (
              <HrRow key={i} line={l} />
            ))}
          </div>
        )}
        {(d.hr?.heat ?? []).length > 0 ? (
          <div className="border-t mt-2.5 pt-2.5" style={{ borderColor: "var(--border)" }}>
            <div className="metric-label mb-1">暑熱の切り分け</div>
            {(d.hr.heat ?? []).map((l: any, i: number) => (
              <p
                key={i}
                className="text-[11.5px] leading-relaxed mb-1"
                style={{ color: l.supported ? "var(--amber)" : "var(--text-3)" }}
              >
                <span className="num">{l.date.slice(5).replace("-", "/")}</span> {l.note}
              </p>
            ))}
          </div>
        ) : null}
      </Card>
    </div>
  );
}

const LIMITER_JP: Record<string, string> = {
  speed: "絶対スピード",
  endurance: "後半の維持",
  balanced: "どちらも大きくは外れていない",
  unknown: "判定できません",
};

// ---------------------------------------------------------------------------
// M-11 週次レビュー
// ---------------------------------------------------------------------------

function ReviewPanel() {
  const d = useInsights();
  const [copied, setCopied] = useState(false);
  /*
   * 本文は閉じているあいだ DOM から外す。
   * `<details>` で畳むと、閉じていても中身が箱として残り、
   * 最下部がタブバーの裏に入る（E2EのP-4が捕まえた）。
   */
  const [openText, setOpenText] = useState(false);
  if (!d) return <p className="text-[13px]">読み込み中…</p>;
  if (d.empty) return <Card><p className="text-[12px]">プロフィールを登録すると出ます。</p></Card>;
  const rev = d.review;

  return (
    <Card title={`週次レビュー（${rev.weekStart} 〜 ${rev.weekEnd}）`}>
      <p className="text-[11.5px] mb-2.5" style={{ color: "var(--text-3)" }}>
        そのまま指導者に見せられる形にしてあります。数字は実測です。
      </p>
      {/*
        本文は畳んでおく。これは指導者に渡すための文章であって、
        毎回この画面で読むものではない。開かず「コピーする」だけで用が足りるので、
        分析タブを縦にスクロールするときの障害物にしない。
      */}
      <button
        className="btn-ghost !text-[12px] !py-1"
        aria-expanded={openText}
        onClick={() => setOpenText((v) => !v)}
      >
        {openText ? "本文を閉じる" : `本文を読む（${rev.text.length}字）`}
      </button>
      {openText ? (
        <div
          className="rounded-lg p-3 mt-2 text-[12.5px] leading-relaxed whitespace-pre-wrap"
          style={{ background: "var(--surface-2)", color: "var(--text)" }}
        >
          {rev.text}
        </div>
      ) : null}
      <button
        className="btn-ghost mt-2.5"
        onClick={() => {
          navigator.clipboard?.writeText(rev.text);
          setCopied(true);
        }}
      >
        {copied ? "コピーしました" : "コピーする"}
      </button>
    </Card>
  );
}
