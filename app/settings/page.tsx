"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Card, ConfirmButton, StatusText } from "../components/ui";
import { ChipGroup, ChipMultiGroup } from "../components/inputs";
import { SHOE_KIND_LABELS, type ShoeKind, type ShoeUsage } from "@/lib/core/shoes";
import {
  normalizePurposes,
  profileOf,
  SHOE_PURPOSE_LABELS,
  type ShoePurpose,
} from "@/lib/core/shoeProfile";
import { SETTINGS_ITEMS } from "../components/nav";
import { searchFeatures } from "@/lib/core/featureSearch";

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
      { href: "/plan-settings", what: "曜日の優先・固定と自作メニュー。毎週の希望を決めます" },
      { href: "/heat", what: "暑熱順化のブロック。夏場の設定ペースの扱いが変わります" },
    ],
  },
  {
    title: "データ",
    items: [
      { href: "/past", what: "練習日誌を貼り付けてまとめて登録。現在地の推定に使います" },
      { href: "/data", what: "書き出しと復元。端末のストレージが消えたときの備えです" },
      { href: "/sync", what: "他の端末と記録を引き継ぎます。設定しなければ何も起きません" },
      { href: "/diagnostics", what: "動かないときに見る画面。バージョン・同期状態を表示します" },
    ],
  },
  {
    title: "分からないとき",
    items: [
      {
        href: "/ask",
        what: "「なんでこの数字なのか」を今のデータをもとに説明します。設定するまで何も送りません",
      },
    ],
  },
];

const ELSEWHERE: { label: string; where: string; href: string }[] = [
  { label: "レース分析", where: "分析タブ内のセグメント「レース」", href: "/race" },
  { label: "大会モード", where: "ホームのRACEセクション（前日・当日は自動で昇格）", href: "/meet" },
  { label: "過去データの入力", where: "カレンダーの日付タップからも入力できます", href: "/calendar" },
  { label: "警告の一覧", where: "ホームとカレンダーの警告バッジから", href: "/warnings" },
];

/**
 * 機能検索。
 *
 * 設定画面に置いたのは、ここが「日々使わないものの置き場所」だから。
 * 探しているのはたいていこの中にある。ヘッダーの歯車から全画面で1タップ。
 * 下部タブは4つから増やさない（FORGEの規則）ので、入口はここに集約する。
 *
 * 判定は `featureSearch.ts`。LLMは使わないので、同じ入力からは同じ結果が出る。
 */
function FeatureSearch() {
  const [q, setQ] = useState("");
  const hits = searchFeatures(q);
  const typed = q.trim().length > 0;

  return (
    <Card title="機能を探す">
      <p className="text-[11.5px] leading-relaxed mb-2" style={{ color: "var(--text-3)" }}>
        画面の名前が分からなくても引けます。「タイムがずれてる」「バックアップ」
        「コーチに見せる」のように、やりたいことで入れてください。
      </p>
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="例: cfe / バックアップ / 暑い"
        aria-label="機能を探す"
        className="w-full"
        style={{ minHeight: 44 }}
      />
      {typed && hits.length === 0 ? (
        <p className="text-[12px] mt-2.5" style={{ color: "var(--text-3)" }}>
          見つかりませんでした。別の言い方で試してください。
        </p>
      ) : null}
      {hits.length > 0 ? (
        <div className="flex flex-col mt-1.5">
          {hits.map((h) => (
            <Link
              key={h.feature.id}
              href={h.feature.href}
              className="py-2.5 border-b"
              style={{ borderColor: "var(--border)" }}
            >
              <span className="text-[13px] font-semibold">{h.feature.label}</span>
              <span
                className="block text-[11.5px] leading-relaxed mt-0.5"
                style={{ color: "var(--text-2)" }}
              >
                {h.feature.description}
              </span>
              {/* 画面の中にある機能は、行った先のどこかまで書かないと辿り着けない */}
              {h.feature.where ? (
                <span className="block text-[11px] mt-0.5" style={{ color: "var(--text-3)" }}>
                  場所: {h.feature.where}
                </span>
              ) : null}
            </Link>
          ))}
        </div>
      ) : null}
    </Card>
  );
}


const SHOE_KIND_OPTIONS: { value: ShoeKind; label: string }[] = (
  Object.keys(SHOE_KIND_LABELS) as ShoeKind[]
).map((k) => ({ value: k, label: SHOE_KIND_LABELS[k] }));

/**
 * シューズの登録と使用距離。
 *
 * **合計距離は持っていない。** 記録から毎回足し上げている。
 * カウンタを持つと、記録を消したり直したりしたときにずれて、
 * しかもずれたことに気づけない（記録は正しいのに合計だけが違う）。
 *
 * 使った記録がある靴は消せない。過去の記録が指す先が無くなり、
 * 「何を履いていたか」が分からなくなるため。使い終わったものは「引退」にする。
 */
