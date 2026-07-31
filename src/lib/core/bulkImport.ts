/**
 * 過去データの一括入力（改修指示書v3 F-2 / 実データ対応版）
 *
 * 実際の練習日誌はこう書かれている。
 *
 *   7/4  2kmジョグ 8:40
 *   7/5  オフ
 *   7/6  300(42)＋600(1:26)＋600(1:26) r15min
 *        42 1:26 1:25                       ← 結果が次の行にある
 *   7/10 300(41-42)×2×2 r100walk R12min
 *        41.6 41.8 40.0 41.8
 *   7/13 レース　800m 1:56.0(56.0-60.0)     ← 括弧の中は前後半
 *   7/18 1000(3:15-25)×4 r200jog 3:27 3:26 3:27 3:27 平均心拍180 最大195
 *
 * つまり「日付 / 練習内容 / 練習結果」がタブで綺麗に3列になっていることは稀で、
 * 半角スペース1個で区切られ、結果が次の行に来て、設定と実測が混ざる。
 *
 * 設計の絶対条件は変えない。
 *
 * 1. 完全ルールベース。同じテキストを貼れば必ず同じ解釈になる。
 * 2. 読めなかったものを推測で埋めない。空欄にして理由を出す。
 * 3. 確定前に必ず全行を見せる。貼った瞬間に保存しない。
 *
 * ただし「読める範囲」は実データに合わせて大きく広げる。
 * 読めないまま放置して人間に全部直させるのは、入力の負担を減らすという
 * 目的そのものを損なう。
 */
import type { RestType, SessionCategory } from "./types";
import { completeRunTriple, parseDurationToSec } from "./inputFormat";
import type { PastEntryKind } from "./backfill";
import { diffDays } from "./dates";

// ---------------------------------------------------------------------------
// 型
// ---------------------------------------------------------------------------

export interface ParsedRow {
  lineNo: number;
  raw: string;
  date?: string;
  kind?: PastEntryKind;

  category?: SessionCategory;
  repDistanceM?: number;
  reps?: number;
  repTimesSec?: number[];
  restNote?: string;
  /**
   * レストの構造化。`restNote` は表示用の原文で、こちらは比較・集計用。
   * 書かれていないものは埋めない（`r5` のように単位が無いときは両方 undefined）。
   */
  restSec?: number;
  restDistanceM?: number;
  restType?: RestType;
  /** 設定タイム（括弧内）。カテゴリ推定と表示に使う */
  targetSec?: number;

  distanceKm?: number;
  durationSec?: number;
  paceSecPerKm?: number;

  raceDistanceM?: number;
  raceTimeSec?: number;
  /** レースの区間ラップ。配分シミュレータの材料になる */
  lapsSec?: number[];

  /** 補強のとき */
  strengthType?: StrengthKind;
  contactCount?: number;

  avgHr?: number;
  maxHr?: number;
  note?: string;

  categoryUncertain?: boolean;
  supplementNote?: string;
  /**
   * 括弧付きで書かれた区間（300(42)＋600(1:26) など）。
   * 複合セッションで区間ごとの入力欄を作るために使う（N-2）。
   */
  segments?: Segment[];
  issues: string[];
  ready: boolean;
}

export interface BulkParseOptions {
  /**
   * 現在のGRP（秒/m）= CFE ÷ 800。
   * 設定タイムからカテゴリを判定するのに使う。
   * 無い場合はカテゴリを断定せず人間に選ばせる。
   */
  grpSecPerM?: number;
  /**
   * 表記辞書。読めなかった書き方を本人が登録したもの。
   * 組み込みルールより先に評価する（本人の語彙のほうが正しいため）。
   */
  phrases?: PhraseRule[];
}

/** 表記辞書の1件 */
export interface PhraseRule {
  id: string;
  /** 本文に含まれていたら適用する語（部分一致・大文字小文字は区別しない） */
  phrase: string;
  kind: PastEntryKind;
  category?: SessionCategory;
  /** 補強のときの種別 */
  strengthType?: StrengthKind;
  createdAt?: string;
}

/** 補強の種別。既存の StrengthSession.type に合わせる */
export type StrengthKind = "strength" | "plyometrics" | "medicine_ball" | "core";

// ---------------------------------------------------------------------------
// 行の切り出し
// ---------------------------------------------------------------------------

/** 先頭トークンが日付として読める形か */
export function looksLikeDate(token: string): boolean {
  return /^(\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/月]\d{1,2})/.test(token.trim());
}

/**
 * 1行を「日付」と「それ以外」に割る。
 *
 * 旧実装はタブか全角空白か2連スペースを列区切りにしていたが、
 * 実際の日誌は半角スペース1個で書かれていて1列も切り出せなかった。
 * 先頭トークンだけを日付として切り、残りは丸ごと本文として扱う。
 */
