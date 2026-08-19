/**
 * ポイント練習前の「走種目のアップ」。
 *
 * これは**主練習の子データ**であって、独立した練習ではない。
 * 目的は当日の準備状態・実際の総負荷・主練習との相性を見ることで、
 * アップそのものを評価することではない。
 *
 * だから流す先を分けてある:
 *
 * | 流す | 流さない |
 * | --- | --- |
 * | 距離・時間・負荷・シューズの走行距離 | 週間の刺激回数 |
 * | | カテゴリ配分 |
 * | | CFEの更新 |
 * | | 進行段階の判定 |
 *
 * 右側に流すと、**アップを足しただけで「ポイント練習が増えた」ことになる**。
 * 週2回のポイントが3回に見え、生成器が休養を挟もうとする。
 * アップは主練習の一部なので、回数として数えてはいけない。
 *
 * 主練習のカテゴリも変えない。アップに刺激が入っていても、
 * その日のカテゴリは主練習のままにする。
 */
/**
 * 区間の種別。
 *
 * 「アップ」とひとくくりにしない理由は、
 * ジョグだけの日と流しまで入れた日で、主練習1本目の入りが変わるため。
 * あとから見分けられないと、相性を比べる材料にならない。
 */
export type WarmupSegmentKind =
  | "easy_jog"
  | "progressive"
  | "strides"
  | "acceleration"
  | "short_stimulus";

export const WARMUP_SEGMENT_KINDS: WarmupSegmentKind[] = [
  "easy_jog",
  "progressive",
  "strides",
  "acceleration",
  "short_stimulus",
];

export const WARMUP_SEGMENT_LABELS: Record<WarmupSegmentKind, string> = {
  easy_jog: "イージージョグ",
  progressive: "ビルドアップ",
  strides: "流し",
  acceleration: "加速走",
  short_stimulus: "短い刺激",
};

/** アップ後の脚 */
export type WarmupLegs = "heavy" | "normal" | "bouncy";

export const WARMUP_LEGS_LABELS: Record<WarmupLegs, string> = {
  heavy: "重い",
  normal: "普通",
  bouncy: "弾む",
};

/** アップ後の呼吸 */
export type WarmupBreathing = "heavy" | "normal" | "easy";

export const WARMUP_BREATHING_LABELS: Record<WarmupBreathing, string> = {
  heavy: "重い",
  normal: "普通",
  easy: "余裕",
};

/** どこから入った記録か。手入力とFITを混ぜて信用しない */
export type WarmupSource = "manual" | "fit";

export const WARMUP_SOURCE_LABELS: Record<WarmupSource, string> = {
  manual: "手入力",
  fit: "FIT",
};

export interface WarmupSegment {
  kind: WarmupSegmentKind;
  /** 1本あたりの距離（m） */
  distanceM?: number;
  /** 本数。流しなど繰り返すもの。ジョグは1 */
  reps?: number;
  /** 1本ずつのタイム（秒）。測っていない本は null のまま残し、推測で埋めない */
  timesSec?: (number | null)[];
  /** レスト（秒） */
  restSec?: number;
  /** レストをジョグの距離で取った場合（m） */
  restDistanceM?: number;
  /**
   * その区間のペース（秒/km）。
   *
   * 距離と本数だけだと**合計時間を手で計算して入れる**ことになる。
   * ペースが分かれば時間は出せるので、入れたぶんだけ計算に使う。
   *
   * 入っていない区間は時間に寄与しない。**推測で埋めない**——
   * 「だいたい5分/km」で埋めると、実際より速い/遅い時間が合計に混ざる。
   */
  paceSecPerKm?: number;
  note?: string;
}

export interface WarmupRecord {
  /** 合計距離（km）。区間から積み上げず、本人が測った値を優先する */
  totalDistanceKm?: number;
  /** 合計時間（分） */
  totalDurationMin?: number;
  avgHr?: number;
  maxHr?: number;
  segments: WarmupSegment[];
  /** アップ終了から主練習開始までの時間（分） */
  gapToMainMin?: number;
  legs?: WarmupLegs;
  breathing?: WarmupBreathing;
  /** アップで履いた靴。主練習と違うことがある（スパイクに履き替える） */
  shoeId?: string;
  source: WarmupSource;
  /**
   * FITを1ファイル丸ごと取り込むと、主練習の距離と時間に**アップが既に入っている**。
   * そのときここを true にして、合計へ二重に足さないようにする。
   *
   * 「アップを記録していない」と「主練習側に含まれている」は違う。
   * 前者は足りない記録、後者は既にある記録なので、区別せずに足すと距離が倍になる。
   */
  includedInMainTotals?: boolean;
  note?: string;
}

