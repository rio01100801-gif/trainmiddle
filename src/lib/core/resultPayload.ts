/**
 * 記録画面が保存する中身を組み立てる。
 *
 * これまで画面の保存処理の中に直接書いてあった。**保存内容を1か所で追えない**ので、
 * 「この値はどこで入ったのか」を調べるたびに2400行のフォームを読むことになっていた。
 * 実際に「隠れているモードの値が混ざる」「空欄が0として入る」は、
 * どちらもこの組み立ての中で起きた種類の不具合。
 *
 * ここは**画面の状態を持たない純関数**にしてある。値を受け取って形を返すだけなので、
 * 単体テストで境界を固定できる（画面の中にあったときはE2Eで1経路ずつ叩くしかなかった）。
 *
 * **モードごとに別々に組む。** 表示していないほうの値は受け取っても使わない。
 * 入力欄の state を消して実現すると、押し間違いで戻したときに打ち直しになるので、
 * **state は残したまま、ここで混ぜない**（E2Eの「記録画面の不変条件」が両方を見張っている）。
 */
import { avgPaceSecPerKm, buildRepResults } from "./workoutLog";
import { parseRest } from "./bulkImport";
import type { NextDayLegs, RestType, Subjective } from "./types";
import type { AbortCause } from "./abortCause";

// ---------------------------------------------------------------------------
// 入力の書き方をほどく
// ---------------------------------------------------------------------------

/** 実施タイム1本ぶん。「41.6」「1:26.5」いずれも受ける */
export function parseRepTime(v: string): number | undefined {
  const t = v.trim();
  if (!t) return undefined;
  if (t.includes(":")) {
    const [m, sec] = t.split(":");
    const n = Number(m) * 60 + Number(sec);
    return isFinite(n) ? n : undefined;
  }
  const n = Number(t);
  return isFinite(n) && n > 0 ? n : undefined;
}

/**
 * S-4: 「6分」「90秒」「300」のようなレストの書き方を秒に直す。
 *
 * 解釈は一括入力と同じ `parseRest` に任せる（同じ文字列が画面によって違う意味に
 * ならないようにする）。単位が無いものは分でも秒でも決められないので、
 * **入力欄なので数字だけなら秒として読む**。
 * 日誌の解釈（読めなければ埋めない）と、入力欄（本人が今打っている）は事情が違う。
 */
export function parseRestInput(v: string): number | undefined {
  const t = v.trim();
  if (!t) return undefined;
  const parsed = parseRest(t);
  if (parsed.restSec !== undefined) return parsed.restSec;
  if (parsed.restDistanceM !== undefined) return undefined; // 距離指定はここでは扱わない
  const n = Number(t.replace(/[^\d.]/g, ""));
  return isFinite(n) && n > 0 ? n : undefined;
}

export function parsePerRepRestInput(v: string): {
  restSec?: number;
  restDistanceM?: number;
  restType?: RestType;
} {
  const parsed = parseRest(v.trim());
  if (parsed.restSec !== undefined || parsed.restDistanceM !== undefined) return parsed;
  const restSec = parseRestInput(v);
  return restSec !== undefined ? { restSec, restType: parsed.restType } : parsed;
}

// ---------------------------------------------------------------------------
// 組み立て
// ---------------------------------------------------------------------------

/** どのモードでも共通で付くもの */
export interface ResultPayloadCommon {
  sessionId: string;
  sessionCategory?: string;
  date: string;
  rpe: number;
  subjective: Subjective;
  nextDayLegs?: NextDayLegs;
  /** 2-1 環境と、その日の条件・靴・打ち切りの理由 */
  weatherTempC?: number;
  humidityPct?: number;
  wind?: string;
  rain?: boolean;
  conditions?: string[];
  shoeId?: string;
  abortCause?: AbortCause;
  abortNote?: string;
}

export interface ContinuousDraft {
  /** S-2 で補ったあとの3値。2つ揃っていることは checkResultDraft が見ている */
  distanceKm: number;
  durationMin: number;
  paceSecPerKm?: number;
  /** 3値のうち、どれが計算で埋まったか */
  derived?: string;
  /** 手で入れたペースを使ったか */
  paceOverride: boolean;
  avgHr?: number;
  maxHr?: number;
}

export interface IntervalDraft {
  reps: number;
  distanceM: number;
  targetSec?: number;
  /** 複合（500+300 など）。距離も設定も本ごとに違うので共通の設定を持たない */
  mixed: boolean;
  /** 1本ずつ入れたか、まとめて貼ったか */
  perRep: boolean;
  /** 1本ずつのときの実施タイム。まとめてのときは `times` を使う */
  repTimes: string[];
  times: string;
  /** 欄の数。処方の本数と入れた本数の多い方 */
  slotCount: number;
  slotDistances: (number | undefined)[];
  slotTargets: (number | undefined)[];
  slotRestDistances: (number | undefined)[];
  structureRestType?: RestType;
  withRest: boolean;
  repRests: string[];
  withActualDistance: boolean;
  repDistances: string[];
  withHr: boolean;
  repHrs: string[];
  hasStructuredPerRepRest: boolean;
  restType: RestType;
  restMode: "time" | "distance";
  restValue: string;
}

