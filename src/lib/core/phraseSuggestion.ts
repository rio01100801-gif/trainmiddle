/**
 * 表記辞書の候補出し。
 *
 * 一括入力で読めなかった行について、「この語はこう読む」という**辞書の案**を出す。
 * 出すだけで、登録するのは本人。登録されたあとはこれまでどおり
 * `bulkImport.ts` が辞書を見て**決定的に**解釈する。
 *
 * ここがこの機能の要点で、使うほどAIを呼ばなくなる方向に働く。
 * 一度覚えた語は次から辞書で通るので、候補出しが動くのは
 * 「まだ知らない書き方に初めて出会ったとき」だけになる。
 *
 * **行ごとの分類はさせない。** させると、同じ文字列が日によって
 * 違う意味になりうる状態ができて、`parseRow` が唯一の解釈という前提が壊れる。
 * ここで作るのはあくまで辞書の1エントリで、中身は画面で確認・編集でき、
 * あとから一覧で消せる。
 */
import type { PastEntryKind } from "./backfill";
import type { SessionCategory } from "./types";

export const SUGGESTABLE_KINDS: PastEntryKind[] = [
  "race",
  "timetrial",
  "interval",
  "continuous",
  "off",
  "strength",
];

/** 辞書に入れられるカテゴリ。ポイント練習の種別だけ */
export const SUGGESTABLE_CATEGORIES: SessionCategory[] = [
  "high_lactate",
  "race_economy",
  "modeling",
  "cv",
  "threshold",
  "neural",
];

export const SUGGESTABLE_STRENGTH_TYPES = [
  "strength",
  "plyometrics",
  "medicine_ball",
  "core",
] as const;

/** 短すぎる語は本文のどこにでも当たってしまうので辞書にしない */
export const MIN_PHRASE_LENGTH = 2;

export interface PhraseSuggestion {
  phrase: string;
  kind: PastEntryKind;
  category?: SessionCategory;
  strengthType?: string;
  /** なぜそう読んだか。本人が却下できるように必ず添える */
  reason: string;
}

export const PHRASE_SUGGESTION_SYSTEM_PROMPT = [
  "あなたは800m走者の練習日誌アプリで、読み取れなかった1行について「表記辞書」の案を出します。",
  "",
  "辞書とは「この語が含まれていたら、この種類の練習として読む」という対応のことです。",
  "チーム固有の呼び方（例:「B-up走」「ビルドアップ」「WS」）を1回登録すると、次から自動で読めるようになります。",
  "",
  "守ること:",
  "- 語は、渡された行の中に**実際に書かれている文字列**をそのまま抜き出してください。言い換えたり、書かれていない語を作らないでください。",
  "- 数字・単位・レスト表記（300、m、分、r5min など）は語にしないでください。どの行にも当たってしまいます。",
  "- 何の練習か判断できない場合は、無理に答えず kind を null にしてください。",
  "- なぜそう読んだかを reason に必ず1文で書いてください。",
  "",
  "kind は次のいずれか:",
  "  race=レース / timetrial=タイムトライアル / interval=ポイント練習（本数のある練習）",
  "  continuous=ジョグ・持続走 / off=休養 / strength=補強（走らない練習）",
  "",
  "kind が interval か continuous のときだけ category を付けられます（不明なら null）:",
  "  high_lactate=高乳酸 / race_economy=経済走 / modeling=モデリング / cv=CV / threshold=閾値 / neural=神経系",
  "",
  "kind が strength のときだけ strengthType を付けられます（不明なら null）:",
  "  strength=ウェイト / plyometrics=プライオ / medicine_ball=メディシンボール / core=体幹",
  "",
  "JSONだけを返してください。前置きも説明文も付けないでください。形式:",
  '{"phrase":"...","kind":"...","category":null,"strengthType":null,"reason":"..."}',
].join("\n");

/** 送る本文。行と、すでに覚えている語だけ。純関数 */
export function buildPhraseSuggestionRequest(line: string, knownPhrases: string[] = []): string {
  const known =
    knownPhrases.length > 0
      ? `\n\nすでに辞書にある語（重複して提案しないでください）:\n${knownPhrases.map((p) => `- ${p}`).join("\n")}`
      : "";
  return `次の1行が読み取れませんでした。辞書に入れる語の案を出してください。\n\n${line}${known}`;
}

