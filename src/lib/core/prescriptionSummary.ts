/**
 * カレンダーの1行に出す、処方の短い形。
 *
 * これまでは処方の原文をそのまま置いて CSS で切っていた。
 * 生成される原文は
 *
 *   `300m × 5 @300m 41.2〜41.6秒 r5分（ジョグ）`
 *
 * のようになっていて、**文字数で切ると一番見たい設定タイムが真っ先に消える**
 * （`@300m 41.2…` の手前で切れる）。前から消すのではなく、残すものを決めて組み直す。
 *
 * 残すのは2つだけ:
 *   ・距離×本数（今日走る形）
 *   ・設定タイム（今日出す数字）
 *
 * レスト・つなぎ・推定の注記は落とす。タップすれば全部見える。
 *
 * ---
 *
 * **ここは「解釈」ではなく「整形」。**
 * 利用者が書いた日誌を読むのは `bulkImport.ts` の `parseRow` が唯一の実装で、
 * こちらが相手にするのは `progression.ts` の `describeSpec` が組んだ**自分の出力**。
 * だから形が決まっている。
 *
 * ただし形が変わったら黙って劣化するので、
 * `tests/prescriptionSummary.test.ts` が `describeSpec` の実物を通して確かめている。
 * **読み取れない形なら undefined を返す**——呼ぶ側が原文を出すので、
 * 中途半端に組み立てた文字列で原文と食い違うことがない。
 */

/**
 * 設定を詰める。2つの形がある。
 *
 *   インターバル: `300m 41.2〜41.6秒`      → `41.2〜41.6`
 *   ジョグ・持続走: `5:05/km〜5:25/km`      → `5:05〜5:25/km`
 *
 * **ジョグの形も必ず拾うこと。** 秒だけを見ていたときは
 * ジョグ行から設定ペースがまるごと消えていた（本数より、こちらが本体）。
 */
function compactPace(text: string): string | undefined {
  const perKm = /([\d:]+)\/km(?:〜([\d:]+)\/km)?/.exec(text);
  if (perKm) {
    return perKm[2] ? `${perKm[1]}〜${perKm[2]}/km` : `${perKm[1]}/km`;
  }
  const sec = /([\d.]+(?:〜[\d.]+)?)\s*秒/.exec(text);
  return sec ? sec[1] : undefined;
}

export function shortPrescription(prescription: string): string | undefined {
  const text = prescription?.trim();
  if (!text) return undefined;

  /*
   * 複合（500m(68.7〜69.4)＋300m(41.2〜41.6)）は、距離と設定が既に並んでいる。
   * レスト以降だけ落とす。
   */
  if (text.includes("＋") && text.includes("(")) {
    const head = text.split(/\s+r/)[0].trim();
    return head || undefined;
  }

  // 単一区間: `300m × 5 @300m 41.2〜41.6秒 r5分（ジョグ）`
  const at = text.indexOf("@");
  if (at < 0) return undefined;
  const head = text.slice(0, at).trim();
  if (!head) return undefined;

  const rest = text.slice(at + 1);
  const pace = compactPace(rest.split(/\s+r/)[0]);
  return pace ? `${head} ${pace}` : head;
}
