"use client";
import { useCallback, useEffect, useState } from "react";
import {
  Card,
  CATEGORY_COLORS,
  ConfirmButton,
  UndoBar,
  ViolationList,
} from "../components/ui";
import { PrescriptionFields, usePrescriptionFields } from "../components/prescription-fields";
import {
  DOW_LABELS,
  SLOT_LABELS,
  SOURCE_LABELS,
  emptyWeekTemplate,
  modeOf,
  normalizeWeekTemplate,
  validateWeekTemplate,
  type CustomMenu,
  type CustomMenuSource,
  type Dow,
  type WeekdayPreferenceMode,
  type WeekdaySlot,
  type WeekTemplate,
} from "@/lib/core/weekTemplate";
import type { SessionCategory } from "@/lib/core/types";

const DOWS: Dow[] = [1, 2, 3, 4, 5, 6, 0]; // 月〜日で表示
const SLOT_OPTIONS: WeekdaySlot[] = [
  "auto",
  "point",
  "high_lactate",
  "race_economy",
  "cv",
  "threshold",
  "neural",
  "aerobic",
  "off",
];

export default function PlanSettingsPage() {
  return (
    <div className="plan-settings-screen flex flex-col gap-3">
      <WeekTemplateCard />
      <CustomMenuCard />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3-1. 固定曜日設定
// ---------------------------------------------------------------------------

function WeekTemplateCard() {
  const [t, setT] = useState<WeekTemplate>(emptyWeekTemplate());
  const [msg, setMsg] = useState("");

  useEffect(() => {
    fetch("/api/plan-settings")
      .then((r) => r.json())
      .then((d) => d.weekTemplate && setT(normalizeWeekTemplate(d.weekTemplate)));
  }, []);

  const violations = validateWeekTemplate(t);
  const errors = violations.filter((v) => v.level === "ERROR");

  const save = async () => {
    await fetch("/api/plan-settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ weekTemplate: normalizeWeekTemplate(t) }),
    });
    setMsg(
      "保存しました。「目標・レース」画面で『プランを自動生成』を押すとカレンダーに反映されます。"
    );
  };

  const setSlot = (dow: Dow, slot: WeekdaySlot) =>
    setT((prev) => ({
      ...prev,
      slots: { ...prev.slots, [dow]: slot },
      modes: {
        ...prev.modes,
        [dow]: slot === "auto" ? "none" : modeOf(prev, dow) === "none" ? "preferred" : modeOf(prev, dow),
      },
    }));

  const setMode = (dow: Dow, mode: WeekdayPreferenceMode) =>
    setT((prev) => ({
      ...prev,
      modes: { ...prev.modes, [dow]: mode },
      slots: {
        ...prev.slots,
        [dow]: mode === "none" ? "auto" : prev.slots[dow] === "auto" || !prev.slots[dow] ? "point" : prev.slots[dow],
      },
    }));

  return (
    <Card title="曜日の優先設定">
      <label className="flex items-center gap-2 text-[13px] mb-3 min-h-[44px]">
        <input
          type="checkbox"
          className="w-5 h-5"
          checked={t.enabled}
          onChange={(e) => setT({ ...t, enabled: e.target.checked })}
        />
        曜日ごとの希望を使う
      </label>

      <p className="text-[11px] mb-3 leading-relaxed" style={{ color: "var(--text-2)" }}>
        「優先」は週の回数を増やさず、可能なら既存メニューをその曜日へ移します。
        連続高負荷、回復週、レース・テーパーでは自動配置を優先します。
        「固定」はユーザーが動かしたくない曜日だけに使い、安全上の問題は警告します。
      </p>

      <div className="flex flex-col gap-1.5">
        {DOWS.map((dow) => {
          const slot = t.slots[dow] ?? "auto";
          const mode = modeOf(t, dow);
          const cat = SLOT_OPTIONS.includes(slot) && slot !== "auto" && slot !== "point"
            ? (slot as SessionCategory)
            : undefined;
          return (
            <div
              key={dow}
              className="grid grid-cols-[2rem_1fr] gap-x-2 gap-y-1.5 rounded-lg p-2"
              style={{ background: "var(--surface-2)" }}
            >
              <span
                className="w-8 text-[13px] font-bold text-center rounded"
                style={{
                  color: dow === 0 ? "var(--red)" : dow === 6 ? "var(--cat-race-economy)" : "var(--text)",
                }}
              >
                {DOW_LABELS[dow]}
              </span>
              <div className="min-w-0">
                <div
                  className="grid grid-cols-3 gap-1 mb-1.5"
                  role="group"
                  aria-label={`${DOW_LABELS[dow]}曜の指定強度`}
                >
                  {(["none", "preferred", "fixed"] as WeekdayPreferenceMode[]).map((option) => (
                    <button
                      key={option}
                      type="button"
                      className={mode === option ? "btn-volt !py-1.5 !px-1" : "btn-ghost !py-1.5 !px-1"}
                      disabled={!t.enabled}
                      aria-pressed={mode === option}
                      aria-label={`${DOW_LABELS[dow]}曜 ${option === "none" ? "指定なし" : option === "preferred" ? "優先" : "固定"}`}
                      onClick={() => setMode(dow, option)}
                    >
                      {option === "none" ? "指定なし" : option === "preferred" ? "優先" : "固定"}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="w-1.5 h-6 rounded-sm flex-shrink-0"
                    style={{
                      background: cat ? CATEGORY_COLORS[cat] : slot === "point" ? "var(--volt)" : "transparent",
                    }}
                  />
                  <select
                    className="flex-1 min-h-[44px]"
                    aria-label={`${DOW_LABELS[dow]}曜のメニュー`}
                    disabled={!t.enabled}
                    value={slot}
                    onChange={(e) => setSlot(dow, e.target.value as WeekdaySlot)}
                  >
                    {SLOT_OPTIONS.map((o) => (
                      <option key={o} value={o}>
                        {SLOT_LABELS[o]}
                      </option>
                    ))}
                  </select>
                  <label className="text-[10.5px] flex items-center gap-1 min-h-[44px]" style={{ color: "var(--text-3)" }}>
                    <input
                      type="radio"
                      name="longrun"
                      className="w-4 h-4"
                      disabled={!t.enabled || slot !== "aerobic" || mode === "none"}
                      checked={t.longRunDow === dow}
                      onChange={() => setT({ ...t, longRunDow: dow })}
                    />
                    長走
                  </label>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {t.enabled && violations.length > 0 ? (
        <div className="mt-3">
          <ViolationList violations={violations} />
        </div>
      ) : null}

      <div className="flex gap-2 mt-3 flex-wrap">
        <ConfirmButton
          label="設定を保存"
          title="曜日の優先設定を保存しますか？"
          message={
            errors.length > 0
              ? "固定設定に安全上の問題が残っています。保存はできますが、生成後に変更案と警告を確認してください。"
              : "保存後、プランを再生成すると反映されます。"
          }
          danger={errors.length > 0}
          className="btn-volt justify-center min-h-[44px]"
          onConfirm={save}
        />
        <ConfirmButton
          label="設定をリセット"
          title="曜日の優先設定をリセットしますか？"
          className="btn-ghost min-h-[44px]"
          onConfirm={() => {
            setT(emptyWeekTemplate());
            setMsg("リセットしました。保存を押すと確定します。");
          }}
        />
      </div>
      {msg ? <p className="text-[12px] mt-2">{msg}</p> : null}

      <p className="text-[10.5px] mt-3 leading-relaxed" style={{ color: "var(--text-3)" }}>
        優先順位は、レース・安全性・テーパー/回復・高負荷間隔・週負荷・固定・優先・自動生成です。
        固定でも安全性を明らかに損なう場合は警告と変更案を表示します。
      </p>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// 3-2. 自作メニュー登録
// ---------------------------------------------------------------------------

const MENU_CATEGORIES: SessionCategory[] = [
  "high_lactate",
  "race_economy",
  "modeling",
  "cv",
  "threshold",
  "neural",
  "aerobic",
];

/** S-6: 「1:46.0」「106」どちらの書き方も受ける */
function parsePbInput(v: string): number | undefined {
  const t = v.trim();
  if (!t) return undefined;
  if (t.includes(":")) {
    const [m, s] = t.split(":");
    const n = Number(m) * 60 + Number(s);
    return isFinite(n) && n > 0 ? n : undefined;
  }
  const n = Number(t);
  return isFinite(n) && n > 0 ? n : undefined;
}

const CAT_LABELS: Record<string, string> = {
  high_lactate: "高乳酸",
  race_economy: "経済走",
  modeling: "モデリング",
  cv: "CV",
  threshold: "閾値",
  neural: "神経系",
  aerobic: "ジョグ",
};

function CustomMenuCard() {
  const [menus, setMenus] = useState<CustomMenu[]>([]);
  const [open, setOpen] = useState(false);
  const [undo, setUndo] = useState<CustomMenu | null>(null);
  const [msg, setMsg] = useState("");
  const [form, setForm] = useState({
    name: "",
    category: "high_lactate" as SessionCategory,
    source: "self" as CustomMenuSource,
    prescription: "",
    note: "",
  });

  // S-3: 本文の解釈は他の入力画面とまったく同じものを使う
  const fields = usePrescriptionFields(form.prescription, {
    category: form.category,
    fallbackKind: "interval",
  });
  const { category: parsedCategory } = fields;

  // S-6: 他の選手のメニューを自分の設定に換算する
  const [fromOther, setFromOther] = useState(false);
  const [otherName, setOtherName] = useState("");
  const [otherPb, setOtherPb] = useState("");
  const [myCfeSec, setMyCfeSec] = useState<number | undefined>();
  const [converted, setConverted] = useState<any>(null);
  const [convertedText, setConvertedText] = useState("");

  useEffect(() => {
    fetch("/api/dashboard")
      .then((r) => r.json())
      .then((d) => setMyCfeSec(d?.cfe?.estimated800mSec))
      .catch(() => {});
  }, []);

  const theirPbSec = parsePbInput(otherPb);
  useEffect(() => {
    if (!fromOther || !theirPbSec || !myCfeSec || !form.prescription.trim()) {
      setConverted(null);
      setConvertedText("");
      return;
    }
    // 換算そのものはコア（athleteConvert）に任せる。画面では計算しない
    fetch("/api/convert-menu", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prescription: form.prescription,
        theirPb800Sec: theirPbSec,
      }),
    })
      .then((r) => r.json())
      .then((d) => {
        setConverted(d.converted ?? null);
        setConvertedText(d.text ?? "");
      })
      .catch(() => setConverted(null));
  }, [fromOther, theirPbSec, myCfeSec, form.prescription]);

  // 本文からカテゴリが決まったら、こちらの選択にも反映する（二重管理にしない）
  useEffect(() => {
    if (parsedCategory && parsedCategory !== form.category) {
      setForm((f) => ({ ...f, category: parsedCategory as SessionCategory }));
    }
  }, [parsedCategory]); // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(() => {
    fetch("/api/plan-settings")
      .then((r) => r.json())
      .then((d) => setMenus(d.customMenus ?? []));
  }, []);
  useEffect(load, [load]);

  const save = async () => {
    if (!form.name || !form.prescription) {
      setMsg("名前と内容は必須です");
      return;
    }
    await fetch("/api/plan-settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customMenu: {
          name: form.name,
          category: form.category,
          source: form.source,
          prescription: form.prescription,
          // S-3: 距離・本数・レストは本文の解釈から取る（手で入れ直させない）
          distanceM: fields.slots[0]?.distanceM,
          reps: fields.slots.length > 0 ? fields.slots.length : undefined,
          restNote: fields.shape?.restNote,
          // S-6: 換算できていれば、その設定と出どころを残す
          targetSec: converted?.targetSec,
          sourceAthlete:
            fromOther && theirPbSec
              ? { name: otherName || undefined, pb800Sec: theirPbSec }
              : undefined,
          note: form.note || undefined,
        },
      }),
    });
    setForm({ ...form, name: "", prescription: "", note: "" });
    setOpen(false);
    setMsg("登録しました。プランを再生成すると、このメニューが優先して使われます。");
    load();
  };

  const remove = async (m: CustomMenu) => {
    await fetch(`/api/plan-settings?menuId=${encodeURIComponent(m.id)}`, {
      method: "DELETE",
    });
    setUndo(m);
    load();
  };

  const restore = async () => {
    if (!undo) return;
    await fetch("/api/plan-settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customMenu: undo }),
    });
    setUndo(null);
    load();
  };

  const toggleActive = async (m: CustomMenu) => {
    await fetch("/api/plan-settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customMenu: { ...m, active: m.active === false } }),
    });
    load();
  };

  const byCategory = new Map<string, CustomMenu[]>();
  for (const m of menus) {
    if (!byCategory.has(m.category)) byCategory.set(m.category, []);
    byCategory.get(m.category)!.push(m);
  }

  return (
    <Card
      title="自作メニューの登録"
      right={
        <button
          className="text-[11px] min-h-[36px] px-2"
          style={{ color: "var(--volt)" }}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "閉じる" : "+ 登録する"}
        </button>
      }
    >
      <p className="text-[11px] mb-3 leading-relaxed" style={{ color: "var(--text-2)" }}>
        自分がやっていた練習、コーチから指示された練習、過去にうまくいったパターンを登録すると、
        メニュー生成のときに自動生成より優先して使われます。
        「過去にうまくいった」が最優先で、同じ練習が連続しないよう自動で入れ替わります。
      </p>

      {open ? (
        <div
          className="flex flex-col gap-2 mb-3 pb-3 border-b"
          style={{ borderColor: "var(--border)" }}
        >
          <label className="text-[13px]">
            <span className="block text-[10.5px] mb-1" style={{ color: "var(--text-3)" }}>
              メニュー名
            </span>
            <input
              className="w-full"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="例: 大学の定番 300m×6"
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[13px]">
              <span className="block text-[10.5px] mb-1" style={{ color: "var(--text-3)" }}>
                カテゴリ
              </span>
              <select
                className="w-full"
                value={form.category}
                onChange={(e) =>
                  setForm({ ...form, category: e.target.value as SessionCategory })
                }
              >
                {MENU_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CAT_LABELS[c]}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[13px]">
              <span className="block text-[10.5px] mb-1" style={{ color: "var(--text-3)" }}>
                由来
              </span>
              <select
                className="w-full"
                value={form.source}
                onChange={(e) =>
                  setForm({ ...form, source: e.target.value as CustomMenuSource })
                }
              >
                {(Object.keys(SOURCE_LABELS) as CustomMenuSource[]).map((s) => (
                  <option key={s} value={s}>
                    {SOURCE_LABELS[s]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="text-[13px]">
            <span className="block text-[10.5px] mb-1" style={{ color: "var(--text-3)" }}>
              内容
            </span>
            <input
              className="w-full"
              value={form.prescription}
              onChange={(e) => setForm({ ...form, prescription: e.target.value })}
              placeholder="例: 300m×6 r4分 jog"
            />
          </label>
          {/*
            S-3: 入力方法を記録画面・編集シート・追加シートと同じにする。
            ここだけ本文のテキスト1つで、距離を手で入れ直す作りになっていた。
            本文を打てば欄が組み上がり、1本ごとの設定タイムもそのまま入る。
          */}
          <PrescriptionFields state={fields} />
          <p className="text-[10.5px] -mt-1" style={{ color: "var(--text-3)" }}>
            1本の距離と本数は内容から読み取ります。設定タイムを入れておくと、
            生成のたびに計算し直さずそのまま使えます。
          </p>

          {/*
            S-6: 他の選手のメニューを取り込む。
            構造をそのまま真似ると設定だけが速すぎる形になるので、
            その選手の800mPBに対する相対強度を、自分のCFEに当て直す。
          */}
          <label className="flex items-center gap-1.5 text-[12px]" style={{ color: "var(--text-2)" }}>
            <input
              type="checkbox"
              checked={fromOther}
              onChange={(e) => setFromOther(e.target.checked)}
              style={{ width: 16, height: 16, padding: 0 }}
            />
            他の選手のメニューを取り込む（自分の設定に換算します）
          </label>
          {fromOther ? (
            <div className="rounded-lg p-2.5" style={{ background: "var(--surface-2)" }}>
              <div className="grid grid-cols-2 gap-2 mb-2">
                <label className="text-[13px]">
                  <span className="block text-[10.5px] mb-1" style={{ color: "var(--text-3)" }}>
                    選手名（任意）
                  </span>
                  <input
                    className="w-full"
                    value={otherName}
                    onChange={(e) => setOtherName(e.target.value)}
                    placeholder="例: 〇〇選手"
                  />
                </label>
                <label className="text-[13px]">
                  <span className="block text-[10.5px] mb-1" style={{ color: "var(--text-3)" }}>
                    その選手の800m PB
                  </span>
                  <input
                    className="w-full"
                    value={otherPb}
                    onChange={(e) => setOtherPb(e.target.value)}
                    placeholder="1:46.0"
                  />
                </label>
              </div>
              {converted ? (
                <>
                  <div className="metric-label mb-1">自分の設定に換算すると</div>
                  <div className="text-[13px] font-semibold leading-snug mb-1">
                    {convertedText}
                  </div>
                  {converted.notes.map((n: string, i: number) => (
                    <p
                      key={i}
                      className="text-[11px] leading-relaxed mt-1"
                      style={{ color: "var(--amber)" }}
                    >
                      {n}
                    </p>
                  ))}
                  <p className="text-[10.5px] leading-relaxed mt-1.5" style={{ color: "var(--text-3)" }}>
                    換算値は実測ではありません。1回やってみて合わなければ動かしてください。
                  </p>
                </>
              ) : (
                <p className="text-[11.5px]" style={{ color: "var(--text-3)" }}>
                  内容とその選手の800mPBを入れると、ここに自分向けの設定が出ます。
                </p>
              )}
            </div>
          ) : null}
          <label className="text-[13px]">
            <span className="block text-[10.5px] mb-1" style={{ color: "var(--text-3)" }}>
              メモ（任意）
            </span>
            <input
              className="w-full"
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
            />
          </label>
          <ConfirmButton
            label="このメニューを登録"
            title="自作メニューを登録しますか？"
            message="登録後、プランを再生成すると同じカテゴリの自動生成メニューの代わりに使われます。"
            className="btn-volt justify-center min-h-[44px]"
            onConfirm={save}
            disabled={!form.name || !form.prescription}
          />
        </div>
      ) : null}

      {msg ? <p className="text-[12px] mb-2">{msg}</p> : null}

      {menus.length === 0 ? (
        <p className="text-[11px]" style={{ color: "var(--text-3)" }}>
          登録はありません。まずは「これをやると調子が上がる」という練習を1つ入れてみてください。
        </p>
      ) : (
        <div className="space-y-3">
          {[...byCategory.entries()].map(([cat, items]) => (
            <div key={cat}>
              <div className="text-[11px] font-bold mb-1 flex items-center gap-1.5">
                <span
                  className="w-2 h-2 rounded-full inline-block"
                  style={{ background: CATEGORY_COLORS[cat as SessionCategory] }}
                />
                {CAT_LABELS[cat]}
              </div>
              {items.map((m) => (
                <div
                  key={m.id}
                  className="text-[11px] rounded-lg border p-2.5 mb-1.5"
                  style={{
                    borderColor: "var(--border)",
                    background: "var(--surface-2)",
                    opacity: m.active === false ? 0.5 : 1,
                  }}
                >
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="font-bold">{m.name}</div>
                      <div className="num" style={{ color: "var(--text-2)" }}>
                        {m.prescription}
                      </div>
                      <div className="text-[10px] mt-0.5" style={{ color: "var(--text-3)" }}>
                        {SOURCE_LABELS[m.source]}
                        {m.timesUsed ? ` ／ ${m.timesUsed}回使用` : ""}
                        {m.lastUsedDate ? ` ／ 最終 ${m.lastUsedDate}` : ""}
                        {m.note ? ` ／ ${m.note}` : ""}
                      </div>
                    </div>
                    <div className="flex flex-col gap-1 flex-shrink-0">
                      <button
                        className="btn-ghost !py-1 !px-2 !text-[10px]"
                        onClick={() => toggleActive(m)}
                      >
                        {m.active === false ? "有効化" : "一時停止"}
                      </button>
                      <ConfirmButton
                        label="削除"
                        title="このメニューを削除しますか？"
                        message="削除後8秒間は取り消せます。"
                        danger
                        className="btn-ghost !py-1 !px-2 !text-[10px]"
                        onConfirm={() => remove(m)}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {undo ? (
        <UndoBar
          message={`「${undo.name}」を削除しました`}
          onUndo={restore}
          onDismiss={() => setUndo(null)}
        />
      ) : null}
    </Card>
  );
}
