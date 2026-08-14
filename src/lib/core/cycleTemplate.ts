/**
 * N日周期のトレーニング周期。
 *
 * これまでメニューの枠は曜日（7日）でしか組めなかった。
 * 7日は生活の都合であって、**回復に必要な日数とは関係がない**。
 * 高乳酸のあと中2日欲しいのに週2回の枠に押し込めると、
 * どちらかが中1日になるか、片方が消える。
 * 「10日で2〜3本」のほうが素直に組める局面がある。
 *
 * ここは配置だけを決める純関数。処方の中身（何m×何本）は `progression.ts`、
 * 曜日枠との共通の語彙（ポイント／ジョグ／休養）は `weekTemplate.ts` にある。
 *
 * ---
 *
 * いちばん厄介なのは、**アプリのルールが暦の週で数えていること**。
 * RULE-04 は「同じ週に高負荷が4日以上」「高乳酸・中距離特異的が3日以上」でERRORを出す。
 * 10日周期は暦の週と噛み合わないので、周期の中では等間隔でも、
 * 暦の週で見ると1週に3本入る並びが出てくる。
 *
 * だから配置を決めたあと、**周期を繰り返したときの7日窓を全部数えて確かめる**。
 * 通らなければ、きつい方（高乳酸・経済走・モデリング）の割合を落とし、
 * それでも駄目ならポイントの本数を減らす。**減らしたことは必ず理由とセットで返す。**
 */
import type { SessionCategory } from "./types";
import { addDays, diffDays } from "./dates";
import {
  hasDeepGlycolyticCostCategory,
  isHighLoadCategory,
  isSpecificCategory,
} from "./trainingClassification";

/**
 * 周期の長さの範囲。
 *
 * 下限4日: ポイントの間隔は最低でも中2日（3日）欲しい（RULE-03）。
 * 3日周期だとポイントが3日おきに来るので、暦の7日間に3本入って必ずERRORになる。
 * 4日なら7日窓に入るのは最大2本で、どう並べても成立する。
 *
 * 上限14日: これ以上長いとフェーズ（Base 12週〜／Taper 2週）より周期が粗くなり、
 * 「周期の途中でフェーズが変わる」ほうが常態になって、何を繰り返しているのか分からなくなる。
 */
export const MIN_CYCLE_DAYS = 4;
export const MAX_CYCLE_DAYS = 14;

/** ポイント練習どうしの最短間隔（中2日 = RULE-03） */
export const MIN_POINT_GAP_DAYS = 3;

/** 高乳酸・モデリングの最短間隔（RULE-01 と生成ループの保険に合わせる） */
export const MIN_DEEP_GLYCOLYTIC_GAP_DAYS = 5;

/** 暦の7日間に許す高負荷日数（RULE-04: 4日以上でERROR） */
const MAX_HIGH_LOAD_PER_7_DAYS = 3;

/** 暦の7日間に許す高乳酸・中距離特異的の日数（RULE-04: 3日以上でERROR） */
const MAX_DEMANDING_PER_7_DAYS = 2;

/**
 * きつい方の割合を落とすときの段。
 *
 * 連続値で下げると、割合がわずかに違うだけの並びを何十回も試すことになる。
 * 分母の小さい分数だけに絞ると、並びが必ず短い周期で繰り返すので
 * 「10周期ぶん数えれば全部見た」と言い切れる。
 */
const DEMANDING_RATE_LADDER = [1, 3 / 4, 2 / 3, 1 / 2, 2 / 5, 1 / 3, 1 / 4, 1 / 5, 1 / 6];

/** 検証で数える周期の数。上の段の分母（最大6）を2巡できる長さ */
const SIMULATED_CYCLES = 14;

export type CycleRole = "point" | "recovery_jog" | "long_run" | "neural" | "jog";

export interface CycleShapeInput {
  lengthDays: number;
  /** 週テンプレートを実際に数えた本数（別表を持つと生成の基準とずれる） */
  pointsPerWeek: number;
  neuralPerWeek: number;
  longRunPerWeek: number;
  /** ポイントのうち「きつい方」に入れる内容の並び（高乳酸・経済走・モデリング） */
  demandingStream: SessionCategory[];
  /** ポイントのうち「きつくない方」に入れる内容の並び（CV・閾値） */
  aerobicHighStream: SessionCategory[];
  /** そのフェーズで、ポイントのうちきつい方が占める割合（週テンプレートの実測） */
  demandingRate: number;
}

