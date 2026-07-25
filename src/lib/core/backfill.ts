/**
 * 過去データの遡り入力と「現在地」の推定
 *
 * ねらい:
 * CFEの初期値は 800mPB + 1.5秒 で置かれる。しかしPBが1年前のもので、
 * その後に走力が落ちている場合、CFEが実力より速い側に張り付く。
 * 基準タイム = CFE×(1−w) + 目標×w が全カテゴリのペースの親なので、
 * CFEが速すぎると設定ペース全体が実力を上回り、特に暑熱耐性が低い選手が
 * 夏場にこれをやると練習が成立しない。過去の実測から現在地を測り直す。
 *
 * 設計上の絶対条件:
 * 過去データを通常の結果記録ループ（processResult）に流してはならない。
 * ・CFE更新は1回あたり±1.5秒（レース±3秒）のガードレールを持つ。
 *   過去3ヶ月ぶんを順に流すとガードレールが何十回も適用され、
 *   CFEがいくらでも動いてしまう（ガードレールが意味を失う）。
 * ・未来セッションへの波及処理が過去日付で何度も走り、無意味な変更提案が出る。
 * そのため、ここでは「全件を入れ終えてから1回だけ」現在地を算出する。
 *
 * さらに、算出結果は自動適用しない。内訳（どの実測が何秒として効いたか）を
 * 提示し、本人が承認して初めてCFEに反映する。理由が見えない数値は使えない。
 */
import type {
  Athlete,
  RestType,
  Session,
  SessionCategory,
  SessionResult,
  FitnessMarker,
} from "./types";
import { diffDays } from "./dates";
import { estimateWbgt, HEAT_FLAG_WBGT_THRESHOLD, HEAT_FLAG_TEMP_THRESHOLD } from "./environment";
import { GRP_RATIOS } from "./pace";

// ---------------------------------------------------------------------------
// データ型
// ---------------------------------------------------------------------------

export type PastEntryKind = "race" | "timetrial" | "interval" | "continuous" | "off" | "strength";

export const PAST_KIND_LABELS: Record<PastEntryKind, string> = {
  race: "レース",
  timetrial: "タイムトライアル",
  interval: "ポイント練習",
  continuous: "ジョグ・持続走",
  off: "オフ（休養）",
  strength: "補強",
};

export interface PastEntry {
  id: string;
  date: string;
  kind: PastEntryKind;

  /** race / timetrial: 距離と記録 */
  distanceM?: number;
  timeSec?: number;
  /** 区間ラップ（任意）。前後半の落ち幅の分析に使う */
  lapsSec?: number[];
  lapDistanceM?: number;

  /** interval: 本数・1本の距離・各本のタイム・レスト */
  category?: SessionCategory;
  reps?: number;
  repDistanceM?: number;
  repTimesSec?: number[];
  restType?: RestType;
  restSec?: number;

  /** continuous: 距離と時間 */
  distanceKm?: number;
  durationMin?: number;

  avgHr?: number;
  rpe?: number;
  tempC?: number;
  humidityPct?: number;
  note?: string;
}

/** 遡り入力の推奨上限（週）。これより古いものは現在地の推定に使わない */
export const BACKFILL_WINDOW_WEEKS = 12;

// ---------------------------------------------------------------------------
// 換算: 他距離の記録 → 800m相当
// ---------------------------------------------------------------------------

/**
 * 一般式（Riegel）。指数1.06は中距離〜長距離で使われる標準値。
 * ただし400mのように無酸素性の比重が大きい距離では誤差が大きいので、
 * 本人のPB関係が使える場合はそちらを優先する（personalConverter 参照）。
 */
export function riegel(timeSec: number, fromM: number, toM: number): number {
  return timeSec * Math.pow(toM / fromM, 1.06);
}

export interface Converter {
  to800m: (timeSec: number, distanceM: number) => number | undefined;
  /** その換算がどれだけ信用できるか 0〜1 */
  reliability: (distanceM: number) => number;
  basis: string;
}