function ShoeCard() {
  const [usage, setUsage] = useState<ShoeUsage[]>([]);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ShoeKind>("trainer");
  const [msg, setMsg] = useState("");
  /*
   * 靴は増える一方で減らない。1足ずつ操作を並べると設定画面が伸び続けるので、
   * 押した1足だけ開き、引退したものは畳んでおく。
   */
  const [openShoeId, setOpenShoeId] = useState<string | null>(null);
  const [showRetired, setShowRetired] = useState(false);
  const retiredCount = usage.filter((u) => u.shoe.retired).length;

  const load = useCallback(() => {
    fetch("/api/shoes")
      .then((r) => r.json())
      .then((d) => setUsage(d.usage ?? []))
      .catch(() => setMsg("シューズを読み込めませんでした"));
  }, []);
  useEffect(load, [load]);

  const add = async () => {
    if (!name.trim()) {
      setMsg("シューズの名前を入れてください");
      return;
    }
    const r = await fetch("/api/shoes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, kind }),
    });
    const d = await r.json();
    if (d.error) {
      setMsg(d.error);
      return;
    }
    setUsage(d.usage ?? []);
    setName("");
    setMsg("登録しました。");
  };

  /**
   * 靴の性格を直す。
   *
   * 直した項目だけを `profile` に足す。**触っていない項目は入れない**——
   * 全部を書き込むと、種類から置いた目安と本人が決めた値の区別が付かなくなる。
   */
  const saveProfile = async (u: ShoeUsage, patch: Record<string, unknown>) => {
    const next = { ...u.shoe, profile: { ...(u.shoe.profile ?? {}), ...patch } };
    const r = await fetch("/api/shoes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next),
    });
    const d = await r.json();
    if (d.error) setMsg(d.error);
    else setUsage(d.usage ?? []);
  };

  const setRetired = async (u: ShoeUsage, retired: boolean) => {
    const r = await fetch("/api/shoes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...u.shoe, retired }),
    });
    const d = await r.json();
    if (d.error) setMsg(d.error);
    else {
      setUsage(d.usage ?? []);
      setMsg(retired ? "引退にしました（記録は残ります）。" : "また使えるようにしました。");
    }
  };

  const remove = async (u: ShoeUsage) => {
    const r = await fetch(`/api/shoes?shoeId=${encodeURIComponent(u.shoe.id)}`, {
      method: "DELETE",
    });
    const d = await r.json();
    if (d.error) setMsg(d.error);
    else {
      setUsage(d.usage ?? []);
      setMsg("消しました。");
    }
  };

  return (
    <Card title="シューズ">
      <p className="text-[11px] mb-2 leading-relaxed" style={{ color: "var(--text-2)" }}>
        記録するときに選べるようになります。使用距離は<strong>記録から毎回足し上げた値</strong>です
        （別に数えていないので、記録を直せばここも直ります）。
      </p>

      <div className="flex flex-col gap-2 mb-3">
        <label className="text-[13px]">
          <span className="block text-[10.5px] mb-1" style={{ color: "var(--text-3)" }}>
            製品名
          </span>
          <input
            className="w-full min-h-[44px]"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例: ヴェイパーフライ3"
            aria-label="製品名"
          />
        </label>
        <ChipGroup
          label="種類"
          value={kind}
          onChange={(v) => setKind((v ?? "trainer") as ShoeKind)}
          options={SHOE_KIND_OPTIONS}
          columns={3}
        />
        <button onClick={add} className="btn-volt justify-center min-h-[44px]">
          登録する
        </button>
      </div>

      {usage.length === 0 ? (
        <p className="text-[11px]" style={{ color: "var(--text-3)" }}>
          まだ登録がありません。
        </p>
      ) : (
        /*
          1足を1行にする。
          以前は1足ごとに「名前・使用距離・最後に使った日・引退・消す」を
          縦に積んでいたので、**登録するほど設定画面が伸びた**。
          靴は増える一方で減らないので、増えても伸びない形にする。

          押した1足だけ操作を開く。引退した靴は畳んでおく——
          記録として残す必要はあるが、ふだん見るものではない。
        */
        <div className="flex flex-col gap-1">
          {usage
            .filter((u) => !u.shoe.retired || showRetired)
            .map((u) => (
              <div key={u.shoe.id}>
                <button
                  className="w-full flex items-baseline justify-between gap-2 rounded-lg px-2.5 min-h-[44px] text-left"
                  style={{
                    background: openShoeId === u.shoe.id ? "var(--surface-2)" : "transparent",
                    opacity: u.shoe.retired ? 0.6 : 1,
                  }}
                  aria-expanded={openShoeId === u.shoe.id}
                  onClick={() => setOpenShoeId(openShoeId === u.shoe.id ? null : u.shoe.id)}
                >
                  <span className="text-[13px] font-semibold truncate">
                    {u.shoe.name}
                    <span className="text-[11px] ml-1.5" style={{ color: "var(--text-3)" }}>
                      {SHOE_KIND_LABELS[u.shoe.kind]}
                      {u.shoe.retired ? "・引退" : ""}
                    </span>
                  </span>
                  <span className="num text-[13px] font-bold flex-shrink-0">
                    {u.totalKm}
                    <span className="text-[10.5px] font-normal" style={{ color: "var(--text-3)" }}>
                      km / {u.sessions}回
                    </span>
                  </span>
                </button>
                {openShoeId === u.shoe.id ? (
                  <div
                    className="rounded-lg p-2.5 mt-0.5"
                    style={{ background: "var(--surface-2)" }}
                  >
                    {u.lastUsed ? (
                      <p className="text-[10.5px] mb-1.5" style={{ color: "var(--text-3)" }}>
                        最後に使った日: {u.lastUsed}
                      </p>
                    ) : null}

                    {/*
                      推薦の材料。**製品ごとの性能表は持っていない。**
                      種類から作った一般的な傾向を出発点にして、
                      本人が直したものを常に優先する
                      （こちらで確かめずに数値を書くと、推薦の理由を検証できない）。
                    */}
                    <div className="metric-label mb-1">この靴の性格（推薦に使う）</div>
                    <p className="text-[10.5px] leading-relaxed mb-1.5" style={{ color: "var(--text-3)" }}>
                      種類から置いた目安です。実際と違えば直してください。直したほうが優先されます。
                    </p>
                    {(
                      [
                        ["cushioning", "クッション"],
                        ["responsiveness", "反発"],
                        ["stability", "安定"],
                        ["grip", "グリップ"],
                        ["lightness", "軽さ"],
                      ] as const
                    ).map(([key, label]) => (
                      <div key={key} className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-[11.5px]">{label}</span>
                        <span className="flex gap-1">
                          {([1, 2, 3, 4, 5] as const).map((n) => (
                            <button
                              key={n}
                              type="button"
                              aria-label={`${u.shoe.name} ${label} ${n}`}
                              aria-pressed={profileOf(u.shoe)[key] === n}
                              className="rounded num text-[11.5px] font-semibold min-h-[44px]"
                              style={{
                                width: 34,
                                background:
                                  profileOf(u.shoe)[key] === n ? "var(--volt)" : "var(--surface)",
                                color:
                                  profileOf(u.shoe)[key] === n ? "var(--volt-ink)" : "var(--text-2)",
                              }}
                              onClick={() => saveProfile(u, { [key]: n })}
                            >
                              {n}
                            </button>
                          ))}
                        </span>
                      </div>
                    ))}
                    <div className="mt-1.5 mb-2">
                      {/*
                        用途は複数選べる（forge-v109）。
                        1つしか選べなかったとき、厚底のように
                        「レースにもポイント練習にも履く」靴を表せなかった。

                        「決めていない」は他と併用しない（`normalizePurposes`）。
                        併用できると「決めていないがレース用でもある」という
                        読めない設定が保存できてしまう。
                      */}
                      <ChipMultiGroup
                        label="主な用途（複数選べる）"
                        values={profileOf(u.shoe).purposes}
                        onChange={(next) =>
                          saveProfile(u, { purposes: normalizePurposes(next) })
                        }
                        options={SHOE_PURPOSE_OPTIONS}
                        columns={3}
                        testId={`shoe-purposes-${u.shoe.id}`}
                      />
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      <button
                        className="btn-ghost !py-1.5 !px-2.5 !text-[11.5px] min-h-[44px]"
                        onClick={() => setRetired(u, !u.shoe.retired)}
                      >
                        {u.shoe.retired ? "また使う" : "引退にする"}
                      </button>
                      {u.sessions === 0 ? (
                        <ConfirmButton
                          label="消す"
                          title="このシューズを消しますか？"
                          message="まだ使った記録が無いので消せます。"
                          className="btn-ghost !py-1.5 !px-2.5 !text-[11.5px] min-h-[44px]"
                          onConfirm={() => remove(u)}
                        />
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
          {retiredCount > 0 ? (
            <button
              className="text-[11.5px] min-h-[44px] text-left"
              style={{ color: "var(--text-2)" }}
              aria-expanded={showRetired}
              onClick={() => setShowRetired((v) => !v)}
            >
              {showRetired ? "▾" : "▸"} 引退したシューズ {retiredCount}足
            </button>
          ) : null}
        </div>
      )}
      {msg ? (
        <div className="mt-2">
          <StatusText kind={msg.includes("できません") ? "error" : "success"}>{msg}</StatusText>
        </div>
      ) : null}
    </Card>
  );
}

const SHOE_PURPOSE_OPTIONS: { value: ShoePurpose; label: string }[] = (
  Object.keys(SHOE_PURPOSE_LABELS) as ShoePurpose[]
).map((v) => ({ value: v, label: SHOE_PURPOSE_LABELS[v] }));

export default function SettingsPage() {
  return (
    <div className="settings-screen flex flex-col gap-3">
      <FeatureSearch />
      <ShoeCard />
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
