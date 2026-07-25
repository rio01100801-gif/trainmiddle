"use client";
import { useEffect, useState } from "react";
import { Card } from "../components/ui";
import { diagnose } from "@/lib/core/diagnosis";
import { checkAchillesCare } from "@/lib/core/strength";
import type { Athlete, Diagnosis } from "@/lib/core/types";

function parseTime(v: string): number | undefined {
  if (!v) return undefined;
  if (v.includes(":")) {
    const [m, s] = v.split(":");
    return Number(m) * 60 + Number(s);
  }
  const n = Number(v);
  return isNaN(n) ? undefined : n;
}

function fmtInput(sec?: number): string {
  if (!sec) return "";
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return m > 0 ? `${m}:${s.toFixed(2).padStart(5, "0")}` : String(sec);
}

export default function SetupPage() {
  const [form, setForm] = useState({
    name: "",
    heightCm: "",
    weightKg: "",
    skeletalMuscleKg: "",
    pb400: "",
    pb800: "",
    pb1500: "",
    heatTolerance: "normal",
    recoveryProfile: "normal",
  });
  const [diag, setDiag] = useState<Diagnosis | null>(null);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    fetch("/api/athlete")
      .then((r) => r.json())
      .then(({ athlete }) => {
        if (!athlete) return;
        setForm({
          name: athlete.name ?? "",
          heightCm: athlete.heightCm ? String(athlete.heightCm) : "",
          weightKg: athlete.weightKg ? String(athlete.weightKg) : "",
          skeletalMuscleKg: athlete.skeletalMuscleKg ? String(athlete.skeletalMuscleKg) : "",
          pb400: fmtInput(athlete.pb400mSec),
          pb800: fmtInput(athlete.pb800mSec),
          pb1500: fmtInput(athlete.pb1500mSec),
          heatTolerance: athlete.heatTolerance ?? "normal",
          recoveryProfile: athlete.recoveryProfile ?? "normal",
        });
      });
  }, []);

  const save = async () => {
    const pb800 = parseTime(form.pb800);
    if (!pb800) {
      setMsg("800mPBは必須です（例: 1:49.51）");
      return;
    }
    const athlete: Athlete = {
      id: "athlete-1",
      name: form.name || "選手",
      heightCm: form.heightCm ? Number(form.heightCm) : undefined,
      weightKg: form.weightKg ? Number(form.weightKg) : undefined,
      skeletalMuscleKg: form.skeletalMuscleKg ? Number(form.skeletalMuscleKg) : undefined,
      pb400mSec: parseTime(form.pb400),
      pb800mSec: pb800,
      pb1500mSec: parseTime(form.pb1500),
      heatTolerance: form.heatTolerance as Athlete["heatTolerance"],
      recoveryProfile: form.recoveryProfile as Athlete["recoveryProfile"],
      injuryHistory: [],
    };
    await fetch("/api/athlete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(athlete),
    });
    setDiag(diagnose(athlete));
    setMsg("保存しました。タイプ診断を表示します。");
  };

  const F = (
    label: string,
    key: keyof typeof form,
    placeholder = ""
  ) => (
    <label className="block text-sm mb-2">
      <span className="block text-xs mb-0.5" style={{ color: "var(--text-2)" }}>
        {label}
      </span>
      <input
        className="w-full"
        value={form[key]}
        placeholder={placeholder}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
      />
    </label>
  );

  return (
    <div className="flex flex-col gap-3">
      <Card title="選手プロフィール">
        <div className="grid grid-cols-2 gap-x-3 md:gap-x-6">
          {F("名前", "name")}
          {F("身長(cm)", "heightCm", "171")}
          {F("体重(kg)", "weightKg", "64.5")}
          {F("骨格筋量(kg・任意)", "skeletalMuscleKg", "32.5")}
          {F("400m PB", "pb400", "49.0")}
          {F("800m PB（必須）", "pb800", "1:49.51")}
          {F("1500m PB", "pb1500", "3:56.0")}
          <label className="block text-sm mb-2">
            <span className="block text-xs mb-0.5" style={{ color: "var(--text-2)" }}>
              暑熱耐性
            </span>
            <select
              className="w-full"
              value={form.heatTolerance}
              onChange={(e) => setForm({ ...form, heatTolerance: e.target.value })}
            >
              <option value="low">low（暑さに弱い）</option>
              <option value="normal">normal</option>
              <option value="high">high</option>
            </select>
          </label>
          <label className="block text-sm mb-2">
            <span className="block text-xs mb-0.5" style={{ color: "var(--text-2)" }}>
              回復プロフィール
            </span>
            <select
              className="w-full"
              value={form.recoveryProfile}
              onChange={(e) => setForm({ ...form, recoveryProfile: e.target.value })}
            >
              <option value="slow">slow（回復が遅い）</option>
              <option value="normal">normal</option>
              <option value="fast">fast</option>
            </select>
          </label>
        </div>
        <p className="text-xs mb-2" style={{ color: "var(--text-2)" }}>
          ※ 高校時代の3000m/5000mのPBは現在の有酸素能力の根拠には使いません。有酸素の設定は
          実測（結果入力のペース走等）から算出されます。
        </p>
        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          <button onClick={save} className="btn-volt justify-center">
            保存して診断
          </button>
          {msg ? <span className="text-[12.5px]">{msg}</span> : null}
        </div>
      </Card>

      {diag ? (
        <Card title="タイプ診断結果">
          <p className="text-sm mb-1">
            タイプ: <b>{diag.athleteType}</b> ／ 最大の伸びしろ: <b>{diag.primaryGap}</b>
          </p>
          <pre
            className="text-xs whitespace-pre-wrap leading-relaxed"
            style={{ color: "var(--text-2)", fontFamily: "inherit" }}
          >
            {diag.narrative}
          </pre>
        </Card>
      ) : null}

      <AchillesCareCheck />
    </div>
  );
}

/**
 * 4-8-3. アキレス腱・腱組織のケア内容チェック。
 * 静的ストレッチをアキレス腱の主要ケアとして登録しようとした場合に警告し、
 * 腱への漸進的負荷という代替案を提示する。
 */
function AchillesCareCheck() {
  const [text, setText] = useState("");
  const result = text ? checkAchillesCare(text) : null;

  return (
    <Card title="ケア内容のチェック（アキレス腱・腱組織）">
      <p className="text-[11px] mb-2 leading-relaxed" style={{ color: "var(--text-3)" }}>
        普段行っているケア・補強の内容を入力すると、腱組織にとって逆効果になり得るものを検出します。
      </p>
      <input
        className="w-full"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="例: アキレス腱の静的ストレッチを毎晩、カーフレイズ 3×15"
      />
      {result?.warn ? (
        <div
          className="mt-2 text-[12px] rounded-lg border p-3 leading-relaxed"
          style={{ borderColor: "var(--amber)", background: "rgba(237,198,4,.06)" }}
        >
          <div style={{ color: "var(--amber)" }} className="font-bold mb-1">
            ⚠ {result.message}
          </div>
          <div className="text-[11.5px]" style={{ color: "var(--text-2)" }}>
            推奨する代替:
            <ul className="list-disc pl-5 mt-1">
              {result.recommendations?.map((r, i) => <li key={i}>{r}</li>)}
            </ul>
          </div>
        </div>
      ) : text ? (
        <p className="text-[12px] mt-2" style={{ color: "var(--volt)" }}>
          ✓ 問題のある組み合わせは検出されませんでした
        </p>
      ) : null}
    </Card>
  );
}
