/**
 * 写真からの転記。
 *
 * **LLMにやらせるのは文字起こしだけ。** 解釈は一切させない。
 * 練習日誌の意味を読み取るのは、これまでどおり `bulkImport.ts` の `parseRow` が
 * 唯一の実装で、そこは決定的（同じ文字列からは必ず同じ結果が出る）。
 *
 * この分け方は妥協ではなく、こうしないと成立しない。
 * 「300(42)×3」が高乳酸なのかCVなのかは**今のCFEに対する比率**で決まるので、
 * 写真を見ただけのLLMには本来決められない。決められないものを決めさせると、
 * あとで数値を疑ったときに、どこで曲がったのか追えなくなる。
 *
 * 流れ:
 *   写真 → （LLM）文字起こし → 本人が目で直す → parseRow が解釈 → 本人が確定
 * 途中の「本人が目で直す」を飛ばさない。文字起こしは必ず間違う。
 */

/**
 * 読めなかった箇所に入れる印。
 *
 * `?` にしないのは、練習日誌そのものに `?` が書かれていることがあるため
 * （「1:26?」のように本人が疑問符を残す）。区別できないと、
 * 読めなかったのか本人が書いたのかが分からなくなる。
 */
export const UNREADABLE_MARK = "【読めず】";

/**
 * 文字起こしの指示。
 *
 * 縛っているのは2つ。
 *   1. 見えている文字だけを書く（読めないものを推測で埋めない）
 *   2. 整えない・並べ替えない・単位を足さない（整形は解釈の一種）
 */
export const TRANSCRIPTION_SYSTEM_PROMPT = [
  "あなたは画像に写っている練習日誌の文字を、そのまま書き起こす作業をしています。",
  "",
  "守ること:",
  "- 画像に見えている文字だけを書いてください。見えていないものを補わないでください。",
  `- かすれ・手書きのくずし・見切れなどで読めない箇所は ${UNREADABLE_MARK} と書いてください。推測で埋めないでください。`,
  "- 行の並び、改行、書かれている順序を変えないでください。",
  "- 表記を整えないでください。「300(42)×3」は「300m×3 @42秒」などに直さず、書いてあるとおりに写してください。",
  "- 単位・記号・全角半角を勝手に足したり直したりしないでください。",
  "- 内容の意味を説明したり、練習の種類を判定したりしないでください。あなたの仕事は文字起こしだけです。",
  "- 前置き・後書き・見出しを付けず、書き起こした本文だけを返してください。",
  "- 練習日誌が写っていない場合は、本文を返さず「練習日誌が写っていません」とだけ書いてください。",
].join("\n");

export interface TranscriptionResult {
  /** 一括入力の欄へそのまま入れる文字列 */
  text: string;
  /** 読めなかった箇所の数。0でなければ本人に直してもらう必要がある */
  unreadableCount: number;
  /** 日誌が写っていないと判断された場合の理由 */
  rejected?: string;
}

/**
 * 応答をコードフェンスで包んでくることがあるので外す。
 * 先頭と末尾の両方が ``` のときだけ外す。片方だけなら本文の一部かもしれないので触らない。
 */
function stripCodeFence(raw: string): string {
  const lines = raw.split("\n");
  const first = lines.findIndex((l) => l.trim() !== "");
  let last = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trim() !== "") {
      last = i;
      break;
    }
  }
  if (first < 0 || last <= first) return raw;
  if (!lines[first].trim().startsWith("```") || lines[last].trim() !== "```") return raw;
  return lines.slice(first + 1, last).join("\n");
}

/**
 * 応答を一括入力の欄に入れられる形にする。純関数。
 *
 * ここでやるのは**取り除くことだけ**。中身を直したり並べ替えたりしない。
 * 直すと、それはもう文字起こしではなく解釈になる。
 */
export function cleanTranscription(raw: string): TranscriptionResult {
  const stripped = stripCodeFence(raw).replace(/\r\n?/g, "\n");
  const text = stripped.replace(/^\n+/, "").replace(/\s+$/, "");

  if (/練習日誌が写っていません/.test(text) && text.length < 40) {
    return {
      text: "",
      unreadableCount: 0,
      rejected: "写真から練習日誌を読み取れませんでした。日誌の面が写っているか確認してください。",
    };
  }

  const unreadableCount = text.split(UNREADABLE_MARK).length - 1;
  return { text, unreadableCount };
}

/**
 * 画像を送る前に縮める大きさ。純関数。
 *
 * 撮ったままの写真は4000px近くあり、そのまま送ると通信も費用も無駄に増える。
 * かといって小さくしすぎると手書きが潰れて読めなくなる（読めない文字が増えれば、
 * 直す手間が本人に返ってくるだけで、何も得しない）。
 * 上限は 2576px。Anthropic の高解像度の上限がここで、これを超えて送っても
 * 向こうで縮められるため、送るだけ損になる。
 *
 * 元が小さい場合は拡大しない。拡大しても情報は増えず、容量だけ増える。
 */
export const MAX_IMAGE_EDGE = 2576;

export function fitWithin(
  width: number,
  height: number,
  maxEdge = MAX_IMAGE_EDGE
): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 0, height: 0 };
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height };
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** Anthropicが受け取れる画像形式。これ以外は送る前に断る */
export const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;

export function isAcceptedImageType(type: string): boolean {
  return (ACCEPTED_IMAGE_TYPES as readonly string[]).includes(type);
}
