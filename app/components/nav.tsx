"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

type Item = { href: string; label: string; icon: JSX.Element; mobile?: boolean };

const I = {
  home: <path d="M3 10l9-7 9 7v10a1 1 0 01-1 1h-5v-7H9v7H4a1 1 0 01-1-1z" />,
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </>
  ),
  record: <path d="M12 3v18M5 8v13M19 12v9" />,
  chart: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
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
  { href: "/", label: "ホーム", icon: ico(I.home), mobile: true },
  { href: "/calendar", label: "カレンダー", icon: ico(I.calendar), mobile: true },
  { href: "/results", label: "記録", icon: ico(I.record), mobile: true },
  { href: "/analysis", label: "分析", icon: ico(I.chart), mobile: true },
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
];

/** 設定以外の到達先（PC左サイドバーにだけ並べる） */
const EXTRA_ITEMS: Item[] = [
  { href: "/warnings", label: "警告一覧", icon: ico(I.alert) },
  { href: "/race", label: "レース分析", icon: ico(I.flag) },
  { href: "/meet", label: "大会モード", icon: ico(I.trophy) },
];

export const SCREEN_TITLES: Record<string, string> = {
  "/": "ホーム",
  "/calendar": "カレンダー",
  "/results": "記録",
  "/analysis": "分析",
  "/settings": "設定",
  "/setup": "プロフィール",
  "/plan-settings": "メニュー設定",
  "/goal": "目標・レース",
  "/heat": "暑熱順化",
  "/past": "過去データ",
  "/data": "データ管理",
  "/sync": "同期",
  "/warnings": "警告一覧",
  "/race": "レース分析",
  "/meet": "大会モード",
  "/session": "メニューの根拠",
  "/run": "セッション中の入力",
};

/**
 * FORGE マーク（R-3）。400mトラック。
 *
 * アプリアイコン（pwa/icon.svg）と同じ形。ヘッダー・サイドバー・
 * 起動画面で同じものが出るようにしておく。
 *
 * 中央の切れ目（スタート／フィニッシュ）は、黒い矩形を重ねるのではなく
 * 左右2本のパスに分けて描く。重ねる方式だと、背景色が違う場所
 * （サイドバーは #070707）で切れ目だけ色が合わなくなる。
 *
 * `size` は高さ。トラックは横長なので幅はその約1.85倍になる。
 */
export function ForgeMark({ size = 18 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 148 80"
      style={{ height: size, width: size * 1.85 }}
      fill="none"
      stroke="var(--forge)"
      strokeWidth={12}
      aria-hidden
    >
      <path d="M68 6 H40 A34 34 0 0 0 40 74 H68" />
      <path d="M80 6 H108 A34 34 0 0 1 108 74 H80" />
      <path d="M68 22 H52 A18 18 0 0 0 52 58 H68" />
      <path d="M80 22 H96 A18 18 0 0 1 96 58 H80" />
    </svg>
  );
}

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <ForgeMark size={compact ? 16 : 20} />
      <div className="flex flex-col">
        {/*
          アイコンのワードマークが斜体なので、画面側も同じ傾きにする（R-3）。
          font-style: italic ではなく skew を使うのは、
          等幅の数字と同じ幾何的な傾きにしたいため（フォント任せだと形が変わる）。
        */}
        <b
          className="font-black leading-none tracking-tight"
          style={{
            fontSize: compact ? 15 : 19,
            letterSpacing: "0.02em",
            transform: "skewX(-8deg)",
            transformOrigin: "left center",
            display: "inline-block",
          }}
        >
          FORGE
        </b>
        {compact ? null : (
          <span
            className="font-semibold mt-1"
            style={{ fontSize: 8, letterSpacing: "0.24em", color: "var(--text-3)" }}
          >
            800M PERFORMANCE
          </span>
        )}
      </div>
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
            className="flex-1 text-center text-[9.5px] font-semibold min-h-[44px] flex flex-col justify-center"
            style={{ color: on ? "var(--forge)" : "var(--text-3)" }}
          >
            <span
              className="w-[19px] h-[19px] block mx-auto mb-1 [&>svg]:w-full [&>svg]:h-full"
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
