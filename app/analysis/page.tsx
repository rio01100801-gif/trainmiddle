"use client";
import { useEffect, useState } from "react";
import { Card, CATEGORY_COLORS, CATEGORY_LABELS, fmtSec } from "../components/ui";
import RaceAnalysis from "../race/page";

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
    <div className="flex flex-col gap-3">
      {/*
        B-2: レース分析を分析タブのセグメントとして統合する。
        あわせて既存の6カードもセグメントに振り分け、1画面に縦積みするのをやめた
        （現行は目的のグラフまでスクロールが要った）。
      */}
      <div className="seg">
        {ANALYSIS_SEGMENTS.map((x) => (
          <button key={x.key} data-on={seg === x.key ? "1" : "0"} onClick={() => setSeg(x.key)}>
            {x.label}
          </button>
        ))}
      </div>

      {seg === "race" ? <RaceAnalysis /> : null}
      {seg === "now" ? <GapPanel /> : null}
      {seg === "now" ? <ReviewPanel /> : null}

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
          <p className="text-sm mt-1">
            現在のACWR: <b>{data.acwrNow.acwr?.toFixed(2) ?? "-"}</b>（{data.acwrNow.rating}） {data.acwrNow.note}
          </p>
        ) : null}
        <p className="text-xs" style={{ color: "var(--text-2)" }}>
          上: 日次負荷 ／ 下: ACWR。ACWRは単独で判断せず、信号機・CFE・主観と併せて確認してください。
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
      <p className="text-[11.5px] leading-relaxed mb-3" style={{ color: trendColor(g.fadeTrend.judgement) }}>
        {g.fadeTrend.message}
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
            <div className="grid grid-cols-2 gap-2 mt-3 mb-2.5">
              <div>
                <div className="metric-label">400mから見た妥当域</div>
                <div className="text-[13px] num">
                  {lim.from400 ? `${fmtT(lim.from400.fastSec)}〜${fmtT(lim.from400.slowSec)}` : "-"}
                </div>
              </div>
              <div>
                <div className="metric-label">1500mから見た妥当域</div>
                <div className="text-[13px] num">
                  {lim.from1500 ? `${fmtT(lim.from1500.fastSec)}〜${fmtT(lim.from1500.slowSec)}` : "-"}
                </div>
              </div>
            </div>
            <p className="text-[12px] leading-relaxed" style={{ color: "var(--text-2)" }}>
              {lim.narrative}
            </p>
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
            <p className="text-[12px] leading-relaxed" style={{ color: "var(--text-2)" }}>
              {split.narrative}
            </p>
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
  if (!d) return <p className="text-[13px]">読み込み中…</p>;
  if (d.empty) return <Card><p className="text-[12px]">プロフィールを登録すると出ます。</p></Card>;
  const rev = d.review;

  return (
    <Card title={`週次レビュー（${rev.weekStart} 〜 ${rev.weekEnd}）`}>
      <p className="text-[11.5px] mb-2.5" style={{ color: "var(--text-3)" }}>
        そのまま指導者に見せられる形にしてあります。数字は実測です。
      </p>
      <div
        className="rounded-lg p-3 text-[12.5px] leading-relaxed whitespace-pre-wrap"
        style={{ background: "var(--surface-2)", color: "var(--text)" }}
      >
        {rev.text}
      </div>
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