/**
 * 区間ごとの負荷換算に使うRPE。
 *
 * アップにRPEを入力させない代わりに、種別ごとの目安を置く。
 * 入力を増やすと、答えないと記録できない仕組みになるため。
 *
 * 値は「その努力度なら普通このくらい」という一般的な目安で、
 * 主練習のRPEとは別物として扱う。**主練習のRPEをアップに使い回さない**——
 * 使い回すと、きつい主練習の日だけアップの負荷が跳ね上がる。
 */
const SEGMENT_RPE: Record<WarmupSegmentKind, number> = {
  easy_jog: 3,
  progressive: 4,
  strides: 5,
  acceleration: 5,
  short_stimulus: 5,
};

/** 区間1つぶんの距離（km）。分からなければ0（推測で埋めない） */
export function segmentDistanceKm(seg: WarmupSegment): number {
  if (seg.distanceM === undefined) return 0;
  const reps = seg.reps ?? 1;
  return (seg.distanceM * reps) / 1000;
}

/**
 * 区間1つぶんの時間（秒）。
 *
 * 1本ごとの実測タイムがあればその合計を使う。無ければ、距離とペースが
 * 両方あるときだけ出す。どちらの経路でも時間が分からなければ 0
 * （**分からないものを0分として合計に混ぜない**）。
 * レストは含めない——アップのレストは歩きや立ち止まりで、
 * 走った時間として数えるものではない。
 */
export function segmentDurationSec(seg: WarmupSegment): number {
  const measuredTimes = (seg.timesSec ?? []).filter(
    (seconds): seconds is number => typeof seconds === "number" && seconds > 0
  );
  // 流し等は1本ごとの実測を優先する。距離から1kmペースへ読み替えない。
  if (measuredTimes.length > 0) return measuredTimes.reduce((sum, seconds) => sum + seconds, 0);
  const km = segmentDistanceKm(seg);
  if (km <= 0 || seg.paceSecPerKm === undefined || seg.paceSecPerKm <= 0) return 0;
  return km * seg.paceSecPerKm;
}

export interface WarmupTotals {
  distanceKm: number;
  durationMin: number;
  /** 時間を出せなかった区間の数。**出せなかったことを黙って隠さない** */
  missingPace: number;
}

/**
 * 区間から合計を出す。
 *
 * 画面はこれを合計欄に入れる。**手で直した合計は上書きしない**のは画面側の責任で、
 * ここは「区間から計算するとこうなる」だけを返す。
 *
 * タイムまたはペースが足りない区間は missingPace に数える。
 * 合計時間が短く出ているのに理由が分からない状態を作らないため。
 */
export function warmupTotalsFromSegments(segments: WarmupSegment[]): WarmupTotals {
  let km = 0;
  let sec = 0;
  let missingPace = 0;
  for (const seg of segments) {
    const segKm = segmentDistanceKm(seg);
    km += segKm;
    const segSec = segmentDurationSec(seg);
    if (segSec > 0) sec += segSec;
    const measuredTimeCount = (seg.timesSec ?? []).filter(
      (seconds): seconds is number => typeof seconds === "number" && seconds > 0
    ).length;
    const expectedTimeCount = Math.max(1, Math.trunc(seg.reps ?? 1));
    if (measuredTimeCount > 0 && measuredTimeCount < expectedTimeCount) missingPace += 1;
    else if (segSec <= 0 && segKm > 0) missingPace += 1;
  }
  return {
    // 桁を増やさない（0.1km・0.1分まで）
    distanceKm: Math.round(km * 10) / 10,
    durationMin: Math.round((sec / 60) * 10) / 10,
    missingPace,
  };
}