/** 全角・大文字小文字・空白の違いを吸収して突き合わせる */
function normalize(s: string): string {
  return s.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
}

function stripFence(raw: string): string {
  const t = raw.trim();
  if (!t.startsWith("```")) return t;
  const firstBreak = t.indexOf("\n");
  const lastFence = t.lastIndexOf("```");
  if (firstBreak < 0 || lastFence <= firstBreak) return t;
  return t.slice(firstBreak + 1, lastFence).trim();
}

export interface PhraseSuggestionResult {
  suggestion?: PhraseSuggestion;
  /** 案にならなかった理由。画面にそのまま出せる文にする */
  error?: string;
}

/**
 * 応答を検査して案にする。純関数。
 *
 * **通す条件を厳しくしてある。** 少しでも怪しければ案にしない。
 * ここを緩めると、辞書に妙な語が入り、以降その語を含む行が全部そう読まれる。
 * 辞書は一度入ると効き続けるので、入口で止めるほうが安い。
 */
export function parsePhraseSuggestion(
  raw: string,
  sourceLine: string,
  knownPhrases: string[] = []
): PhraseSuggestionResult {
  let value: unknown;
  try {
    value = JSON.parse(stripFence(raw));
  } catch {
    return { error: "候補を読み取れませんでした。もう一度試すか、手で入力してください。" };
  }
  if (!value || typeof value !== "object") {
    return { error: "候補の形式が正しくありませんでした。" };
  }
  const v = value as Record<string, unknown>;

  const phrase = typeof v.phrase === "string" ? v.phrase.trim() : "";
  if (!phrase) return { error: "語を決められませんでした。手で入力してください。" };
  if (phrase.length < MIN_PHRASE_LENGTH) {
    return { error: `「${phrase}」は短すぎます。どの行にも当たってしまうので登録できません。` };
  }
  // 数字・記号だけの語は、どの行にも当たるので辞書にしない
  if (!/[\p{L}]/u.test(phrase)) {
    return { error: `「${phrase}」は数字や記号だけなので辞書にできません。` };
  }
  /*
   * 行に実際に無い語は通さない。
   * 言い換えや要約を許すと、書いていないものが辞書に入る。
   * （「読めなかったものを推測で埋めない」と同じ考え方）
   */
  if (!normalize(sourceLine).includes(normalize(phrase))) {
    return { error: `「${phrase}」はこの行に書かれていないため、候補にできません。` };
  }
  if (knownPhrases.some((p) => normalize(p) === normalize(phrase))) {
    return { error: `「${phrase}」はすでに辞書にあります。` };
  }

  const kind = typeof v.kind === "string" ? v.kind : "";
  if (!SUGGESTABLE_KINDS.includes(kind as PastEntryKind)) {
    return { error: "何の練習かを判断できませんでした。種類を選んでから登録してください。" };
  }

  const reason = typeof v.reason === "string" ? v.reason.trim() : "";
  // 理由の無い案は出さない。却下する材料が本人に無くなる
  if (!reason) return { error: "根拠が付いていない候補だったので採用しませんでした。" };

  const suggestion: PhraseSuggestion = { phrase, kind: kind as PastEntryKind, reason };

  const category = typeof v.category === "string" ? v.category : "";
  if (category) {
    if (kind !== "interval" && kind !== "continuous") {
      // 種類と合わないカテゴリは黙って捨てる（案そのものは活かす）
    } else if (SUGGESTABLE_CATEGORIES.includes(category as SessionCategory)) {
      suggestion.category = category as SessionCategory;
    }
  }

  const strengthType = typeof v.strengthType === "string" ? v.strengthType : "";
  if (
    strengthType &&
    kind === "strength" &&
    (SUGGESTABLE_STRENGTH_TYPES as readonly string[]).includes(strengthType)
  ) {
    suggestion.strengthType = strengthType;
  }

  return { suggestion };
}
