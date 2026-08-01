/**
 * FIT取込 Phase 4: 3層データモデルでの保存（元ファイル / 自動解析 / 確認済み）。
 * FIT取込 Phase 6: 既存の計画済みセッションとの紐付け。
 *
 * 二重登録防止はPhase 5（`src/lib/service.ts` の `importFitFile`）。
 *
 * ここでの「確認済み」は、`FitImportRecord.confirmedKinds`
 * （自動判定＋本人が画面上で直した後の最終的な種別、lap配列と同じ並び）から
 * 実測データ（`deriveFitActuals`）を導く純粋関数。`PastEntry` →
 * `toSessionAndResult`（`backfill.ts`）と同じ考え方：確認済み層だけから
 * 機械的に決まり、何度re-runしても同じ結果になる。
 *
 * 計画済みセッションが見つからない場合（Phase 4までの挙動）は
 * `buildBackfilledSessionAndResult` で新規の`backfilled`セッションを作る。
 * 見つかって本人が紐付けを選んだ場合（Phase 6）は `buildLinkedResult` で
 * 既存セッションのidを使ったSessionResultだけを作り、呼び出し側
 * （service.tsの`importFitFile`）が正規の記録経路 `processResult` に渡す
 * ——これにより、手入力で記録した場合と同じくCFE更新・ルールエンジンが働く
 * （backfilledなデータには意図的にこれらを適用しない、という既存の使い分けと
 * 対になる。計画済みの予定に対する実測は「今日の記録」そのものだから）。
 */
import type {
  ContinuousRunDetail,
  IntervalDetail,
  RepResult,
  Session,
  SessionCategory,
  SessionResult,
  Subjective,
} from "./types";
import type { FitParseLap, FitParseResult } from "./fitParse";
import type { IntervalClassifyResult, IntervalKind } from "./intervalClassify";
import { categoryFromTarget } from "./bulkImport";

/** 保存される1件のFIT取込。3層のうち「元ファイル」と「自動解析」を持つ */
export interface FitImportRecord {
  id: string;
  importedAtUtc: string;
  fileName: string;
  /** 元ファイルの生バイト列（base64）。解析ロジックの改善時に再解析できるようにするため保持する */
  rawBytesBase64: string;
  parse: FitParseResult;
  autoClassification: IntervalClassifyResult;
  /** 本人が画面上で直した後の最終的な種別（lap配列と同じ並び）。「確認済み」層の元になる */
  confirmedKinds: IntervalKind[];
  sessionId: string;
  resultId: string;
}

export interface DeriveFitActualsInput {
  parse: FitParseResult;
  /** lap配列と同じ並びの、最終的な（本人確認後の）種別 */
  confirmedKinds: IntervalKind[];
  /** 秒/m。目標未設定（CFE無し）の場合は undefined（カテゴリを断定しない） */
  grpSecPerM?: number;
}

/** FITから確定した「確認済み」の実測データ。まだSession/SessionResultの形にはしていない */
export interface FitDerivedActuals {
  date: string;
  timeOfDay: "am" | "pm";
  category: SessionCategory;
  interval?: IntervalDetail;
  continuous?: ContinuousRunDetail;
  actualLapsSec: number[];
  lapDistancesM?: number[];
  completedReps?: number;
  rpe: number;
  subjective: Subjective;
  totalDistanceKm: number;
  totalDurationMin: number;
  warnings: string[];
  /** ランニングダイナミクス。対応デバイスのFITだけに入っている（無ければundefined） */
  weatherTempC?: number;
  avgCadenceSpm?: number;
  avgVerticalOscillationMm?: number;
  avgGroundContactTimeMs?: number;
  avgStepLengthM?: number;
}

export interface FitToSessionInput extends DeriveFitActualsInput {
  sourceId: string;
  fileName: string;
}

export interface FitToSessionOutput {
  session: Session;
  result: SessionResult;
  warnings: string[];
}

function localDateFromUtc(isoUtc: string, utcOffsetSec: number | undefined): string {
  const localMs = new Date(isoUtc).getTime() + (utcOffsetSec ?? 0) * 1000;
  return new Date(localMs).toISOString().slice(0, 10);
}

