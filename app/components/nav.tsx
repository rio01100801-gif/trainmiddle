"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ForgeLogo } from "./brand/forge-logo";

type Item = { href: string; label: string; icon: JSX.Element; mobile?: boolean };

const I = {
  /*
   * TODAY はブランドの2周トラックそのもの（reference-ui の bottom-navigation.jpeg）。
   * 家のアイコンではなく、アプリの記号を最初のタブに置く。
   * ForgeMark と同じ形だが、他のアイコンと同じ 24x24 の枠に合わせてある。
   */
  home: (
    <>
      <path d="M11 5H7.5a7 7 0 000 14H11" />
      <path d="M13 5h3.5a7 7 0 010 14H13" />
      <path d="M11 9H9a3 3 0 000 6h2" />
      <path d="M13 9h2a3 3 0 010 6h-2" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </>
  ),
  /* RECORD は「録る」を表す同心円（リファレンスと同じ） */
  record: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="2.4" />
    </>
  ),
  /* ANALYTICS は高さの違う4本の棒。基線は引かない（リファレンスに合わせる） */
  chart: <path d="M5 20v-5M10 20V8M15 20v-8M20 20V5" />,
  gear: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.4 13.5a7.7 7.7 0 000-3l2-1.5-2-3.4-2.4 1a7.8 7.8 0 00-2.6-1.5L14 2h-4l-.4 2.6a7.8 7.8 0 00-2.6 1.5l-2.4-1-2 3.4 2 1.5a7.7 7.7 0 000 3l-2 1.5 2 3.4 2.4-1a7.8 7.8 0 002.6 1.5L10 22h4l.4-2.6a7.8 7.8 0 002.6-1.5l2.4 1 2-3.4z" />
    </>
  ),
  flag: <path d="M5 21V4h13l-3 4 3 4H5" />,
  trophy: (
    <>
      <path d="M8 4h8v5a4 4 0 01-8 0z" />
      <path d="M8 5H5v2a3 3 0 003 3M16 5h3v2a3 3 0 01-3 3M10 17h4M12 13v4M9 21h6" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="3.4" />
      <path d="M5 21c0-3.9 3.1-7 7-7s7 3.1 7 7" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="3.5" />
    </>
  ),
  sliders: (
    <>
      <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3" />
      <path d="M1 14h6M9 8h6M17 16h6" />
    </>
  ),
  history: (
    <>
      <path d="M3.5 12a8.5 8.5 0 108.5-8.5A8.4 8.4 0 006 6.4" />
      <path d="M3 3v4h4" />
      <path d="M12 7.5V12l3 1.8" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8" />
    </>
  ),
  db: (
    <>
      <ellipse cx="12" cy="6" rx="8" ry="3" />
      <path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
    </>
  ),
  alert: (
    <>
      <path d="M12 3l9.5 17H2.5z" />
      <path d="M12 9.5v4.5M12 17.2v.3" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6M12 7.5v.3" />
    </>
  ),
  ask: (
    <>
      <path d="M20.5 12.2c0 4-3.8 7.2-8.5 7.2a10 10 0 01-2.6-.33L4 21l1.4-3.6A6.8 6.8 0 013.5 12.2C3.5 8.2 7.3 5 12 5s8.5 3.2 8.5 7.2z" />
      <path d="M9.9 10.2a2.2 2.2 0 114.1 1c0 1.1-1.6 1.4-1.9 2.4M12 15.9v.3" />
    </>
  ),
};

const ico = (p: JSX.Element) => (
  <svg viewBox="0 0 24 24" fill="none" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
    {p}
  </svg>
);

/**
 * 下部タブは4つだけ（B-1 / FORGE: タブ数は最小限）。
 * 「設定」はヘッダー右のアイコンから開く。ハンバーガーは廃止した。
 */
export const NAV_ITEMS: Item[] = [
  { href: "/", label: "TODAY", icon: ico(I.home), mobile: true },
  { href: "/calendar", label: "PLAN", icon: ico(I.calendar), mobile: true },
  { href: "/results", label: "RECORD", icon: ico(I.record), mobile: true },
  { href: "/analysis", label: "ANALYTICS", icon: ico(I.chart), mobile: true },
];

/** 設定画面の中身（B-2の再配置先） */
export const SETTINGS_ITEMS: Item[] = [
  { href: "/setup", label: "プロフィール", icon: ico(I.user) },
  { href: "/plan-settings", label: "メニュー設定", icon: ico(I.sliders) },
  { href: "/goal", label: "目標・レース", icon: ico(I.target) },
  { href: "/heat", label: "暑熱順化", icon: ico(I.sun) },
  { href: "/past", label: "過去データの一括入力", icon: ico(I.history) },
  { href: "/data", label: "データ管理", icon: ico(I.db) },
  { href: "/sync", label: "同期（他の端末と）", icon: ico(I.db) },
  { href: "/ask", label: "相談（AI）", icon: ico(I.ask) },
  { href: "/diagnostics", label: "診断情報", icon: ico(I.info) },
];

