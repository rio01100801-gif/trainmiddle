/**
 * 途中でやめた理由。
 *
 * M-3 の中止基準は「設定から外れたら止める」だけを見ている。
 * だが実際に途中でやめる理由はそれだけではない——雨が強くなった、時間切れ、
 * 脚に違和感が出た。**どれも同じ「打ち切り」として記録されていた。**
 *
 * これが効くのは設定ペースの自動補正（adaptive.ts）。
 * 打ち切りが2回続くと「設定が高すぎる」と判断して設定を緩める仕組みなので、
 * 電車の時間で止めた回数が混ざると、**実力は落ちていないのに設定だけが下がり続ける。**
 * 下がった設定で走れば当然こなせるので、下がったことに気づけない。
 *
 * だから理由を本人に選ばせて、**体の話と外の話を分ける**。
 * 推測はしない（なぜ止めたかは本人にしか分からない）。
 */

export type AbortCause =
  /** 設定が高すぎた。前半から離れて、続けても狙った刺激が入らない */
  | "pace"
  /** 疲労が残っていた。設定は妥当だが今日の体が動かない */
  | "fatigue"
  /** 痛み・違和感。安全のため止めた */
  | "pain"
  /** 天候・路面。雨・風・場所の状態 */
  | "condition"
  /** 時間・予定。時間切れ */
  | "schedule"
  /** その他（自由記述で残す） */
  | "other";

export interface AbortCauseInfo {
  id: AbortCause;
  label: string;
  /** 選ぶときの手がかり。どれを選ぶかで扱いが変わるので、選ぶ前に見せる */
  hint: string;
}

/**
 * 並びは「設定の話 → 体の話 → 外の話」。
 * 走った直後に選ぶので、当てはまりやすいものを上に置く。
 */
export const ABORT_CAUSES: AbortCauseInfo[] = [
  { id: "pace", label: "設定が高すぎた", hint: "前半から離れて、続けても狙った刺激が入らない" },
  { id: "fatigue", label: "疲労が残っていた", hint: "設定は妥当だが、今日は体が動かない" },
  { id: "pain", label: "痛み・違和感", hint: "安全のため止めた。痛みの記録に残す" },
  { id: "condition", label: "天候・路面", hint: "雨・風・場所の状態で続けられない" },
  { id: "schedule", label: "時間・予定", hint: "時間切れ。走りとは関係ない" },
  { id: "other", label: "その他", hint: "当てはまるものが無いとき。何があったか書く" },
];

const BY_ID = new Map(ABORT_CAUSES.map((c) => [c.id, c]));

/**
 * 設定ペースを緩める材料に数えるか。
 *
 * 数えるのは **設定・疲労の2つだけ**。
 * M-2 が動かすのは「今日出せる値」なので、体が動かなかったのは材料になる。
 * 雨・時間・痛みは「今日出せる値」の証拠ではないので材料にしない。
 *
 * **未入力（undefined）は数える。** ここは推測ではない——
 * 理由を選べるようにする前の打ち切りは、M-3の中止基準（設定から外れた）で
 * 自動判定されたものだけで、つまり当時の判定そのものが `pace` に当たる。
 * 未入力を「数えない」に倒すと、これまでの打ち切りが一斉に無効になり、
 * 今動いている補正が**静かに止まる**。
 */
export function countsTowardPaceEase(cause?: AbortCause): boolean {
  if (cause === undefined) return true;
  return cause === "pace" || cause === "fatigue";
}

/**
 * 体への負担の証拠として数えるか。
 *
 * メニュー形式の選択（progression）と疲労の裏付け（rules）で使う。
 * 痛みはここでは数える——設定の話ではないが、体の話ではある。
 * 天候・時間は体の話ではないので数えない。
 */
export function isStrainCause(cause?: AbortCause): boolean {
  if (cause === undefined) return true;
  return cause === "pace" || cause === "fatigue" || cause === "pain";
}

/** 痛みで止めたときは、故障ログに残さないと次の判定に届かない */
export function needsInjuryLog(cause?: AbortCause): boolean {
  return cause === "pain";
}

/** 一覧に無い値は捨てる。手書きJSONや旧データで壊れないようにする */
export function normalizeAbortCause(value: unknown): AbortCause | undefined {
  if (typeof value !== "string") return undefined;
  return BY_ID.has(value as AbortCause) ? (value as AbortCause) : undefined;
}

export function abortCauseLabel(cause?: AbortCause): string {
  return cause ? (BY_ID.get(cause)?.label ?? cause) : "";
}

/**
 * 画面と文章に出す一文。
 *
 * 「数えたか／数えなかったか」まで書く。
 * 黙って扱いを変えると、設定が動いた理由も動かなかった理由も追えなくなる。
 */
export function describeAbortCause(cause?: AbortCause, note?: string): string {
  if (cause === undefined) return "";
  const label = abortCauseLabel(cause);
  const detail = cause === "other" && note?.trim() ? `（${note.trim()}）` : "";
  const effect = countsTowardPaceEase(cause)
    ? "設定を見直す材料に数えます"
    : "設定の判断には数えません";
  return `${label}${detail}のため打ち切り。${effect}`;
}
