"use client";
import type { ReactNode } from "react";
import { BottomTabs, MobileHeader, Sidebar } from "./nav";
import { RecordFab } from "./fab";

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
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex-1 min-w-0 flex flex-col">
        <MobileHeader />
        <main className="flex-1 p-3.5 md:p-5 pb-[var(--main-bottom-pad)] md:pb-6 max-w-[1200px] w-full">
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
