"use client";
import { useEffect, useState } from "react";
import { Card, ViolationList } from "../components/ui";
import { localToday } from "@/lib/core/dates";

function parseTime(v: string): number {
  if (v.includes(":")) {
    const [m, s] = v.split(":");
    return Number(m) * 60 + Number(s);
  }
  return Number(v);
}

type RoundForm = { type: string; datetime: string };

export default function GoalPage() {
  const [target, setTarget] = useState("1:48.9");
  const [raceName, setRaceName] = useState("");
  const [dateStart, setDateStart] = useState("");
  const [advance, setAdvance] = useState("place");
  const [border, setBorder] = useState("");
  const [rounds, setRounds] = useState<RoundForm[]>([
    { type: "heat", datetime: "" },
    { type: "final", datetime: "" },
  ]);
  const [subRaces, setSubRaces] = useState<
    { name: string; dateStart: string; priority: string }[]
  >([]);
  const [planStart, setPlanStart] = useState(localToday());
  const [msg, setMsg] = useState("");
  const [violations, setViolations] = useState<any[]>([]);

  useEffect(() => {
    fetch("/api/goal")
      .then((r) => r.json())
      .then(({ goal, races }) => {
        if (goal) {
          const m = Math.floor(goal.targetTimeSec / 60);
          const s = (goal.targetTimeSec - m * 60).toFixed(2);
          setTarget(`${m}:${s}`);
          const main = races.find((r: any) => r.id === goal.targetRaceId);
          if (main) {
            setRaceName(main.name);
            setDateStart(main.dateStart);
            setAdvance(main.advancementRule ?? "place");
            setRounds(
              main.rounds.map((r: any) => ({
                type: r.type,
                datetime: r.datetime.slice(0, 16),
              }))
            );
          }
          setSubRaces(
            races
              .filter((r: any) => r.id !== goal.targetRaceId)
              .map((r: any) => ({ name: r.name, dateStart: r.dateStart, priority: r.priority }))
          );
        }
      });
  }, []);

  const save = async () => {
    if (!dateStart) {
      setMsg("本命レースの開催初日は必須です");
      return;
    }
    const raceId = "race-target";
    const races = [
      {
        id: raceId,
        name: raceName || "本命レース",
        dateStart,
        priority: "A",
        rounds: rounds
          .filter((r) => r.datetime)
          .map((r) => ({ type: r.type, datetime: r.datetime })),
        peakTargetRound: "final",
        advancementRule: advance,
        borderTimeSec: border ? parseTime(border) : undefined,
      },
      ...subRaces
        .filter((s) => s.dateStart)
        .map((s, i) => ({
          id: `race-sub-${i}`,
          name: s.name || `通過点レース${i + 1}`,
          dateStart: s.dateStart,
          priority: s.priority,
          rounds: [{ type: "final", datetime: `${s.dateStart}T14:00:00` }],
          peakTargetRound: "final",
        })),
    ];
    const goal = {
      targetEvent: "800m",
      targetTimeSec: parseTime(target),
      targetRaceId: raceId,
      subRaceIds: races.slice(1).map((r) => r.id),
    };
    await fetch("/api/goal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goal, races }),
    });
    setMsg("保存しました。");
  };

  const generate = async () => {
    setMsg("プラン生成中…");
    const res = await fetch("/api/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startDate: planStart }),
    });
    const d = await res.json();
    if (d.error) {
      setMsg(d.error);
      return;
    }
    setMsg(
      `プラン生成完了: ${d.sessionCount}セッション + 補強${d.strengthCount}件` +
        (d.customMenusUsed ? ` ／ 自作メニュー${d.customMenusUsed}種類を使用` : "")
    );
    setViolations([...(d.templateViolations ?? []), ...(d.violations ?? [])]);
  };

  return (
    <div className="flex flex-col gap-3">
      <Card title="目標">
        <label className="block text-sm mb-2 max-w-xs">
          <span className="block text-xs mb-0.5">目標タイム（800m）</span>
          <input
            className="w-full"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder="1:48.9"
          />
        </label>
      </Card>

      <Card title="本命レース（Aレース）">
        <div className="grid md:grid-cols-2 gap-x-6">
          <label className="block text-sm mb-2">
            <span className="block text-xs mb-0.5">大会名</span>
            <input className="w-full" value={raceName} onChange={(e) => setRaceName(e.target.value)} />
          </label>
          <label className="block text-sm mb-2">
            <span className="block text-xs mb-0.5">開催初日</span>
            <input type="date" className="w-full" value={dateStart} onChange={(e) => setDateStart(e.target.value)} />
          </label>
          <label className="block text-sm mb-2">
            <span className="block text-xs mb-0.5">通過条件</span>
            <select className="w-full" value={advance} onChange={(e) => setAdvance(e.target.value)}>
              <option value="place">着順通過（place）</option>
              <option value="time">タイム通過（time）</option>
              <option value="place_and_time">着順＋タイム（place_and_time）</option>
            </select>
          </label>
          {advance !== "place" ? (
            <label className="block text-sm mb-2">
              <span className="block text-xs mb-0.5">過去大会のボーダータイム</span>
              <input className="w-full" value={border} onChange={(e) => setBorder(e.target.value)} placeholder="1:51.0" />
            </label>
          ) : null}
        </div>

        <h3 className="text-sm font-semibold mt-2 mb-1">ラウンド構成（800mは2〜3日で2〜3本が前提）</h3>
        {rounds.map((r, i) => (
          <div key={i} className="flex gap-2 mb-1.5 items-center flex-wrap">
            <select
              className="text-sm"
              value={r.type}
              onChange={(e) => {
                const next = [...rounds];
                next[i] = { ...r, type: e.target.value };
                setRounds(next);
              }}
            >
              <option value="heat">予選</option>
              <option value="semifinal">準決勝</option>
              <option value="final">決勝</option>
            </select>
            <input
              type="datetime-local"
              className="text-sm max-w-[210px]"
              value={r.datetime}
              onChange={(e) => {
                const next = [...rounds];
                next[i] = { ...r, datetime: e.target.value };
                setRounds(next);
              }}
            />
            <button
              className="text-xs underline" style={{ color: "var(--text-3)" }}
              onClick={() => setRounds(rounds.filter((_, j) => j !== i))}
            >
              削除
            </button>
          </div>
        ))}
        <button
          className="text-xs underline" style={{ color: "var(--text-3)" }}
          onClick={() => setRounds([...rounds, { type: "semifinal", datetime: "" }])}
        >
          + ラウンド追加
        </button>
      </Card>

      <Card title="通過点レース（B/C）">
        {subRaces.map((s, i) => (
          <div key={i} className="flex gap-2 mb-1 items-center flex-wrap">
            <input
              className="text-sm w-full sm:w-auto"
              placeholder="大会名"
              value={s.name}
              onChange={(e) => {
                const next = [...subRaces];
                next[i] = { ...s, name: e.target.value };
                setSubRaces(next);
              }}
            />
            <input
              type="date"
              className="text-sm"
              value={s.dateStart}
              onChange={(e) => {
                const next = [...subRaces];
                next[i] = { ...s, dateStart: e.target.value };
                setSubRaces(next);
              }}
            />
            <select
              className="text-sm"
              value={s.priority}
              onChange={(e) => {
                const next = [...subRaces];
                next[i] = { ...s, priority: e.target.value };
                setSubRaces(next);
              }}
            >
              <option value="B">B（通過点）</option>
              <option value="C">C（練習レース）</option>
            </select>
            <button className="text-xs underline" style={{ color: "var(--text-3)" }} onClick={() => setSubRaces(subRaces.filter((_, j) => j !== i))}>
              削除
            </button>
          </div>
        ))}
        <button
          className="text-xs underline" style={{ color: "var(--text-3)" }}
          onClick={() => setSubRaces([...subRaces, { name: "", dateStart: "", priority: "B" }])}
        >
          + 通過点レース追加
        </button>
        <p className="text-xs mt-1" style={{ color: "var(--text-2)" }}>
          通過点レースの前3日のみ軽くする「無調整に近い」設計になります。本命のピークは崩しません。
        </p>
      </Card>

      <Card title="プラン生成">
        <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
          <button onClick={save} className="btn-volt justify-center">
            目標・レースを保存
          </button>
          <label className="block text-sm">
            <span className="block text-xs mb-0.5">プラン開始日</span>
            <input type="date"  value={planStart} onChange={(e) => setPlanStart(e.target.value)} />
          </label>
          <button onClick={generate} className="btn-ghost text-left sm:text-center">
            プランを自動生成（既存の予定セッションは置き換え）
          </button>
        </div>
        {msg ? <p className="text-sm mt-2">{msg}</p> : null}
        {violations.length > 0 ? (
          <div className="mt-2">
            <ViolationList violations={violations} />
          </div>
        ) : null}
      </Card>
    </div>
  );
}
