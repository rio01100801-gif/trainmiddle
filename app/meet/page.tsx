"use client";
import { useEffect, useState } from "react";
import { Card, fmtSec } from "../components/ui";
import { planHeatPace, recoveryProtocol, taperAnchor } from "@/lib/core/rounds";
import { raceDayHeatChecklist } from "@/lib/core/heat";
import type { Athlete, Goal, Race } from "@/lib/core/types";

export default function MeetPage() {
  const [racePlan, setRacePlan] = useState<any | null>(null);
  const [races, setRaces] = useState<Race[]>([]);
  const [goal, setGoal] = useState<Goal | null>(null);
  const [athlete, setAthlete] = useState<Athlete | null>(null);
  const [raceId, setRaceId] = useState("");
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    fetch("/api/goal").then((r) => r.json()).then((d) => {
      setRaces(d.races ?? []);
      setGoal(d.goal ?? null);
      if (d.goal) setRaceId(d.goal.targetRaceId);
      else if (d.races?.[0]) setRaceId(d.races[0].id);
    });
    fetch("/api/athlete").then((r) => r.json()).then((d) => setAthlete(d.athlete));
    fetch("/api/dashboard")
      .then((r) => r.json())
      .then((d) => setRacePlan(d.racePlan ?? null))
      .catch(() => {});
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);

  const race = races.find((r) => r.id === raceId);
  if (!race || !goal) {
    return <Card><p className="text-sm">目標・レースを設定すると大会モードが使えます。</p></Card>;
  }

  const rounds = [...race.rounds].sort((a, b) => a.datetime.localeCompare(b.datetime));
  const nextRound = rounds.find((r) => new Date(r.datetime).getTime() > now.getTime());
  const heatPlan = planHeatPace(race, goal.targetTimeSec);
  const anchor = taperAnchor(race);
  const checklist = athlete ? raceDayHeatChecklist(athlete, 30) : undefined;

  const roundLabel: Record<string, string> = { heat: "予選", semifinal: "準決勝", final: "決勝" };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2 items-center mb-3">
        <select className="text-sm w-full md:w-auto max-w-full" value={raceId} onChange={(e) => setRaceId(e.target.value)}>
          {races.map((r) => (
            <option key={r.id} value={r.id}>{r.name}（{r.dateStart}）</option>
          ))}
        </select>
      </div>

      <RacePlanCard plan={racePlan} />

      <Card title="次のラウンド">
        {nextRound ? (
          <div>
            <p className="text-lg font-bold num">
              {roundLabel[nextRound.type]} — {new Date(nextRound.datetime).toLocaleString("ja-JP")}
            </p>
            <p className="text-sm">
              残り約 {Math.max(0, Math.round((new Date(nextRound.datetime).getTime() - now.getTime()) / 3600000))} 時間
            </p>
            {nextRound.expectedPaceSec ? (
              <p className="text-sm mt-1">想定タイム: <b>{fmtSec(nextRound.expectedPaceSec)}</b></p>
            ) : null}
          </div>
        ) : (
          <p className="text-sm">全ラウンド終了、またはラウンド日時が未設定です。</p>
        )}
      </Card>

      {heatPlan ? (
        <Card title="予選の走り方（4-7-1）">
          <p className="text-sm">
            想定: <b>{fmtSec(heatPlan.expectedTimeSec)}</b>（前半 {heatPlan.lapFront400Sec.toFixed(1)} / 後半 {heatPlan.lapBack400Sec.toFixed(1)}）
          </p>
          <p className="text-sm mt-1">{heatPlan.upperLimitNote}</p>
          <p className="text-sm">{heatPlan.reserveNote}</p>
          {heatPlan.conditionalNote ? <p className="text-sm mt-1">{heatPlan.conditionalNote}</p> : null}
        </Card>
      ) : null}

      <Card title="ラウンド間の回復プロトコル（4-7-2）">
        {rounds.length >= 2 ? (
          rounds.slice(1).map((r, i) => {
            const prev = rounds[i];
            const gap = Math.round(
              (new Date(r.datetime.slice(0, 10)).getTime() - new Date(prev.datetime.slice(0, 10)).getTime()) / 86400000
            );
            return (
              <div key={i} className="mb-2">
                <p className="text-sm font-semibold">
                  {roundLabel[prev.type]} → {roundLabel[r.type]}（{gap === 0 ? "同日" : `${gap}日後`}）
                </p>
                <ul className="text-sm list-disc pl-5">
                  {recoveryProtocol(gap).map((line, j) => (
                    <li key={j}>{line}</li>
                  ))}
                </ul>
              </div>
            );
          })
        ) : (
          <p className="text-sm">単一ラウンドの大会です。</p>
        )}
        <p className="text-xs mt-1" style={{ color: "var(--text-2)" }}>
          ラウンド間の日に高負荷練習・神経刺激は置けません（RULE-20）。テーパーの基準日は {anchor.peakDate}（{roundLabel[race.peakTargetRound]}）、
          高負荷練習は初戦3日前（{anchor.qualityCutoffDate}）までに完了している必要があります。
        </p>
      </Card>

      <Card title="補給・暑熱チェックリスト">
        <ul className="text-sm list-disc pl-5">
          <li>各ラウンド直後30分以内に糖質+タンパク質を補給する</li>
          <li>ラウンド間は水分と電解質をこまめに（一気飲みしない）</li>
          <li>ウォームダウンはジョグ10分以内に留め、脚を使い切らない</li>
          {(checklist ?? []).map((c, i) => (
            <li key={i}>{c}</li>
          ))}
        </ul>
      </Card>
    </div>
  );
}