function localHourFromUtc(isoUtc: string, utcOffsetSec: number | undefined): number {
  const localMs = new Date(isoUtc).getTime() + (utcOffsetSec ?? 0) * 1000;
  return new Date(localMs).getUTCHours();
}

/** 最頻値。件数が同数のときは先に現れたものを優先する（決定的） */
function mode<T>(values: T[]): T {
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = values[0];
  let bestCount = 0;
  for (const [v, c] of counts) {
    if (c > bestCount) {
      best = v;
      bestCount = c;
    }
  }
  return best;
}

/**
 * GRP（設定ペースの基準）が無いときの距離だけによる暫定分類。
 * `bulkImport.ts` の `inferCategory` が設定タイム不明時に使う距離帯と揃えてある。
 */
function categoryForDistance(distanceM: number): SessionCategory {
  if (distanceM <= 600) return "high_lactate";
  if (distanceM <= 1600) return "cv";
  return "threshold";
}

/** 定義されている値だけの平均。1つも無ければundefined（0で埋めない） */
function avgOf(values: (number | undefined)[]): number | undefined {
  const defined = values.filter((v): v is number => v !== undefined);
  if (defined.length === 0) return undefined;
  return defined.reduce((a, b) => a + b, 0) / defined.length;
}

/**
 * 同じ1本の通過と見なす、lapの終わりと次のlapの始まりのずれの上限（秒）。
 *
 * FITの `total_elapsed_time` は一時停止も含んだ実時間なので、
 * 「前のlapの終わり ＝ 次のlapの始まり」なら、その間に休みは無い。
 * 2秒にしているのは、記録が1秒刻みで丸められるぶんだけを許すため
 * （休みは最短でも数十秒あるので、これを広げる理由が無い）。
 */
const SAME_REP_GAP_SEC = 2;

function lapEndMs(lap: FitParseLap): number | undefined {
  if (lap.endTimeUtc) return new Date(lap.endTimeUtc).getTime();
  if (lap.startTimeUtc && lap.elapsedSec !== undefined) {
    return new Date(lap.startTimeUtc).getTime() + lap.elapsedSec * 1000;
  }
  return undefined;
}

/**
 * 「メイン」lapを本ごとにまとめる。返すのはlap位置の配列の配列。
 *
 * 1本の中を時計で刻む（1000mを400/400/200で押す）と、間に休みのlapが無い
 * メインlapが並ぶ。**休み無しで次の本が始まることはありえない**ので、
 * この並びは別々の本ではなく1本の中の通過。
 * lap1つを1本と数えていたため、実運用で `1000m×4` が `396m×12` になっていた。
 *
 * まとめる条件は2つとも満たすこと:
 * - lap配列で隣り合っている（間に他の種別のlapが1つも無い＝休みが記録されていない）
 * - 時刻が連続している（記録を止めて再開した場合はここで切れる）
 *
 * 時刻が読めないFITでは隣接だけで判断する。間にlapが無い以上、
 * 休みが記録されていないことは確かなので、推測ではない。
 */
function groupIntoReps(laps: FitParseLap[], mainPositions: number[]): number[][] {
  const groups: number[][] = [];
  for (const pos of mainPositions) {
    const current = groups[groups.length - 1];
    const prev = current?.[current.length - 1];
    if (prev !== undefined && pos === prev + 1 && continuesWithoutRest(laps[prev], laps[pos])) {
      current.push(pos);
    } else {
      groups.push([pos]);
    }
  }
  return groups;
}

function continuesWithoutRest(prev: FitParseLap, next: FitParseLap): boolean {
  const prevEnd = lapEndMs(prev);
  const nextStart = next.startTimeUtc ? new Date(next.startTimeUtc).getTime() : undefined;
  if (prevEnd === undefined || nextStart === undefined) return true;
  return Math.abs(nextStart - prevEnd) <= SAME_REP_GAP_SEC * 1000;
}

/** 通過ごとの平均心拍を、通過の長さで重みをつけて1本ぶんにする。1つも無ければundefined */
function weightedHr(parts: FitParseLap[]): number | undefined {
  let sum = 0;
  let weight = 0;
  for (const l of parts) {
    if (l.avgHr === undefined) continue;
    const w = l.elapsedSec ?? 1;
    sum += l.avgHr * w;
    weight += w;
  }
  return weight > 0 ? Math.round(sum / weight) : undefined;
}