/**
 * 持続走（ジョグ・ペース走）。
 *
 * **インターバルの値は受け取らない。** 引数の型で混ざりようがないようにしてある。
 */
export function buildContinuousPayload(
  common: ResultPayloadCommon,
  draft: ContinuousDraft
): Record<string, unknown> {
  const { distanceKm: km, durationMin: min } = draft;
  return {
    sessionId: common.sessionId,
    sessionCategory: common.sessionCategory,
    date: common.date,
    continuous: {
      distanceKm: Math.round(km * 100) / 100,
      durationMin: Math.round(min * 10) / 10,
      avgPaceSecPerKm: draft.paceSecPerKm ?? avgPaceSecPerKm(km, min),
      /*
       * 手で入れたペースが計算値の代わりに使われた場合だけ「上書き」とする。
       * ペースから距離を出したときは上書きではなく、それが実測そのもの。
       */
      paceOverridden: draft.paceOverride && draft.derived !== "distanceKm" ? true : undefined,
      avgHr: draft.avgHr,
      maxHr: draft.maxHr,
    },
    achievement: "achieved",
    rpe: common.rpe,
    subjective: common.subjective,
    nextDayLegs: common.nextDayLegs,
    durationMin: min,
    ...environmentOf(common),
  };
}

/**
 * インターバル・レペ。
 *
 * **持続走の値は受け取らない。**
 */
export function buildIntervalPayload(
  common: ResultPayloadCommon,
  draft: IntervalDraft
): Record<string, unknown> {
  const source = draft.perRep ? draft.repTimes.join(",") : draft.times;
  // 心拍と「何本目か」で対応させるため、間引く前の並びも残す
  const parsedTimes = source.split(",").map((x) => parseRepTime(x) ?? 0);
  const target = draft.mixed ? undefined : draft.targetSec;

  // S-4: 区間ごとのレスト。空欄の本はセッション共通の設定を使う（undefinedのまま）
  const perRepRests =
    draft.perRep && draft.withRest
      ? Array.from({ length: draft.slotCount }, (_, index) => {
          const entered = draft.repRests[index]?.trim();
          return entered
            ? parsePerRepRestInput(entered)
            : {
                restDistanceM: draft.slotRestDistances[index],
                restType: draft.structureRestType,
              };
        })
      : [];

  // 予定距離と実距離を分ける。500m予定を400mで止めた本も400m実測として残す
  const plannedDists = draft.perRep
    ? Array.from(
        { length: draft.slotCount },
        (_, index) => draft.slotDistances[index] ?? draft.distanceM
      )
    : [];
  const dists = draft.perRep
    ? plannedDists.map((plannedDistance, index) => {
        if (!draft.withActualDistance) return plannedDistance;
        const entered = Number(draft.repDistances[index]);
        return isFinite(entered) && entered > 0 ? entered : plannedDistance;
      })
    : [];
  const hrs =
    draft.perRep && draft.withHr
      ? draft.repHrs.map((v) => {
          const n = Number(v);
          return v.trim() && isFinite(n) && n > 0 ? n : undefined;
        })
      : [];

  const builtResults = buildRepResults(
    draft.distanceM,
    parsedTimes,
    target,
    hrs,
    dists,
    perRepRests.map((rest) => rest.restSec),
    draft.slotTargets,
    perRepRests.map((rest) => rest.restDistanceM),
    plannedDists
  );

  return {
    sessionId: common.sessionId,
    sessionCategory: common.sessionCategory,
    date: common.date,
    interval: {
      reps: draft.reps,
      distanceM: draft.distanceM,
      targetSec: target,
      restType: draft.structureRestType ?? draft.restType,
      restSec:
        !draft.hasStructuredPerRepRest && draft.restMode === "time"
          ? Number(draft.restValue)
          : undefined,
      restDistanceM:
        !draft.hasStructuredPerRepRest && draft.restMode === "distance"
          ? Number(draft.restValue)
          : undefined,
      results: builtResults,
    },
    actualLapsSec: builtResults.map((result) => result.actualSec),
    lapDistancesM: builtResults.map((result) => result.distanceM),
    achievement: "achieved", // サービス層が実測から上書きする
    rpe: common.rpe,
    subjective: common.subjective,
    nextDayLegs: common.nextDayLegs,
    ...environmentOf(common),
  };
}

/** 2-1 環境と、その日の条件・靴・打ち切りの理由。どのモードでも同じ */
function environmentOf(common: ResultPayloadCommon): Record<string, unknown> {
  return {
    weatherTempC: common.weatherTempC,
    humidityPct: common.humidityPct,
    wind: common.wind,
    rain: common.rain,
    conditions: common.conditions,
    shoeId: common.shoeId,
    abortCause: common.abortCause,
    abortNote: common.abortNote,
  };
}
