/**
 * 実コンポーネント検証用エントリ。
 * window.__PAGE__ で指定されたページを、実データfixtures + fetchスタブで描画する。
 */
import * as React from "react";
import { createRoot } from "react-dom/client";
import { BottomTabs, MobileHeader, Sidebar } from "../app/components/nav";

import Dashboard from "../app/page";
import Setup from "../app/setup/page";
import Goal from "../app/goal/page";
import Calendar from "../app/calendar/page";
import Results from "../app/results/page";
import Analysis from "../app/analysis/page";
import Race from "../app/race/page";
import Meet from "../app/meet/page";
import Heat from "../app/heat/page";

import fixtures from "./fixtures.json";

const PAGES: Record<string, { C: React.ComponentType; path: string }> = {
  dashboard: { C: Dashboard, path: "/" },
  setup: { C: Setup, path: "/setup" },
  goal: { C: Goal, path: "/goal" },
  calendar: { C: Calendar, path: "/calendar" },
  results: { C: Results, path: "/results" },
  analysis: { C: Analysis, path: "/analysis" },
  race: { C: Race, path: "/race" },
  meet: { C: Meet, path: "/meet" },
  heat: { C: Heat, path: "/heat" },
};

// fetch スタブ: fixtures から実データを返す。/api/sessions は from/to でフィルタ
const fx = fixtures as Record<string, any>;
(window as any).fetch = async (url: string, init?: RequestInit) => {
  const u = new URL(url, "http://localhost");
  let body: any = fx[u.pathname] ?? {};
  if (u.pathname === "/api/sessions" && !init?.method) {
    const from = u.searchParams.get("from");
    const to = u.searchParams.get("to");
    body = {
      sessions: fx["/api/sessions"].sessions.filter(
        (s: any) => (!from || s.date >= from) && (!to || s.date <= to)
      ),
      strengthSessions: fx["/api/sessions"].strengthSessions.filter(
        (s: any) => (!from || s.date >= from) && (!to || s.date <= to)
      ),
    };
  }
  if (init?.method === "POST" || init?.method === "PATCH") {
    body = { ok: true, violations: [], signal: "yellow", action: "強度は維持し、量を30%減", reasons: ["テスト"], changes: [] };
  }
  return {
    ok: true,
    json: async () => body,
  } as Response;
};

const key = (window as any).__PAGE__ ?? "dashboard";
const { C, path } = PAGES[key];
(globalThis as any).__PATH__ = path;

function App() {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex-1 min-w-0 flex flex-col">
        <MobileHeader />
        <main className="flex-1 p-3.5 md:p-5 pb-24 md:pb-6 max-w-[1200px] w-full">
          <C />
        </main>
      </div>
      <BottomTabs />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