export interface CycleShape {
  lengthDays: number;
  /** 周期の各日に何を置くか（index 0 = 1日目） */
  roles: CycleRole[];
  /** ポイント練習を置く位置（0始まり・昇順） */
  pointPositions: number[];
  pointsPerCycle: number;
  demandingRate: number;
  demandingStream: SessionCategory[];
  aerobicHighStream: SessionCategory[];
  /**
   * 週テンプレートの配分から変えた点。
   * 黙って減らすと「調子が落ちたのか設定が変わったのか」が分からなくなるので、
   * 画面に出して本人が却下できるようにする。
   */
  adjustments: string[];
}

/** その日付が周期の何日目か（0始まり）。起点より前の日でも正しく折り返す */
export function cyclePositionOf(anchorDate: string, date: string, lengthDays: number): number {
  const n = Math.max(1, Math.round(lengthDays));
  const d = diffDays(anchorDate, date);
  return ((d % n) + n) % n;
}

/** その日付が起点から何周目か（起点より前は負になる） */
export function cycleNumberOf(anchorDate: string, date: string, lengthDays: number): number {
  const n = Math.max(1, Math.round(lengthDays));
  return Math.floor(diffDays(anchorDate, date) / n);
}

/** 周期のその位置が次に来る日付 */
export function nextDateAtPosition(
  anchorDate: string,
  fromDate: string,
  lengthDays: number,
  position: number
): string {
  const n = Math.max(1, Math.round(lengthDays));
  const current = cyclePositionOf(anchorDate, fromDate, n);
  const ahead = ((position - current) % n + n) % n;
  return addDays(fromDate, ahead);
}

export function clampCycleLength(days: number): number {
  if (!Number.isFinite(days)) return 7;
  return Math.min(MAX_CYCLE_DAYS, Math.max(MIN_CYCLE_DAYS, Math.round(days)));
}

/** ポイントをできるだけ等間隔に置く */
function placeEvenly(lengthDays: number, count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(Math.round((i * lengthDays) / count) % lengthDays);
  return [...new Set(out)].sort((a, b) => a - b);
}

/** 周期が繰り返す前提での、隣り合うポイントの最短間隔 */
function minPointGap(lengthDays: number, positions: number[]): number {
  if (positions.length <= 1) return lengthDays;
  let min = lengthDays;
  for (let i = 0; i < positions.length; i++) {
    const next = positions[(i + 1) % positions.length];
    const gap = i === positions.length - 1 ? lengthDays - positions[i] + next : next - positions[i];
    min = Math.min(min, gap);
  }
  return min;
}

/**
 * ポイントの通し番号から「きつい方かどうか」を決める。
 *
 * 割合を等間隔にばらす（3/4なら○○○×の並びになる）。
 * 通し番号だけで決まるので、生成器は周期の何周目でも同じ答えを出せる。
 */
function isDemandingPoint(globalIndex: number, rate: number): boolean {
  if (rate >= 1) return true;
  if (rate <= 0) return false;
  return Math.floor((globalIndex + 1) * rate) > Math.floor(globalIndex * rate);
}

function wrap(n: number, len: number): number {
  return ((n % len) + len) % len;
}

function categoryForPoint(
  globalIndex: number,
  rate: number,
  demandingStream: SessionCategory[],
  aerobicHighStream: SessionCategory[]
): SessionCategory {
  /*
   * きつい方が何本目かは数え上げずに出す。
   * `isDemandingPoint` は floor((g+1)r) > floor(gr) なので、
   * 0..g-1 に入るきつい方の本数はちょうど floor(g*r) になる。
   * **通し番号は負にもなる**（起点より前の日を生成することがある）ので、
   * 数え上げのループにすると答えが出ない。
   */
  const demandingBefore = Math.floor(globalIndex * rate);
  if (isDemandingPoint(globalIndex, rate) && demandingStream.length > 0) {
    return demandingStream[wrap(demandingBefore, demandingStream.length)];
  }
  if (aerobicHighStream.length > 0) {
    return aerobicHighStream[wrap(globalIndex - demandingBefore, aerobicHighStream.length)];
  }
  return demandingStream[0] ?? "cv";
}

/** 周期のその位置・その周のポイントに入る内容 */
export function pointCategoryAt(shape: CycleShape, globalPointIndex: number): SessionCategory {
  return categoryForPoint(
    globalPointIndex,
    shape.demandingRate,
    shape.demandingStream,
    shape.aerobicHighStream
  );
}

