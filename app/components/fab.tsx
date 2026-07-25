"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { localToday } from "@/lib/core/dates";
import { withQuery } from "./route";

/**
 * 記録追加のフローティングボタン（D-3）
 *
 * どの画面からでも1タップで記録に入れるようにする。
 * 記録タブそのものを開いているときは邪魔になるだけなので出さない。
 */
export function RecordFab() {
  // ハッシュ遷移では "/run?sessionId=..." のようにクエリが付く。
  // パス部分だけで判定しないと、クエリ付きで来たときに非表示にならない
  const path = (usePathname() ?? "/").split("?")[0];
  const [open, setOpen] = useState(false);
  const today = localToday();

  // 走っている最中は誤タップの元になるので出さない
  if (path === "/results" || path === "/setup" || path === "/run") return null;

  return (
    <>
      {open ? (
        <div
          className="fixed inset-0 z-40 bg-black/60"
          onClick={() => setOpen(false)}
          aria-hidden
        />
      ) : null}

      <div
        className="fixed right-4 z-50 flex flex-col items-end gap-2"
        style={{ bottom: "calc(var(--sab) + 78px)" }}
      >
        {open ? (
          <>
            <FabItem href={withQuery("/results", { date: today })} label="今日を記録" />
            <FabItem href="/calendar" label="日付を選んで記録" />
            <FabItem href={withQuery("/results", { seg: "marker" })} label="実測データを追加" />
            <FabItem href="/past" label="過去データをまとめて入力" />
          </>
        ) : null}

        <button
          aria-label={open ? "閉じる" : "記録を追加"}
          onClick={() => setOpen(!open)}
          className="min-w-[52px] min-h-[52px] rounded-full flex items-center justify-center font-black"
          style={{
            background: "var(--forge)",
            color: "var(--volt-ink)",
            fontSize: 24,
            lineHeight: 1,
            border: 0,
            transition: "transform 160ms ease",
            transform: open ? "rotate(45deg)" : "none",
          }}
        >
          +
        </button>
      </div>
    </>
  );
}

function FabItem({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="px-3.5 py-2.5 rounded-xl text-[12.5px] font-bold whitespace-nowrap border min-h-[44px] flex items-center"
      style={{
        background: "var(--surface)",
        borderColor: "var(--border-2)",
        color: "var(--text)",
      }}
    >
      {label}
    </Link>
  );
}
