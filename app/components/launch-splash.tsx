"use client";

import { useEffect, useRef, useState } from "react";
import {
  buildSplashSummary,
  saveSplashSummary,
  SPLASH_KEY,
  type SplashDashboardData,
  type SplashSummary,
} from "./splash-cache";

type SplashView = {
  label: string;
  value: string;
  sub: string;
};

function daysUntil(date?: string): number | undefined {
  if (!date) return undefined;
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const race = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(race)) return undefined;
  const days = Math.round((race - today) / 86_400_000);
  return days >= 0 ? days : undefined;
}

function toView(
  summary: SplashSummary | null,
  dataReady: boolean,
  dataFailed: boolean
): SplashView {
  const days = daysUntil(summary?.raceDate);
  if (days !== undefined) {
    return {
      label: "レースまで",
      value: `${days}日`,
      sub: summary?.gapText ?? summary?.fallbackText ?? "目標を設定",
    };
  }
  if (summary?.fallbackText) {
    return { label: "CURRENT", value: summary.fallbackText, sub: "目標レースを設定" };
  }
  if (!dataReady && !dataFailed) {
    return { label: "INITIALIZING", value: "データ読込中", sub: "端末内の情報を確認しています" };
  }
  if (dataFailed) {
    return { label: "OFFLINE READY", value: "ローカルで起動", sub: "同期は接続回復後に再開できます" };
  }
  return { label: "NEXT RACE", value: "レース未設定", sub: "目標を設定" };
}

function TrackArtwork() {
  return (
    <svg className="launch-track mark" viewBox="0 0 720 300" aria-hidden="true">
      <defs>
        <filter id="launch-glow" x="-30%" y="-50%" width="160%" height="200%">
          <feGaussianBlur stdDeviation="8" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <path className="launch-lane launch-lane-muted" d="M72 172C72 72 648 72 648 172S72 272 72 172Z" />
      <path className="launch-lane launch-lane-muted" d="M110 172C110 102 610 102 610 172S110 242 110 172Z" />
      <path className="launch-lane launch-lane-live" d="M72 172C72 72 648 72 648 172S72 272 72 172Z" />
      <path className="launch-lane launch-lane-live launch-lane-delay" d="M110 172C110 102 610 102 610 172S110 242 110 172Z" />
      <circle className="launch-finish" cx="648" cy="172" r="8" />
    </svg>
  );
}

export function LaunchSplash() {
  const mountedAt = useRef(Date.now());
  const [visible, setVisible] = useState(true);
  const [summary, setSummary] = useState<SplashSummary | null>(null);
  const [dataReady, setDataReady] = useState(false);
  const [dataFailed, setDataFailed] = useState(false);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    // PWAはbundle読込前から同じ演出を出しているため、二重表示しない。
    if (document.getElementById("splash")) {
      setVisible(false);
      return;
    }

    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(media.matches);

    try {
      const cached = localStorage.getItem(SPLASH_KEY);
      if (cached) setSummary(JSON.parse(cached) as SplashSummary);
    } catch {
      // 保存領域が使えない場合は読み込み中のフォールバックを表示する。
    }

    const abort = new AbortController();
    const abortTimer = window.setTimeout(() => abort.abort(), 4_200);
    fetch("/api/dashboard", { cache: "no-store", signal: abort.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`dashboard HTTP ${response.status}`);
        const data = (await response.json()) as SplashDashboardData;
        const next = buildSplashSummary(data);
        setSummary(next);
        saveSplashSummary(data);
        setDataReady(true);
      })
      .catch(() => {
        setDataFailed(true);
        setDataReady(true);
      })
      .finally(() => window.clearTimeout(abortTimer));

    return () => {
      abort.abort();
      window.clearTimeout(abortTimer);
    };
  }, []);

  useEffect(() => {
    if (!visible || !dataReady) return;
    const minimum = reduced ? 650 : 2_800;
    const elapsed = Date.now() - mountedAt.current;
    const timer = window.setTimeout(() => setVisible(false), Math.max(0, minimum - elapsed));
    return () => window.clearTimeout(timer);
  }, [dataReady, reduced, visible]);

  useEffect(() => {
    if (!visible) return;
    const maximum = window.setTimeout(() => {
      setDataFailed(true);
      setDataReady(true);
    }, 4_500);
    return () => window.clearTimeout(maximum);
  }, [visible]);

  if (!visible) return null;
  const view = toView(summary, dataReady, dataFailed);

  return (
    <div
      className={`launch-splash${reduced ? " launch-splash-reduced" : ""}`}
      role="status"
      aria-live="polite"
      aria-busy={!dataReady}
      aria-label={dataReady ? `${view.label} ${view.value} ${view.sub}` : "FORGEを起動しています"}
    >
      <div className="launch-splash-inner">
        <TrackArtwork />
        <div className="launch-brand">
          <strong>FORGE</strong>
          <span>800M PERFORMANCE</span>
        </div>
        <div className="launch-data">
          <span className="launch-data-label">{view.label}</span>
          <b className="launch-data-value">{view.value}</b>
          <span className="launch-data-sub">{view.sub}</span>
        </div>
        {!dataReady ? <span className="launch-wait">初期データを読み込んでいます</span> : null}
      </div>
    </div>
  );
}
