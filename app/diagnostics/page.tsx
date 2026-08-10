"use client";
import { useEffect, useState } from "react";
import { Card, StatusText } from "../components/ui";
import { getLastSynced, getSession, getSyncDiagnostics } from "../components/supabase";

/**
 * 診断情報（運用整備、2026-07-31で追加）
 *
 * 障害発生時に「何が起きているか」を本人が確認できるようにするための画面。
 * 設定→診断情報から**明示的に開いた場合だけ**表示する。バックグラウンドや
 * 自動での外部送信は一切しない（この画面はコピー機能はあるが送信機能は無い）。
 *
 * 表示しないもの: Publishable Key全文・access/refresh token・Authorizationヘッダー・
 * 健康データ本文・FIT本文・バックアップ本文・service role key。
 * Supabaseのホスト名は出すが、Project URL全体（token的な部分を含みうる）は出さない。
 */

interface BuildInfo {
  version?: string;
  commit?: string;
  builtAt?: string;
}

interface BackupStatus {
  lastExportedAt?: string;
}

type SwState = "unsupported" | "no-registration" | "installing" | "waiting" | "active" | "unknown";

export default function DiagnosticsPage() {
  const [buildInfo, setBuildInfo] = useState<BuildInfo | undefined>();
  const [buildInfoError, setBuildInfoError] = useState("");
  const [swState, setSwState] = useState<SwState>("unknown");
  const [swControlled, setSwControlled] = useState(false);
  const [online, setOnline] = useState(true);
  const [backupStatus, setBackupStatus] = useState<BackupStatus | undefined>();
  const [copied, setCopied] = useState(false);

  const diag = typeof window !== "undefined" ? getSyncDiagnostics() : undefined;
  const session = typeof window !== "undefined" ? getSession() : undefined;
  const lastSynced = typeof window !== "undefined" ? getLastSynced() : undefined;

  useEffect(() => {
    setOnline(navigator.onLine);
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    fetch("./build-info.json", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setBuildInfo)
      .catch(() =>
        setBuildInfoError(
          "取得できません（Next.js版で動かしている場合はbuild-info.jsonが無いのが正常です）"
        )
      );

    fetch("/api/backup")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setBackupStatus)
      .catch(() => setBackupStatus(undefined));

    if (!("serviceWorker" in navigator)) {
      setSwState("unsupported");
      return;
    }
    setSwControlled(!!navigator.serviceWorker.controller);
    navigator.serviceWorker.getRegistration().then((reg) => {
      if (!reg) {
        setSwState("no-registration");
      } else if (reg.installing) {
        setSwState("installing");
      } else if (reg.waiting) {
        setSwState("waiting");
      } else if (reg.active) {
        setSwState("active");
      }
    });

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  const SW_LABELS: Record<SwState, string> = {
    unsupported: "このブラウザはService Worker非対応",
    "no-registration": "未登録（初回起動直後、またはNext.js版）",
    installing: "更新中（install）",
    waiting: "新版が待機中（再読込で反映されます）",
    active: "有効",
    unknown: "確認中…",
  };

  const rows: { label: string; value: string }[] = [
    { label: "アプリバージョン", value: buildInfo?.version ?? (buildInfoError || "確認中…") },
    { label: "ソース指紋", value: buildInfo?.commit ?? "-" },
    {
      label: "ビルド情報",
      value: buildInfo?.builtAt === "reproducible" ? "再現可能ビルド" : buildInfo?.builtAt ?? "-",
    },
    { label: "実行環境", value: diag?.environment ?? "-" },
    { label: "origin", value: diag?.origin ?? "-" },
    { label: "オンライン", value: online ? "オンライン" : "オフライン" },
    { label: "Service Worker", value: SW_LABELS[swState] },
    { label: "このページはSW経由で配信されているか", value: swControlled ? "はい" : "いいえ" },
    { label: "Supabase設定", value: diag?.urlHost ? "設定あり" : "未設定" },
    { label: "Supabase host", value: diag?.urlHost ?? "-" },
    { label: "サインイン状態", value: session ? "サインイン済み" : "未サインイン" },
    {
      label: "最終クラウド同期",
      value: lastSynced ? `${lastSynced.exportedAt}（${lastSynced.totalCount}件）` : "同期履歴なし",
    },
    {
      label: "最終バックアップ書き出し",
      value: backupStatus?.lastExportedAt ?? "書き出し履歴なし",
    },
  ];

  const copyText = rows.map((r) => `${r.label}: ${r.value}`).join("\n");

  return (
    <div className="flex flex-col gap-3">
      <Card title="診断情報">
        <p className="text-[11.5px] leading-relaxed mb-3" style={{ color: "var(--text-3)" }}>
          障害発生時に状況を確認するための画面です。この画面の内容は外部へは一切送信されません。
          トークン・鍵・健康データの本文はここには表示しません。
        </p>
        <div className="flex flex-col">
          {rows.map((r) => (
            <div
              key={r.label}
              className="flex justify-between gap-3 py-2 border-b last:border-0 text-[12px]"
              style={{ borderColor: "var(--border)" }}
            >
              <span style={{ color: "var(--text-3)" }}>{r.label}</span>
              <span className="text-right num" style={{ wordBreak: "break-all" }}>
                {r.value}
              </span>
            </div>
          ))}
        </div>
      </Card>

      <Card title="診断情報をコピー">
        <p className="text-[11px] leading-relaxed mb-2" style={{ color: "var(--text-3)" }}>
          コピーされる内容は上の一覧と同じです（トークン・鍵・健康データは含みません）。
        </p>
        <textarea
          readOnly
          value={copyText}
          rows={6}
          className="w-full text-[10.5px] num p-2 rounded"
          style={{
            background: "var(--surface-2)",
            border: "1px solid var(--border)",
            color: "var(--text-2)",
          }}
        />
        <button
          className="btn-ghost mt-2"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(copyText);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch {
              setCopied(false);
            }
          }}
        >
          コピーする
        </button>
        {copied ? (
          <StatusText kind="success" className="text-[11px] mt-2">
            コピーしました
          </StatusText>
        ) : null}
      </Card>
    </div>
  );
}
