"use client";
import { useCallback, useEffect, useState } from "react";
import {
  Card,
  CATEGORY_COLORS,
  ConfirmButton,
  StatusText,
  UndoBar,
  ViolationList,
} from "../components/ui";
import { apiRequest } from "../components/api-client";
import { PrescriptionFields, usePrescriptionFields } from "../components/prescription-fields";
import {
  DOW_LABELS,
  SLOT_LABELS,
  SOURCE_LABELS,
  cycleModeOf,
  cycleWeekdayDrift,
  emptyCycle,
  emptyWeekTemplate,
  modeOf,
  normalizeWeekTemplate,
  validateWeekTemplate,
  type CustomMenu,
  type CustomMenuSource,
  type Dow,
  type TrainingCycle,
  type WeekdayPreferenceMode,
  type WeekdaySlot,
  type WeekTemplate,
} from "@/lib/core/weekTemplate";
import {
  MAX_CYCLE_DAYS,
  MIN_CYCLE_DAYS,
  clampCycleLength,
} from "@/lib/core/cycleTemplate";
import { addDays } from "@/lib/core/dates";
import type { Phase, SessionCategory } from "@/lib/core/types";
import type { StrengthPhaseSpec } from "@/lib/core/strength";

const DOWS: Dow[] = [1, 2, 3, 4, 5, 6, 0]; // 月〜日で表示
const SLOT_OPTIONS: WeekdaySlot[] = [
  "auto",
  "point",
  "high_lactate",
  "race_economy",
  "cv",
  "threshold",
  // 神経系は中身で分ける。「神経系」とだけ出しても何をやるのか分からない
  "hill",
  "neural",
  "aerobic",
  "off",
];

const MODE_OPTIONS: WeekdayPreferenceMode[] = ["none", "preferred", "fixed"];
const MODE_LABELS: Record<WeekdayPreferenceMode, string> = {
  none: "指定なし",
  preferred: "優先",
  fixed: "固定",
};

/**
 * 枠1つぶんの行。
 *
 * **コンポーネントの中で定義しない。** 再描画のたびに別の関数になると
 * Reactが中身の input を作り直し、iOSでは1文字打つたびにキーボードが閉じる
 * （CLAUDE.md「落とし穴」）。曜日と周期で同じ行を使うので、ここは1か所だけ。
 *
 * `id` は「火曜」「3日目」のような呼び名。読み上げラベルにそのまま使う。
 */