/**
 * I: レース配分シミュレータ
 *
 * 本人の実測落ち幅を基準にする。過去レースのラップが足りないときは
 * 案を出さず、何を入れれば出せるかだけを伝える。
 * 根拠のない配分を提示すると、それを信じてレースを壊すことになる。
 */
function RacePlanCard({ plan }: { plan: any | null }) {
  if (!plan) return null;
  const fmt = (v: number) => v.toFixed(1);

  if (plan.blockedReason) {
    return (
      <Card title="レース配分">
        <p className="text-[12px] leading-relaxed" style={{ color: "var(--text-2)" }}>
          {plan.blockedReason}
        </p>
      </Card>
    );
  }

  return (
    <Card title="レース配分">
      <p className="text-[11.5px] mb-3" style={{ color: "var(--text-3)" }}>
        目標 <b className="num" style={{ color: "var(--text-2)" }}>{fmtSec(plan.targetSec)}</b>
        {" ／ 過去"}
        {plan.samples.length}本の平均落ち幅{" "}
        <b className="num" style={{ color: "var(--text-2)" }}>
          +{fmt(plan.measuredFadeSec)}秒
        </b>
      </p>

      <div className="flex flex-col gap-2">
        {plan.options.map((o: any, i: number) => (
          <div
            key={i}
            className="rounded-lg p-3"
            style={{
              background: "var(--surface-2)",
              border: `1px solid ${i === 0 ? "rgba(182,255,0,0.3)" : "var(--border)"}`,
            }}
          >
            <div className="flex items-baseline gap-2 flex-wrap mb-1.5">
              <b className="text-[12.5px]">{o.label}</b>
              <span className="num text-[15px] font-bold">
                {fmt(o.firstSec)} + {fmt(o.secondSec)}
              </span>
              <span className="text-[11px] num" style={{ color: "var(--text-3)" }}>
                （落ち幅 +{fmt(o.fadeSec)}秒）
              </span>
            </div>
            <div className="text-[11.5px] num mb-1.5" style={{ color: "var(--text-2)" }}>
              通過目安 200m {fmt(o.passing200[0])} ／ 400m {fmt(o.passing200[1])} ／ 600m{" "}
              {fmt(o.passing200[2])} ／ 800m {fmt(o.passing200[3])}
            </div>
            <p className="text-[11px] leading-relaxed" style={{ color: "var(--text-3)" }}>
              {o.note}
            </p>
          </div>
        ))}
      </div>

      <p className="text-[10.5px] mt-2.5 leading-relaxed" style={{ color: "var(--text-3)" }}>
        通過目安は前半400を0.485、後半400を0.495で割った概算です。
        風とレース展開で前後するので、目安として使ってください。
      </p>
    </Card>
  );
}
