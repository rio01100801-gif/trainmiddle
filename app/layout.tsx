import "./globals.css";
import type { ReactNode } from "react";
import { AppShell } from "./components/app-shell";

export const metadata = {
  title: "FORGE — 800m Performance System",
  description: "FORGE — 800m Performance System",
  icons: {
    icon: [
      { url: "/icon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/icon-180.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport = {
  themeColor: "#0a0a0a",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
} satisfies import("next").Viewport;

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