/** [from, to) 区間のlapの距離・時間を合算する。値が1つも読めなければ undefined */
function sumLapRange(
  laps: FitParseLap[],
  from: number,
  to: number
): { sec?: number; m?: number } {
  let sec = 0;
  let m = 0;
  let any = false;
  for (let k = from; k < to; k++) {
    const lap = laps[k];
    if (lap.elapsedSec !== undefined) {
      sec += lap.elapsedSec;
      any = true;
    }
    if (lap.distanceKm !== undefined) m += lap.distanceKm * 1000;
  }
  return any ? { sec: Math.round(sec), m: Math.round(m) } : {};
}

/**
 * FITの確認済みlap列から、区間種別ごとの実測データを導く。
 * Session/SessionResultどちらの形にするかは呼び出し側が決める
 * （新規のbackfilledセッションか、既存の計画済みセッションへの紐付けか）。
 */
export function deriveFitActuals(input: DeriveFitActualsInput): FitDerivedActuals {
  const { parse, confirmedKinds, grpSecPerM } = input;
  const laps = parse.laps;
  const warnings: string[] = [];

  if (laps.length === 0) {
    throw new Error("lapが無いFITファイルは記録として登録できません");
  }
  if (confirmedKinds.length !== laps.length) {
    throw new Error("区間の分類データがlap件数と一致しません");
  }

  const referenceUtc =
    laps[0].startTimeUtc ??
    parse.sessions[0]?.startTimeUtc ??
    parse.activityTimestampUtc ??
    parse.timeCreatedUtc;
  if (!referenceUtc) {
    throw new Error("日時を特定できるフィールドがFITファイル内に見つかりません");
  }
  if (parse.utcOffsetSec === undefined) {
    warnings.push(
      "記録デバイスのタイムゾーンが不明なため、日付がずれている可能性があります（UTC基準で登録しました）"
    );
  }
  const date = localDateFromUtc(referenceUtc, parse.utcOffsetSec);
  const timeOfDay: "am" | "pm" =
    parse.utcOffsetSec !== undefined
      ? localHourFromUtc(referenceUtc, parse.utcOffsetSec) < 12
        ? "am"
        : "pm"
      : "pm";

  const mainPositions = laps
    .map((lap, i) => i)
    .filter(
      (i) =>
        confirmedKinds[i] === "main" &&
        laps[i].distanceKm !== undefined &&
        laps[i].distanceKm! > 0 &&
        laps[i].elapsedSec !== undefined
    );

  let category: SessionCategory;
  let interval: IntervalDetail | undefined;
  let continuous: ContinuousRunDetail | undefined;
  let actualLapsSec: number[];
  let lapDistancesM: number[] | undefined;
  let completedReps: number | undefined;
  // ランニングダイナミクス（対応デバイスのみ）。インターバルは「メイン」区間の平均、
  // 持続走はセッション全体（無ければlap平均）。デバイス非対応なら全てundefinedのまま。
  let avgCadenceSpm: number | undefined;
  let avgVerticalOscillationMm: number | undefined;
  let avgGroundContactTimeMs: number | undefined;
  let avgStepLengthM: number | undefined;
  let weatherTempC: number | undefined;

  if (mainPositions.length > 0) {
    const groups = groupIntoReps(laps, mainPositions);
    const reps: RepResult[] = groups.map((group, idx) => {
      const last = group[group.length - 1];
      // 直後の「メイン」または「クールダウン」の手前までだけをこの本のレストとして数える。
      // クールダウンまで含めてしまうと、最後の本のレストが実際より長く出る。
      let end = last + 1;
      while (
        end < laps.length &&
        confirmedKinds[end] !== "main" &&
        confirmedKinds[end] !== "cooldown"
      ) {
        end++;
      }
      const rest = sumLapRange(laps, last + 1, end);
      const parts = group.map((p) => laps[p]);
      const splits = parts.map((l) => l.elapsedSec!);
      return {
        index: idx + 1,
        distanceM: Math.round(parts.reduce((s, l) => s + l.distanceKm! * 1000, 0)),
        actualSec: splits.reduce((a, b) => a + b, 0),
        // 通過ごとに心拍が違うので、通過の長さで重みをつけて1本ぶんにする
        avgHr: weightedHr(parts),
        restAfterSec: rest.sec,
        restAfterDistanceM: rest.m,
        splitsSec: splits.length > 1 ? splits : undefined,
      };
    });
    const distanceM = mode(reps.map((r) => r.distanceM));
    interval = { reps: reps.length, distanceM, results: reps };
    actualLapsSec = reps.map((r) => r.actualSec);
    lapDistancesM = reps.map((r) => r.distanceM);
    completedReps = reps.length;

    const mainLaps = mainPositions.map((pos) => laps[pos]);
    avgCadenceSpm = avgOf(mainLaps.map((l) => l.avgCadenceSpm));
    avgVerticalOscillationMm = avgOf(mainLaps.map((l) => l.avgVerticalOscillationMm));
    avgGroundContactTimeMs = avgOf(mainLaps.map((l) => l.avgGroundContactTimeMs));
    avgStepLengthM = avgOf(mainLaps.map((l) => l.avgStepLengthM));
    weatherTempC = avgOf(mainLaps.map((l) => l.avgTemperatureC));

    if (grpSecPerM !== undefined) {
      category = mode(
        reps.map((r) => categoryFromTarget(r.distanceM, r.actualSec, grpSecPerM).category)
      );
    } else {
      category = categoryForDistance(distanceM);
      warnings.push(
        "目標未設定でGRP（設定ペースの基準）が無いため、カテゴリは距離だけから暫定的に決めています。必要に応じて記録画面から直してください"
      );
    }
  } else {
    const session0 = parse.sessions[0];
    let distanceKm = session0?.totalDistanceKm;
    let elapsedSec = session0?.totalElapsedSec ?? session0?.totalTimerSec;
    if (distanceKm === undefined || elapsedSec === undefined) {
      const sums = sumLapRange(laps, 0, laps.length);
      distanceKm = sums.m !== undefined ? sums.m / 1000 : undefined;
      elapsedSec = sums.sec;
    }
    if (!distanceKm || !elapsedSec) {
      throw new Error("距離・時間の情報が無く、記録として登録できません");
    }
    continuous = {
      distanceKm: Math.round(distanceKm * 100) / 100,
      durationMin: Math.round((elapsedSec / 60) * 10) / 10,
      avgPaceSecPerKm: elapsedSec / distanceKm,
      avgHr: session0?.avgHr,
      maxHr: session0?.maxHr,
    };
    actualLapsSec = [Math.round(elapsedSec)];
    category = "aerobic";

    avgCadenceSpm = session0?.avgCadenceSpm ?? avgOf(laps.map((l) => l.avgCadenceSpm));
    avgVerticalOscillationMm =
      session0?.avgVerticalOscillationMm ?? avgOf(laps.map((l) => l.avgVerticalOscillationMm));
    avgGroundContactTimeMs =
      session0?.avgGroundContactTimeMs ?? avgOf(laps.map((l) => l.avgGroundContactTimeMs));
    avgStepLengthM = session0?.avgStepLengthM ?? avgOf(laps.map((l) => l.avgStepLengthM));
    weatherTempC = session0?.avgTemperatureC ?? avgOf(laps.map((l) => l.avgTemperatureC));
  }

  const totalDistanceKm =
    parse.sessions[0]?.totalDistanceKm ??
    laps.reduce((sum, l) => sum + (l.distanceKm ?? 0), 0);
  const totalDurationSec =
    parse.sessions[0]?.totalElapsedSec ?? laps.reduce((sum, l) => sum + (l.elapsedSec ?? 0), 0);

  const rpe = category === "aerobic" ? 3 : 8;
  const subjective: Subjective =
    rpe >= 9 ? "very_hard" : rpe >= 7 ? "hard" : rpe >= 5 ? "moderate" : "easy";

  return {
    date,
    timeOfDay,
    category,
    interval,
    continuous,
    actualLapsSec,
    lapDistancesM,
    completedReps,
    rpe,
    subjective,
    totalDistanceKm: Math.round(totalDistanceKm * 100) / 100,
    totalDurationMin: Math.round(totalDurationSec / 60),
    warnings,
    weatherTempC,
    avgCadenceSpm,
    avgVerticalOscillationMm,
    avgGroundContactTimeMs,
    avgStepLengthM,
  };
}

