/**
 * 1-1 / 1-2. 練習記録の構造化ヘルパー
 * ジョグ・持続走（continuous）とインターバル・レペ（interval）の
 * 計算・整形・達成判定をまとめる。
 */
import type {
  ContinuousRunDetail,
  IntervalDetail,
  RepResult,
  RestType,
  Session,
  SessionCategory,
  SessionResult,
} from "./types";

export const REST_LABELS: Record<RestType, string> = {
  jog: "jog",
  walk: "walk",
  full: "完全休息",
};

// ---------------------------------------------------------------------------
// 1-1. ジョグ・持続走
// ---------------------------------------------------------------------------

/** 距離(km)と時間(分)から平均ペース(秒/km)を計算する */
export function avgPaceSecPerKm(distanceKm: number, durationMin: number): number {
  if (distanceKm <= 0) return NaN;
  return (durationMin * 60) / distanceKm;
}

/**
 * ジョグ記録を組み立てる。
 * paceOverrideSecPerKm が渡された場合はそれを採用し、上書きフラグを立てる。
 */
export function buildContinuous(input: {
  distanceKm: number;
  durationMin: number;
  paceOverrideSecPerKm?: number;
  avgHr?: number;
  maxHr?: number;
}): ContinuousRunDetail {
  const auto = avgPaceSecPerKm(input.distanceKm, input.durationMin);
  const overridden =
    input.paceOverrideSecPerKm !== undefined && isFinite(input.paceOverrideSecPerKm);
  return {
    distanceKm: input.distanceKm,
    durationMin: input.durationMin,
    avgPaceSecPerKm: overridden ? input.paceOverrideSecPerKm! : auto,
    paceOverridden: overridden || undefined,
    avgHr: input.avgHr,
    maxHr: input.maxHr,
  };
}

// ---------------------------------------------------------------------------
// 1-2. インターバル・レペ
// ---------------------------------------------------------------------------

/** "1000m×5 r2' jog" のような表示文字列を組み立てる */
/**
 * S-4: 本ごとのレストが入っていれば、それを並べて返す。
 * 全部同じ／入っていないなら undefined（セッション共通のレストを出せばよい）。
 */
export function perRepRestNote(d: IntervalDetail): string | undefined {
  const rests = d.results.map((r) => r.restAfterSec);
  const given = rests.filter((v): v is number => v !== undefined);
  if (given.length === 0) return undefined;
  const uniq = new Set(given);
  if (uniq.size === 1 && given.length === rests.length) return undefined;
  // 最終本のあとのレストは意味が無いので落とす
  const shown = rests.slice(0, -1);
  if (shown.every((v) => v === undefined)) return undefined;
  return `レスト ${shown.map((v) => (v === undefined ? "-" : formatRest(v))).join(" / ")}`;
}

export function describeInterval(d: IntervalDetail): string {
  // レストの種類が書かれていないものは、種類を出さずに量だけ出す
  const kind = d.restType ? ` ${REST_LABELS[d.restType]}` : "";
  const rest =
    d.restDistanceM !== undefined
      ? `r${d.restDistanceM}m${kind}`
      : d.restSec !== undefined
        ? `r${formatRest(d.restSec)}${kind}`
        : kind.trim();
  const target = d.targetSec !== undefined ? ` @${d.targetSec.toFixed(1)}秒` : "";
  return `${d.distanceM}m×${d.reps}${target} ${rest}`;
}

function formatRest(sec: number): string {
  if (sec % 60 === 0) return `${sec / 60}'`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}'${String(s).padStart(2, "0")}"` : `${s}"`;
}

/** 本数分の実施タイム配列から RepResult[] を作る */
export function buildRepResults(
  distanceM: number,
  actualSecs: number[],
  targetSec?: number,
  /** 1本ごとの平均心拍（Q-1）。任意。入っているものだけ付く */
  avgHrs: (number | undefined)[] = [],
  /** 1本ごとの距離（S-4）。複合セッションで区間の距離が違うとき */
  distancesM: (number | undefined)[] = [],
  /** その本のあとのレスト秒（S-4）。任意 */
  restAfterSecs: (number | undefined)[] = []
): RepResult[] {
  // 心拍・距離・レストは「何本目か」で対応させる。先に間引くと、
  // 実施タイムが空の本があったときに1本ずつずれる
  const num = (v: number | undefined) =>
    v !== undefined && isFinite(v) && v > 0 ? v : undefined;
  return actualSecs
    .map((actualSec, i) => ({
      actualSec,
      avgHr: avgHrs[i],
      distanceM: distancesM[i],
      restAfterSec: restAfterSecs[i],
    }))
    .filter((x) => isFinite(x.actualSec) && x.actualSec > 0)
    .map((x, i) => ({
      index: i + 1,
      distanceM: num(x.distanceM) ?? distanceM,
      targetSec,
      actualSec: x.actualSec,
      ...(num(x.avgHr) !== undefined ? { avgHr: x.avgHr } : {}),
      ...(num(x.restAfterSec) !== undefined ? { restAfterSec: x.restAfterSec } : {}),
    }));
}

export interface LapTrend {
  /** 各本のタイム */
  values: number[];
  fastest: number;
  slowest: number;
  average: number;
  /** 最終本 − 初回本。正 = 垂れている */
  dropoffSec: number;
  /** 設定に対する達成率(%)。設定が無ければ undefined */
  achievementPct?: number;
  /** 設定を満たした本数 */
  achievedReps?: number;
  summary: string;
}

/**
 * ラップの推移を要約する。
 * 800mの練習では「垂れ幅」が最も重要な情報なので、平均だけでなく必ず出す。
 */
