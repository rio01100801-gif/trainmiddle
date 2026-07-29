"use client";
import { useEffect, type ReactNode } from "react";
import { BottomTabs, MobileHeader, Sidebar } from "./nav";
import { RecordFab } from "./fab";
import { authRedirectLanding } from "@/lib/core/sync";
import { captureAuthRedirect, isHashNavigationRuntime } from "./supabase";
import { LaunchSplash } from "./launch-splash";

/**
 * 画面の外枠。
 *
 * **Next.js の layout.tsx と PWA の entry.tsx の両方がここを使う。唯一の実装。**
 * 以前は同じ枠を2か所に書いていたので、片方だけ直しても
 * もう片方の実行環境では直らなかった（画面には何も出ないので気づけない）。
 *
 * P-4: 下部タブバーとFABは position:fixed なので、スクロール領域の下端に
 * そのぶんの余白（--main-bottom-pad）を確保する。画面ごとに padding を
 * 足して回ると、足し忘れた画面だけ最下部がタブバーの裏に入る。
 * PC（md以上）はタブバーもFABも出ないので通常の余白に戻す。
 */
export function AppShell({ children, footer }: { children: ReactNode; footer?: boolean }) {
  /*
   * サインインから戻ってきたトークンを、どの画面に着いても拾う。
   *
   * Supabase は戻り先に `#access_token=...` を付けて返すが、
   * この枠はハッシュルーティングなので、戻り先のハッシュは指定できない
   * （付け足されて消える）。結果、以前はルート＝ホーム画面に戻り、
   * トークンを誰も読まないまま捨てていた（サインインが黙って失敗する）。
   *
   * 受け取りを同期画面ではなくここに置いて、着地点に関係なく拾う。
   *
   * 以前は `?sync=1` というクエリが残っていることを前提に同期画面へ戻していたが、
   * Supabase の Redirect URLs にこのURLを登録していないと、Supabase は
   * redirect_to を無視して Site URL へ飛ばすためクエリごと落ちる。
   * その結果、サインインは成功してトークンも保存されるのに、画面だけ
   * ホームに居座り続けていた（実機で確認済み）。
   *
   * captureAuthRedirect が何か拾えた時点で、それは必ず signInWithGoogle が
   * 発行した redirect_to からの戻りなので、クエリの有無を問わず同期画面へ戻す。
   * 判断は sync.ts の authRedirectLanding に集約する（純関数でテストするため）。
   */
  useEffect(() => {
    const captured = captureAuthRedirect();
    if (!captured) return;

    // クエリ・ハッシュを消してから同期画面へ。トークンはcaptureAuthRedirectが除去済み。
    history.replaceState(null, "", location.pathname);
    const landing = authRedirectLanding(isHashNavigationRuntime(), location.pathname);
    if (landing.hash) {
      location.hash = landing.hash;
    } else if (landing.pathname) {
      location.replace(new URL(landing.pathname, location.origin).toString());
    }
  }, []);

  return (
    <div className="flex min-h-screen">
      <LaunchSplash />
      <Sidebar />
      <div className="flex-1 min-w-0 flex flex-col">
        <MobileHeader />
        <main className="app-main flex-1 p-3.5 md:p-5 pb-[var(--main-bottom-pad)] md:pb-6 max-w-[1200px] w-full">
          {children}
        </main>
        {footer ? (
          <footer
            className="hidden md:flex justify-between text-[10px] px-5 pb-4"
            style={{ color: "var(--text-3)" }}
          >
            <span>FORGE ／ データはこの端末に保存されています</span>
            <span>Built Through Training.</span>
          </footer>
        ) : null}
      </div>
      <RecordFab />
      <BottomTabs />
    </div>
  );
}