/** 計画済みセッションが見つからない場合: 新規のbackfilledセッション+結果を作る（Phase 4までの挙動） */
export function buildBackfilledSessionAndResult(
  derived: FitDerivedActuals,
  sourceId: string,
  fileName: string
): FitToSessionOutput {
  const { interval, continuous, category } = derived;
  const session: Session = {
    id: `fit-s-${sourceId}`,
    date: derived.date,
    category,
    name: interval ? "インターバル（FIT取込）" : "ジョグ（FIT取込）",
    prescription: interval
      ? `${interval.distanceM}m×${interval.reps}（FIT取込・自動判定）`
      : `${continuous!.distanceKm}km ${Math.round(continuous!.durationMin)}分（FIT取込）`,
    targetPaces: [],
    transfer800m: category === "aerobic" ? 2 : 4,
    transfer1500m: category === "aerobic" ? 3 : 3,
    riskLevel: category === "aerobic" ? "low" : "high",
    phase: "Base",
    status: "completed",
    isFixed: true,
    timeOfDay: derived.timeOfDay,
    distanceKm: derived.totalDistanceKm,
    durationMin: derived.totalDurationMin,
    surface: interval ? "track" : "road",
    backfilled: true,
  };
  const result: SessionResult = {
    id: `fit-r-${sourceId}`,
    sessionId: session.id,
    date: derived.date,
    actualLapsSec: derived.actualLapsSec,
    interval,
    continuous,
    lapDistancesM: derived.lapDistancesM,
    completedReps: derived.completedReps,
    rpe: derived.rpe,
    achievement: "achieved",
    subjective: derived.subjective,
    note: `FIT取込: ${fileName}`,
    backfilled: true,
    weatherTempC: derived.weatherTempC,
    avgCadenceSpm: derived.avgCadenceSpm,
    avgVerticalOscillationMm: derived.avgVerticalOscillationMm,
    avgGroundContactTimeMs: derived.avgGroundContactTimeMs,
    avgStepLengthM: derived.avgStepLengthM,
  };
  return { session, result, warnings: derived.warnings };
}

