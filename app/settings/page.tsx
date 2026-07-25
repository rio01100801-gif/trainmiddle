"use client";
import Link from "next/link";
import { Card } from "../components/ui";
import { SETTINGS_ITEMS } from "../components/nav";

/**
 * 設定画面（B-1 / B-2）
 *
 * ハンバーガーの12項目のうち、日々使わないものをここへ集約する。
 * 「機能を消す」のではなく「置き場所を変える」ことが目的なので、
 * 旧メニューから到達できたものは必ずここか下部タブから到達できる。
 */
const ELSEWHERE: { label: string; where: string; href: string }[] = [
  { label: "レース分析", where: "分析タブ内のセグメント「レース」", href: "/race" },
  { label: "大会モード", where: "ホームのRACEセクション（前日・当日は自動で昇格）", href: "/meet" },
  { label: "過去データの入力", where: "カレンダーの日付タップからも入力できます", href: "/calendar" },
  { label: "警告の一覧", where: "ホームとカレンダーの警告バッジから", href: "/warnings" },
];

export default function SettingsPage() {
  return (
    <div className="flex flex-col gap-3">
      <Card title="設定">
        <div className="flex flex-col">
          {SETTINGS_ITEMS.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className="flex items-center gap-3 py-3 border-b last:border-0 min-h-[48px]"
              style={{ borderColor: "var(--border)" }}
            >
              <span
                className="w-[17px] h-[17px] block [&>svg]:w-full [&>svg]:h-full flex-shrink-0"
                style={{ stroke: "var(--text-3)" }}
              >
                {n.icon}
              </span>
              <span className="text-[13.5px] font-semibold flex-1">{n.label}</span>
              <span style={{ color: "var(--text-3)" }}>→</span>
            </Link>
          ))}
        </div>
      </Card>

      <Card title="別の場所へ移動した項目">
        <p className="text-[11.5px] leading-relaxed mb-2.5" style={{ color: "var(--text-3)" }}>
          以前このメニューにあった項目のうち、日常の導線に組み込んだものです。
          機能は削除していません。
        </p>
        <div className="flex flex-col">
          {ELSEWHERE.map((e) => (
            <Link
              key={e.label}
              href={e.href}
              className="py-2.5 border-b last:border-0"
              style={{ borderColor: "var(--border)" }}
            >
              <div className="text-[12.5px] font-semibold">{e.label}</div>
              <div className="text-[11px] mt-0.5" style={{ color: "var(--text-3)" }}>
                {e.where}
              </div>
            </Link>
          ))}
        </div>
      </Card>

      <Card title="FORGE について">
        <p className="text-[12px] leading-relaxed" style={{ color: "var(--text-2)" }}>
          FORGE は 800m の練習を組み立て、危険な構成を機械的に検出するための
          パフォーマンスシステムです。CFE・ACWR・転移度・ルール判定はすべて
          端末内で計算しており、外部にデータを送っていません。
        </p>
      </Card>
    </div>
  );
}
