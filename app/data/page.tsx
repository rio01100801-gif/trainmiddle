"use client";
import { useCallback, useEffect, useState } from "react";
import { Card, ConfirmButton } from "../components/ui";
import { localToday } from "@/lib/core/dates";

/**
 * データ管理
 *  M-12 書き出しと復元
 *  M-10 接地時間の取り込み
 *
 * 書き出しは地味な機能だが、失ったときの損失は他のどの機能より大きい。
 * iPhoneのPWAはストレージが消えることがあり、
 * 数か月ぶんの実測が消えると現在地の推定が全部やり直しになる。
 */
export default function DataPage() {
  const [status, setStatus] = useState<any>(null);
  const [msg, setMsg] = useState("");
  const [report, setReport] = useState<any>(null);
  const [mode, setMode] = useState<"replace" | "merge">("merge");
  const [busy, setBusy] = useState(false);
  const [rebuildMsg, setRebuildMsg] = useState("");

  const rebuild = async () => {
    setBusy(true);
    setRebuildMsg("");
    try {
      const r = await fetch("/api/past", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rebuild: true }),
      });
      const out = await r.json();
      const b = out.rebuild;
      if (!b) {
        setRebuildMsg(out.error ?? "作り直せませんでした。");
        return;
      }
      setRebuildMsg(
        `${b.entries}件を確認し、${b.rebuilt}件を作り直しました。` +
          (b.withoutTarget > 0
            ? `　うち${b.withoutTarget}件は設定タイムが残っていません（登録時に読み取れていないため、作り直しても戻りません）。設定に対する評価が要る場合は、その練習だけ入れ直してください。`
            : "")
      );
    } finally {
      setBusy(false);
    }
  };

  const load = useCallback(() => {
    fetch("/api/backup")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => {});
  }, []);
  useEffect(load, [load]);

  const exportJson = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/backup?download=1");
      const file = await r.json();
      const blob = new Blob([JSON.stringify(file)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `FORGE-${localToday()}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      setMsg(
        `書き出しました（${Object.entries(file.counts ?? {})
          .map(([k, v]) => `${k} ${v}`)
          .join(" / ")}）。ファイルアプリやiCloudに置いておいてください。`
      );
      load();
    } finally {
      setBusy(false);
    }
  };

  const importJson = (file: File) => {
    const reader = new FileReader();
    reader.onload = async () => {
      setBusy(true);
      try {
        const parsed = JSON.parse(String(reader.result));
        const r = await fetch("/api/backup", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ file: parsed, mode }),
        });
        const out = await r.json();
        if (out.error) {
          setMsg(out.error);
          return;
        }
        setReport(out.report);
        setMsg("読み込みました。画面を再読み込みします…");
        setTimeout(() => location.reload(), 1200);
      } catch (e) {
        setMsg(`読み込めませんでした: ${(e as Error).message}`);
      } finally {
        setBusy(false);
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="flex flex-col gap-3">
      <Card title="書き出し（バックアップ）">
        <p
          className="text-[12px] leading-relaxed mb-2.5"
          style={{ color: status?.remind ? "var(--amber)" : "var(--text-2)" }}
        >
          {status?.message ?? "…"}
        </p>
        <p className="text-[11.5px] leading-relaxed mb-2.5" style={{ color: "var(--text-3)" }}>
          端末のストレージが消えると、実測もCFEもすべて失われます。
          月に1回で構わないので、書き出してファイルアプリに置いておいてください。
        </p>
        <button className="btn-volt" onClick={exportJson} disabled={busy}>
          書き出す
        </button>
      </Card>

      {/*
        Q-3: 取り込み時にしか変換が走らないので、変換を直しても
        すでに入っているぶんは古いまま残る。自動でも1度作り直すが、
        ここからいつでも走らせられるようにしておく（何件直ったかを出す）。
      */}
      <Card title="過去データの作り直し">
        <p className="text-[11.5px] leading-relaxed mb-2.5" style={{ color: "var(--text-2)" }}>
          一括入力で登録したぶんを、いまの解釈で作り直します。
          週次レビューや同じ処方の比較に過去のぶんが出てこないときに使ってください。
          実測した値は書き換えません。
        </p>
        <button className="btn-ghost" onClick={rebuild} disabled={busy}>
          作り直す
        </button>
        {rebuildMsg ? (
          <p className="text-[11.5px] leading-relaxed mt-2.5" style={{ color: "var(--text-3)" }}>
            {rebuildMsg}
          </p>
        ) : null}
      </Card>

      <Card title="復元">
        <div className="seg mb-2.5">
          <button data-on={mode === "merge" ? "1" : "0"} onClick={() => setMode("merge")}>
            統合
          </button>
          <button data-on={mode === "replace" ? "1" : "0"} onClick={() => setMode("replace")}>
            上書き
          </button>
        </div>
        <p className="text-[11.5px] leading-relaxed mb-2.5" style={{ color: "var(--text-2)" }}>
          {mode === "merge"
            ? "統合: いま入っているものを残したまま足します。同じ記録は重複しません。"
            : "上書き: いま入っているものを全部消してから入れ直します。機種変更のときはこちら。"}
        </p>
        <label className="btn-ghost inline-flex cursor-pointer">
          ファイルを選ぶ
          <input
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && importJson(e.target.files[0])}
          />
        </label>
        {report ? (
          <div className="mt-2.5 text-[11.5px] num" style={{ color: "var(--text-2)" }}>
            {Object.keys(report.added ?? {}).map((k) => (
              <div key={k}>
                {k}: 追加 {report.added[k]} / 上書き {report.updated[k] ?? 0} / 保持{" "}
                {report.kept?.[k] ?? 0}
              </div>
            ))}
            {/* 守ったこと・読めなかったことを黙って伏せない */}
            {((report.warnings ?? []) as string[]).map((w: string) => (
              <p key={w} className="mt-1.5 text-[11.5px] leading-relaxed" role="status">
                {w}
              </p>
            ))}
          </div>
        ) : null}
      </Card>

      <ContactCard />

      {msg ? (
        <Card>
          <p className="text-[12px] leading-relaxed">{msg}</p>
        </Card>
      ) : null}
    </div>
  );
}

/**
 * M-10 接地時間の取り込み
 *
 * 疲労が溜まると同じペースでも接地時間が伸びる。
 * 主観や安静時心拍より先に出ることがあるので、故障の予兆としても使える。
 */
function ContactCard() {
  const [d, setD] = useState<any>(null);
  const [text, setText] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetch("/api/contact")
      .then((r) => r.json())
      .then(setD)
      .catch(() => {});
  }, []);
  useEffect(load, [load]);

  const submit = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/contact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ csv: text, today: localToday() }),
      });
      const out = await r.json();
      setMsg(out.error ?? `${out.imported}件を取り込みました（合計${out.total}件）。`);
      if (!out.error) {
        setText("");
        load();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="接地時間の取り込み">
      <p className="text-[12px] leading-relaxed mb-2" style={{ color: "var(--text-2)" }}>
        時計から書き出した接地時間を貼り付けてください。1行1本で、
        <b style={{ color: "var(--text)" }}>日付, 接地時間(ms), ペース</b> の順に読みます。
        列名は見ません。
      </p>
      <textarea
        rows={5}
        className="w-full"
        style={{ fontFamily: "ui-monospace, monospace", fontSize: 12 }}
        placeholder={"2026-07-20,158,4:45\n2026-07-22,160,4:50"}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="flex gap-2 mt-2 flex-wrap">
        <button className="btn-volt" onClick={submit} disabled={busy || !text.trim()}>
          取り込む
        </button>
      </div>
      {d?.assessment ? (
        <p
          className="text-[12px] leading-relaxed mt-2.5"
          style={{ color: d.assessment.fatigued ? "var(--amber)" : "var(--text-2)" }}
        >
          {d.assessment.narrative}
        </p>
      ) : null}
      {msg ? (
        <p className="text-[11.5px] mt-2" style={{ color: "var(--forge)" }}>
          {msg}
        </p>
      ) : null}
    </Card>
  );
}
