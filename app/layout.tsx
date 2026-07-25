import "./globals.css";
import type { ReactNode } from "react";
import { BottomTabs, MobileHeader, Sidebar } from "./components/nav";
import { RecordFab } from "./components/fab";

export const metadata = {
  title: "FORGE — 800m Performance System",
  description: "FORGE — 800m Performance System",
};

export const viewport = {
  themeColor: "#0a0a0a",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <body>
        <div className="flex min-h-screen">
          <Sidebar />
          <div className="flex-1 min-w-0 flex flex-col">
            <MobileHeader />
            <main className="flex-1 p-3.5 md:p-5 pb-24 md:pb-6 max-w-[1200px] w-full">
              {children}
            </main>
            <footer
              className="hidden md:flex justify-between text-[10px] px-5 pb-4"
              style={{ color: "var(--text-3)" }}
            >
              <span>FORGE ／ データはこの端末に保存されています</span>
              <span>Built Through Training.</span>
            </footer>
          </div>
        </div>
        <RecordFab />
        <BottomTabs />
      </body>
    </html>
  );
}
