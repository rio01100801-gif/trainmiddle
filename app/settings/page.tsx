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
/**
 * P-5 何ができるかを1行で添え、用途で3つに分ける。
 *
 * 名前だけが縦に並んでいると、開いたことのない画面は
 * 「何をするところか」が分からないまま素通りになる（存在に気づけない）。
 * 画面を増やさず、説明を足すことで解決する。
 */
const SETTINGS_GROUPS: { title: string; items: { href: string; what: string }[] }[] = [
  {
    title: "最初に決めるもの",
    items: [
      { href: "/setup", what: "身長・体重・PB・故障歴。診断とルール判定の前提になります" },
      { href: "/goal", what: "目標タイムと対象レース。ここを設定するとプランが生成されます" },
    ],
  },
  {
    title: "練習の決まりごと",
    items: [
      { href: "/plan-settings", what: "固定曜日と自作メニュー。毎週の枠を決めます" },
      { href: "/heat", what: "暑熱順化のブロック。夏場の設定ペースの扱いが変わります" },
    ],
  },
  {
    title: "データ",
    items: [
      { href: "/past", what: "練習日誌を貼り付けてまとめて登録。現在地の推定に使います" },
      { href: "/data", what: "書き出しと復元。端末のストレージが消えたときの備えです" },
      { href: "/sync", what: "他の端末と記録を引き継ぎます。設定しなければ何も起きません" },
    ],
  },
];

const ELSEWHERE: { label: string; where: string; href: string }[] = [
  { label: "レース分析", where: "分析タブ内のセグメント「レース」", href: "/race" },
  { label: "大会モード", where: "ホームのRACEセクション（前日・当日は自動で昇格）", href: "/meet" },
  { label: "過去データの入力", where: "カレンダーの日付タップからも入力できます", href: "/calendar" },
  { label: "警告の一覧", where: "ホームとカレンダーの警告バッジから", href: "/warnings" },
];

export default function SettingsPage() {
  return (
    <div className="flex flex-col gap-3">
      {SETTINGS_GROUPS.map((g) => (
        <Card key={g.title} title={g.title}>
          <div className="flex flex-col">
            {g.items.map((it) => {
              const n = SETTINGS_ITEMS.find((x) => x.href === it.href);
              if (!n) return null;
              return (
                <Link
                  key={it.href}
                  href={it.href}
                  className="flex items-start gap-3 py-3 border-b last:border-0 min-h-[48px]"
                  style={{ borderColor: "var(--border)" }}
                >
                  <span
                    className="w-[17px] h-[17px] block [&>svg]:w-full [&>svg]:h-full flex-shrink-0 mt-0.5"
                    style={{ stroke: "var(--text-3)" }}
                  >
                    {n.icon}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[13.5px] font-semibold">{n.label}</span>
                    <span
                      className="block text-[11px] leading-relaxed mt-0.5"
                      style={{ color: "var(--text-3)" }}
                    >
                      {it.what}
                    </span>
                  </span>
                  <span style={{ color: "var(--text-3)" }}>→</span>
                </Link>
              );
            })}
          </div>
        </Card>
      ))}

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