/**
 * 既存の計画済みセッションに紐付ける場合（Phase 6）: SessionResultだけを作る。
 * `backfilled` は立てない——正規の記録経路（`processResult`）に渡し、
 * 手入力で記録した場合と同じ扱い（CFE更新・ルールエンジン）にするため。
 * `resultId` は既存の結果があれば呼び出し側（`processResult`）がそれを
 * 引き継ぐので、無ければ使われる新規id、あれば無視される。
 */
export function buildLinkedResult(
  derived: FitDerivedActuals,
  sessionId: string,
  resultId: string,
  fileName: string
): SessionResult {
  return {
    id: resultId,
    sessionId,
    date: derived.date,
    actualLapsSec: derived.actualLapsSec,
    interval: derived.interval,
    continuous: derived.continuous,
    lapDistancesM: derived.lapDistancesM,
    completedReps: derived.completedReps,
    rpe: derived.rpe,
    achievement: "achieved",
    subjective: derived.subjective,
    note: `FIT取込: ${fileName}`,
    weatherTempC: derived.weatherTempC,
    avgCadenceSpm: derived.avgCadenceSpm,
    avgVerticalOscillationMm: derived.avgVerticalOscillationMm,
    avgGroundContactTimeMs: derived.avgGroundContactTimeMs,
    avgStepLengthM: derived.avgStepLengthM,
  };
}

/**
 * 後方互換のための組み合わせ関数（既存のテスト・`rebuildFitDerived` が使う）。
 * `deriveFitActuals` + `buildBackfilledSessionAndResult` と同じ。
 */
export function fitToSessionAndResult(input: FitToSessionInput): FitToSessionOutput {
  const derived = deriveFitActuals(input);
  return buildBackfilledSessionAndResult(derived, input.sourceId, input.fileName);
}
