"use client";
import { useCallback, useEffect, useState } from "react";
import { Card, Field, fmtSec } from "../components/ui";
import { apiRequest } from "../components/api-client";
import { localToday } from "@/lib/core/dates";

/**
 * 4-10. 暑熱順化ブロック
 * - ブロック計画（本命レースの4〜6週前に10〜14日間）
 * - 日次記録（気温・湿度・HR・ペース・体重前後差・主観）
 * - 順化成立判定（同一ペースでHR5〜10拍低下）と脱水ERROR（体重-3%超で中断）
 */
export default function HeatPage() {
  const [data, setData] = useState<any | null>(null);
  const [races, setRaces] = useState<any[]>([]);
  const [raceId, setRaceId] = useState("");
  const [msg, setMsg] = useState("");

  const load = useCallback(() => {
    fetch("/api/heat")
      .then((r) => r.json())
      .then(setData);
    fetch("/api/goal")
      .then((r) => r.json())
      .then((d) => {
        setRaces(d.races ?? []);
        if (d.goal) setRaceId(d.goal.targetRaceId);
        else if (d.races?.[0]) setRaceId(d.races[0].id);
      });
  }, []);
  useEffect(load, [load]);

  const plan = async () => {
    if (!raceId) {
      setMsg("先に目標・レースを設定してください");
      return;
    }
    const res = await fetch("/api/heat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "plan", raceId }),
    });
    const d = await res.json();
    setMsg(
      d.error ??
        `ブロックを設計しました（${d.block.startDate} 〜 ${d.block.endDate}）。この期間の高乳酸/モデリングはRULE-22で警告されます。`
    );
    load();
  };

  return (
    <div className="flex flex-col gap-3">
      <Card title="暑熱順化ブロック（4-10）">
        <p className="text-[12px] leading-relaxed mb-3" style={{ color: "var(--text-2)" }}>
          暑熱は回避するだけでなく、計画的に適応を獲得する対象です。血漿量の増加とHSPによる適応は
          計画的な曝露で獲得でき、効果は中断後1〜2週で減衰します。そのため本命レースの
          <b style={{ color: "var(--text)" }}>4〜6週前に10〜14日間</b>で設計します。
        </p>
        <ul className="text-[11.5px] leading-relaxed mb-3 list-disc pl-5" style={{ color: "var(--text-3)" }}>
          {(data?.content ?? []).map((c: string, i: number) => (
            <li key={i}>{c}</li>
          ))}
        </ul>
        <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
          <Field label="対象レース" className="flex-1 max-w-sm">
            <select className="w-full" value={raceId} onChange={(e) => setRaceId(e.target.value)}>
              {races.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}（{r.dateStart}）
                </option>
              ))}
            </select>
          </Field>
          <button className="btn-volt justify-center" onClick={plan}>
            ブロックを設計する
          </button>
        </div>
        {msg ? <p className="text-[12px] mt-2">{msg}</p> : null}
      </Card>

      {(data?.blocks ?? []).map((b: any) => (
        <BlockCard key={b.block.id} detail={b} onSaved={load} />
      ))}

      {data?.raceDayChecklist ? (
        <Card title="レース当日の暑熱対策チェックリスト（heat_tolerance: low・28℃以上想定）">
          <ul className="text-[12.5px] leading-relaxed list-disc pl-5">
            {data.raceDayChecklist.map((c: string, i: number) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}

function BlockCard({ detail, onSaved }: { detail: any; onSaved: () => void }) {
  const { block, entries, assessment, timingWarning } = detail;
  const [form, setForm] = useState({
    date: localToday(),
    tempC: "",
    humidityPct: "",
    avgHr: "",
    pace: "",
    weightBeforeKg: "",
    weightAfterKg: "",
    strain: "3",
  });
  const [msg, setMsg] = useState("");

  const submit = async () => {
    if (!form.tempC) {
      setMsg("気温は必須です");
      return;
    }
    const paceSec = form.pace.includes(":")
      ? Number(form.pace.split(":")[0]) * 60 + Number(form.pace.split(":")[1])
      : Number(form.pace) || undefined;
    try {
      await apiRequest("/api/heat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "entry",
          blockId: block.id,
          entry: {
            date: form.date,
            tempC: Number(form.tempC),
            humidityPct: form.humidityPct ? Number(form.humidityPct) : undefined,
            avgHr: form.avgHr ? Number(form.avgHr) : undefined,
            paceSecPerKm: paceSec,
            weightBeforeKg: form.weightBeforeKg ? Number(form.weightBeforeKg) : undefined,
            weightAfterKg: form.weightAfterKg ? Number(form.weightAfterKg) : undefined,
            subjectiveStrain: Number(form.strain),
          },
        }),
      });
      setMsg("記録しました");
      onSaved();
    } catch (error) {
      setMsg(error instanceof Error ? error.message : "記録できませんでした");
    }
  };

  const dehydrated = assessment?.dehydrationErrors?.length > 0;

  return (
    <Card
      title={`ブロック ${block.startDate} 〜 ${block.endDate}（記録 ${entries.length}日）`}
    >
      {timingWarning ? (
        <p className="text-[12px] mb-2" style={{ color: "var(--amber)" }}>
          ⚠ {timingWarning}
        </p>
      ) : null}

      {assessment ? (
        <p
          className="text-[12.5px] mb-3 rounded-lg border p-2.5 leading-relaxed"
          style={{
            borderColor: dehydrated
              ? "var(--red)"
              : assessment.acclimatized
                ? "var(--volt)"
                : "var(--border)",
            color: dehydrated ? "var(--red)" : "var(--text)",
            background: dehydrated ? "rgba(242,86,77,.07)" : "var(--surface-2)",
          }}
        >
          {assessment.message}
        </p>
      ) : null}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Field label="日付">
          <input
            type="date"
            className="w-full"
            value={form.date}
            onChange={(e) => setForm({ ...form, date: e.target.value })}
          />
        </Field>
        <Field label="気温(℃)※必須">
          <input className="w-full" value={form.tempC} placeholder="32" onChange={(e) => setForm({ ...form, tempC: e.target.value })} />
        </Field>
        <Field label="湿度(%)">
          <input className="w-full" value={form.humidityPct} placeholder="70" onChange={(e) => setForm({ ...form, humidityPct: e.target.value })} />
        </Field>
        <Field label="平均HR">
          <input className="w-full" value={form.avgHr} placeholder="150" onChange={(e) => setForm({ ...form, avgHr: e.target.value })} />
        </Field>
        <Field label="ペース(/km)">
          <input className="w-full" value={form.pace} placeholder="5:00" onChange={(e) => setForm({ ...form, pace: e.target.value })} />
        </Field>
        <Field label="体重 前(kg)">
          <input className="w-full" value={form.weightBeforeKg} placeholder="64.5" onChange={(e) => setForm({ ...form, weightBeforeKg: e.target.value })} />
        </Field>
        <Field label="体重 後(kg)">
          <input className="w-full" value={form.weightAfterKg} placeholder="63.8" onChange={(e) => setForm({ ...form, weightAfterKg: e.target.value })} />
        </Field>
        <Field label="暑さの負担(1-5)">
          <input className="w-full" value={form.strain} onChange={(e) => setForm({ ...form, strain: e.target.value })} />
        </Field>
      </div>
      <div className="flex items-center gap-3 mt-2.5">
        <button className="btn-volt !py-2" onClick={submit}>
          記録する
        </button>
        {msg ? <span className="text-[12px]">{msg}</span> : null}
      </div>

      {entries.length > 0 ? (
        <div className="mt-3 max-h-56 overflow-y-auto flex flex-col gap-1">
          {entries
            .slice()
            .reverse()
            .map((e: any, i: number) => {
              const loss =
                e.weightBeforeKg && e.weightAfterKg
                  ? e.weightBeforeKg - e.weightAfterKg
                  : undefined;
              return (
                <div
                  key={i}
                  className="text-[11px] rounded-lg border p-2 flex flex-wrap gap-x-3 gap-y-0.5 num"
                  style={{ borderColor: "var(--border)", color: "var(--text-2)" }}
                >
                  <span style={{ color: "var(--text)" }}>{e.date}</span>
                  <span>{e.tempC}℃</span>
                  {e.humidityPct ? <span>{e.humidityPct}%</span> : null}
                  {e.avgHr ? <span>HR {e.avgHr}</span> : null}
                  {e.paceSecPerKm ? <span>{fmtSec(e.paceSecPerKm)}/km</span> : null}
                  {loss !== undefined ? (
                    <span style={{ color: loss > 1.9 ? "var(--red)" : undefined }}>
                      −{loss.toFixed(1)}kg
                    </span>
                  ) : null}
                </div>
              );
            })}
        </div>
      ) : null}
    </Card>
  );
}