function SlotRow({
  id,
  badge,
  badgeColor,
  slot,
  mode,
  amSlot,
  isLongRun,
  longRunGroup,
  disabled,
  onSlot,
  onMode,
  onAmSlot,
  onLongRun,
}: {
  id: string;
  badge: string;
  badgeColor: string;
  slot: WeekdaySlot;
  mode: WeekdayPreferenceMode;
  amSlot: WeekdaySlot;
  isLongRun: boolean;
  longRunGroup: string;
  disabled: boolean;
  onSlot: (slot: WeekdaySlot) => void;
  onMode: (mode: WeekdayPreferenceMode) => void;
  onAmSlot: (slot: WeekdaySlot) => void;
  onLongRun: () => void;
}) {
  const cat =
    SLOT_OPTIONS.includes(slot) && slot !== "auto" && slot !== "point"
      ? (slot as SessionCategory)
      : undefined;
  return (
    <div
      className="grid grid-cols-[3.5rem_1fr] gap-x-2 gap-y-1.5 rounded-lg p-2"
      style={{ background: "var(--surface-2)" }}
    >
      <span
        className="text-[12px] font-bold text-center rounded self-start pt-2 leading-tight whitespace-pre-line"
        style={{ color: badgeColor }}
      >
        {badge}
      </span>
      <div className="min-w-0">
        <div className="grid grid-cols-3 gap-1 mb-1.5" role="group" aria-label={`${id}の指定強度`}>
          {MODE_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              className={mode === option ? "btn-volt !py-1.5 !px-1" : "btn-ghost !py-1.5 !px-1"}
              disabled={disabled}
              aria-pressed={mode === option}
              aria-label={`${id} ${MODE_LABELS[option]}`}
              onClick={() => onMode(option)}
            >
              {MODE_LABELS[option]}
            </button>
          ))}
        </div>
        {/*
          午前／午後を対で見せる。
          以前は主枠にラベルが無く、下の行だけ「午前」と書いてあったので
          「じゃあ上は何なのか」が分からなかった（本人から指摘）。
          時間帯は行の「上」に置く。横に並べると 320px幅（iPhone SE）で
          セレクトが押し出されて画面からはみ出す（E2Eで18px検出）。
        */}
        <div className="metric-label mb-0.5">午後（主）</div>
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="w-1 h-6 rounded-sm flex-shrink-0"
            style={{
              background: cat
                ? CATEGORY_COLORS[cat]
                : slot === "point"
                  ? "var(--volt)"
                  : "transparent",
            }}
          />
          <select
            className="flex-1 min-h-[44px]"
            aria-label={`${id}のメニュー`}
            disabled={disabled}
            value={slot}
            onChange={(e) => onSlot(e.target.value as WeekdaySlot)}
          >
            {SLOT_OPTIONS.map((o) => (
              <option key={o} value={o}>
                {SLOT_LABELS[o]}
              </option>
            ))}
          </select>
          <label
            className="text-[10.5px] flex items-center gap-1 min-h-[44px]"
            style={{ color: "var(--text-3)" }}
          >
            <input
              type="radio"
              name={longRunGroup}
              className="w-4 h-4"
              disabled={disabled || slot !== "aerobic" || mode === "none"}
              checked={isLongRun}
              onChange={onLongRun}
            />
            長走
          </label>
        </div>
        {/*
          2部練習の午前枠。既定は「なし」。
          午前を自動で埋めないのは、頼んでいない量が勝手に乗るのを避けるため。
        */}
        <div className="metric-label mb-0.5 mt-1.5">午前（2部）</div>
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="w-1 h-6 flex-shrink-0" />
          <select
            className="flex-1 min-h-[44px] !text-[12px]"
            aria-label={`${id}の午前（2部練習）`}
            disabled={disabled}
            value={amSlot}
            onChange={(e) => onAmSlot(e.target.value as WeekdaySlot)}
          >
            <option value="auto">なし（1部）</option>
            {SLOT_OPTIONS.filter((o) => o !== "auto" && o !== "off").map((o) => (
              <option key={o} value={o}>
                {SLOT_LABELS[o]}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}

const JP_DOW = ["日", "月", "火", "水", "木", "金", "土"];

/** 起点から数えてその位置が何月何日・何曜になるか（最初の1周） */
function cycleDayLabel(anchorDate: string, position: number): string {
  if (!anchorDate) return `${position + 1}日目`;
  const date = addDays(anchorDate, position);
  const d = new Date(date + "T00:00:00Z");
  return `${position + 1}日目\n${d.getUTCMonth() + 1}/${d.getUTCDate()}(${JP_DOW[d.getUTCDay()]})`;
}

function todayISO(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export default function PlanSettingsPage() {
  return (
    <div className="plan-settings-screen flex flex-col gap-3">
      <WeekTemplateCard />
      <StrengthPhaseCard />
      <CustomMenuCard />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 4-8-2. フェーズ別の補強
// ---------------------------------------------------------------------------

const PHASE_ORDER: Phase[] = ["Base", "Build", "Specific", "Modeling", "Taper"];
const PHASE_JP: Record<Phase, string> = {
  Base: "基礎期",
  Build: "準備期",
  Specific: "専門期",
  Modeling: "試合期",
  Taper: "調整期",
};

/**
 * 補強がフェーズでどう変わるかの一覧。
 *
 * この表は前からコアにあったが、**出している画面が無かった**（`STRENGTH_PHASE_TABLE`）。
 * しかも同じ知識が生成側にも別の文言で書かれていて、片方だけ古くなる状態だった。
 * 出どころを1つに寄せたので、ここに出しているのは**実際に生成されるものそのもの**。
 *
 * 「今はここ」を出さないとただの資料になって読まれないので、現在の期を強調する。
 */
function StrengthPhaseCard() {
  const [table, setTable] = useState<Record<string, StrengthPhaseSpec> | null>(null);
  const [now, setNow] = useState<{ phase: Phase; offSeason: boolean } | null>(null);

  useEffect(() => {
    fetch("/api/plan-settings")
      .then((r) => r.json())
      .then((d) => {
        if (d.strengthTable) setTable(d.strengthTable);
        if (d.currentPhase) setNow(d.currentPhase);
      })
      .catch(() => {
        /* 補強の一覧は参考情報。取れなくても設定の操作は止めない */
      });
  }, []);

  if (!table) return null;

  return (
    <Card title="補強はフェーズでこう変わる">
      <p className="text-[11px] mb-2 leading-relaxed" style={{ color: "var(--text-2)" }}>
        自動生成される補強の中身です。<strong>ポイント練習の日の午後にだけ</strong>置きます
        （回復日を汚さないため）。
        {now
          ? now.offSeason
            ? "いまは目標レース未定（冬季・基礎構築）なので基礎期の内容で、坂ダッシュの日にも付きます。"
            : `いまは${PHASE_JP[now.phase]}です。`
          : ""}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["期", "筋力", "プライオ", "頻度"].map((h) => (
                <th
                  key={h}
                  className="metric-label text-left py-1 pr-2"
                  style={{ borderBottom: "1px solid var(--border)" }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PHASE_ORDER.map((phase) => {
              const spec = table[phase];
              if (!spec) return null;
              const here = now?.phase === phase;
              return (
                <tr
                  key={phase}
                  style={{
                    background: here ? "var(--surface-2)" : "transparent",
                    borderBottom: "1px solid var(--border)",
                  }}
                >
                  <td className="py-1.5 pr-2 whitespace-nowrap">
                    <span style={{ color: here ? "var(--forge)" : "var(--text)" }}>
                      {here ? "▶ " : ""}
                      {PHASE_JP[phase]}
                    </span>
                  </td>
                  <td className="py-1.5 pr-2">{spec.strength}</td>
                  <td className="py-1.5 pr-2">{spec.plyometrics}</td>
                  <td className="py-1.5 whitespace-nowrap">{spec.frequency}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {now && table[now.phase] ? (
        <div className="mt-2 rounded-lg p-2.5" style={{ background: "var(--surface-2)" }}>
          <p className="metric-label mb-1">いまの期に出る種目</p>
          <p className="text-[12px] leading-relaxed">
            {table[now.phase].exercises.join(" ／ ")}
          </p>
        </div>
      ) : null}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// 3-1. 固定曜日設定
// ---------------------------------------------------------------------------

function WeekTemplateCard() {
  const [t, setT] = useState<WeekTemplate>(emptyWeekTemplate());
  const [msg, setMsg] = useState("");

  const [advice, setAdvice] = useState<{ message: string; basis: string }[]>([]);

  useEffect(() => {
    fetch("/api/plan-settings")
      .then((r) => r.json())
      .then((d) => {
        if (d.weekTemplate) setT(normalizeWeekTemplate(d.weekTemplate));
        setAdvice(d.amAdvice ?? []);
      });
  }, []);

  const violations = validateWeekTemplate(t);
  const errors = violations.filter((v) => v.level === "ERROR");

  const save = async () => {
    try {
      await apiRequest("/api/plan-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weekTemplate: normalizeWeekTemplate(t) }),
      });
      setMsg(
        "保存しました。「目標・レース」画面で『プランを自動生成』を押すとカレンダーに反映されます。"
      );
    } catch (error) {
      setMsg(error instanceof Error ? error.message : "保存できませんでした");
    }
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

  /** 2部練習の午前枠。"auto"（なし）は保存しない＝1部に戻す */
  const setAmSlot = (dow: Dow, slot: WeekdaySlot) =>
    setT((prev) => {
      const amSlots = { ...(prev.amSlots ?? {}) };
      if (slot === "auto") delete amSlots[dow];
      else amSlots[dow] = slot;
      return { ...prev, amSlots };
    });

  // --- N日周期 ---
  const cycle = t.cycle;
  const cycleOn = !!cycle?.enabled;
  const cycleLength = clampCycleLength(cycle?.lengthDays ?? 10);
  const drift = cycleWeekdayDrift(cycleLength);

  const patchCycle = (patch: Partial<TrainingCycle>) =>
    setT((prev) => ({
      ...prev,
      cycle: { ...(prev.cycle ?? emptyCycle(todayISO())), ...patch },
    }));

  const setCycleSlot = (position: number, slot: WeekdaySlot) =>
    setT((prev) => {
      const c = prev.cycle ?? emptyCycle(todayISO());
      return {
        ...prev,
        cycle: {
          ...c,
          slots: { ...c.slots, [position]: slot },
          modes: {
            ...c.modes,
            [position]:
              slot === "auto"
                ? "none"
                : cycleModeOf(c, position) === "none"
                  ? "preferred"
                  : cycleModeOf(c, position),
          },
        },
      };
    });

  const setCycleMode = (position: number, mode: WeekdayPreferenceMode) =>
    setT((prev) => {
      const c = prev.cycle ?? emptyCycle(todayISO());
      const current = c.slots?.[position];
      return {
        ...prev,
        cycle: {
          ...c,
          modes: { ...c.modes, [position]: mode },
          slots: {
            ...c.slots,
            [position]:
              mode === "none" ? "auto" : !current || current === "auto" ? "point" : current,
          },
        },
      };
    });

  const setCycleAmSlot = (position: number, slot: WeekdaySlot) =>
    setT((prev) => {
      const c = prev.cycle ?? emptyCycle(todayISO());
      const amSlots = { ...(c.amSlots ?? {}) };
      if (slot === "auto") delete amSlots[position];
      else amSlots[position] = slot;
      return { ...prev, cycle: { ...c, amSlots } };
    });

  return (
    <Card title="メニューの枠">
      <label className="flex items-center gap-2 text-[13px] mb-3 min-h-[44px]">
        <input
          type="checkbox"
          className="w-5 h-5"
          checked={t.enabled}
          onChange={(e) => setT({ ...t, enabled: e.target.checked })}
        />
        枠の希望を使う
      </label>

      {/*
        曜日か周期か。
        7日は生活の都合であって、回復に必要な日数とは関係がない。
        「高乳酸のあと中2日」を守りたいのに週2枠に押し込むと、
        どちらかが中1日になるか片方が消える。10日で3本のほうが素直な局面がある。
        切り替えても**もう一方の設定は消さない**（試して戻せるようにする）。
      */}
      <div className="grid grid-cols-2 gap-1 mb-3" role="group" aria-label="枠の決め方">
        <button
          type="button"
          className={!cycleOn ? "btn-volt !py-2" : "btn-ghost !py-2"}
          disabled={!t.enabled}
          aria-pressed={!cycleOn}
          onClick={() => patchCycle({ enabled: false })}
        >
          曜日で決める
        </button>
        <button
          type="button"
          className={cycleOn ? "btn-volt !py-2" : "btn-ghost !py-2"}
          disabled={!t.enabled}
          aria-pressed={cycleOn}
          onClick={() =>
            patchCycle({
              enabled: true,
              lengthDays: cycleLength,
              anchorDate: cycle?.anchorDate || todayISO(),
            })
          }
        >
          日数の周期で決める
        </button>
      </div>

      <p className="text-[11px] mb-3 leading-relaxed" style={{ color: "var(--text-2)" }}>
        「優先」は回数を増やさず、可能なら既存メニューをその枠へ移します。
        連続高負荷、回復週、レース・テーパーでは自動配置を優先します。
        「固定」は動かしたくない枠だけに使い、安全上の問題は警告します。
      </p>
      {/*
        一覧に無い内容をやりたいときの逃げ道。
        自作メニューは同じカテゴリの日に自動で使われる仕組みが既にあるが、
        曜日設定の画面からはそれが見えず、「その他が無い」と受け取られていた。
      */}
      <p className="text-[11px] mb-3 leading-relaxed" style={{ color: "var(--text-3)" }}>
        一覧に無いメニューは、下の「自作メニュー」に登録してください。
        同じカテゴリの枠に当たった日で自動的に使われます。
        「ジョグ＋坂ダッシュ」「ジョグ＋流し（WS）」は一覧から直接選べます
        （どちらもジョグ30分が別枠で付きます）。
      </p>

      {cycleOn ? (
        <div className="flex flex-col gap-2 mb-3">
          <div className="flex gap-2 flex-wrap">
            <label className="flex-1 min-w-[8rem]">
              <span className="metric-label block mb-0.5">周期の長さ（日）</span>
              <input
                type="number"
                inputMode="numeric"
                className="w-full min-h-[44px]"
                min={MIN_CYCLE_DAYS}
                max={MAX_CYCLE_DAYS}
                disabled={!t.enabled}
                value={cycle?.lengthDays ?? 10}
                onChange={(e) => patchCycle({ lengthDays: Number(e.target.value) })}
              />
            </label>
            <label className="flex-1 min-w-[10rem]">
              <span className="metric-label block mb-0.5">1日目にする日</span>
              <input
                type="date"
                className="w-full min-h-[44px]"
                disabled={!t.enabled}
                value={cycle?.anchorDate ?? ""}
                onChange={(e) => patchCycle({ anchorDate: e.target.value })}
              />
            </label>
          </div>
          {/*
            周期にすると何が起きるかを先に出す。
            10日周期は70日たたないと曜日が戻らない。学校・チーム練習が曜日で
            決まっている人には効く話なので、禁止はしないが黙ってもいない。
          */}
          <p className="text-[11px] leading-relaxed" style={{ color: "var(--text-2)" }}>
            {cycleLength}日ごとに同じ並びを繰り返します。1日目にポイント練習が入ります
            （ずらしたいときは「1日目にする日」を動かしてください）。
            {drift
              ? `${cycleLength}日周期は7日と噛み合わないので、同じ内容が同じ曜日に戻るのは${drift}日後です。`
              : "7の倍数なので曜日は固定されます。"}
          </p>
          <p className="text-[11px] leading-relaxed" style={{ color: "var(--text-3)" }}>
            指定しなかった枠は自動で埋まります。ポイント練習の本数は、暦の1週間に
            高乳酸・中距離特異的が3日入らない範囲で決まります
            （減らした場合は生成時に理由が出ます）。
            レース直前のテーパーは周期ではなくレース日から逆算します。
          </p>
        </div>
      ) : null}

      <div className="flex flex-col gap-1.5">
        {cycleOn
          ? Array.from({ length: cycleLength }, (_, position) => {
              const id = `${position + 1}日目`;
              return (
                <SlotRow
                  key={position}
                  id={id}
                  badge={cycleDayLabel(cycle?.anchorDate ?? "", position)}
                  badgeColor="var(--text)"
                  slot={cycle?.slots?.[position] ?? "auto"}
                  mode={cycleModeOf(cycle, position)}
                  amSlot={cycle?.amSlots?.[position] ?? "auto"}
                  isLongRun={cycle?.longRunIndex === position}
                  longRunGroup="longrun-cycle"
                  disabled={!t.enabled}
                  onSlot={(slot) => setCycleSlot(position, slot)}
                  onMode={(mode) => setCycleMode(position, mode)}
                  onAmSlot={(slot) => setCycleAmSlot(position, slot)}
                  onLongRun={() => patchCycle({ longRunIndex: position })}
                />
              );
            })
          : DOWS.map((dow) => (
              <SlotRow
                key={dow}
                id={`${DOW_LABELS[dow]}曜`}
                badge={DOW_LABELS[dow]}
                badgeColor={
                  dow === 0
                    ? "var(--red)"
                    : dow === 6
                      ? "var(--cat-race-economy)"
                      : "var(--text)"
                }
                slot={t.slots[dow] ?? "auto"}
                mode={modeOf(t, dow)}
                amSlot={t.amSlots?.[dow] ?? "auto"}
                isLongRun={t.longRunDow === dow}
                longRunGroup="longrun-dow"
                disabled={!t.enabled}
                onSlot={(slot) => setSlot(dow, slot)}
                onMode={(mode) => setMode(dow, mode)}
                onAmSlot={(slot) => setAmSlot(dow, slot)}
                onLongRun={() => setT({ ...t, longRunDow: dow })}
              />
            ))}
      </div>


      {t.enabled && violations.length > 0 ? (
        <div className="mt-3">
          <ViolationList violations={violations} />
        </div>
      ) : null}

      {/*
        2部の午前枠についての助言。
        **自動では変えない。** 制限因子は既に午後（主練習）で効いているので、
        午前にも当てると同じ判定を二重に数えることになる。
        噛み合っていないときだけ出して、決めるのは本人に残す。
        読み込み時点の保存済み設定に対して出るので、画面で変えた直後には追従しない
        ——保存して開き直したときの状態を見せるほうが、助言としては正しい。
      */}
      {advice.length > 0 ? (
        <div className="mt-3">
          {advice.map((a, i) => (
            <div
              key={i}
              className="rounded-lg p-2.5 mb-1.5"
              style={{ background: "var(--surface-2)" }}
            >
              <p className="metric-label mb-1">午前枠についての気づき</p>
              <p className="text-[12px] leading-relaxed">{a.message}</p>
              <p
                className="text-[11px] leading-relaxed mt-1"
                style={{ color: "var(--text-3)" }}
              >
                根拠: {a.basis}
              </p>
            </div>
          ))}
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
    try {
      await apiRequest("/api/plan-settings", {
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
    } catch (error) {
      setMsg(error instanceof Error ? error.message : "登録できませんでした");
    }
  };

  const remove = async (m: CustomMenu) => {
    try {
      await apiRequest(`/api/plan-settings?menuId=${encodeURIComponent(m.id)}`, {
        method: "DELETE",
      });
      setUndo(m);
      load();
    } catch (error) {
      setMsg(error instanceof Error ? error.message : "削除できませんでした");
    }
  };

  const restore = async () => {
    if (!undo) return;
    try {
      await apiRequest("/api/plan-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customMenu: undo }),
      });
      setUndo(null);
      load();
    } catch (error) {
      setMsg(error instanceof Error ? error.message : "元に戻せませんでした");
    }
  };

  const toggleActive = async (m: CustomMenu) => {
    try {
      await apiRequest("/api/plan-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customMenu: { ...m, active: m.active === false } }),
      });
      load();
    } catch (error) {
      setMsg(error instanceof Error ? error.message : "変更できませんでした");
    }
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
          className="text-[11px] min-h-[44px] px-2"
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
                    <StatusText key={i} kind="warning" className="text-[11px] leading-relaxed mt-1">
                      {n}
                    </StatusText>
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
