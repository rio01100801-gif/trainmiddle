/**
 * N-2 / N-3 メニュー本文から構造を読み取る
 *
 * 目的は2つ。
 *   ・本文に合わせて入力欄を組み立てる（インターバルなら本数ぶんのタイム欄）
 *   ・本文からカテゴリを判定し直す
 *
 * **解釈は一括入力のものをそのまま使う。** ここで独自に読み直さない。
 * 同じ「300(42)×5 r5min」が、一括入力では高乳酸、編集シートでは別の何か、
 * ということが起きると、どちらの数字を信じればいいのか分からなくなる。
 * そのため中身は `parseRow`（一括入力の1行解析）に日付を足して渡しているだけで、
 * このファイルがやるのは「入力欄を組むための形に整える」ことだけ。
 */
import type { RestType, SessionCategory } from "./types";
import type { PastEntryKind } from "./backfill";
import { parseRow, type BulkParseOptions, type StrengthKind } from "./bulkImport";

/** 入力欄1つぶん（1本ぶん） */
export interface RepSlot {
  /** 1始まり */
  index: number;
  distanceM: number;
  /** 本文から読めた設定タイム */
  targetSec?: number;
  /** この区間のあとのレスト。複合セットでは区間ごとに異なり得る。 */
  restAfterDistanceM?: number;
  restType?: RestType;
}

export interface PrescriptionStructure {
  kind: PastEntryKind | "unknown";
  category?: SessionCategory;
  /** カテゴリが一意に決まったか。false なら人に選ばせる */
  categoryCertain: boolean;
  /** 判定の根拠（「設定 42.0秒/300m はGRPの98%」など） */
  basis?: string;

  /** インターバル: 本数ぶん。複合（300+600+600）なら区間ごと */
  slots: RepSlot[];
  reps?: number;
  repDistanceM?: number;
  restNote?: string;
  /**
   * レストの実体。文面（restNote）だけだと画面が数値として使えず、
   * 結果入力の欄が処方を見ずに既定値へ落ちていた（実際に処方207秒に対して欄が300秒だった）。
   */
  restSec?: number;
  restDistanceM?: number;
  restType?: RestType;
  /** 距離の違う区間が混ざっているか */
  mixed: boolean;

  distanceKm?: number;
  durationMin?: number;
  paceSecPerKm?: number;

  raceDistanceM?: number;
  raceTimeSec?: number;
  lapsSec?: number[];

  strengthType?: StrengthKind;
  contactCount?: number;

  /**
   * 読み取れたか。false のときは入力欄を変えない。
   * 打ちかけの本文で欄を作り直すと、入力中の値が消える。
   */
  recognized: boolean;
  issues: string[];

  /**
   * 構造の指紋。これが変わったときだけ入力欄を作り直す。
   * 本文が1文字変わるたびに作り直すと、入力欄が毎回作られてキーボードが閉じる（N-1と同じ症状）。
   */
  shape: string;
}

/** 解析の基準日。日付は使わないので固定でよい */
const DUMMY_DATE = "2026-01-01";