export function splitDateAndBody(line: string): { dateToken: string; body: string } {
  const t = line.trim().replace(/^[\t 　]+/, "");
  const m = /^(\S+?)[\t 　]+([\s\S]*)$/.exec(t);
  if (!m) return { dateToken: t, body: "" };
  return { dateToken: m[1], body: m[2].trim() };
}

/**
 * 本文を「練習内容」と「練習結果」に割る（割れる場合だけ）。
 *
 * タブ・全角空白・2連スペースがあれば、そこから後ろを結果とみなす。
 * これが必要なのは、内容欄には**予定**が書かれるため。
 *
 *   ジョグ40〜50分（4:50〜5:10/km）  ←予定
 *   51分　平均4:40                  ←実績
 *
 * 区別せずに全部から数値を拾うと、予定の「50分」が実績の「51分」を
 * 押しのけてしまう。結果欄がある場合はそちらを優先する。
 * 区切りが無い行（半角スペース1個だけの日誌）は結果欄なしとして扱い、
 * 本文全体から拾う。
 */
export function splitContentAndResult(body: string): { content: string; result: string } {
  const m = /^([\s\S]*?)(?:\t+|　+|\s{2,})([\s\S]*)$/.exec(body);
  if (!m) return { content: body, result: "" };
  return { content: m[1].trim(), result: m[2].trim() };
}

// ---------------------------------------------------------------------------
// 日付
// ---------------------------------------------------------------------------

export const BULK_WINDOW_WEEKS = 12;