/**
 * 周期を繰り返したときに、暦の7日間でルールに触れないかを数える。
 *
 * 周期の中で等間隔でも、暦の週と噛み合わないので実際に並べて数えるしかない。
 * 端の周期は前後が欠けて数え落とすため、真ん中だけを見る。
 */
function violates7DayWindow(
  lengthDays: number,
  positions: number[],
  rate: number,
  demandingStream: SessionCategory[],
  aerobicHighStream: SessionCategory[]
): boolean {
  const k = positions.length;
  if (k === 0) return false;
  const total = SIMULATED_CYCLES * lengthDays;
  const byDay = new Array<SessionCategory | undefined>(total).fill(undefined);
  for (let c = 0; c < SIMULATED_CYCLES; c++) {
    for (let i = 0; i < k; i++) {
      byDay[c * lengthDays + positions[i]] = categoryForPoint(
        c * k + i,
        rate,
        demandingStream,
        aerobicHighStream
      );
    }
  }
  const from = lengthDays;
  const to = total - lengthDays - 7;
  for (let s = from; s <= to; s++) {
    let high = 0;
    let demanding = 0;
    for (let d = s; d < s + 7; d++) {
      const cat = byDay[d];
      if (!cat) continue;
      if (isHighLoadCategory(cat)) high++;
      if (isSpecificCategory(cat)) demanding++;
    }
    if (high > MAX_HIGH_LOAD_PER_7_DAYS) return true;
    if (demanding > MAX_DEMANDING_PER_7_DAYS) return true;
  }

  // 高乳酸・モデリングの最短間隔（RULE-01）。生成ループの保険が潰す前にここで避ける
  let last: number | undefined;
  for (let d = from; d <= total - lengthDays; d++) {
    const cat = byDay[d];
    if (!cat || !hasDeepGlycolyticCostCategory(cat)) continue;
    if (last !== undefined && d - last < MIN_DEEP_GLYCOLYTIC_GAP_DAYS) return true;
    last = d;
  }
  return false;
}

/**
 * 周期の形を決める。
 *
 * 順番に意味がある。
 *   1. ポイント（等間隔・中2日以上）
 *   2. その翌日を回復ジョグ（高負荷の翌日に何を置くかは動かせない）
 *   3. ポイントの前日に神経系（週テンプレートも「木=流し → 金=経済走」の並びになっている）
 *   4. 残りのうちポイントからいちばん遠い日にロングラン
 *   5. 残りはジョグ
 */
