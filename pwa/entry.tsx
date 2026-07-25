/**
 * PWA エントリ。既存の画面コンポーネントをそのまま使い、
 * ルーティング(ハッシュ)・ストレージ(IndexedDB)・API(シム)だけ差し替える。
 */
import * as React from "react";
import { createRoot } from "react-dom/client";
import { BottomTabs, MobileHeader, Sidebar } from "../app/components/nav";
import { RecordFab } from "../app/components/fab";
import { Card, ConfirmButton } from "../app/components/ui";

import Dashboard from "../app/page";
import Setup from "../app/setup/page";
import Goal from "../app/goal/page";
import Calendar from "../app/calendar/page";
import Results from "../app/results/page";
import Analysis from "../app/analysis/page";
import Race from "../app/race/page";
import Meet from "../app/meet/page";
import Heat from "../app/heat/page";
import PlanSettings from "../app/plan-settings/page";
import Past from "../app/past/page";
import Settings from "../app/settings/page";
import Warnings from "../app/warnings/page";
import SessionDetail from "../app/session/page";
import SharedDataPage from "../app/data/page";
import RunPage from "../app/run/page";

import { installApiShim } from "./api-shim";
import { AppState, emptyState, loadState, MemoryStore, persistState } from "./memory-store";

// ハッシュナビゲーションを有効化（next/link・next/navigation スタブが参照する）
(globalThis as any).__HASH_NAV__ = true;

// ---------------------------------------------------------------------------
// データ管理画面（PWA専用: エクスポート / インポート / 初期化）
// ---------------------------------------------------------------------------

let storeRef: MemoryStore;

/**
 * Apple ヘルスケア連携（エクスポートファイルの取り込み）
 * HealthKit は Safari から直接呼べないため、標準の書き出し機能を経由する。
 */
