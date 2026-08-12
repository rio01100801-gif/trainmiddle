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

/**
 * 読み込み表示。細い線と3つの点だけ。
 *
 * 以前は400mトラックを描いていく演出だったが、毎日開く道具に
 * 毎回2.5秒の見せ場を入れるのは重い。PWA側（pwa/index.html）と
 * 同じ見た目にしてある——**片方だけ変えると、同じアプリなのに
 * 起動画面が実行環境で違う**ので、両方まとめて直すこと。
 */
function LoadingIndicator() {
  return (
    <div className="launch-loader" aria-hidden="true">
      <span className="launch-loader-bar" />
      <span className="launch-loader-dots">
        <i />
        <i />
        <i />
      </span>
    </div>
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
    // pwa/index.html の minimumMs と同じ値にする（起動の体感を環境で変えない）
    const minimum = reduced ? 900 : 2_000;
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
        <div className="launch-brand">
          {/*
            ワードマークは画像（マスク）。以前は skewX をかけた太字テキストで、
            旧アイコンの斜体に寄せていた。新しいロゴは専用の字形なので似せられない。
          */}
          <span className="forge-wordmark launch-wordmark" role="img" aria-label="FORGE" />
          <span>800M PERFORMANCE</span>
        </div>
        <LoadingIndicator />
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
