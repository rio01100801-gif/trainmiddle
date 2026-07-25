import "./globals.css";
import type { ReactNode } from "react";
import { AppShell } from "./components/app-shell";

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
        {/* 枠は PWA と共有する（app/components/app-shell.tsx） */}
        <AppShell footer>{children}</AppShell>
      </body>
    </html>
  );
}
