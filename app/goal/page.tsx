"use client";
import { useEffect, useState } from "react";
import { Card, ViolationList } from "../components/ui";
import { localToday } from "@/lib/core/dates";
import type {
  AdvancementRule,
  Goal,
  Race,
  RacePriority,
  RoundType,
} from "@/lib/core/types";

function parseTime(v: string): number {
  if (v.includes(":")) {
    const [m, s] = v.split(":");
    return Number(m) * 60 + Number(s);
  }
  return Number(v);
}

function formatTimeInput(seconds: number | undefined): string {
  if (seconds === undefined) return "";
  const minutes = Math.floor(seconds / 60);
  const rest = (seconds - minutes * 60).toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  return `${minutes}:${rest.padStart(2, "0")}`;
}

function legacyBorderPlace(race: Race): number | undefined {
  if (race.borderPlace !== undefined) return race.borderPlace;
  const match = /上位\s*(\d+)\s*着/.exec(race.advancementDetail ?? "");
  return match ? Number(match[1]) : undefined;
}

type RoundForm = { type: RoundType; datetime: string };
type SubRaceForm = {
  id: string;
  name: string;
  dateStart: string;
  priority: Exclude<RacePriority, "A">;
};
type GoalResponse = { goal: Goal | null; races: Race[]; error?: string };