/**
 * 本人のPB関係から換算式を組む。
 *
 * 400m→800m: 800m = 400m×2 + 換算差
 *   換算差は本人のPBから実測できる（診断ロジック 4-1 と同じ指標）。
 *   例) 800m 1:49.51 / 400m 49.0 → 換算差 11.51秒
 * 1500m→800m: 800m = (1500m − 差) ÷ 2
 *   例) 1500m 3:56.0 / 800m 1:49.51 → 差 16.98秒
 * 600m→800m: 本人データが無いので一般係数（後述）を使う。
 *
 * 本人の関係式を使う理由: 800m選手は同じ800mタイムでも
 * スピード型と持久型で400m/1500mとの関係が大きく違う。
 * 一般式を当てると型の分だけ丸ごと誤差になる。
 */
export function personalConverter(athlete: Athlete): Converter {
  const pb800 = athlete.pb800mSec;
  const diff400 =
    athlete.pb400mSec !== undefined ? pb800 - athlete.pb400mSec * 2 : undefined;
  const diff1500 =
    athlete.pb1500mSec !== undefined ? athlete.pb1500mSec - pb800 * 2 : undefined;

  return {
    basis: [
      diff400 !== undefined ? `400m換算差 ${diff400.toFixed(2)}秒` : undefined,
      diff1500 !== undefined ? `1500m差 ${diff1500.toFixed(2)}秒` : undefined,
    ]
      .filter(Boolean)
      .join(" / "),
    to800m(timeSec, distanceM) {
      if (distanceM === 800) return timeSec;
      if (distanceM === 400 && diff400 !== undefined) return timeSec * 2 + diff400;
      if (distanceM === 1500 && diff1500 !== undefined) return (timeSec - diff1500) / 2;
      // 600m は本人のPBが無いため一般係数。
      // 600mから800mへの換算はおおよそ ×1.43（十分に訓練された800m選手）。
      if (distanceM === 600) return timeSec * 1.43;
      if (distanceM >= 300 && distanceM <= 3000) return riegel(timeSec, distanceM, 800);
      return undefined;
    },
    reliability(distanceM) {
      if (distanceM === 800) return 1.0;
      if (distanceM === 600) return 0.85;
      if (distanceM === 400) return diff400 !== undefined ? 0.75 : 0.5;
      if (distanceM === 1000) return 0.8;
      if (distanceM === 1500) return diff1500 !== undefined ? 0.7 : 0.5;
      if (distanceM >= 300 && distanceM <= 3000) return 0.45;
      return 0;
    },
  };
}

// ---------------------------------------------------------------------------
// 換算: ポイント練習 → 800m相当
// ---------------------------------------------------------------------------

/** カテゴリごとの標準レスト（秒）。実施レストがこれより長いほど過大評価になる */
const STANDARD_REST_SEC: Partial<Record<SessionCategory, number>> = {
  high_lactate: 240,
  modeling: 300,
  race_economy: 120,
  cv: 90,
  threshold: 60,
  neural: 300,
};

/**
 * ポイント練習の実測から800m相当を逆算する。
 *
 * 生成側は 設定タイム = 距離 × GRP × 比率 で作っている（4-2）。
 * その逆をたどれば 800m相当 = 実測平均タイム ÷ 距離 ÷ 比率 × 800 になる。
 *
 * ただし練習はレースではない。次の3点で信頼度を落とす。
 * 1. 全力に近くなければ能力を測れない → RPEが低い実測は使わない
 * 2. レストが標準より長ければ同じタイムでも楽 → 過大評価を補正
 * 3. 垂れているセッションは「1本目だけ速い」を実力と誤認しやすい → 平均を使う
 */