export function lapTrend(detail: IntervalDetail): LapTrend | undefined {
  const values = detail.results.map((r) => r.actualSec).filter((v) => isFinite(v) && v > 0);
  if (values.length === 0) return undefined;

  const fastest = Math.min(...values);
  const slowest = Math.max(...values);
  const average = values.reduce((a, b) => a + b, 0) / values.length;
  const dropoffSec = values[values.length - 1] - values[0];

  let achievementPct: number | undefined;
  let achievedReps: number | undefined;
  if (detail.targetSec !== undefined && detail.targetSec > 0) {
    achievedReps = values.filter((v) => v <= detail.targetSec! + 0.05).length;
    // 達成率 = 設定タイム / 平均実施タイム（100%超 = 設定より速い）
    achievementPct = (detail.targetSec / average) * 100;
  }

  const parts = [
    `平均 ${average.toFixed(1)}秒`,
    `最速 ${fastest.toFixed(1)} / 最遅 ${slowest.toFixed(1)}`,
    dropoffSec > 0
      ? `垂れ +${dropoffSec.toFixed(1)}秒`
      : dropoffSec < 0
        ? `ビルドアップ ${dropoffSec.toFixed(1)}秒`
        : "イーブン",
  ];
  if (achievedReps !== undefined) {
    parts.push(`設定達成 ${achievedReps}/${values.length}本`);
  }

  return {
    values,
    fastest,
    slowest,
    average,
    dropoffSec,
    achievementPct,
    achievedReps,
    summary: parts.join(" ／ "),
  };
}

/**
 * 4-1（クローズドループ）用: 構造化記録から達成度を自動判定する。
 * 手入力の achievement より、実測から機械的に決まるこちらを優先できるようにする。
 */
export function inferAchievement(
  detail: IntervalDetail
): "achieved" | "partial" | "failed" | undefined {
  const t = lapTrend(detail);
  if (!t || t.achievedReps === undefined) return undefined;
  const done = t.values.length;
  const ratioReps = done / detail.reps; // 本数を完遂したか
  const ratioHit = t.achievedReps / done; // 設定を満たした割合

  if (ratioReps >= 1 && ratioHit >= 0.8) return "achieved";
  if (ratioReps < 0.7 || ratioHit < 0.4) return "failed";
  return "partial";
}

/** 記録の種類を判定する（一覧表示用） */
export function resultKind(r: SessionResult): "continuous" | "interval" | "laps" | "none" {
  if (r.continuous) return "continuous";
  if (r.interval) return "interval";
  if (r.actualLapsSec.length > 0) return "laps";
  return "none";
}

/** 一覧に出す1行サマリー */
export function summarizeResult(r: SessionResult): string {
  if (r.continuous) {
    const c = r.continuous;
    return `${c.distanceKm}km / ${c.durationMin}分 / ${fmtPace(c.avgPaceSecPerKm)}${
      c.avgHr ? ` / 平均${c.avgHr}bpm` : ""
    }`;
  }
  if (r.interval) {
    const t = lapTrend(r.interval);
    // 本ごとにレストが違うときは、そちらを出す（セッション共通のレストでは表せない）
    const perRep = perRepRestNote(r.interval);
    return `${describeInterval(r.interval)}${perRep ? `（${perRep}）` : ""}${
      t ? ` → ${t.summary}` : ""
    }`;
  }
  if (r.actualLapsSec.length > 0) {
    return r.actualLapsSec.map((v) => v.toFixed(1)).join(" / ");
  }
  return "記録なし";
}

function fmtPace(secPerKm: number): string {
  if (!isFinite(secPerKm)) return "-";
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm - m * 60);
  return `${m}:${String(s).padStart(2, "0")}/km`;
}

// ---------------------------------------------------------------------------
// D-3「前回と同じ」
// ---------------------------------------------------------------------------

/**
 * 「前回と同じ」で読み込む対象を選ぶ。
 *
 * 設計上いちばん危ないのは「違う練習を前回と同じとして提示すること」。
 * トラックで急いで入力しているときに中身を確認せず登録されると、
 * そのままCFEの更新に流れてしまう。そこで次の2点で事故を防ぐ。
 *
 * 1. 同一カテゴリのものしか対象にしない（高乳酸の記録を経済走に持ってこない）
 * 2. どのセッションから読んだかを必ず呼び出し側へ返し、画面に出させる
 *
 * 距離や本数が違っていても「前回の入力値」として読み込む価値はあるので、
 * 一致条件は厳しくしない。代わりに出典を見せて本人に判断させる。
 */
export interface PreviousEntry {
  /** 読み込み元のセッション */
  sessionId: string;
  date: string;
  sessionName: string;
  category: SessionCategory;
  result: SessionResult;
  /** 画面に出す出典表示（例: "07-21 高乳酸セッション"） */
  label: string;
}

export function findPreviousEntry(
  sessions: Session[],
  results: SessionResult[],
  category: SessionCategory,
  beforeDate: string,
  excludeSessionId?: string
): PreviousEntry | undefined {
  const bySession = new Map(results.map((r) => [r.sessionId, r]));
  const candidates = sessions
    .filter(
      (s) =>
        s.category === category &&
        s.date < beforeDate &&
        s.id !== excludeSessionId &&
        bySession.has(s.id)
    )
    .sort((a, b) => b.date.localeCompare(a.date));
  const s = candidates[0];
  if (!s) return undefined;
  const result = bySession.get(s.id)!;
  return {
    sessionId: s.id,
    date: s.date,
    sessionName: s.name,
    category: s.category,
    result,
    label: `${s.date.slice(5)} ${s.name}`,
  };
}