/**
 * アップの距離（km）。
 *
 * 合計が入っていればそれを使う。**区間から積み上げた値で上書きしない。**
 * 区間はアップの一部しか書かないことがある（ジョグの距離を測っていない等）ので、
 * 積み上げた値のほうが小さくなる。本人が測った合計のほうが正しい。
 */
export function warmupDistanceKm(w: WarmupRecord | undefined): number {
  if (!w) return 0;
  if (w.totalDistanceKm !== undefined) return w.totalDistanceKm;
  return w.segments.reduce((sum, s) => sum + segmentDistanceKm(s), 0);
}

/** アップの時間（分）。分からなければ0 */
export function warmupDurationMin(w: WarmupRecord | undefined): number {
  if (!w) return 0;
  return w.totalDurationMin ?? 0;
}

/**
 * 合計に足してよい距離。
 *
 * 主練習側に既に入っているなら0。ここを通さずに `warmupDistanceKm` を足すと、
 * FITを丸ごと取り込んだ日の距離が倍になる。
 */
export function warmupAddedDistanceKm(w: WarmupRecord | undefined): number {
  if (!w || w.includedInMainTotals) return 0;
  return warmupDistanceKm(w);
}

/** 合計に足してよい時間（分） */
export function warmupAddedDurationMin(w: WarmupRecord | undefined): number {
  if (!w || w.includedInMainTotals) return 0;
  return warmupDurationMin(w);
}

/**
 * アップの負荷。時間が分からなければ0。
 *
 * 区間ごとの時間は普通測らないので、**合計時間を区間の重さで按分する**。
 * 区間が無ければイージージョグ相当として扱う。
 */
export function warmupLoad(w: WarmupRecord | undefined): number {
  const min = warmupAddedDurationMin(w);
  if (min <= 0 || !w) return 0;
  if (w.segments.length === 0) return SEGMENT_RPE.easy_jog * min;

  /*
   * 距離の比で按分する。距離が分からない区間は同じ重さで分ける。
   * 厳密さより「流しを入れた日のほうが少し重い」が出ることを優先している。
   */
  const weights = w.segments.map((s) => {
    const km = segmentDistanceKm(s);
    return km > 0 ? km : 0;
  });
  const total = weights.reduce((a, b) => a + b, 0);
  const share = total > 0 ? weights.map((x) => x / total) : w.segments.map(() => 1 / w.segments.length);

  let rpe = 0;
  w.segments.forEach((s, i) => {
    rpe += SEGMENT_RPE[s.kind] * share[i];
  });
  return rpe * min;
}

/** 区間1つの短い説明。「流し 100m×4」 */
export function describeSegment(seg: WarmupSegment): string {
  const label = WARMUP_SEGMENT_LABELS[seg.kind];
  if (seg.distanceM === undefined) return label;
  const reps = seg.reps ?? 1;
  const dist = seg.distanceM >= 1000 ? `${seg.distanceM / 1000}km` : `${seg.distanceM}m`;
  return reps > 1 ? `${label} ${dist}×${reps}` : `${label} ${dist}`;
}

/**
 * 折りたたんだ状態で出す1行。
 *
 * 最初に見せるのは合計と区間の概要だけにする。
 * 全部を常に開いておくと、記録画面が縦に伸びて主練習の入力が遠くなる。
 */
export function summarizeWarmup(w: WarmupRecord | undefined): string | undefined {
  if (!w) return undefined;
  const parts: string[] = [];
  const km = warmupDistanceKm(w);
  if (km > 0) parts.push(`${Math.round(km * 10) / 10}km`);
  const min = warmupDurationMin(w);
  if (min > 0) parts.push(`${Math.round(min)}分`);
  if (w.segments.length > 0) parts.push(w.segments.map(describeSegment).join("・"));
  if (parts.length === 0) return undefined;
  return parts.join(" / ");
}

/**
 * 保存前の確認。**足りないものを埋めるのではなく、おかしいものを止める。**
 *
 * 空欄は許す（アップは任意で、測っていない項目があって当たり前）。
 * 止めるのは、入っている値が明らかに練習の記録として成立しないときだけ。
 */