/** 設定以外の到達先（PC左サイドバーにだけ並べる） */
const EXTRA_ITEMS: Item[] = [
  { href: "/warnings", label: "警告一覧", icon: ico(I.alert) },
  { href: "/race", label: "レース分析", icon: ico(I.flag) },
  { href: "/meet", label: "大会モード", icon: ico(I.trophy) },
];

export const SCREEN_TITLES: Record<string, string> = {
  "/": "ホーム",
  /*
   * 主要4画面の見出しは英語にする（reference-ui に合わせた技術ラベル）。
   * ナビの PLAN に対して見出しが CALENDAR なのはリファレンスどおり
   * （枠の名前と画面の名前は別でよい）。それ以外の画面は日本語のまま。
   */
  "/calendar": "CALENDAR",
  "/results": "RECORD",
  "/analysis": "PERFORMANCE",
  "/settings": "設定",
  "/setup": "プロフィール",
  "/plan-settings": "メニュー設定",
  "/goal": "目標・レース",
  "/heat": "暑熱順化",
  "/past": "過去データ",
  "/data": "データ管理",
  "/sync": "同期",
  "/diagnostics": "診断情報",
  "/ask": "相談",
  "/warnings": "警告一覧",
  "/race": "レース分析",
  "/meet": "大会モード",
  "/session": "メニューの根拠",
  "/summary": "SESSION SUMMARY",
  "/run": "セッション中の入力",
};

/**
 * ヘッダー・サイドバーのロゴ。
 *
 * 以前は緑の400mトラックのマークをワードマークの左に置いていたが、外した。
 * アプリアイコンを差し替えたとき、新しいロゴが**文字だけの構成**になり、
 * 対応するシンボルが存在しなくなったため。無いものに形を寄せられない。
 * 緑はタブと数値の側に集約する（黒白グレー90%・アクセント10%の配分）。
 *
 * 幅で指定するのは ForgeLogo が縦横比から高さを出すため。
 * ロゴがほぼ正方形（比1.22）になったので、前の46pxのままだと高さが38pxになり
 * ヘッダーが伸びる。34px → 高さ約28px に収めた。
 * **ロゴを差し替えたらここも必ず見直す。** 幅だけ据え置くと高さが勝手に変わる。
 */
export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex flex-col">
      <ForgeLogo width={compact ? 30 : 34} />
      {compact ? null : (
        <span
          className="font-semibold mt-1"
          style={{ fontSize: 8, letterSpacing: "0.24em", color: "var(--text-3)" }}
        >
          800M PERFORMANCE
        </span>
      )}
    </div>
  );
}

/** PC: 左サイドバー */
export function Sidebar() {
  const path = usePathname();
  const [athlete, setAthlete] = useState<any>(null);
  const [goal, setGoal] = useState<any>(null);

  useEffect(() => {
    fetch("/api/athlete").then((r) => r.json()).then((d) => setAthlete(d.athlete));
    fetch("/api/goal").then((r) => r.json()).then((d) => setGoal(d.goal));
  }, []);

  const group = (items: Item[], title?: string) => (
    <>
      {title ? (
        <div
          className="px-3 pt-4 pb-1.5 text-[9px] font-bold"
          style={{ letterSpacing: "0.14em", color: "var(--text-3)" }}
        >
          {title}
        </div>
      ) : null}
      {items.map((n) => {
        const on = path === n.href;
        return (
          <Link
            key={n.href}
            href={n.href}
            className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-[12.5px] font-semibold mb-0.5"
            style={{
              background: on ? "var(--surface-2)" : "transparent",
              color: on ? "var(--text)" : "var(--text-2)",
            }}
          >
            <span
              className="w-[15px] h-[15px] block [&>svg]:w-full [&>svg]:h-full"
              style={{ stroke: on ? "var(--forge)" : "var(--text-3)" }}
            >
              {n.icon}
            </span>
            {n.label}
          </Link>
        );
      })}
    </>
  );

  return (
    <aside
      className="hidden md:flex flex-col flex-shrink-0 w-[200px] p-[18px_12px] border-r overflow-y-auto"
      style={{ background: "#070707", borderColor: "var(--border)" }}
    >
      <div className="px-1.5 pb-5">
        <Logo />
      </div>
      <nav className="flex-1">
        {group(NAV_ITEMS)}
        {group(EXTRA_ITEMS)}
        {group(SETTINGS_ITEMS, "設定")}
      </nav>
      <div className="mt-auto pt-3.5 border-t" style={{ borderColor: "var(--border)" }}>
        <div className="text-[10.5px] leading-[1.7]" style={{ color: "var(--text-3)" }}>
          {athlete?.name ?? "未設定"}
          <br />
          800m PB{" "}
          <b className="num font-semibold" style={{ color: "var(--text-2)" }}>
            {athlete ? fmtT(athlete.pb800mSec) : "-"}
          </b>
          {" ／ 目標 "}
          <b className="num font-semibold" style={{ color: "var(--text-2)" }}>
            {goal ? fmtT(goal.targetTimeSec) : "-"}
          </b>
        </div>
      </div>
    </aside>
  );
}