export function parsePrescription(
  text: string,
  opts: BulkParseOptions = {}
): PrescriptionStructure {
  const body = (text ?? "").trim();
  if (!body) return emptyStructure("本文が空です");

  // 一括入力と同じ解析器に通す。日付だけ足して1行として渡す
  const row = parseRow(`${DUMMY_DATE} ${body}`, 1, DUMMY_DATE, opts);

  if (!row.kind) {
    return emptyStructure(
      "種別を読み取れませんでした（例: 300m×5 r5分 / ジョグ40分 / 800m 1:53.5）"
    );
  }

  const slots = buildSlots(row);
  const mixed = row.issues.some((i) => i.includes("距離の違う区間"));
  const durationMin =
    row.durationSec !== undefined ? Math.round((row.durationSec / 60) * 10) / 10 : undefined;

  const s: PrescriptionStructure = {
    kind: row.kind,
    category: row.category,
    categoryCertain: !row.categoryUncertain,
    basis: row.issues.find((i) => i.startsWith("カテゴリの根拠: "))?.replace("カテゴリの根拠: ", ""),
    slots,
    reps: row.reps ?? (slots.length > 0 ? slots.length : undefined),
    repDistanceM: row.repDistanceM,
    restNote: row.restNote,
    restSec: row.restSec,
    restDistanceM: row.restDistanceM,
    restType: row.restType,
    mixed,
    // 8.333… のような割り算の結果をそのまま入力欄に出さない
    distanceKm:
      row.distanceKm !== undefined ? Math.round(row.distanceKm * 10) / 10 : undefined,
    durationMin,
    paceSecPerKm: row.paceSecPerKm,
    raceDistanceM: row.raceDistanceM,
    raceTimeSec: row.raceTimeSec,
    lapsSec: row.lapsSec,
    strengthType: row.strengthType,
    contactCount: row.contactCount,
    recognized: isRecognized(row),
    issues: row.issues.filter((i) => !i.startsWith("カテゴリの根拠: ")),
    shape: "",
  };
  s.shape = shapeOf(s);
  return s;
}

function buildSlots(row: ReturnType<typeof parseRow>): RepSlot[] {
  if (row.kind !== "interval") return [];

  // 複合（300(42)＋600(1:26)＋600(1:26)）は区間ごとに欄を出す。
  // 区間ごとに設定が違うので、1つの設定欄では表せない。
  const segs = row.segments ?? [];
  if (segs.length >= 2) {
    return segs.map((g, i) => ({
      index: i + 1,
      distanceM: g.distanceM,
      targetSec: g.targetSec,
      restAfterDistanceM:
        row.restFollowsNextDistance && i < segs.length - 1
          ? segs[i + 1].distanceM
          : undefined,
      restType: row.restFollowsNextDistance && i < segs.length - 1 ? "walk" : undefined,
    }));
  }

  const dist = row.repDistanceM;
  const reps = row.reps ?? row.repTimesSec?.length;
  if (!dist || !reps) return [];
  return Array.from({ length: Math.min(reps, MAX_SLOTS) }, (_, i) => ({
    index: i + 1,
    distanceM: dist,
    targetSec: row.targetSec,
  }));
}

/** 本数の上限。打ち間違いで「×99」と入っても欄を99個作らない */
export const MAX_SLOTS = 30;

function isRecognized(row: ReturnType<typeof parseRow>): boolean {
  switch (row.kind) {
    case "interval":
      return !!row.repDistanceM || (row.segments?.length ?? 0) > 0;
    case "continuous":
      return row.distanceKm !== undefined || row.durationSec !== undefined;
    case "race":
    case "timetrial":
      return row.raceDistanceM !== undefined || row.raceTimeSec !== undefined;
    case "off":
    case "strength":
      return true;
    default:
      return false;
  }
}

function emptyStructure(issue: string): PrescriptionStructure {
  return {
    kind: "unknown",
    categoryCertain: false,
    slots: [],
    mixed: false,
    recognized: false,
    issues: [issue],
    shape: "unknown",
  };
}

/**
 * 構造が変わったかどうかの判定に使う指紋。
 * 設定タイムは含めない。設定だけを直したときに欄を作り直すと、
 * 入力途中の値が消えてしまう。
 */
export function shapeOf(s: PrescriptionStructure): string {
  return [
    s.kind,
    s.slots.map((x) => x.distanceM).join("-"),
    s.reps ?? "",
    s.repDistanceM ?? "",
  ].join("|");
}

/**
 * 本数が変わったときに、入力済みの値をどう引き継ぐか。
 *
 * 増えたぶんは空欄を足すだけ。減ったぶんは捨てずに残す。
 * 打ち間違いで一時的に「×3」になったときに、4本目5本目を消してしまうと
 * 入れ直しになる。使うのは先頭 n 本ぶんだけ。
 */
export function resizeValues<T>(prev: T[], next: number, fill: T): T[] {
  if (next <= prev.length) return prev;
  return [...prev, ...Array.from({ length: next - prev.length }, () => fill)];
}