export function checkWarmup(w: WarmupRecord | undefined): string | undefined {
  if (!w) return undefined;
  if (w.totalDistanceKm !== undefined && (w.totalDistanceKm < 0 || w.totalDistanceKm > 30)) {
    return "アップの距離が練習の記録として成立しません。単位（km）を確かめてください。";
  }
  if (w.totalDurationMin !== undefined && (w.totalDurationMin < 0 || w.totalDurationMin > 180)) {
    return "アップの時間が練習の記録として成立しません。単位（分）を確かめてください。";
  }
  if (w.avgHr !== undefined && w.maxHr !== undefined && w.avgHr > w.maxHr) {
    return "平均心拍が最大心拍を超えています。";
  }
  if (w.gapToMainMin !== undefined && (w.gapToMainMin < 0 || w.gapToMainMin > 180)) {
    return "アップから主練習までの時間が練習の記録として成立しません。";
  }
  for (const s of w.segments) {
    if (s.distanceM !== undefined && (s.distanceM <= 0 || s.distanceM > 20000)) {
      return `${WARMUP_SEGMENT_LABELS[s.kind]}の距離が練習の記録として成立しません。`;
    }
    if (s.reps !== undefined && (s.reps <= 0 || s.reps > 50)) {
      return `${WARMUP_SEGMENT_LABELS[s.kind]}の本数が練習の記録として成立しません。`;
    }
  }
  return undefined;
}

function num(x: unknown): number | undefined {
  return typeof x === "number" && Number.isFinite(x) ? x : undefined;
}

/**
 * 外から来た値を型に落とす。
 *
 * **読めなかったものは捨てる。推測で埋めない。**
 * 知らない区間種別を「たぶんジョグ」として残すと、
 * あとで相性を見るときに、実際には流しだった日がジョグとして数えられる。
 */
export function normalizeWarmup(x: unknown): WarmupRecord | undefined {
  if (!x || typeof x !== "object") return undefined;
  const o = x as Record<string, unknown>;

  const segments: WarmupSegment[] = [];
  if (Array.isArray(o.segments)) {
    for (const raw of o.segments) {
      if (!raw || typeof raw !== "object") continue;
      const s = raw as Record<string, unknown>;
      const kind = s.kind as WarmupSegmentKind;
      if (!WARMUP_SEGMENT_KINDS.includes(kind)) continue;
      const times = Array.isArray(s.timesSec)
        ? s.timesSec.map((t) =>
            typeof t === "number" && Number.isFinite(t) && t > 0 ? t : null
          )
        : undefined;
      // 末尾の空欄は保存しない。途中のnullは「その本だけ未計測」なので位置を保つ。
      while (times?.at(-1) === null) times.pop();
      segments.push({
        kind,
        distanceM: num(s.distanceM),
        reps: num(s.reps),
        timesSec: times && times.length > 0 ? times : undefined,
        restSec: num(s.restSec),
        restDistanceM: num(s.restDistanceM),
        paceSecPerKm: num(s.paceSecPerKm),
        note: typeof s.note === "string" && s.note.trim() ? s.note.trim() : undefined,
      });
    }
  }

  const legs = o.legs as WarmupLegs;
  const breathing = o.breathing as WarmupBreathing;
  const source: WarmupSource = o.source === "fit" ? "fit" : "manual";

  const w: WarmupRecord = {
    totalDistanceKm: num(o.totalDistanceKm),
    totalDurationMin: num(o.totalDurationMin),
    avgHr: num(o.avgHr),
    maxHr: num(o.maxHr),
    segments,
    gapToMainMin: num(o.gapToMainMin),
    legs: legs in WARMUP_LEGS_LABELS ? legs : undefined,
    breathing: breathing in WARMUP_BREATHING_LABELS ? breathing : undefined,
    shoeId: typeof o.shoeId === "string" && o.shoeId ? o.shoeId : undefined,
    source,
    includedInMainTotals: o.includedInMainTotals === true ? true : undefined,
    note: typeof o.note === "string" && o.note.trim() ? o.note.trim() : undefined,
  };

  /*
   * 中身が何も無いなら記録として残さない。
   * 空のアップが付いていると、分析で「アップをした日」として数えられてしまう。
   */
  if (
    w.totalDistanceKm === undefined &&
    w.totalDurationMin === undefined &&
    w.avgHr === undefined &&
    w.maxHr === undefined &&
    w.gapToMainMin === undefined &&
    w.legs === undefined &&
    w.breathing === undefined &&
    w.shoeId === undefined &&
    w.note === undefined &&
    segments.length === 0
  ) {
    return undefined;
  }
  return w;
}