/**
 * スマホ: 上部ヘッダー
 * B-1: ハンバーガーは廃止。左に画面名、右に設定アイコン1つだけ。
 * B-3: 現在の画面名を出し、シーズンフェーズのバッジを右に小さく常時表示する。
 */
export function MobileHeader() {
  const path = usePathname();
  const [phase, setPhase] = useState<string | undefined>();

  useEffect(() => {
    fetch("/api/dashboard")
      .then((r) => r.json())
      .then((d) => setPhase(d?.currentPhase))
      .catch(() => {});
  }, []);

  const title = SCREEN_TITLES[path] ?? "FORGE";

  return (
    <header
      className="md:hidden flex items-center gap-2 px-4 pb-2.5 border-b sticky top-0 z-30"
      style={{
        background: "var(--bg)",
        borderColor: "var(--border)",
        /*
         * ホーム画面から起動すると（standalone表示）ブラウザのバーが無くなり、
         * iOSのステータスバーの下に画面が潜り込む。index.html が
         * viewport-fit=cover ＋ black-translucent なので、safe-area を自分で空ける。
         * 設定ボタンは -m-3（-12px）でタップ領域を広げているぶんを見込んで +14px。
         */
        paddingTop: "calc(var(--sat) + 14px)",
      }}
    >
      {path === "/" ? (
        <Logo compact />
      ) : (
        <h1 className="text-[16px] font-extrabold tracking-tight">{title}</h1>
      )}

      <div className="ml-auto flex items-center gap-2">
        {phase ? (
          <span
            className="text-[9.5px] font-bold px-2 py-1 rounded-md whitespace-nowrap"
            style={{
              background: "var(--surface-2)",
              color: "var(--text-3)",
              letterSpacing: "0.06em",
            }}
          >
            {phase}
          </span>
        ) : null}
        {/* B-1: タップ領域 44×44pt */}
        <Link
          href="/settings"
          aria-label="設定"
          aria-current={path === "/settings" ? "page" : undefined}
          className="-m-3 p-3 min-w-[44px] min-h-[44px] flex items-center justify-center"
        >
          <span
            className="w-[21px] h-[21px] block [&>svg]:w-full [&>svg]:h-full"
            style={{ stroke: path === "/settings" ? "var(--forge)" : "var(--text-2)" }}
          >
            {ico(I.gear)}
          </span>
        </Link>
      </div>
    </header>
  );
}

/** スマホ: 下部タブバー（4つ） */
export function BottomTabs() {
  const path = usePathname();
  return (
    <nav
      aria-label="主要ナビゲーション"
      className="md:hidden fixed bottom-0 left-0 right-0 z-30 flex border-t pt-2"
      style={{
        background: "#070707",
        borderColor: "var(--border)",
        paddingBottom: "calc(var(--sab) + 12px)",
      }}
    >
      {NAV_ITEMS.filter((n) => n.mobile).map((n) => {
        const on = path === n.href;
        return (
          <Link
            key={n.href}
            href={n.href}
            aria-current={on ? "page" : undefined}
            data-on={on ? "1" : "0"}
            className="flex-1 text-center text-[9px] font-bold min-h-[44px] flex flex-col justify-center"
            style={{
              color: on ? "var(--forge)" : "var(--text-3)",
              // リファレンスのラベルは英大文字＋字送り。字送りぶん右にずれるので相殺する
              letterSpacing: ".08em",
              textIndent: ".08em",
            }}
          >
            <span
              className="w-[21px] h-[21px] block mx-auto mb-1.5 [&>svg]:w-full [&>svg]:h-full"
              style={{ stroke: "currentColor" }}
            >
              {n.icon}
            </span>
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}

function fmtT(sec?: number): string {
  if (!sec) return "-";
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return m > 0 ? `${m}:${s.toFixed(2).padStart(5, "0")}` : s.toFixed(2);
}