function HealthImportCard() {
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState("");
  const [result, setResult] = React.useState<any | null>(null);
  const [syncs, setSyncs] = React.useState<any[]>([]);

  const loadSyncs = React.useCallback(() => {
    fetch("/api/health-import")
      .then((r) => r.json())
      .then((d) => setSyncs(d.syncs ?? []));
  }, []);
  React.useEffect(loadSyncs, [loadSyncs]);

  const handleFile = async (file: File) => {
    setBusy(true);
    setMsg("読み込み中…（ファイルが大きい場合は1分ほどかかります）");
    setResult(null);
    try {
      let xml: string;
      if (file.name.endsWith(".zip")) {
        setMsg(
          "zipのままでは読み込めません。zipを解凍して、中の「書き出したデータ.xml」または export.xml を選んでください。"
        );
        setBusy(false);
        return;
      }
      xml = await file.text();
      const res = await fetch("/api/health-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ xml, days: 120 }),
      });
      const d = await res.json();
      if (d.error) {
        setMsg(d.error);
      } else {
        setResult(d);
        setMsg("");
        loadSyncs();
      }
    } catch (e) {
      setMsg(`読み込めませんでした: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const last = syncs[0];

  return (
    <Card title="Apple ヘルスケア連携">
      {last ? (
        <p className="text-[12px] mb-2">
          最終同期{" "}
          <b className="num">
            {new Date(last.syncedAt).toLocaleString("ja-JP", {
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </b>
          <span style={{ color: "var(--text-2)" }}>
            {" "}
            ／ ワークアウト{last.workouts}件・日次{last.dailyChecks}件
          </span>
        </p>
      ) : null}

      <p className="text-[12px] leading-relaxed mb-3" style={{ color: "var(--text-2)" }}>
        iPhoneの「ヘルスケア」アプリ → 右上のアイコン → 一番下の
        <b style={{ color: "var(--text)" }}>「すべてのヘルスケアデータを書き出す」</b>
        で作られるファイルを読み込みます。睡眠・安静時心拍・HRV・ランニングの記録が、
        疲労シグナルとLT推定・CFEに反映されます。
      </p>

      <label className="btn-volt inline-flex cursor-pointer justify-center w-full sm:w-auto min-h-[44px]">
        {busy ? "読み込み中…" : "書き出したデータを選ぶ"}
        <input
          type="file"
          accept=".xml,text/xml,application/xml"
          className="hidden"
          disabled={busy}
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
        />
      </label>

      {msg ? (
        <p className="text-[12px] mt-2" style={{ color: "var(--amber)" }}>
          {msg}
        </p>
      ) : null}

      {result ? (
        <div className="mt-3 pt-3 border-t text-[12px]" style={{ borderColor: "var(--border)" }}>
          <p style={{ color: "var(--volt)" }}>
            ✓ 取り込み完了: ワークアウト{result.sync.workouts}件・日次データ
            {result.sync.dailyChecks}件
            {result.sync.fromDate ? `（${result.sync.fromDate}〜${result.sync.toDate}）` : ""}
          </p>
          {result.sync.note ? (
            <p className="text-[11px] mt-1" style={{ color: "var(--text-2)" }}>
              {result.sync.note}
            </p>
          ) : null}
          {result.hrvNote ? (
            <p className="text-[11px] mt-1" style={{ color: "var(--amber)" }}>
              {result.hrvNote}
            </p>
          ) : null}
          {result.ltUpdated ? (
            <p className="text-[11px] mt-1" style={{ color: "var(--text-2)" }}>
              ランニング記録がLT推定に反映されました。「目標・レース」で再生成すると設定ペースに反映されます。
            </p>
          ) : null}
          {result.signalChanges?.length > 0 ? (
            <p className="text-[11px] mt-1" style={{ color: "var(--text-2)" }}>
              疲労シグナルが緑以外になった日: {result.signalChanges.length}日
            </p>
          ) : null}
        </div>
      ) : null}

      <details className="text-[11px] mt-3">
        <summary style={{ color: "var(--text-3)" }}>
          自動同期にならない理由と、将来の対応
        </summary>
        <p className="mt-1.5 leading-relaxed" style={{ color: "var(--text-2)" }}>
          HealthKit（ヘルスケアのデータを直接読む仕組み）は iOS のネイティブアプリ専用で、
          Safari やホーム画面に追加したアプリからは技術的に呼び出せません。
          そのため現状は手動での書き出し・取り込みになります。
          自動同期を実現するには iOS ネイティブアプリ化（Apple Developer Program 年99ドルが必要）
          が前提になります。
        </p>
      </details>
    </Card>
  );
}

/**
 * データ管理（PWA）。
 * 書き出し・復元・接地時間の取り込みは共通画面（app/data）に寄せる。
 * ここでは Apple ヘルスケアの取り込みと、PWA固有の初期化だけを足す。
 */
function DataPage() {
  const [msg, setMsg] = React.useState("");

  const reset = () => {
    if (!confirm("すべてのデータを削除します。よろしいですか？（バックアップ推奨）")) return;
    storeRef.replaceState(emptyState());
    setMsg("初期化しました。ページを再読み込みします…");
    setTimeout(() => location.reload(), 800);
  };

  return (
    <div className="flex flex-col gap-3">
      <HealthImportCard />
      <SharedDataPage />
      <Card title="この端末のデータ">
        <p className="text-[12px] leading-relaxed mb-3" style={{ color: "var(--text-2)" }}>
          データはこの端末の中だけに保存されています（外部送信はありません）。
          Safariのデータ消去やストレージの整理で消えることがあるので、
          上の書き出しを月に1回は取っておいてください。
        </p>
        <button className="btn-ghost" style={{ color: "var(--red)" }} onClick={reset}>
          全データを初期化
        </button>
        {msg ? <p className="text-[12px] mt-3">{msg}</p> : null}
      </Card>
      <Card title="このアプリについて">
        <p className="text-[12px] leading-relaxed" style={{ color: "var(--text-2)" }}>
          800m特化トレーニング管理ツール（PWA版）。オフラインでも動作します。
          ホーム画面に追加すると通常のアプリのように使えます:
          Safariの共有ボタン → 「ホーム画面に追加」。
        </p>
      </Card>
    </div>
  );
}

// データ管理は SETTINGS_ITEMS（設定画面）に既に入っているので、
// 下部タブ用の NAV_ITEMS には追加しない（B-1: タブは4つだけ）。

// ---------------------------------------------------------------------------

const PAGES: Record<string, React.ComponentType> = {
  "/": Dashboard,
  "/setup": Setup,
  "/goal": Goal,
  "/calendar": Calendar,
  "/results": Results,
  "/analysis": Analysis,
  "/race": Race,
  "/meet": Meet,
  "/heat": Heat,
  "/plan-settings": PlanSettings,
  "/past": Past,
  "/settings": Settings,
  "/warnings": Warnings,
  "/session": SessionDetail,
  "/data": DataPage,
  "/run": RunPage,
};

function usePath(): string {
  const get = () => {
    // "#/results?date=2026-07-20" のようにクエリが付くので、
    // ルート照合ではパス部分だけを見る（クエリは useQueryParam が読む）。
    const h = location.hash.replace(/^#/, "").split("?")[0];
    return h === "" ? "/" : h;
  };
  return React.useSyncExternalStore(
    (cb) => {
      window.addEventListener("hashchange", cb);
      return () => window.removeEventListener("hashchange", cb);
    },
    get,
    get
  );
}

function App() {
  const path = usePath();
  const Page = PAGES[path] ?? Dashboard;
  React.useEffect(() => {
    window.scrollTo(0, 0);
  }, [path]);
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex-1 min-w-0 flex flex-col">
        <MobileHeader />
        <main className="flex-1 p-3.5 md:p-5 pb-24 md:pb-6 max-w-[1200px] w-full">
          <Page key={path} />
        </main>
      </div>
      <RecordFab />
      <BottomTabs />
    </div>
  );
}

// ---------------------------------------------------------------------------

async function boot() {
  const state = await loadState();
  storeRef = new MemoryStore(state, persistState);
  installApiShim(storeRef, () => {
    /* MemoryStore.onChange が永続化する */
  });

  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker
      .register("./sw.js")
      .then((reg) => {
        // 起動のたびに更新を確認する（ホーム画面から起動しても新版が届くように）
        reg.update().catch(() => {});
        // 新しいSWが制御を取ったら1度だけ自動リロードして新版を反映する。
        // これが無いと、配信側を差し替えても端末は古い画面のままになる。
        //
        // ただし「初回訪問」は除く。初回は controller が null の状態から
        // SWが制御を取るので controllerchange が必ず発火するが、これは更新ではない。
        // ここで除外しないと、初めて開いた人が毎回1回リロードされる（画面がちらつく）。
        const hadController = navigator.serviceWorker.controller !== null;
        let refreshed = false;
        navigator.serviceWorker.addEventListener("controllerchange", () => {
          if (!hadController || refreshed) return;
          refreshed = true;
          location.reload();
        });
      })
      .catch(() => {
        /* オフラインキャッシュなしでも動作は可能 */
      });
  }

  createRoot(document.getElementById("root")!).render(<App />);
}

boot();
