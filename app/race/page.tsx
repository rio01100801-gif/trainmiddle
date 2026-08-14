"use client";
import { useEffect, useState } from "react";
import { Card, ChangeList, ConfirmButton, ViolationList, fmtSec } from "../components/ui";
import { localToday } from "@/lib/core/dates";

type RoundInput = {
  roundType: string;
  front400: string;
  back400: string;
  rpe: string;
};

export default function RaceAnalysisPage() {
  const [races, setRaces] = useState<any[]>([]);
  const [raceId, setRaceId] = useState("");
  const [date, setDate] = useState(localToday());
  const [rounds, setRounds] = useState<RoundInput[]>([
    { roundType: "heat", front400: "", back400: "", rpe: "7" },
    { roundType: "final", front400: "", back400: "", rpe: "9" },
  ]);
  const [out, setOut] = useState<any | null>(null);
  const [msg, setMsg] = useState("");
  const [deleteId, setDeleteId] = useState("");
  const [deleteMsg, setDeleteMsg] = useState("");

  useEffect(() => {
    fetch("/api/goal")
      .then((r) => r.json())
      .then((d) => {
        setRaces(d.races ?? []);
        if (d.races?.[0]) setRaceId(d.races[0].id);
      });
  }, []);

  const removeRace = async () => {
    if (!deleteId) {
      setDeleteMsg("消す大会を選んでください");
      return;
    }
    const res = await fetch(`/api/goal?raceId=${encodeURIComponent(deleteId)}`, {
      method: "DELETE",
    });
    const d = await res.json();
    if (d.error) {
      setDeleteMsg(d.error);
      return;
    }
    const left = (d.races ?? []) as { id: string }[];
    setRaces(left);
    setDeleteId("");
    // 選択中の大会を消したら、結果入力側の選択も外れたままにしない
    if (!left.some((r) => r.id === raceId)) setRaceId(left[0]?.id ?? "");
    setDeleteMsg("消しました。");
  };

  const submit = async () => {
    const payload = rounds
      .filter((r) => r.front400 && r.back400)
      .map((r) => ({
        roundType: r.roundType,
        timeSec: Number(r.front400) + Number(r.back400),
        front400Sec: Number(r.front400),
        back400Sec: Number(r.back400),
        laps: [Number(r.front400), Number(r.back400)],
        rpe: Number(r.rpe),
      }));
    if (payload.length === 0) {
      setMsg("少なくとも1ラウンドの前後半400mを入力してください");
      return;
    }
    const res = await fetch("/api/race-result", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ raceId, rounds: payload, date }),
    });
    const d = await res.json();
    if (d.error) setMsg(d.error);
    else {
      setOut(d);
      setMsg("");
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <Card title="レース結果の入力（ラウンド別・前後半400m）">
        <div className="grid md:flex gap-2 md:flex-wrap md:items-end mb-2">
          <label className="text-sm">
            <span className="block text-xs">大会</span>
            <select className="w-full md:w-auto max-w-full" value={raceId} onChange={(e) => setRaceId(e.target.value)}>
              {races.map((r) => (
                <option key={r.id} value={r.id}>{r.name}（{r.dateStart}）</option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="block text-xs">日付</span>
            <input type="date"  value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
        </div>
        {rounds.map((r, i) => (
          <div key={i} className="grid grid-cols-3 md:flex gap-2 md:items-end mb-2 rounded-lg border p-2 md:p-0 md:border-0" style={{ borderColor: "var(--border)" }}>
            <select
              className="text-sm col-span-3 md:col-span-1"
              value={r.roundType}
              onChange={(e) => {
                const next = [...rounds];
                next[i] = { ...r, roundType: e.target.value };
                setRounds(next);
              }}
            >
              <option value="heat">予選</option>
              <option value="semifinal">準決勝</option>
              <option value="final">決勝</option>
            </select>
            <label className="text-sm">
              <span className="block text-xs">前半400m(秒)</span>
              <input className="w-full md:w-24" value={r.front400} placeholder="53.8" onChange={(e) => { const n = [...rounds]; n[i] = { ...r, front400: e.target.value }; setRounds(n); }} />
            </label>
            <label className="text-sm">
              <span className="block text-xs">後半400m(秒)</span>
              <input className="w-full md:w-24" value={r.back400} placeholder="56.2" onChange={(e) => { const n = [...rounds]; n[i] = { ...r, back400: e.target.value }; setRounds(n); }} />
            </label>
            <label className="text-sm">
              <span className="block text-xs">RPE</span>
              <input className="w-full md:w-16" value={r.rpe} onChange={(e) => { const n = [...rounds]; n[i] = { ...r, rpe: e.target.value }; setRounds(n); }} />
            </label>
          </div>
        ))}
        <button onClick={submit} className="btn-volt justify-center w-full md:w-auto">
          分析を実行
        </button>
        {msg ? <p className="text-sm mt-2">{msg}</p> : null}
      </Card>

      {/*
        間違えて登録したレースを消す導線。
        保存層には前から `deleteRace` があったのに呼ぶ側が無く、
        目標から外しても記録としては残り続けていた。

        本命レースと、結果を入力済みのレースは消せない（APIが断る）。
        押す前に理由が分かるよう、断られる条件をここにも書く。
      */}
      {races.length > 0 ? (
        <Card title="登録したレースを消す">
          <p className="text-[11px] mb-2 leading-relaxed" style={{ color: "var(--text-2)" }}>
            間違えて登録したレース用です。<strong>本命レース</strong>と
            <strong>結果を入力済みのレース</strong>は消せません
            （走った記録は現在地の根拠になっているため）。
          </p>
          <div className="flex flex-wrap gap-2 items-end">
            <label className="text-sm">
              <span className="block text-xs">消す大会</span>
              <select
                className="w-full md:w-auto max-w-full"
                aria-label="消す大会"
                value={deleteId}
                onChange={(e) => setDeleteId(e.target.value)}
              >
                <option value="">選択</option>
                {races.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}（{r.dateStart}）
                  </option>
                ))}
              </select>
            </label>
            <ConfirmButton
              label="このレースを消す"
              title="登録したレースを消しますか？"
              message="目標から外れ、一覧からも消えます。走った記録（有酸素マーカー）がある大会は消せません。"
              danger
              className="btn-ghost min-h-[44px]"
              onConfirm={removeRace}
            />
          </div>
          {deleteMsg ? <p className="text-sm mt-2">{deleteMsg}</p> : null}
        </Card>
      ) : null}

      {out ? (
        <>
          <Card title="ラウンド管理の診断（予選 ⇄ 決勝）">
            <p className="text-sm">
              CFE: <b>{fmtSec(out.cfeBefore)}</b> → <b>{fmtSec(out.cfeAfter)}</b>（最速ラウンド {fmtSec(out.roundsDiagnosis?.fastestTimeSec)} で更新）
            </p>
            {out.roundsDiagnosis?.finalMinusHeatSec !== undefined ? (
              <p className="text-sm">決勝 − 予選: {out.roundsDiagnosis.finalMinusHeatSec > 0 ? "+" : ""}{out.roundsDiagnosis.finalMinusHeatSec.toFixed(1)}秒</p>
            ) : null}
            <p className="text-sm mt-1">{out.roundsDiagnosis?.assessment}</p>
          </Card>

          {out.analysis ? (
            <Card title="ラップ分析 → 今後の配分">
              <p className="text-sm">
                合計 <b>{fmtSec(out.analysis.totalSec)}</b> ／ 前後半差{" "}
                <b>{out.analysis.splitDiffSec >= 0 ? "+" : ""}{out.analysis.splitDiffSec.toFixed(1)}秒</b>
              </p>
              <p className="text-sm font-semibold mt-1">{out.analysis.primaryIssue}</p>
              <ul className="text-sm mt-1 space-y-0.5">
                {out.analysis.adjustments.map((a: any, i: number) => (
                  <li key={i}>
                    ・{a.category}:{" "}
                    {a.change === "increase" ? "比率を上げる" : a.change === "decrease" ? "比率を下げる" : "維持"}
                    <span className="text-xs" style={{ color: "var(--text-2)" }}>（{a.reason}）</span>
                  </li>
                ))}
              </ul>
              {(out.analysis.extraActions ?? []).map((a: string, i: number) => (
                <p key={i} className="text-sm mt-1">{a}</p>
              ))}
              {out.analysis.feasibility?.warn ? (
                <p className="text-sm mt-1" style={{ color: "var(--red)" }}>
                  ⚠ {out.analysis.feasibility.message}
                </p>
              ) : null}
              <p className="text-xs mt-2" style={{ color: "var(--text-2)" }}>
                再診断タイプ: {out.analysis.rediagnosis?.athleteType} ／ 伸びしろ: {out.analysis.rediagnosis?.primaryGap}
              </p>
            </Card>
          ) : null}

          <Card title="以降のメニューへの反映">
            <ChangeList changes={out.changes ?? []} />
            <div className="mt-2">
              <ViolationList violations={out.violations ?? []} />
            </div>
          </Card>
        </>
      ) : null}
    </div>
  );
}
