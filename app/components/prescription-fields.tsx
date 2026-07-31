"use client";
import * as React from "react";
import { useEffect, useRef, useState } from "react";
import { resizeValues, type PrescriptionStructure, type RepSlot } from "@/lib/core/prescription";
import { StatusText } from "./ui";

/**
 * N-2 / N-3 メニュー本文に合わせて入力欄を組み立てる部分。
 *
 * **編集シートと追加シートの両方がここを使う。唯一の実装。**
 * 同じ組み替え規則を2か所に書くと、片方だけ直したときに
 * 同じ本文が画面によって違う欄になり、どちらの数字を信じればいいのか分からなくなる。
 * 解釈そのものを `parseRow` の1か所に集めているのと同じ理由。
 *
 * 守っている規則（どれも実際に踏んだ不具合が根拠）:
 *   ・解釈は入力が止まってから走らせる（300ms）。1文字ごとに欄を作り直すとキーボードが閉じる（N-1）
 *   ・欄の作り直しは shape（種別・距離・本数の指紋）が変わったときだけ。設定だけ直しても組み替えない
 *   ・本数が増えたら空欄を足すだけ。減っても入力済みの値は捨てない
 *   ・入力欄の key は「何本目か」で固定する
 *   ・読み取れない本文のときは欄を変えない。空にもしない。推測で埋めない
 */

/** 打ち終わってから解釈するまでの待ち時間 */
export const PARSE_DEBOUNCE_MS = 300;

export const EDIT_CATEGORIES = [
  ["high_lactate", "高乳酸"],
  ["race_economy", "経済走"],
  ["modeling", "モデリング"],
  ["cv", "CV"],
  ["threshold", "閾値"],
  ["neural", "神経系"],
  ["aerobic", "有酸素"],
  ["off", "休養"],
] as const;

export const KIND_LABEL: Record<string, string> = {
  interval: "インターバル・レペ",
  continuous: "ジョグ・持続走",
  race: "レース",
  timetrial: "タイムトライアル",
  strength: "補強",
  off: "休養",
  unknown: "未判定",
};

/** 「41.5」「1:26.5」いずれも受ける */
export function parseSec(v: string): number | undefined {
  const t = v.trim();
  if (!t) return undefined;
  if (t.includes(":")) {
    const [m, s] = t.split(":");
    const n = Number(m) * 60 + Number(s);
    return isFinite(n) ? n : undefined;
  }
  const n = Number(t);
  return isFinite(n) && n > 0 ? n : undefined;
}

/** 0.1秒まで。8.333… のような割り算の結果を入力欄に出さない */
function fmtSec(sec: number): string {
  return String(Math.round(sec * 10) / 10);
}

/** APIの戻り。読めなかったときは keep が立つ（欄をそのままにする印） */
type Parsed = PrescriptionStructure & { keep?: boolean };

/**
 * 本文を解釈する。打っている最中は走らせない。
 * 解釈は `/api/prescription`（＝一括入力と同じ `parseRow`）に任せる。
 */
