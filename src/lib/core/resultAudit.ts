/**
 * 保存された結果の読み返し。「入れたものがそのまま入っているか」を本人が確かめる。
 *
 * これが無かったせいで、複合セット（1000m×4＋200m×3、レストが本ごとに違う）を
 * 入れたあと「ちゃんと入力できているのか」を確かめる手段が本人側に無かった。
 * 実際そのとき、保存は正しかったがCFE側に取りこぼしが2件あった。
 * 保存の中身と、それが何に使われたかの両方が見えないと切り分けられない。
 *
 * ここがやるのは**保存済みの値を並べ直すことだけ**。
 * 判定（CFEに使うか等）はしない——判定をここで書き直すと、
 * 実際の処理と説明が食い違ったときに、説明のほうが正しく見えてしまう。
 * 使われ方はサービス層が本物の判定関数から取って渡す。
 */
import type { Session, SessionResult } from "./types";

export interface AuditRep {
  /** 1始まり */
  index: number;
  /** 実際に走った距離 */
  distanceM?: number;
  /** 予定していた距離。実距離と違うときだけ入る */
  plannedDistanceM?: number;
  timeSec?: number;
  /** レストの表示用文字列（「3分」「200mジョグ」）。無ければ undefined */
  restLabel?: string;
}

export interface ResultAudit {
  resultId: string;
  date: string;
  sessionName: string;
  category: string;
  reps: AuditRep[];
  /** 本ごとの距離が揃っていないか */
  mixedDistances: boolean;
  rpe?: number;
  /** 何に使われるか。サービス層が判定結果を入れる */
  usage: { label: string; used: boolean; note?: string }[];
}

const REST_TYPE_LABEL: Record<string, string> = {
  jog: "ジョグ",
  walk: "ウォーク",
  full: "完全休息",
  stand: "立位",
};

/** 「180秒」→「3分」、「200m + jog」→「200mジョグ」。無ければ出さない */
export function restLabelOf(
  restSec: number | undefined,
  restDistanceM: number | undefined,
  restType: string | undefined
): string | undefined {
  const type = restType ? (REST_TYPE_LABEL[restType] ?? "") : "";
  if (restDistanceM !== undefined) return `${restDistanceM}m${type}`;
  if (restSec === undefined) return undefined;
  // 割り切れるときだけ分で書く。95秒を「1.6分」にすると入れた値と違って見える
  const label = restSec % 60 === 0 ? `${restSec / 60}分` : `${restSec}秒`;
  return type ? `${label}${type}` : label;
}

/**
 * 保存済みの結果を、本ごとの行に並べ直す。
 *
 * `interval.results` を正とする。`actualLapsSec` / `lapDistancesM` は
 * 同じ値の平坦な写しなので、片方だけ見ると本ごとのレストが落ちる。
 */
export function buildResultAudit(session: Session, result: SessionResult): ResultAudit {
  const rows = result.interval?.results ?? [];
  const reps: AuditRep[] = rows.length
    ? rows.map((r, i) => ({
        index: r.index ?? i + 1,
        distanceM: r.distanceM,
        plannedDistanceM:
          r.plannedDistanceM !== undefined && r.plannedDistanceM !== r.distanceM
            ? r.plannedDistanceM
            : undefined,
        timeSec: r.actualSec,
        // 本ごとのレストは restAfterSec / restAfterDistanceM（「その本のあと」の意味）。
        // interval 側の restSec と名前が似ているので取り違えないこと。
        restLabel: restLabelOf(
          r.restAfterSec ?? result.interval?.restSec,
          r.restAfterDistanceM ?? result.interval?.restDistanceM,
          result.interval?.restType
        ),
      }))
    : result.actualLapsSec.map((t, i) => ({
        index: i + 1,
        distanceM: result.lapDistancesM?.[i],
        timeSec: t,
        restLabel: restLabelOf(
          result.interval?.restSec,
          result.interval?.restDistanceM,
          result.interval?.restType
        ),
      }));

  const dists = reps.map((r) => r.distanceM).filter((d): d is number => d !== undefined);
  return {
    resultId: result.id,
    date: result.date,
    sessionName: session.name,
    category: session.category,
    reps,
    mixedDistances: new Set(dists).size > 1,
    rpe: result.rpe,
    usage: [],
  };
}