export default function GoalPage() {
  const [target, setTarget] = useState("1:48.9");
  const [raceName, setRaceName] = useState("");
  const [targetRaceId, setTargetRaceId] = useState("race-target");
  const [dateStart, setDateStart] = useState("");
  const [advance, setAdvance] = useState<AdvancementRule>("place");
  const [placeBorder, setPlaceBorder] = useState("");
  const [border, setBorder] = useState("");
  const [rounds, setRounds] = useState<RoundForm[]>([
    { type: "heat", datetime: "" },
    { type: "final", datetime: "" },
  ]);
  const [subRaces, setSubRaces] = useState<SubRaceForm[]>([]);
  const [planStart, setPlanStart] = useState(localToday());
  const [msg, setMsg] = useState("");
  const [violations, setViolations] = useState<any[]>([]);

  const hydrate = ({ goal, races }: GoalResponse) => {
    if (!goal) return;
    const m = Math.floor(goal.targetTimeSec / 60);
    const s = (goal.targetTimeSec - m * 60).toFixed(2);
    setTarget(`${m}:${s}`);
    const byId = new Map(races.map((race) => [race.id, race]));
    const main = byId.get(goal.targetRaceId);
    if (main) {
      setTargetRaceId(main.id);
      setRaceName(main.name);
      setDateStart(main.dateStart);
      setAdvance(main.advancementRule ?? "place");
      setPlaceBorder(
        legacyBorderPlace(main) === undefined ? "" : String(legacyBorderPlace(main))
      );
      setBorder(formatTimeInput(main.borderTimeSec));
      setRounds(
        main.rounds.map((round) => ({
          type: round.type,
          datetime: round.datetime.slice(0, 16),
        }))
      );
    }
    setSubRaces(
      (goal.subRaceIds ?? [])
        .map((id) => byId.get(id))
        .filter((race): race is Race => race !== undefined)
        .map((race) => ({
          id: race.id,
          name: race.name,
          dateStart: race.dateStart,
          priority: race.priority === "C" ? "C" : "B",
        }))
    );
  };

  useEffect(() => {
    fetch("/api/goal", { cache: "no-store" })
      .then((r) => r.json())
      .then((data: GoalResponse) => hydrate(data))
      .catch((error) => setMsg(`目標を読み込めませんでした: ${String(error)}`));
  }, []);

  const save = async () => {
    if (!dateStart) {
      setMsg("本命レースの開催初日は必須です");
      return;
    }
    const borderTimeSec = border ? parseTime(border) : undefined;
    const borderPlace = placeBorder ? Number(placeBorder) : undefined;
    if (
      (advance === "time" || advance === "place_and_time") &&
      border !== "" &&
      (!Number.isFinite(borderTimeSec) || (borderTimeSec ?? 0) <= 0)
    ) {
      setMsg("タイムによる通過ボーダーを正しく入力してください");
      return;
    }
    if (
      (advance === "place" || advance === "place_and_time") &&
      placeBorder !== "" &&
      (!Number.isInteger(borderPlace) || (borderPlace ?? 0) <= 0)
    ) {
      setMsg("着順による通過ボーダーを正しく入力してください");
      return;
    }

    const races: Race[] = [
      {
        id: targetRaceId,
        name: raceName || "本命レース",
        dateStart,
        priority: "A",
        rounds: rounds
          .filter((r) => r.datetime)
          .map((r) => ({ type: r.type, datetime: r.datetime })),
        peakTargetRound: "final",
        advancementRule: advance,
        advancementDetail: [
          advance !== "time" && borderPlace ? `各組上位${borderPlace}着` : "",
          advance !== "place" && borderTimeSec ? `タイム ${formatTimeInput(borderTimeSec)}` : "",
        ]
          .filter(Boolean)
          .join("＋"),
        borderPlace: advance !== "time" ? borderPlace : undefined,
        borderTimeSec: advance !== "place" ? borderTimeSec : undefined,
      },
      ...subRaces
        .filter((s) => s.dateStart)
        .map((s, index): Race => ({
          id: s.id,
          name: s.name || `通過点レース${index + 1}`,
          dateStart: s.dateStart,
          priority: s.priority,
          rounds: [{ type: "final", datetime: `${s.dateStart}T14:00:00` }],
          peakTargetRound: "final",
        })),
    ];
    const goal: Goal = {
      targetEvent: "800m",
      targetTimeSec: parseTime(target),
      targetRaceId,
      subRaceIds: races.slice(1).map((r) => r.id),
    };
    const response = await fetch("/api/goal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goal, races }),
    });
    const saved = (await response.json()) as GoalResponse & { ok?: boolean };
    if (!response.ok || saved.error) {
      setMsg(saved.error ?? "保存できませんでした");
      return;
    }
    hydrate(saved);
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
        (d.customMenusUsed ? ` ／ 自作メニュー${d.customMenusUsed}種類を使用` : "") +
        (d.unsafeSkipped > 0
          ? ` ／ 設定ペースが物理的にありえない${d.unsafeSkipped}枠は安全のため除外しました`
          : "") +
        (d.safetyAdjustments?.length
          ? ` ／ 継続中の故障記録により高負荷${d.safetyAdjustments.length}枠を回復メニューへ変更しました`
          : "") +
        /*
         * N日周期にしたときの調整。
         * 「10日周期にしたら高乳酸が減った」を黙って起こさない。
         * どちらも本人が却下できる（曜日に戻す・周期の長さを変える）ので、
         * 何をしたのかが分かる形で出す。
         */
        (d.spacingSwaps?.length
          ? ` ／ 暦の1週間に高負荷が集中する${d.spacingSwaps.length}枠をCVへ落としました`
          : "") +
        (d.cycleNotes?.length ? `\n周期の調整: ${d.cycleNotes.join(" ")}` : "")
    );
    setViolations([...(d.templateViolations ?? []), ...(d.violations ?? [])]);
  };

  return (
    <div className="plan-screen flex flex-col gap-3">
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
            <select
              className="w-full"
              value={advance}
              onChange={(e) => setAdvance(e.target.value as AdvancementRule)}
            >
              <option value="place">着順通過（place）</option>
              <option value="time">タイム通過（time）</option>
              <option value="place_and_time">着順＋タイム（place_and_time）</option>
            </select>
          </label>
          {advance !== "time" ? (
            <label className="block text-sm mb-2">
              <span className="block text-xs mb-0.5">着順による通過ボーダー（各組）</span>
              <input
                type="number"
                min={1}
                inputMode="numeric"
                className="w-full"
                value={placeBorder}
                onChange={(e) => setPlaceBorder(e.target.value)}
                placeholder="2"
              />
            </label>
          ) : null}
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
                next[i] = { ...r, type: e.target.value as RoundType };
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
                next[i] = {
                  ...s,
                  priority: e.target.value === "C" ? "C" : "B",
                };
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
          onClick={() =>
            setSubRaces([
              ...subRaces,
              {
                id: `race-sub-${Date.now().toString(36)}-${subRaces.length}`,
                name: "",
                dateStart: "",
                priority: "B",
              },
            ])
          }
        >
          + 通過点レース追加
        </button>
        <p className="text-xs mt-1" style={{ color: "var(--text-2)" }}>
          通過点レースの前3日のみ軽くする「無調整に近い」設計になります。本命のピークは崩しません。
        </p>
      </Card>

      <Card title="プラン生成" variant="hero" className="plan-generate-card">
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
        {/* 周期の調整は改行して出す（1行に詰めると読み飛ばされる） */}
        {msg ? <p className="text-sm mt-2 whitespace-pre-line">{msg}</p> : null}
        {violations.length > 0 ? (
          <div className="mt-2">
            <ViolationList violations={violations} />
          </div>
        ) : null}
      </Card>
    </div>
  );
}