export function impliedFromInterval(
  entry: PastEntry
): { implied800mSec: number; reliability: number; note: string } | undefined {
  const cat = entry.category;
  const dist = entry.repDistanceM;
  const times = entry.repTimesSec?.filter((t) => t > 0) ?? [];
  if (!cat || !dist || times.length === 0) return undefined;

  const ratios = GRP_RATIOS[cat];
  if (!ratios) return undefined;

  // RPEが低い＝全力ではない。能力の下限しか分からないので採用しない。
  if (entry.rpe !== undefined && entry.rpe < 6) return undefined;

  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const ratio = (ratios.fast + ratios.slow) / 2;
  const implied = (avg / dist / ratio) * 800;

  // レスト補正: 標準より長いレストで出したタイムは実力を速く見せる。
  // 標準の2倍のレストで 0.6秒（800m換算）ぶん割り引く程度の穏やかな補正にする。
  // ここを強くしすぎると「レストを正直に入力すると損」になり入力が歪む。
  const std = STANDARD_REST_SEC[cat];
  let restPenalty = 0;
  const notes: string[] = [];
  if (std && entry.restSec !== undefined && entry.restSec > std) {
    const over = entry.restSec / std - 1;
    restPenalty = Math.min(1.2, over * 0.6);
    notes.push(`レスト${entry.restSec}秒（標準${std}秒）のため+${restPenalty.toFixed(1)}秒補正`);
  }
  // 完全休息は同じ時間でも回復量が多い
  if (entry.restType === "full" && cat !== "neural") {
    restPenalty += 0.3;
    notes.push("完全休息のため+0.3秒補正");
  }

  // 本数が少ないほど1本あたりは速く出せる。3本未満は能力の代表性が低い。
  let reliability = 0.5;
  if (times.length < 3) reliability = 0.3;
  if (times.length >= 5) reliability = 0.55;
  // 高乳酸・モデリングは800mへの転移が高いので相対的に信用できる
  if (cat === "modeling") reliability += 0.1;
  if (cat === "cv" || cat === "threshold") reliability -= 0.2;
  reliability = Math.max(0.1, Math.min(0.65, reliability));

  return {
    implied800mSec: implied + restPenalty,
    reliability,
    note:
      `${times.length}本平均 ${avg.toFixed(2)}秒 ÷ ${cat}比率 ${ratio.toFixed(3)}` +
      (notes.length ? ` / ${notes.join(" / ")}` : ""),
  };
}

// ---------------------------------------------------------------------------
// 現在地の推定
// ---------------------------------------------------------------------------

export interface BackfillSample {
  entryId: string;
  date: string;
  label: string;
  implied800mSec: number;
  weight: number;
  reliability: number;
  recencyWeight: number;
  heatFlagged: boolean;
  note: string;
}

export interface ExcludedSample {
  entryId: string;
  date: string;
  label: string;
  reason: string;
}

export interface FitnessAssessment {
  estimated800mSec?: number;
  confidence: number;
  samples: BackfillSample[];
  excluded: ExcludedSample[];
  notes: string[];
  /** 現在のCFEとの差（＋なら今のCFEは楽観的） */
  deltaFromCfeSec?: number;
}

/**
 * 直近性の重み。半減期28日。
 *
 * LT推定（pace.ts）は半減期14日を使っているが、こちらは28日にしている。
 * 理由: LTペースは数週間で動くが、レース能力そのものはもう少し慢性的で、
 * 既存のCFE鈍化規定（14日無記録で+0.4秒/週）ともスケールが揃う。
 * 12週前のレースは重み 0.5^3 ≒ 0.125 まで落ちる。
 */
export function recencyWeight(ageDays: number): number {
  return Math.pow(0.5, ageDays / 28);
}

/**
 * 暑熱下データを除外してよいと判断する、涼しい実測の重み合計の下限。
 * 0.5 は「直近の800mレース1本（信頼度1.0）がおよそ4週以内にある」水準。
 * 練習からの外挿（信頼度0.5前後）だけでは1本では届かず、2本必要になる。
 */
export const COOL_WEIGHT_THRESHOLD = 0.5;

function isHeat(entry: PastEntry): boolean {
  if (entry.tempC === undefined) return false;
  if (entry.tempC >= HEAT_FLAG_TEMP_THRESHOLD) return true;
  if (entry.humidityPct === undefined) return false;
  return estimateWbgt(entry.tempC, entry.humidityPct) >= HEAT_FLAG_WBGT_THRESHOLD;
}

