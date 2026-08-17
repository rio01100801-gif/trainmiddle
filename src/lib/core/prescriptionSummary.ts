/**
 * 処方の1行を、**切ってよい部分と切ってはいけない部分に分ける**。
 *
 * これまでは1本の文字列を返して CSS の `truncate` に任せていた。
 * 文字数で切ると前から残るので、
 *
 *   `400m×3 @400m 52.7〜53…`
 *
 * と、**一番見たい設定タイムが真っ先に消える**。
 * 「前から何文字」ではなく「何を残すか」を決める必要がある。
 *
 * 練習前に3秒で読むのは次の3つ。この3つは**絶対に切らない**。
 *
 *   1. 距離×本数（今日走る形）
 *   2. 設定（今日出す数字）
 *   3. レスト（つなぎ方）
 *
 * 目的・注記は切ってよい。タップすれば全部見える。
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

export interface PrescriptionParts {
  /**
   * 距離×本数、またはジョグの時間。「400m×3」「ジョグ40分」。
   * **切らない。**
   */
  shape?: string;
  /** 設定。「52.7〜53.3秒」「4:42〜5:02/km」。**切らない。** */
  target?: string;
  /**
   * 設定を区間ごとに分けたもの。複合（500m＋300m）では2つ以上になる。
   *
   * 画面は**1つずつ別の塊として並べる**。1本の文字列にすると、
   * 狭い幅で折り返せず横にはみ出す（切らないと決めたので縮められない）。
   */
  targets?: string[];
  /** レスト。「r5分」。**切らない。** */
  rest?: string;
  /** 目的・注記。切ってよい */
  note?: string;
  /** 注記から読めた狙いのRPE。「3〜4」 */
  rpe?: string;
  /** 暑さのときの扱い。読めたときだけ */
  heatNote?: string;
}

/**
 * 設定を詰める。2つの形がある。
 *
 *   インターバル: `300m 41.2〜41.6秒`      → `41.2〜41.6秒`
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
  return sec ? `${sec[1]}秒` : undefined;
}

/** `r5分（jog）` から `r5分` を取る。つなぎの種類は括弧の中なので落とす */
function compactRest(text: string): string | undefined {
  const m = /r(\d+(?::\d+)?(?:分|秒)?)/.exec(text);
  return m ? `r${m[1]}` : undefined;
}

/**
 * ジョグの形を詰める。
 *
 * 生成される原文は `40分有酸素ジョグ`。
 * 「有酸素」はカテゴリの表示と重複するので落とし、時間を後ろに回す。
 * 数字を先に読ませたいので `ジョグ40分` の順にする。
 */
function compactContinuousShape(head: string): string | undefined {
  const m = /^(\d+)分(.*)$/.exec(head.trim());
  if (!m) return head.trim() || undefined;
  /*
   * 括弧の中は落とす。自作メニューでは `40分ジョグ （カレンダー反映テスト）` のように
   * 説明が途中に入ることがあり、そのまま繋ぐと
   * **切れない215pxの塊**になって行が横にはみ出した（320px幅で32px超過）。
   *
   * 形は「絶対に切らない」場所なので、**短いことを作りで保証する**。
   * 長い呼び名は形ではなく名前なので、ここには入れない（名前の欄に出る）。
   */
  const kind = m[2]
    .replace(/[（(][^）)]*[）)]/g, "")
    .replace("有酸素", "")
    .trim();
  const SHORT_KIND_MAX = 6;
  return kind && kind.length <= SHORT_KIND_MAX ? `${kind}${m[1]}分` : `${m[1]}分`;
}

/**
 * 注記から狙いのRPEを取る。`RPE 3〜4を優先` → `3〜4`
 *
 * 読めなければ undefined。**無いものを作らない**（注記の原文は別に持っている）。
 */
function extractRpe(note: string): string | undefined {
  const m = /RPE\s*([\d]+(?:〜[\d]+)?)/.exec(note);
  return m ? m[1] : undefined;
}

/**
 * 暑いときの扱い。
 *
 * 原文は「暑熱時はペースを強制しない」のように長い。
 * **結論だけを残す**——練習前に読むのは「守らなくていい」という判断だけで、
 * 理由はタップして読めばいい。
 */
function extractHeatNote(note: string): string | undefined {
  if (!note.includes("暑熱")) return undefined;
  if (/強制しない|遅くてよい|優先/.test(note)) return "暑熱時：感覚優先";
  return "暑熱時：注記あり";
}

/**
 * 複合（`500m(68.7〜69.4)＋300m(41.2〜41.6)`）をほどく。
 *
 * 同じ距離が続くときはまとめる（`600m＋600m` → `600m×2`）。
 * 区間ごとに設定が違うので、設定は並べて出す。
 */