export function planCycleShape(input: CycleShapeInput): CycleShape {
  const lengthDays = clampCycleLength(input.lengthDays);
  const adjustments: string[] = [];

  // --- ポイントの本数 ---
  const wanted = Math.max(1, Math.round((input.pointsPerWeek * lengthDays) / 7));
  const capacity = Math.max(1, Math.floor(lengthDays / MIN_POINT_GAP_DAYS));
  let k = Math.min(wanted, capacity);
  if (k < wanted) {
    adjustments.push(
      `ポイント練習を${wanted}本から${k}本に減らしました（間隔を中2日以上あけるため）。`
    );
  }

  let positions = placeEvenly(lengthDays, k);
  while (k > 1 && minPointGap(lengthDays, positions) < MIN_POINT_GAP_DAYS) {
    k--;
    positions = placeEvenly(lengthDays, k);
    adjustments.push(`ポイント練習を1本減らしました（等間隔にすると中1日になるため）。`);
  }

  // --- きつい方の割合。7日窓で数え、通るまで下げる ---
  const naturalRate = Math.min(1, Math.max(0, input.demandingRate));
  let rate = naturalRate;
  const ladder = DEMANDING_RATE_LADDER.filter((r) => r <= naturalRate + 1e-9);
  let ok = !violates7DayWindow(
    lengthDays,
    positions,
    rate,
    input.demandingStream,
    input.aerobicHighStream
  );
  for (const candidate of ladder) {
    if (ok) break;
    rate = candidate;
    ok = !violates7DayWindow(
      lengthDays,
      positions,
      rate,
      input.demandingStream,
      input.aerobicHighStream
    );
  }
  // 割合を落としても駄目なら本数を減らす（最後の手段）
  while (!ok && k > 1) {
    k--;
    positions = placeEvenly(lengthDays, k);
    rate = naturalRate;
    ok = !violates7DayWindow(
      lengthDays,
      positions,
      rate,
      input.demandingStream,
      input.aerobicHighStream
    );
    for (const candidate of ladder) {
      if (ok) break;
      rate = candidate;
      ok = !violates7DayWindow(
        lengthDays,
        positions,
        rate,
        input.demandingStream,
        input.aerobicHighStream
      );
    }
    adjustments.push(
      `ポイント練習を1本減らして${k}本にしました（暦の1週間に高負荷が集中するため）。`
    );
  }
  if (rate < naturalRate - 1e-9) {
    adjustments.push(
      `高乳酸・経済走の割合をポイントの${Math.round(naturalRate * 100)}%から${Math.round(
        rate * 100
      )}%に下げ、残りをCV・閾値にしました（暦の1週間に高乳酸・中距離特異的が3日入らないようにするため）。`
    );
  }

  // --- 役割を置く ---
  const roles: CycleRole[] = new Array(lengthDays).fill("jog");
  for (const p of positions) roles[p] = "point";
  for (const p of positions) {
    const after = (p + 1) % lengthDays;
    if (roles[after] === "jog") roles[after] = "recovery_jog";
  }

  const neuralCount = Math.max(
    0,
    Math.min(
      Math.round((input.neuralPerWeek * lengthDays) / 7),
      roles.filter((r) => r === "jog").length
    )
  );
  let placedNeural = 0;
  // ポイントの前日から埋める（神経系はポイントの準備になる。低負荷なので前日でよい）
  for (const p of positions) {
    if (placedNeural >= neuralCount) break;
    const before = (p - 1 + lengthDays) % lengthDays;
    if (roles[before] === "jog") {
      roles[before] = "neural";
      placedNeural++;
    }
  }
  // 足りなければポイントからいちばん遠い日に置く（かたまらないように）
  while (placedNeural < neuralCount) {
    const pick = farthestFree(roles, positions, lengthDays, "neural");
    if (pick === undefined) break;
    roles[pick] = "neural";
    placedNeural++;
  }

  const longRunCount = Math.max(
    0,
    Math.min(
      Math.round((input.longRunPerWeek * lengthDays) / 7),
      roles.filter((r) => r === "jog").length
    )
  );
  for (let i = 0; i < longRunCount; i++) {
    const pick = farthestFree(roles, positions, lengthDays, "long_run");
    if (pick === undefined) break;
    roles[pick] = "long_run";
  }

  return {
    lengthDays,
    roles,
    pointPositions: positions,
    pointsPerCycle: positions.length,
    demandingRate: rate,
    demandingStream: input.demandingStream,
    aerobicHighStream: input.aerobicHighStream,
    adjustments,
  };
}

/**
 * まだジョグのままの日のうち、ポイントからいちばん遠い日を選ぶ。
 * 同点なら「すでに置いた同じ役割から遠いほう」→ それも同点なら後ろの日。
 * ロングランを高負荷の隣に置かないための選び方。
 */
function farthestFree(
  roles: CycleRole[],
  positions: number[],
  lengthDays: number,
  placing: CycleRole
): number | undefined {
  const same = roles.flatMap((r, i) => (r === placing ? [i] : []));
  let best: number | undefined;
  let bestScore = -1;
  for (let i = 0; i < lengthDays; i++) {
    if (roles[i] !== "jog") continue;
    const toPoint = positions.length
      ? Math.min(...positions.map((p) => cyclicDistance(i, p, lengthDays)))
      : lengthDays;
    const toSame = same.length
      ? Math.min(...same.map((p) => cyclicDistance(i, p, lengthDays)))
      : lengthDays;
    const score = Math.min(toPoint, toSame);
    // 同点なら後ろの日を選ぶ（週テンプレートでもロングランは週末側にある）
    if (score >= bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

function cyclicDistance(a: number, b: number, lengthDays: number): number {
  const raw = Math.abs(a - b);
  return Math.min(raw, lengthDays - raw);
}

/** 周期の中身を1行で説明する（設定画面と処方の根拠に出す） */
export function describeCycleShape(shape: CycleShape): string {
  const perWeek = (shape.pointsPerCycle * 7) / shape.lengthDays;
  return `${shape.lengthDays}日で${shape.pointsPerCycle}本（週換算 ${perWeek.toFixed(1)}本）`;
}