export function parseLogDate(raw: string, today: string): string | undefined {
  const t = raw.trim();
  const iso = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(t);
  if (iso) {
    return `${iso[1]}-${String(Number(iso[2])).padStart(2, "0")}-${String(
      Number(iso[3])
    ).padStart(2, "0")}`;
  }
  const md = /^(\d{1,2})[-/月](\d{1,2})/.exec(t);
  if (!md) return undefined;
  const mm = Number(md[1]);
  const dd = Number(md[2]);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return undefined;

  const thisYear = Number(today.slice(0, 4));
  for (const y of [thisYear, thisYear - 1]) {
    const s = `${y}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
    const age = diffDays(s, today);
    if (age >= 0 && age <= BULK_WINDOW_WEEKS * 7) return s;
  }
  const s = `${thisYear}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  return diffDays(s, today) >= 0
    ? s
    : `${thisYear - 1}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// タイム表記
// ---------------------------------------------------------------------------

/** "1:26" "1:26.5" "42" "41.6" を秒に */
export function timeTokenToSec(tok: string): number | undefined {
  const t = tok.trim();
  const ms = /^(\d{1,2}):(\d{2}(?:\.\d+)?)$/.exec(t);
  if (ms) return Number(ms[1]) * 60 + Number(ms[2]);
  const n = /^\d{1,3}(?:\.\d+)?$/.exec(t);
  return n ? Number(t) : undefined;
}

/** ラベル付きの数値を先に消す。消さないと心拍や距離をタイムと誤認する */
export function stripLabeledNumbers(text: string): string {
  return (
    text
      /*
       * レストの記述を最初に落とす。順番が重要。
       *
       * また r と数字の間に空白を許してはならない。許すと
       * "R12min 41.6" の "min" を先に消したあとの "R  41" までを
       * レスト扱いで飲み込み、実施タイムの1本目が消える。
       * 実際の日誌は r15min / r200jog / r100walk / R12min と密着表記なので
       * 空白なしに限定して問題ない。
       */
      .replace(/[rR]\d+\s*(?:min|分|秒|m|jog|walk|ジョグ|ウォーク)?/g, " ")
      // 平均心拍186 / 心拍 186 / HR186 / 最大195 / 最高195
      .replace(/(?:平均心拍|心拍|平均HR|HR|最大心拍|最大|最高)\s*[:：]?\s*\d{2,3}/gi, " ")
      // 平均3:50 / 平均4:40
      .replace(/平均\s*\d{1,2}:\d{2}/g, " ")
      // 11.8km / 5km / 8000m
      .replace(/\d+(?:\.\d+)?\s*(?:km|ｋｍ|キロ)/gi, " ")
      .replace(/\d{3,5}\s*[mMｍ](?![a-zA-Z])/g, " ")
      // 65min / 22min / 51分 / 1時間5分 / 15秒
      .replace(/\d+(?:\.\d+)?\s*(?:min|分|時間|秒)/gi, " ")
      .replace(/\d{1,2}\s*本/g, " ")
  );
}

/**
 * 処方の記述を取り除く。
 *
 * "300(42)＋600(1:26)" の 300 や 600 は距離であって実施タイムではない。
 * "(3:15-25)" は設定であって実施タイムではない。
 * これを消さずに数値を拾うと、距離と設定が実施タイムの列に紛れ込み、
 * 800m換算がまるごと壊れる。
 */
export function stripPrescription(content: string): string {
  return (
    content
      // 300(41-42)×2×2 / 1000(3:15-25)×4 / 300m×6
      .replace(
        /\d{2,4}\s*[mMｍ]?\s*(?:[（(][^）)]*[）)])?\s*[×xX＊*]\s*\d{1,2}(?:\s*[×xX＊*]\s*\d{1,2})?/g,
        " "
      )
      // 300(42) / 600(1:26)
      .replace(/\d{2,4}\s*[mMｍ]?\s*[（(][^）)]*[）)]/g, " ")
      .replace(/[＋+]/g, " ")
  );
}

/**
 * 実施タイムの並びを取り出す。
 *
 * "42 1:26 1:25" のように秒と分:秒が混ざる。
 * 処方とラベル付き数値を先に落としてから拾うので、
 * 距離・設定・心拍を巻き込まない。
 */
export function extractTimes(text: string): number[] {
  const cleaned = stripLabeledNumbers(stripPrescription(text));
  const toks = cleaned.match(/\d{1,2}:\d{2}(?:\.\d+)?|\d{2,3}\.\d+|\b\d{2,3}\b/g) ?? [];
  const secs = toks
    .map(timeTokenToSec)
    .filter((v): v is number => v !== undefined && v > 5 && v < 1200);
  return secs;
}

// ---------------------------------------------------------------------------
// 練習の構造
// ---------------------------------------------------------------------------

/** 括弧付きの区間: 300(42) / 600(1:26) / 1000(3:15-25) */
export interface Segment {
  distanceM: number;
  targetSec?: number;
}

/** 複合セッションの代表距離。最も本数が多いもの、同数なら長い方 */
export function representativeDistance(segments: Segment[]): number | undefined {
  if (segments.length === 0) return undefined;
  const counts = new Map<number, number>();
  for (const s of segments) counts.set(s.distanceM, (counts.get(s.distanceM) ?? 0) + 1);
  let best = segments[0].distanceM;
  for (const [d, n] of counts) {
    const bn = counts.get(best) ?? 0;
    if (n > bn || (n === bn && d > best)) best = d;
  }
  return best;
}

export function parseSegments(content: string): Segment[] {
  const out: Segment[] = [];
  const re = /(\d{3,4})\s*[mMｍ]?\s*[（(]\s*([\d:.\-〜~]+?)\s*[）)]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    const dist = Number(m[1]);
    // "3:15-25" や "41-42" のような幅表記は先頭を採る
    const first = m[2].split(/[-〜~]/)[0];
    out.push({ distanceM: dist, targetSec: timeTokenToSec(first) });
  }
  return out;
}

/**
 * レストの表記を構造化する。「5min」「90秒」「100walk」「200jog」など。
 *
 * 単位が書かれていないときは時間とも距離とも決まらないので、両方 undefined にする。
 * 「r5」を5分と読むか5秒と読むかは決められない（読めなかったものを推測で埋めない）。
 * レストの種類（ジョグ／ウォーク）も書かれていなければ埋めない。
 * 種類は同一処方の比較には使わず、表示にしか使わないので、不明なら出さないほうが正しい。
 */
export function parseRest(token: string): {
  restSec?: number;
  restDistanceM?: number;
  restType?: RestType;
} {
  const t = token.trim();
  const n = Number(/(\d+)/.exec(t)?.[1]);
  if (!isFinite(n)) return {};
  const restType: RestType | undefined = /walk|ウォーク/i.test(t)
    ? "walk"
    : /jog|ジョグ/i.test(t)
    ? "jog"
    : undefined;

  if (/min|分/i.test(t)) return { restSec: n * 60, restType };
  if (/秒/.test(t)) return { restSec: n, restType };
  // 「100walk」「200jog」のように単位が省かれるのは距離指定のとき。
  // 時間を距離の単位なしで書く例（r5 = 5分）とは、ジョグ/ウォークの語で区別できる
  if (/m/i.test(t) || restType !== undefined) return { restDistanceM: n, restType };
  return { restType };
}

/** 300m×6 / 1000(3:15-25)×4 / 300(41-42)×2×2 → 距離と総本数 */
export function parseRepSpec(
  content: string
): { distanceM: number; reps?: number; targetSec?: number } | undefined {
  const re =
    /(\d{2,4})\s*[mMｍ]?\s*(?:[（(]\s*([\d:.\-〜~]+?)\s*[）)])?\s*[×xX＊*]\s*(\d{1,2})(?:\s*[×xX＊*]\s*(\d{1,2}))?/;
  const m = re.exec(content);
  if (!m) return undefined;
  const sets = m[4] ? Number(m[3]) * Number(m[4]) : Number(m[3]);
  return {
    distanceM: Number(m[1]),
    reps: sets,
    targetSec: m[2] ? timeTokenToSec(m[2].split(/[-〜~]/)[0]) : undefined,
  };
}

/**
 * 「@41.5秒」「@40.9〜41.7秒」「@3:10」形式の設定タイム。
 *
 * 括弧表記（300(42)）は日誌でよく使われるが、
 * このアプリが生成する処方は「300m × 5 @40.9〜41.7秒 r5分」と書く。
 * 生成した処方を編集画面で開いたときに設定を読み取れないと、
 * 自分が出したメニューを自分でカテゴリ未確定と判定することになる。
 * 幅表記は速い側（先頭）を採る。
 */
export function parseAtTarget(content: string): number | undefined {
  const m = /[@＠]\s*(\d{1,2}:\d{2}(?:\.\d+)?|\d{1,3}(?:\.\d+)?)/.exec(content);
  return m ? timeTokenToSec(m[1]) : undefined;
}

/** レースの記録と区間ラップ: 1:56.0(56.0-60.0) */
export function parseRaceRecord(
  content: string
): { timeSec?: number; lapsSec?: number[] } {
  const m = /(\d{1,2}:\d{2}(?:\.\d+)?|\d{2}\.\d+)\s*[（(]\s*([\d:.\s\-〜~]+?)\s*[）)]/.exec(
    content
  );
  if (m) {
    const timeSec = timeTokenToSec(m[1]);
    const laps = m[2]
      .split(/[-〜~\s]+/)
      .map((x) => timeTokenToSec(x))
      .filter((v): v is number => v !== undefined)
      .map((v) => Math.round(v * 100) / 100);
    return { timeSec, lapsSec: laps.length >= 2 ? laps : undefined };
  }
  const t = /(\d{1,2}:\d{2}(?:\.\d+)?)/.exec(content);
  if (t) return { timeSec: timeTokenToSec(t[1]) };
  return {};
}

export function parseRaceDistance(text: string): number | undefined {
  const m = /(\d{3,4})\s*[mMｍ]/.exec(text);
  if (!m) return undefined;
  const d = Number(m[1]);
  return [400, 600, 800, 1000, 1500, 3000, 5000].includes(d) ? d : undefined;
}

// ---------------------------------------------------------------------------
// カテゴリ
// ---------------------------------------------------------------------------

interface CategoryRule {
  words: string[];
  kind: PastEntryKind;
  category?: SessionCategory;
  certain: boolean;
}

export const CATEGORY_RULES: CategoryRule[] = [
  { words: ["オフ", "休養", "完全休養", "off", "OFF", "休み"], kind: "off", category: "off", certain: true },
  // 「レースペース」を実際のレースと誤認しないよう、練習名の規則を先に評価する。
  { words: ["モデリング", "分割800", "分割８００"], kind: "interval", category: "modeling", certain: true },
  { words: ["高乳酸", "解糖系", "スピード持久", "ロングスプリント"], kind: "interval", category: "high_lactate", certain: true },
  { words: ["800mペース", "８００ｍペース", "レースペース"], kind: "interval", category: "race_economy", certain: true },
  { words: ["VO2max", "VO2", "vo2max", "vo2", "最大酸素摂取量", "CVインターバル", "CV走", "CV", "cv"], kind: "interval", category: "cv", certain: true },
  {
    words: [
      "坂ダッシュ",
      "ヒルスプリント",
      "hill sprint",
      "短距離スプリント",
      "スプリント",
      "加速走",
      "流し",
      "WS",
      "ウィンドスプリント",
      "ウインドスプリント",
    ],
    kind: "interval",
    category: "neural",
    certain: true,
  },
  { words: ["レース", "試合", "記録会"], kind: "race", certain: true },
  { words: ["TT", "タイムトライアル"], kind: "timetrial", certain: true },
  { words: ["ロングラン", "ロング走", "LSD"], kind: "continuous", category: "aerobic", certain: true },
  { words: ["ペース走", "閾値", "Ｔ走", "T走", "テンポ"], kind: "continuous", category: "threshold", certain: true },
  { words: ["ジョグ", "jog", "ジョギング", "ジョッグ", "ラン"], kind: "continuous", category: "aerobic", certain: true },
  /*
   * 補強は SessionCategory を増やさず、既存の StrengthSession へ流す。
   * SessionCategory はルールエンジン22本・GRP比率・転移度・負荷計算が
   * 全部参照している型で、ここに strength を足すと
   * 「補強は質練習に数えるのか」「ACWRにどう乗るのか」を
   * 既存の全ルールで決め直すことになる。
   * 補強には接地回数など走練習とは別の規則が既にあるので、そちらに寄せる。
   *
   * 走練習の語より後ろに置いてあるのは意図的。
   * 「ジョグ40分＋体幹」は実際のログに頻出するが、これを補強として登録すると
   * ジョグ40分が有酸素量から丸ごと消える。走った分を残す方を優先する。
   * 逆に「体幹30分」だけの日は走の語が無いので、ここに落ちてくる。
   */
  { words: ["プライオ", "ジャンプ", "バウンディング", "ホッピング"], kind: "strength", certain: true },
  { words: ["メディシン", "メディボ", "MB投げ"], kind: "strength", certain: true },
  { words: ["体幹", "コア", "腹筋", "背筋", "プランク"], kind: "strength", certain: true },
  { words: ["補強", "ウェイト", "筋トレ", "スクワット", "デッドリフト", "ジム", "サーキット"], kind: "strength", certain: true },
];

/** 補強の種別を語から決める。既存の StrengthSession.type に合わせる */
export function inferStrengthType(content: string): StrengthKind {
  if (/プライオ|ジャンプ|バウンディング|ホッピング/.test(content)) return "plyometrics";
  if (/メディシン|メディボ|MB投げ/.test(content)) return "medicine_ball";
  if (/体幹|コア|腹筋|背筋|プランク/.test(content)) return "core";
  return "strength";
}

/** プライオの接地回数（週間管理に使う）: 「接地120回」「120接地」 */
export function parseContactCount(content: string): number | undefined {
  const m = /(?:接地\s*(\d{2,4})\s*回?|(\d{2,4})\s*接地)/.exec(content);
  if (m) return Number(m[1] ?? m[2]);
  return undefined;
}

export function stripRestSpec(content: string): string {
  return content
    .replace(/[rR]\s*\d+\s*(?:min|分|秒|m|jog|walk|ジョグ|ウォーク|完全休息|静止)?/g, " ")
    .replace(/(レスト|つなぎ)\s*[:：]?\s*\d+\s*[m分秒]?\s*(jog|ジョグ)?/g, " ")
    .trim();
}

/**
 * 設定タイムからカテゴリを決める。
 *
 * 同じ 1000m×4 でも、設定が3:10/kmならCV、2:50/kmなら高乳酸寄りになる。
 * つまり距離だけでは決まらないが、**設定タイムがあれば決まる**。
 * 生成側が 設定 = 距離 × GRP × 比率 で作っているので、その逆をたどればよい。
 *
 *   比率 = 設定ペース(秒/m) ÷ GRP(秒/m)
 *
 *   〜1.02  レースペース近辺 → 600m以下は高乳酸 / 600m超はモデリング
 *   〜1.12  やや遅い        → 経済走
 *   それ以上 明確に遅い      → 1600m以下はCV / それ超は閾値
 *
 * GRPが分からない（CFE未設定）ときは断定しない。
 */
export function categoryFromTarget(
  distanceM: number,
  targetSec: number,
  grpSecPerM: number
): { category: SessionCategory; ratio: number } {
  const ratio = targetSec / distanceM / grpSecPerM;
  if (ratio <= 1.02) {
    return { category: distanceM <= 600 ? "high_lactate" : "modeling", ratio };
  }
  if (ratio <= 1.12) return { category: "race_economy", ratio };
  return { category: distanceM <= 1600 ? "cv" : "threshold", ratio };
}

export function inferCategory(
  rawContent: string,
  opts: BulkParseOptions & { targetSec?: number; distanceM?: number } = {}
): { kind: PastEntryKind; category?: SessionCategory; certain: boolean; basis?: string } {
  const content = stripRestSpec(rawContent);
  const rep = parseRepSpec(content);

  // 本人が登録した表記を最優先で見る。組み込みルールより本人の語彙が正しい
  for (const p of opts.phrases ?? []) {
    if (p.phrase && content.toLowerCase().includes(p.phrase.toLowerCase())) {
      return {
        kind: p.kind,
        category: p.category,
        certain: true,
        basis: `表記辞書「${p.phrase}」`,
      };
    }
  }

  for (const r of CATEGORY_RULES) {
    if (r.words.some((w) => content.includes(w))) {
      // 距離×本数があるのに「ジョグ」等の語が混ざっている場合は
      // インターバル側を優先する（レスト記述の取りこぼし対策）
      if (rep && r.kind === "continuous") break;
      return { kind: r.kind, category: r.category, certain: r.certain };
    }
  }

  const distanceM = opts.distanceM ?? rep?.distanceM;
  const targetSec = opts.targetSec ?? rep?.targetSec;

  if (distanceM && targetSec && opts.grpSecPerM) {
    const { category, ratio } = categoryFromTarget(distanceM, targetSec, opts.grpSecPerM);
    return {
      kind: "interval",
      category,
      certain: true,
      basis: `設定 ${targetSec.toFixed(1)}秒/${distanceM}m はGRPの${(ratio * 100).toFixed(0)}%`,
    };
  }

  if (distanceM) {
    // 設定が読めないので断定できない。距離帯から候補だけ出す
    if (distanceM <= 600) return { kind: "interval", category: "high_lactate", certain: false };
    if (distanceM <= 1600) return { kind: "interval", category: "cv", certain: false };
    return { kind: "interval", category: "threshold", certain: false };
  }
  return { kind: "continuous", category: undefined, certain: false };
}

/**
 * 不具合1対応: 本文に「有酸素（continuous、例: ジョグ）」と
 * 「インターバル系（interval、例: 坂ダッシュ）」の両方の語が混ざっているかを見る。
 *
 * kind（interval/continuous）は1つの練習枠につき1つしか持てない
 * （targetPaces と distanceKm/durationMin は排他的に保存される。
 * prescription-fields.tsx の prescriptionPayload 参照）。
 * 混ざっている本文は inferCategory が先に一致した方を選び、もう一方の内容
 * （本数・距離・時間）は保存されないため、黙って捨てずに理由を出す。
 * strength（補強）はSessionCategoryと別枠に保存されるためここでは扱わない
 * （「ジョグ＋体幹」は正しく両方残る。走の語を優先する既存の並び順のとおり）。
 */
export function detectMixedWorkoutKind(rawContent: string): boolean {
  const content = stripRestSpec(rawContent);
  let hasContinuous = false;
  let hasInterval = false;
  for (const r of CATEGORY_RULES) {
    if (r.kind !== "continuous" && r.kind !== "interval") continue;
    if (r.words.some((w) => content.includes(w))) {
      if (r.kind === "continuous") hasContinuous = true;
      if (r.kind === "interval") hasInterval = true;
    }
  }
  return hasContinuous && hasInterval;
}

// ---------------------------------------------------------------------------
// 数値の抽出（距離・時間・心拍）
// ---------------------------------------------------------------------------

export interface ParsedResultFields {
  paceSecPerKm?: number;
  avgHr?: number;
  maxHr?: number;
  durationSec?: number;
  distanceKm?: number;
}

/** ジョグとして妥当なペースの範囲（秒/km）。曖昧な表記の判別に使う */
export const PLAUSIBLE_PACE_MIN = 150;
export const PLAUSIBLE_PACE_MAX = 480;

export function parseResultText(text: string): ParsedResultFields {
  const out: ParsedResultFields = {};
  const t = text.replace(/　/g, " ");

  const maxHr = /(?:最大心拍|最大|最高)\s*[:：]?\s*(\d{2,3})/.exec(t);
  if (maxHr) out.maxHr = Number(maxHr[1]);
  const hr = /(?:平均心拍|心拍|平均HR|HR)\s*[:：]?\s*(\d{2,3})/i.exec(t);
  if (hr) out.avgHr = Number(hr[1]);

  const pace = /(?:平均|@)\s*(\d{1,2}:\d{2})|(\d{1,2}:\d{2})\s*\/\s*km/.exec(t);
  if (pace) out.paceSecPerKm = timeTokenToSec(pace[1] ?? pace[2]);

  // 65min / 22min / 51分 / 1時間5分
  const dur = /(\d+(?:\.\d+)?)\s*(?:min|分)(?!\d)/i.exec(t);
  if (dur) out.durationSec = Number(dur[1]) * 60;
  else {
    const jp = /(\d+時間\d*分?|\d+分\d*秒?)/.exec(t);
    if (jp) out.durationSec = parseDurationToSec(jp[1]);
  }

  const distKm = /(\d+(?:\.\d+)?)\s*(?:km|ｋｍ|キロ)/i.exec(t);
  if (distKm) out.distanceKm = Number(distKm[1]);
  else {
    const distM = /(\d{3,5})\s*[mMｍ](?![a-zA-Z])/.exec(t);
    if (distM) out.distanceKm = Number(distM[1]) / 1000;
  }

  return out;
}

/**
 * "2kmジョグ 8:40" のように、裸の 分:秒 が1つだけ書かれている場合の解釈。
 *
 * 所要時間なのかペースなのかは表記からは決まらないので、
 * 距離と組み合わせて「ジョグとして妥当なペースになる方」を採る。
 * どちらも妥当、あるいはどちらも妥当でない場合は決めない（人間に任せる）。
 */
export function resolveBareTime(
  bareSec: number,
  distanceKm: number
): { durationSec?: number; paceSecPerKm?: number; ambiguous: boolean } {
  const asDurationPace = bareSec / distanceKm;
  const asPace = bareSec;
  const okDuration = asDurationPace >= PLAUSIBLE_PACE_MIN && asDurationPace <= PLAUSIBLE_PACE_MAX;
  const okPace = asPace >= PLAUSIBLE_PACE_MIN && asPace <= PLAUSIBLE_PACE_MAX;
  if (okDuration && !okPace) return { durationSec: bareSec, ambiguous: false };
  if (okPace && !okDuration) return { paceSecPerKm: bareSec, ambiguous: false };
  return { ambiguous: true };
}

// ---------------------------------------------------------------------------
// 行の解釈
// ---------------------------------------------------------------------------

const SUPPLEMENT_RE = /[＋+]?\s*(流し|WS|ウィンドスプリント|ウインドスプリント)\s*(\d{1,2})?\s*本?/;

export function parseRow(
  line: string,
  lineNo: number,
  today: string,
  opts: BulkParseOptions = {}
): ParsedRow {
  const row: ParsedRow = { lineNo, raw: line, issues: [], ready: false };
  const { dateToken, body } = splitDateAndBody(line);

  const date = parseLogDate(dateToken, today);
  if (!date) {
    row.issues.push("日付として読めませんでした（例: 7/22, 2026-07-22）");
    return row;
  }
  row.date = date;
  row.note = body;

  if (!body) {
    row.issues.push("練習内容が空です");
    return row;
  }

  // 補助（流し）を主セッションから切り離す
  const sup = SUPPLEMENT_RE.exec(body);
  let content = body;
  if (sup && !/^\s*(流し|WS)/.test(body)) {
    row.supplementNote = sup[2] ? `流し${sup[2]}本` : "流し";
    content = body.replace(SUPPLEMENT_RE, "").replace(/[＋+]\s*$/, "").trim();
  }

  const segments = parseSegments(content);
  if (segments.length > 0) row.segments = segments;
  const rep = parseRepSpec(content);

  /*
   * カテゴリ判定に使う距離と設定は「代表区間のもの」でなければならない。
   * 300(42)＋600(1:26)＋600(1:26) で先頭の 300m/42秒 を使うと、
   * 実質600mの練習を短距離として分類してしまう。
   */
  const repDist = representativeDistance(segments);
  // 「@設定」は距離×本数が書かれているときだけ設定として扱う。
  // ジョグの「@5:00〜5:20/km」を1本の設定と読むと種別を取り違える
  const atTarget = rep ? parseAtTarget(content) : undefined;
  const cat = inferCategory(content, {
    ...opts,
    distanceM: rep?.distanceM ?? repDist,
    targetSec:
      rep?.targetSec ?? segments.find((x) => x.distanceM === repDist)?.targetSec ?? atTarget,
  });
  row.kind = cat.kind;
  row.category = cat.category;
  row.categoryUncertain = !cat.certain;

  if (detectMixedWorkoutKind(content)) {
    row.issues.push(
      `本文に複数の種類の練習（ジョグ等の持続走＋坂ダッシュ等のインターバル）が` +
        `混ざっているようです。この枠には「${
          cat.kind === "interval" ? "インターバル側" : "持続走側"
        }」だけが登録されます。もう一方は別の練習として日付・時間帯を分けて追加してください。`
    );
  }

  // 結果欄があればそちらを優先する（内容欄には予定が書かれるため）
  const { result: resultPart } = splitContentAndResult(content);
  const fromResult = parseResultText(resultPart);
  const fromAll = parseResultText(content);
  const fields: ParsedResultFields = {
    paceSecPerKm: fromResult.paceSecPerKm ?? fromAll.paceSecPerKm,
    avgHr: fromResult.avgHr ?? fromAll.avgHr,
    maxHr: fromResult.maxHr ?? fromAll.maxHr,
    durationSec: fromResult.durationSec ?? fromAll.durationSec,
    distanceKm: fromResult.distanceKm ?? fromAll.distanceKm,
  };
  row.avgHr = fields.avgHr;
  row.maxHr = fields.maxHr;

  if (cat.kind === "off") {
    row.ready = true;
    return row;
  }

  if (cat.kind === "strength") {
    row.strengthType = inferStrengthType(content);
    row.contactCount = parseContactCount(content);
    row.durationSec = fields.durationSec;
    row.ready = true;
    return row;
  }

  if (cat.kind === "race" || cat.kind === "timetrial") {
    row.raceDistanceM = parseRaceDistance(content);
    const rec = parseRaceRecord(content);
    // 1:53.49 を足し算すると 113.49000000000001 になる。表示にも保存にも出るので丸める
    row.raceTimeSec = rec.timeSec !== undefined ? Math.round(rec.timeSec * 100) / 100 : undefined;
    row.lapsSec = rec.lapsSec;
    if (!row.raceDistanceM) row.issues.push("レースの距離を読み取れませんでした");
    if (!row.raceTimeSec) row.issues.push("記録を読み取れませんでした");
    row.ready = computeReady(row);
    return row;
  }

  if (cat.kind === "interval") {
    const fromResultTimes = resultPart ? extractTimes(resultPart) : [];
    const times = fromResultTimes.length > 0 ? fromResultTimes : extractTimes(content);

    if (segments.length >= 2) {
      // 300(42)＋600(1:26)＋600(1:26) のような複合。
      // 最も本数の多い距離を代表にする。混ぜると換算が壊れるため。
      const counts = new Map<number, number>();
      for (const g of segments) counts.set(g.distanceM, (counts.get(g.distanceM) ?? 0) + 1);
      const best = representativeDistance(segments)!;
      row.repDistanceM = best;
      // カテゴリ判定に使う設定タイムは「代表距離のもの」でなければならない。
      // 300+600+600 で 300m の設定を使うと、600m の練習を短距離として誤分類する。
      row.targetSec = segments.find((x) => x.distanceM === best)?.targetSec;
      if (times.length === segments.length) {
        row.repTimesSec = segments
          .map((s, i) => ({ s, t: times[i] }))
          .filter((x) => x.s.distanceM === best)
          .map((x) => x.t);
      } else if (times.length > 0) {
        row.repTimesSec = times;
        row.issues.push(
          `区間${segments.length}本に対して実施タイムが${times.length}個です。対応が取れないため全部を並べています`
        );
      }
      row.reps = row.repTimesSec?.length ?? counts.get(best);
      if (counts.size > 1) {
        row.issues.push(
          `距離の違う区間が混ざっています（${[...counts.keys()].join("・")}m）。` +
            `代表として${best}mぶんだけを能力推定に使います`
        );
      }
    } else {
      row.repDistanceM = rep?.distanceM ?? segments[0]?.distanceM;
      row.targetSec = rep?.targetSec ?? segments[0]?.targetSec ?? atTarget;
      row.repTimesSec = times.length > 0 ? times : undefined;
      row.reps = rep?.reps ?? (times.length > 0 ? times.length : undefined);
    }

    const rest = /[rR]\s*(\d+\s*(?:min|分|秒|m)?\s*(?:jog|walk|ジョグ|ウォーク)?)/.exec(content);
    if (rest) {
      row.restNote = `r${rest[1].trim()}`;
      Object.assign(row, parseRest(rest[1]));
    }

    if (!row.repDistanceM && row.category !== "neural") {
      row.issues.push("1本の距離を読み取れませんでした（例: 300m×6 / 300(42)）");
    }
    if (!row.repTimesSec && row.category !== "neural") {
      row.issues.push(
        "実施タイムがありません（負荷には算入しますが、能力推定には使いません）"
      );
    }
    if (cat.basis) row.issues.push(`カテゴリの根拠: ${cat.basis}`);
    row.ready = computeReady(row);
    return row;
  }

  // continuous
  let distanceKm = fields.distanceKm;
  let durationSec = fields.durationSec;
  let paceSecPerKm = fields.paceSecPerKm;

  if (durationSec === undefined && paceSecPerKm === undefined && distanceKm !== undefined) {
    // "2kmジョグ 8:40" のように裸の分:秒だけがある場合
    const bare = extractTimes(content);
    if (bare.length === 1) {
      const r = resolveBareTime(bare[0], distanceKm);
      if (r.ambiguous) {
        row.issues.push(
          `「${content}」の時間が所要時間かペースか判断できませんでした。どちらかを入力してください`
        );
      } else {
        durationSec = r.durationSec;
        paceSecPerKm = r.paceSecPerKm;
      }
    }
  }

  const triple = completeRunTriple({ distanceKm, durationSec, paceSecPerKm });
  row.distanceKm = triple.distanceKm;
  row.durationSec = triple.durationSec;
  row.paceSecPerKm = triple.paceSecPerKm;
  if (triple.mismatch) row.issues.push(triple.mismatch);
  if (!row.distanceKm || !row.durationSec) {
    row.issues.push(
      "距離・時間・ペースのうち2つが必要です（例: 51分 平均4:40）。読み取れた項目だけ埋めてあります"
    );
  }
  row.ready = computeReady(row);
  return row;
}

export function computeReady(row: ParsedRow): boolean {
  if (!row.date || !row.kind) return false;
  if (row.kind === "off") return true;
  if (row.kind === "strength") return true;
  if (row.categoryUncertain) return false;
  if (row.kind === "race" || row.kind === "timetrial") {
    return row.raceDistanceM !== undefined && row.raceTimeSec !== undefined;
  }
  if (row.kind === "interval") {
    if (row.category === "neural") return true;
    return row.repDistanceM !== undefined;
  }
  return row.distanceKm !== undefined && row.durationSec !== undefined;
}

export function isHeaderLine(line: string): boolean {
  return /^\s*(日付|date|Date)[\s\t]/.test(line) || /^\s*日付\s*$/.test(line);
}

/**
 * 貼り付けテキスト全体を解釈する。
 *
 * 先頭が日付でない行は「前の行の続き」として扱う。
 * 実際の日誌では実施タイムが次の行に書かれることが多い。
 */
export function parseBulkText(
  text: string,
  today: string,
  opts: BulkParseOptions = {}
): ParsedRow[] {
  const out: ParsedRow[] = [];
  const lines = text.split(/\r?\n/);
  const pending: { lineNo: number; raw: string }[] = [];

  const flush = () => {
    if (pending.length === 0) return;
    const merged = pending.map((p) => p.raw.trim()).join(" ");
    out.push(parseRow(merged, pending[0].lineNo, today, opts));
    pending.length = 0;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    if (isHeaderLine(line)) continue;
    const { dateToken } = splitDateAndBody(line);
    if (looksLikeDate(dateToken)) {
      flush();
      pending.push({ lineNo: i + 1, raw: line });
    } else if (pending.length > 0) {
      // 継続行（実施タイムだけの行）
      pending.push({ lineNo: i + 1, raw: line });
    } else {
      out.push(parseRow(line, i + 1, today, opts));
    }
  }
  flush();
  return out;
}