function parseCompound(head: string): { shape: string; targets: string[] } | undefined {
  const parts = head.split("＋").map((x) => x.trim());
  const blocks: { dist: string; pace?: string }[] = [];
  for (const part of parts) {
    const m = /^(\d+)m(?:\(([^)]*)\))?$/.exec(part);
    if (!m) return undefined;
    blocks.push({ dist: `${m[1]}m`, pace: m[2] });
  }
  if (blocks.length === 0) return undefined;

  // 同じ距離が続いたらまとめる
  const shapeParts: string[] = [];
  let i = 0;
  while (i < blocks.length) {
    let n = 1;
    while (i + n < blocks.length && blocks[i + n].dist === blocks[i].dist) n += 1;
    shapeParts.push(n > 1 ? `${blocks[i].dist}×${n}` : blocks[i].dist);
    i += n;
  }

  // 設定は距離ごとに1回だけ出す（同じ距離で同じ設定が並ぶので）
  const seen = new Set<string>();
  const paces: string[] = [];
  for (const b of blocks) {
    if (!b.pace) continue;
    const key = `${b.dist}:${b.pace}`;
    if (seen.has(key)) continue;
    seen.add(key);
    paces.push(`${b.pace}秒`);
  }

  return { shape: shapeParts.join("＋"), targets: paces };
}

/** 処方を、切ってよい部分と切ってはいけない部分に分ける */
export function prescriptionParts(prescription: string): PrescriptionParts {
  const text = prescription?.trim();
  if (!text) return {};

  // 注記（丸括弧の中）を先に取り分ける。全角の括弧だけを見る
  const noteMatch = /（([^）]*)）\s*$/.exec(text);
  const note = noteMatch?.[1]?.trim();
  const rpe = note ? extractRpe(note) : undefined;
  const heatNote = note ? extractHeatNote(note) : undefined;

  const rest = compactRest(text);

  // 複合: `500m(68.7〜69.4)＋300m(41.2〜41.6) r5分（jog）`
  if (text.includes("＋") && text.includes("(")) {
    const head = text.split(/\s+r/)[0].trim();
    const compound = parseCompound(head);
    if (compound) {
      return {
        shape: compound.shape,
        target: compound.targets.length > 0 ? compound.targets.join(" / ") : undefined,
        targets: compound.targets.length > 0 ? compound.targets : undefined,
        rest,
        note,
        rpe,
        heatNote,
      };
    }
    // 読めない形は組み立てない。呼ぶ側が原文を出す
    return { note, rpe, heatNote };
  }

  const at = text.indexOf("@");
  if (at < 0) {
    /*
     * 設定が無い処方（休養・補強・固定枠のチーム練習など）。
     * 形だけでも出せるなら出す。
     */
    const head = text.split("（")[0].trim();
    return head ? { shape: head, note, rpe, heatNote } : { note, rpe, heatNote };
  }

  const head = text.slice(0, at).trim();
  const target = compactPace(text.slice(at + 1).split(/\s+r/)[0]);

  // `300m × 5` → `300m×5`（空白を詰めて1つの塊にする。ここで折り返されたくない）
  const interval = /^(\d+)m\s*×\s*(\d+)$/.exec(head);
  if (interval) {
    return {
      shape: `${interval[1]}m×${interval[2]}`,
      target,
      targets: target ? [target] : undefined,
      rest,
      note,
      rpe,
      heatNote,
    };
  }

  // ジョグ・持続走: `40分有酸素ジョグ`
  return {
    shape: compactContinuousShape(head),
    target,
    targets: target ? [target] : undefined,
    rest,
    note,
    rpe,
    heatNote,
  };
}

/**
 * これまでの1行の形。**新しい画面では使わない**（切られてしまうため）。
 * 相談の文脈など、1行の文字列が要る場所のために残してある。
 */
export function shortPrescription(prescription: string): string | undefined {
  const p = prescriptionParts(prescription);
  /*
   * **設定が読めなければ返さない。** 呼ぶ側が原文を出す。
   * 形だけ組んで返すと、原文と食い違っていても気づけない
   * （`prescriptionParts` は設定の無い処方でも形を返すが、
   * あちらは2段に分けて出す画面用で、落ちた部分がすぐ分かる）。
   */
  if (!p.shape || !p.target) return undefined;
  return `${p.shape} ${p.target}`;
}

/**
 * セッション名が、カテゴリの表示と重複していないか。
 *
 * 「高乳酸」の行に「高乳酸セッション（300m）」と並べても情報が増えない。
 * 距離は距離×本数のほうに出るので、括弧の中も重複している。
 *
 * **省くのは重複しているときだけ。** 固定枠のチーム練習や自作メニューの名前は
 * 他に出るところが無いので残す。
 */
export function isRedundantName(name: string | undefined, categoryLabel: string): boolean {
  if (!name) return true;
  const n = name.trim();
  if (!n) return true;
  return n.includes(categoryLabel);
}