/**
 * よく使う型。**毎回ゼロから入力させないため**にある。
 *
 * 中身は固定で、実績から自動で作らない。
 * 「最近こうしているから」で型が勝手に変わると、
 * 型を選んだのか自分で決めたのかが記録から分からなくなる。
 */
export interface WarmupTemplate {
  key: string;
  label: string;
  build: () => WarmupRecord;
}

export const WARMUP_TEMPLATES: WarmupTemplate[] = [
  {
    key: "jog_only",
    label: "ジョグのみ",
    build: () => ({
      totalDistanceKm: 3,
      totalDurationMin: 20,
      segments: [{ kind: "easy_jog", distanceM: 3000 }],
      source: "manual",
    }),
  },
  {
    key: "with_strides",
    label: "ジョグ＋流し",
    build: () => ({
      totalDistanceKm: 3.4,
      totalDurationMin: 25,
      segments: [
        { kind: "easy_jog", distanceM: 3000 },
        { kind: "strides", distanceM: 100, reps: 4 },
      ],
      source: "manual",
    }),
  },
  {
    key: "with_stimulus",
    label: "ジョグ＋流し＋加速走",
    build: () => ({
      totalDistanceKm: 3.7,
      totalDurationMin: 30,
      segments: [
        { kind: "easy_jog", distanceM: 3000 },
        { kind: "strides", distanceM: 100, reps: 4 },
        { kind: "acceleration", distanceM: 150, reps: 2 },
      ],
      source: "manual",
    }),
  },
];

/** FITの1周ぶん。`fitParse` の形に依存しないよう、必要な分だけ受ける */
export interface WarmupFitLap {
  index: number;
  distanceKm?: number;
  timerSec?: number;
  elapsedSec?: number;
  avgHr?: number;
  maxHr?: number;
}

/**
 * FITのうち「アップ」と判定された周からアップを組み立てる。
 *
 * `mainIsContinuous` が要るのは**二重計上を防ぐため**。
 *
 *   ・主練習をインターバルとして取り込んだとき
 *       → 主練習の距離は「メイン」の周だけなので、アップは入っていない → 足す
 *   ・主練習を持続走として取り込んだとき（ファイル丸ごと1本）
 *       → 主練習の距離はファイル全体なので、**アップは既に入っている** → 足さない
 *
 * ここを取り違えると、ジョグの日の距離が倍になる。
 * 呼び出し側に判断させず、引数として明示的に受け取る。
 */
export function warmupFromFitLaps(
  laps: WarmupFitLap[],
  kinds: string[],
  opts: { mainIsContinuous: boolean }
): WarmupRecord | undefined {
  const picked = laps.filter((l) => kinds[l.index] === "warmup");
  if (picked.length === 0) return undefined;

  const km = picked.reduce((sum, l) => sum + (l.distanceKm ?? 0), 0);
  const sec = picked.reduce((sum, l) => sum + (l.timerSec ?? l.elapsedSec ?? 0), 0);

  // 心拍は測れている周だけで平均する。測れていない周を0として混ぜない
  const hrs = picked.map((l) => l.avgHr).filter((x): x is number => x !== undefined);
  const maxes = picked.map((l) => l.maxHr).filter((x): x is number => x !== undefined);

  return {
    totalDistanceKm: km > 0 ? Math.round(km * 100) / 100 : undefined,
    totalDurationMin: sec > 0 ? Math.round((sec / 60) * 10) / 10 : undefined,
    avgHr: hrs.length > 0 ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : undefined,
    maxHr: maxes.length > 0 ? Math.max(...maxes) : undefined,
    /*
     * 区間の中身までは決めない。
     * FITの周は「アップかどうか」しか分かっておらず、
     * そのうちどれが流しだったかは推測になる。空欄にして本人に足してもらう。
     */
    segments: [],
    source: "fit",
    includedInMainTotals: opts.mainIsContinuous ? true : undefined,
  };
}