function labelOf(e: PastEntry): string {
  if (e.kind === "off") return "オフ";
  if (e.kind === "strength") return "補強";
  if (e.kind === "race" || e.kind === "timetrial") {
    return `${PAST_KIND_LABELS[e.kind]} ${e.distanceM ?? "?"}m`;
  }
  if (e.kind === "interval") {
    return `${e.repDistanceM ?? "?"}m×${e.repTimesSec?.length ?? e.reps ?? "?"}`;
  }
  return `${e.distanceKm ?? "?"}km 持続走`;
}

/**
 * 過去データ一式から現在の800m能力を1回だけ推定する。
 *
 * 暑熱の扱い:
 * 暑熱下の実測は実力を過小評価する。原則として除外するが、
 * 東京の夏に練習している選手の場合、除外すると何も残らないことがある。
 * そこで「非暑熱が2件以上あれば暑熱を除外」「無ければ暑熱も使うが
 * 過小評価である旨を明記する」という段階的な扱いにする。
 * 暑熱下データに補正係数を掛けて実力を「盛る」ことはしない（根拠が無いため）。
 */
export function assessCurrentFitness(
  entries: PastEntry[],
  athlete: Athlete,
  today: string,
  opts: { currentCfeSec?: number; windowWeeks?: number } = {}
): FitnessAssessment {
  const windowDays = (opts.windowWeeks ?? BACKFILL_WINDOW_WEEKS) * 7;
  const conv = personalConverter(athlete);
  const notes: string[] = [];
  const excluded: ExcludedSample[] = [];

  type Cand = Omit<BackfillSample, "weight">;
  const cands: Cand[] = [];

  for (const e of entries) {
    const age = diffDays(e.date, today);
    const label = labelOf(e);
    if (age < 0) {
      excluded.push({ entryId: e.id, date: e.date, label, reason: "未来の日付です" });
      continue;
    }
    if (age > windowDays) {
      excluded.push({
        entryId: e.id,
        date: e.date,
        label,
        reason: `${Math.round(age / 7)}週前（対象は直近${opts.windowWeeks ?? BACKFILL_WINDOW_WEEKS}週）`,
      });
      continue;
    }
    if (e.kind === "continuous") {
      excluded.push({
        entryId: e.id,
        date: e.date,
        label,
        reason: "有酸素系は800m能力の推定に使わない（LTペースと負荷比に反映）",
      });
      continue;
    }
    if (e.kind === "off") {
      excluded.push({
        entryId: e.id,
        date: e.date,
        label,
        reason: "休養日（記録として残すだけで、能力推定には使わない）",
      });
      continue;
    }
    if (e.kind === "strength") {
      excluded.push({
        entryId: e.id,
        date: e.date,
        label,
        reason: "補強（走練習ではないので800m能力の推定には使わない）",
      });
      continue;
    }

    if (e.kind === "race" || e.kind === "timetrial") {
      if (!e.distanceM || !e.timeSec) {
        excluded.push({ entryId: e.id, date: e.date, label, reason: "距離または記録が未入力" });
        continue;
      }
      const implied = conv.to800m(e.timeSec, e.distanceM);
      if (implied === undefined) {
        excluded.push({
          entryId: e.id,
          date: e.date,
          label,
          reason: `${e.distanceM}m は800mへの換算対象外（300〜3000mが対象）`,
        });
        continue;
      }
      let rel = conv.reliability(e.distanceM);
      // タイムトライアルは単独走でレースより条件が悪い
      if (e.kind === "timetrial") rel *= 0.85;
      cands.push({
        entryId: e.id,
        date: e.date,
        label,
        implied800mSec: implied,
        reliability: rel,
        recencyWeight: recencyWeight(age),
        heatFlagged: isHeat(e),
        note:
          e.distanceM === 800
            ? "800mの実測をそのまま使用"
            : `${e.distanceM}m ${e.timeSec.toFixed(2)}秒 → ${conv.basis || "一般式(Riegel)"}`,
      });
      continue;
    }

    // interval
    const imp = impliedFromInterval(e);
    if (!imp) {
      excluded.push({
        entryId: e.id,
        date: e.date,
        label,
        reason:
          e.rpe !== undefined && e.rpe < 6
            ? `RPE${e.rpe}（全力でない練習からは能力を測れない）`
            : "カテゴリ・距離・タイムのいずれかが不足",
      });
      continue;
    }
    cands.push({
      entryId: e.id,
      date: e.date,
      label,
      implied800mSec: imp.implied800mSec,
      reliability: imp.reliability,
      recencyWeight: recencyWeight(age),
      heatFlagged: isHeat(e),
      note: imp.note,
    });
  }

  // --- 暑熱の扱い ---
  //
  // 判定は「件数」ではなく「重み（信頼度×直近性）の合計」で見る。
  // 件数で見ると、涼しい日の800mレース1本（最も信用できる実測）が
  // 暑熱下の練習からの外挿と同列に扱われ、平均に引きずられてしまう。
  // 重みで見れば、レース1本あれば暑熱下データを外す判断ができる。
  const cool = cands.filter((c) => !c.heatFlagged);
  const coolWeight = cool.reduce((a, c) => a + c.reliability * c.recencyWeight, 0);
  let used: Cand[];
  if (coolWeight >= COOL_WEIGHT_THRESHOLD) {
    used = cool;
    const dropped = cands.filter((c) => c.heatFlagged);
    for (const d of dropped) {
      excluded.push({
        entryId: d.entryId,
        date: d.date,
        label: d.label,
        reason: "暑熱下（実力を過小評価するため除外）",
      });
    }
    if (dropped.length > 0) {
      notes.push(`暑熱下の${dropped.length}件を除外し、涼しい条件の${cool.length}件で推定しました。`);
    }
  } else {
    used = cands;
    if (cands.some((c) => c.heatFlagged)) {
      notes.push(
        "涼しい条件の信用できる実測が足りないため、暑熱下のデータも使っています。" +
          "暑熱下の記録は実力を過小評価するので、この推定は本来の実力より遅い側に出ている可能性があります。" +
          "涼しい日のタイムトライアルを1本入れると精度が上がります。"
      );
    }
  }

  if (used.length === 0) {
    return {
      confidence: 0,
      samples: [],
      excluded,
      notes: [
        ...notes,
        "現在地を推定できる実測がありません。800m・600m・400mのいずれかのレースかタイムトライアルを1本入れてください。",
      ],
    };
  }

  const samples: BackfillSample[] = used.map((c) => ({
    ...c,
    weight: c.reliability * c.recencyWeight,
  }));
  const totalW = samples.reduce((a, b) => a + b.weight, 0);
  const estimated =
    samples.reduce((a, b) => a + b.implied800mSec * b.weight, 0) / totalW;

  // 信頼度: 重みの合計と、実測のばらつきから決める。
  // ばらつきが大きい（例: レースは速いが練習からの推定は遅い）ときは
  // 数字を1つに丸めた時点で嘘が混じるので、信頼度を落として明示する。
  const spread =
    samples.length >= 2
      ? Math.sqrt(
          samples.reduce((a, b) => a + b.weight * Math.pow(b.implied800mSec - estimated, 2), 0) /
            totalW
        )
      : 0;
  let confidence = Math.min(1, totalW / 1.5);
  if (spread > 2.5) {
    confidence *= 0.7;
    notes.push(
      `実測どうしのばらつきが±${spread.toFixed(1)}秒あります。` +
        "レースの記録と練習からの推定が食い違っている状態なので、この数値は幅を持って見てください。"
    );
  }
  confidence = Math.max(0.1, Math.min(1, confidence));

  const out: FitnessAssessment = {
    estimated800mSec: estimated,
    confidence,
    samples: samples.sort((a, b) => b.weight - a.weight),
    excluded,
    notes,
  };

  if (opts.currentCfeSec !== undefined) {
    out.deltaFromCfeSec = estimated - opts.currentCfeSec;
    if (out.deltaFromCfeSec > 1.5) {
      notes.push(
        `現在のCFE（${opts.currentCfeSec.toFixed(2)}秒）は実測より${out.deltaFromCfeSec.toFixed(
          1
        )}秒速い側にあります。このままだと全カテゴリの設定ペースが実力を上回ります。`
      );
    } else if (out.deltaFromCfeSec < -1.5) {
      notes.push(
        `実測は現在のCFEより${Math.abs(out.deltaFromCfeSec).toFixed(1)}秒速く出ています。` +
          "CFEが実力に追いついていない（設定が緩い）状態です。"
      );
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// 過去データ → セッション/結果/マーカーへの変換
// ---------------------------------------------------------------------------

const KIND_TO_CATEGORY: Record<Exclude<PastEntryKind, "interval">, SessionCategory> = {
  race: "modeling",
  timetrial: "modeling",
  continuous: "aerobic",
  off: "off",
  // 補強は StrengthSession として別に登録するので、ここには来ない
  strength: "off",
};

function describe(e: PastEntry): string {
  if (e.kind === "interval") {
    const rest =
      e.restSec !== undefined
        ? ` r${Math.round(e.restSec / 60)}分${e.restType === "full" ? "完全休息" : "jog"}`
        : "";
    return `${e.repDistanceM}m×${e.repTimesSec?.length ?? e.reps}${rest}`;
  }
  if (e.kind === "off") return "完全休養";
  if (e.kind === "continuous") {
    return `${e.distanceKm}km ${e.durationMin}分`;
  }
  return `${e.distanceM}m ${e.timeSec?.toFixed(2)}秒`;
}

/**
 * 過去データを「実施済みセッション＋結果」に変換する。
 * ACWR（直近28日のうち14日以上のデータが必要）の下地を作るのが目的。
 * backfilled: true を立て、ルールエンジンの評価対象からは外す
 * （過ぎた日の練習構成を今から直すことはできないため、
 *   プランの違反として出すとノイズにしかならない）。
 */
export function toSessionAndResult(
  e: PastEntry,
  athleteTypeFallback: SessionCategory = "aerobic"
): { session: Session; result: SessionResult } {
  const category: SessionCategory =
    e.kind === "interval"
      ? e.category ?? athleteTypeFallback
      : KIND_TO_CATEGORY[e.kind];

  const durationMin =
    e.durationMin ??
    (e.kind === "interval" && e.repTimesSec
      ? Math.round(
          (e.repTimesSec.reduce((a, b) => a + b, 0) +
            (e.restSec ?? 0) * Math.max(0, e.repTimesSec.length - 1)) /
            60
        ) + 30 // アップ・ダウンぶん
      : e.kind === "race" || e.kind === "timetrial"
      ? 60
      : undefined);

  const distanceKm =
    e.distanceKm ??
    (e.kind === "interval" && e.repDistanceM && e.repTimesSec
      ? Math.round(((e.repDistanceM * e.repTimesSec.length) / 1000 + 6) * 10) / 10
      : undefined);

  const session: Session = {
    id: `past-s-${e.id}`,
    date: e.date,
    category,
    name: `${PAST_KIND_LABELS[e.kind]}（過去入力）`,
    prescription: describe(e),
    targetPaces: [],
    transfer800m: category === "aerobic" ? 2 : 4,
    transfer1500m: category === "aerobic" ? 3 : 3,
    riskLevel: category === "aerobic" ? "low" : "high",
    phase: "Base",
    status: "completed",
    isFixed: true,
    timeOfDay: "pm",
    distanceKm,
    durationMin,
    paceSecPerKm:
      e.distanceKm && e.durationMin ? (e.durationMin * 60) / e.distanceKm : undefined,
    surface: e.kind === "continuous" ? "road" : "track",
    backfilled: true,
  };

  const result: SessionResult = {
    id: `past-r-${e.id}`,
    sessionId: session.id,
    date: e.date,
    actualLapsSec:
      e.kind === "interval" ? e.repTimesSec ?? [] : e.lapsSec ?? (e.timeSec ? [e.timeSec] : []),
    lapDistancesM:
      e.kind === "interval" && e.repDistanceM && e.repTimesSec
        ? e.repTimesSec.map(() => e.repDistanceM!)
        : e.lapDistanceM && e.lapsSec
        ? e.lapsSec.map(() => e.lapDistanceM!)
        : undefined,
    rpe: e.rpe ?? (category === "aerobic" ? 3 : 8),
    achievement: "achieved",
    subjective:
      (e.rpe ?? 0) >= 9
        ? "very_hard"
        : (e.rpe ?? 0) >= 7
        ? "hard"
        : (e.rpe ?? 0) >= 5
        ? "moderate"
        : "easy",
    weatherTempC: e.tempC,
    humidityPct: e.humidityPct,
    heatFlagged: isHeat(e),
    note: e.note,
    backfilled: true,
  };

  return { session, result };
}

/**
 * 持続走・ジョグ → FitnessMarker（LT推定の材料）。
 * 平均HRが無い、または短すぎる場合は LT 推定に使えないので undefined を返す。
 * 判定条件は healthImport の取り込みと揃えてある（3km以上）。
 */
export function toFitnessMarker(e: PastEntry): FitnessMarker | undefined {
  if (e.kind !== "continuous") return undefined;
  if (!e.distanceKm || !e.durationMin) return undefined;
  if (e.distanceKm < 3) return undefined;
  return {
    id: `past-fm-${e.id}`,
    date: e.date,
    type: "workout",
    description: `${e.distanceKm}km 持続走（過去入力）`,
    resultLapsSec: [e.durationMin * 60],
    lapDistancesM: [e.distanceKm * 1000],
    avgHr: e.avgHr,
    rpe: e.rpe,
    conditionNote: e.note,
  };
}


// ---------------------------------------------------------------------------
// H. CFEの予測レンジ
// ---------------------------------------------------------------------------

export interface CfeRange {
  centerSec: number;
  lowSec: number;
  highSec: number;
  /** レンジの幅（片側・秒） */
  marginSec: number;
}

/**
 * CFEを幅で示す。
 *
 * 「1:51.0、信頼度0.48」と出しても、人はその0.48を使って判断できない。
 * 「1:50.2〜1:51.8」なら、目標との距離やレースの狙いどころが直感的に分かる。
 *
 * 幅の決め方: 信頼度が低いほど広く、実測どうしのばらつきが大きいほど広くする。
 * 表示専用であり、プラン生成や設定ペースの計算には一切使わない
 * （計算に使うと「幅のどこを採るか」という新しい恣意性が入るため）。
 */
export const CFE_RANGE_BASE_SEC = 0.8;
export const CFE_RANGE_MAX_SEC = 4.0;

export function cfeRange(
  cfeSec: number,
  confidence: number,
  spreadSec = 0
): CfeRange {
  const conf = Math.max(0.05, Math.min(1, confidence));
  // 信頼度1.0 で ±0.8秒、信頼度0.3 で ±2.7秒 程度になる
  const fromConfidence = CFE_RANGE_BASE_SEC / conf;
  const margin = Math.min(CFE_RANGE_MAX_SEC, Math.max(fromConfidence, spreadSec));
  const m = Math.round(margin * 10) / 10;
  return {
    centerSec: cfeSec,
    lowSec: Math.round((cfeSec - m) * 10) / 10,
    highSec: Math.round((cfeSec + m) * 10) / 10,
    marginSec: m,
  };
}

/** assessCurrentFitness の結果から、推定のばらつき（秒）を取り出す */
export function spreadOf(a: FitnessAssessment): number {
  if (!a.estimated800mSec || a.samples.length < 2) return 0;
  const total = a.samples.reduce((x, y) => x + y.weight, 0);
  if (total <= 0) return 0;
  const v =
    a.samples.reduce(
      (x, y) => x + y.weight * Math.pow(y.implied800mSec - a.estimated800mSec!, 2),
      0
    ) / total;
  return Math.sqrt(v);
}