function useStructure(text: string): Parsed | null {
  const [structure, setStructure] = useState<Parsed | null>(null);
  useEffect(() => {
    if (!text.trim()) {
      setStructure(null);
      return;
    }
    const t = setTimeout(() => {
      fetch("/api/prescription", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      })
        .then((r) => r.json())
        .then((d) => setStructure(d.recognized ? d : { ...d, keep: true }))
        .catch(() => {});
    }, PARSE_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [text]);
  return structure;
}

export interface PrescriptionFieldsInit {
  /** 最初に選ばれているカテゴリ（初回描画のみ使う） */
  category?: string;
  distanceKm?: string;
  durationMin?: string;
  /**
   * 本文をまだ読み取れていないときにどちらの欄を出すか。
   * 毎回の描画で読み直すので、カテゴリを手で変えれば追従する。
   */
  fallbackKind: "interval" | "continuous";
}

export interface PrescriptionFieldsState {
  /** 直近の解釈結果。読めなかったときも入る（表示用） */
  structure: Parsed | null;
  /** 欄の組み立てに使っている構造。読めた本文だけが入る */
  shape: Parsed | null;
  kind: string;
  slots: RepSlot[];
  category: string;
  setCategory: React.Dispatch<React.SetStateAction<string>>;
  slotTargets: string[];
  setSlotTargets: React.Dispatch<React.SetStateAction<string[]>>;
  distanceKm: string;
  setDistanceKm: React.Dispatch<React.SetStateAction<string>>;
  durationMin: string;
  setDurationMin: React.Dispatch<React.SetStateAction<string>>;
  /** カテゴリが一意に決まらなかった。人に選ばせる */
  uncertain: boolean;
}

export function usePrescriptionFields(
  text: string,
  init: PrescriptionFieldsInit
): PrescriptionFieldsState {
  const [category, setCategory] = useState<string>(init.category ?? "");
  const [slotTargets, setSlotTargets] = useState<string[]>([]);
  const [distanceKm, setDistanceKm] = useState(init.distanceKm ?? "");
  const [durationMin, setDurationMin] = useState(init.durationMin ?? "");

  const structure = useStructure(text);
  // 読み取れた構造だけを保持する。読めない本文が来ても欄を消さない
  const [shape, setShape] = useState<Parsed | null>(null);
  const lastShape = useRef<string>("");

  useEffect(() => {
    if (!structure?.recognized) return;
    setShape(structure);
    // N-3: 設定タイムから一意に決まったときだけ自動で入れる。断定はしない（あとで直せる）
    if (structure.categoryCertain && structure.category) setCategory(structure.category);
    if (structure.shape === lastShape.current) return;
    lastShape.current = structure.shape;

    const slots = structure.slots ?? [];
    if (slots.length > 0) {
      setSlotTargets((prev) => {
        // 増えたぶんは空欄を足すだけ。減っても捨てない
        const next = [...resizeValues(prev, slots.length, "")];
        // 本文に設定が書かれていて、まだ何も入れていない欄だけ埋める
        return next.map((v, i) =>
          !v && slots[i]?.targetSec !== undefined ? fmtSec(slots[i].targetSec!) : v
        );
      });
    }
    if (structure.distanceKm !== undefined) setDistanceKm(String(structure.distanceKm));
    if (structure.durationMin !== undefined) setDurationMin(String(structure.durationMin));
  }, [structure]);

  return {
    structure,
    shape,
    kind: shape?.kind ?? init.fallbackKind,
    slots: shape?.slots ?? [],
    category,
    setCategory,
    slotTargets,
    setSlotTargets,
    distanceKm,
    setDistanceKm,
    durationMin,
    setDurationMin,
    uncertain: !!shape && !shape.categoryCertain,
  };
}

export interface PrescriptionPayload {
  targetPaces?: { distanceM: number; targetSecFast: number; targetSecSlow: number }[];
  distanceKm?: number;
  durationMin?: number;
}

/**
 * 入力欄の中身を保存できる形にする。
 * 追加と編集で同じ形にしておかないと、＋で足した練習だけ設定タイムが入らない、
 * ということが起きる。
 */
export function prescriptionPayload(state: PrescriptionFieldsState): PrescriptionPayload {
  const out: PrescriptionPayload = {};
  if (state.kind === "interval" && state.slots.length > 0) {
    // 全部の距離と設定が同じなら1件にまとめる。違うものだけ区間ごとに持つ
    const paces = state.slots
      .map((sl, i) => ({ sl, sec: parseSec(state.slotTargets[i] ?? "") }))
      .filter((x) => x.sec !== undefined)
      .map((x) => ({
        distanceM: x.sl.distanceM,
        targetSecFast: x.sec!,
        targetSecSlow: x.sec!,
      }));
    const uniform =
      paces.length > 1 &&
      paces.every(
        (p) => p.distanceM === paces[0].distanceM && p.targetSecFast === paces[0].targetSecFast
      );
    if (paces.length > 0) out.targetPaces = uniform ? [paces[0]] : paces;
  }
  if (state.kind === "continuous") {
    if (state.distanceKm.trim()) out.distanceKm = Number(state.distanceKm);
    if (state.durationMin.trim()) out.durationMin = Number(state.durationMin);
    out.targetPaces = [];
  }
  return out;
}

/**
 * 判定の表示（種別・カテゴリ・根拠）と、本文に合わせた入力欄。
 *
 * 判定は断定せず、必ず直せる形で出す。根拠を一緒に出すのは、
 * 自動で入った値をあとから疑えるようにするため。
 */
export function PrescriptionFields({
  state,
  emptyCategoryLabel,
}: {
  state: PrescriptionFieldsState;
  /** 「未選択」を許すときのラベル。渡さなければ必ずどれかが選ばれている */
  emptyCategoryLabel?: string;
}) {
  const { structure, shape, kind, slots, uncertain } = state;
  return (
    <>
      {/* N-3: 本文から判定した種別とカテゴリ。断定せず、直せるようにする */}
      <div className="flex items-center gap-2 flex-wrap mb-1.5">
        <span className="text-[11px]" style={{ color: "var(--text-3)" }}>
          {KIND_LABEL[kind] ?? kind}
        </span>
        <select
          className="!text-[11px] !py-1"
          value={state.category}
          onChange={(e) => state.setCategory(e.target.value)}
          style={{ borderColor: uncertain ? "var(--amber)" : undefined }}
          aria-label="カテゴリ"
        >
          {emptyCategoryLabel ? <option value="">{emptyCategoryLabel}</option> : null}
          {EDIT_CATEGORIES.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        {shape?.restNote ? (
          <span className="text-[11px] num" style={{ color: "var(--text-3)" }}>
            {shape.restNote}
          </span>
        ) : null}
      </div>
      {shape?.basis ? (
        <p className="text-[10.5px] mb-1.5" style={{ color: "var(--text-3)" }}>
          カテゴリの根拠: {shape.basis}
        </p>
      ) : null}
      {uncertain ? (
        <StatusText kind="warning" className="text-[10.5px] mb-1.5">
          設定タイムが書かれていないためカテゴリが決まりません。選んでください
        </StatusText>
      ) : null}
      {/* 不具合1対応: ジョグ＋坂ダッシュ等、複数種類が混ざった本文への警告。
          1つの練習枠には1種類までしか記録できないため、黙って片方を捨てず理由を出す */}
      {structure?.issues?.find((i) => i.includes("混ざっている")) ? (
        <StatusText kind="warning" className="text-[10.5px] mb-1.5">
          {structure.issues.find((i) => i.includes("混ざっている"))}
        </StatusText>
      ) : null}
      {structure && !structure.recognized ? (
        <p className="text-[10.5px] mb-1.5" style={{ color: "var(--text-3)" }}>
          {structure.issues?.[0] ?? "本文を読み取れませんでした"}（入力欄はそのままにしてあります）
        </p>
      ) : null}

      {/* N-2: 本文の構造に合わせた入力欄 */}
      {kind === "interval" && slots.length > 0 ? (
        <div className="mb-2.5">
          <div className="text-[10px] mb-1" style={{ color: "var(--text-3)" }}>
            1本ごとの設定タイム
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {slots.map((sl, i) => (
              /* key は「何本目か」で固定する。本数が変わっても欄を作り直させない */
              <label key={`slot-${i}`} className="text-[10px]" style={{ color: "var(--text-3)" }}>
                <span className="block mb-0.5 num">
                  {i + 1}本目 {sl.distanceM}m
                </span>
                <input
                  className="w-full !text-[12px] !py-1"
                  inputMode="decimal"
                  value={state.slotTargets[i] ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    state.setSlotTargets((prev) => {
                      const next = [...prev];
                      while (next.length <= i) next.push("");
                      next[i] = v;
                      return next;
                    });
                  }}
                />
              </label>
            ))}
          </div>
        </div>
      ) : null}

      {kind === "continuous" ? (
        <div className="grid grid-cols-2 gap-1.5 mb-2.5">
          <label className="text-[10px]" style={{ color: "var(--text-3)" }}>
            <span className="block mb-0.5">距離km</span>
            <input
              className="w-full !text-[12px] !py-1"
              inputMode="decimal"
              value={state.distanceKm}
              onChange={(e) => state.setDistanceKm(e.target.value)}
            />
          </label>
          <label className="text-[10px]" style={{ color: "var(--text-3)" }}>
            <span className="block mb-0.5">時間（分）</span>
            <input
              className="w-full !text-[12px] !py-1"
              inputMode="decimal"
              value={state.durationMin}
              onChange={(e) => state.setDurationMin(e.target.value)}
            />
          </label>
        </div>
      ) : null}
    </>
  );
}
