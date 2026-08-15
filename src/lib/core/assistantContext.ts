/**
 * 相談（AI）に渡す文脈を組み立てる。
 *
 * ここは**読むだけ**の層。数値を作らない・直さない。
 * CFEも設定ペースもメニュー解釈もルール判定も、これまでどおり決定的なコアが決める。
 * LLMにできるのは、ここで作った文字列を読んで日本語で説明することだけで、
 * 結果を数値に書き戻す経路は用意していない。
 * （CLAUDE.md「LLMを使わない。同じ入力からは必ず同じ結果が出ること」を壊さないため。
 *   壊すと、あとで数値を疑ったときに、どれがルールでどれがLLMか追えなくなる）
 *
 * 同じ入力からは必ず同じ文字列が出る。だから
 *   ・画面に「これを送ります」と全文を出せる
 *   ::・テストで中身を固定できる
 * の両方が成り立つ。
 *
 * **送るのは訓練の数値だけ。** 氏名・メモ・自由記述は入れない。
 * 端末の外に出るものなので、入れる項目を増やすときは必ず本人の了解を取ること。
 */
import { diffDays, fmtTime } from "./dates";

/** 画面にそのまま並べられる単位。ここに無いものは送られない */
export interface AssistantContextSection {
  id: string;
  title: string;
  lines: string[];
}

export interface AssistantContext {
  today: string;
  sections: AssistantContextSection[];
  /**
   * 実際に送る文字列。
   * **必ず sections から組み立てる。** 別々に作ると「画面に出したもの」と
   * 「送ったもの」が静かにズレる。ズレると、何を送ったのか本人が確認できなくなる。
   */
  text: string;
  /** 送れない場合の理由。設定が終わっていないときなど */
  blocked?: string;
}

export interface AssistantSessionInput {
  date: string;
  timeOfDay?: string;
  category: string;
  name: string;
  prescription: string;
  status: string;
  phase?: string;
  riskLevel?: string;
  targetPaces?: { distanceM: number; targetSecFast: number; targetSecSlow: number; isEstimated?: boolean }[];
  selectionReasons?: string[];
  confidence?: string;
}

export interface AssistantResultInput {
  date: string;
  sessionName: string;
  category: string;
  lapsSec: number[];
  lapDistancesM?: number[];
  rpe: number;
  achievement: string;
  completedReps?: number;
  prescribedReps?: number;
  aborted?: boolean;
  /** 途中でやめた理由。何が起きたかだけでなく、なぜ止めたかを相談相手に渡す */
  abortCauseLabel?: string;
}

export interface AssistantContextInput {
  today: string;
  pb800Sec?: number;
  goal?: { targetTimeSec: number; raceDate?: string; raceName?: string };
  cfe?: {
    estimated800mSec: number;
    confidence: number;
    lastUpdated: string;
    history: { date: string; before: number; after: number; source: string }[];
  };
  phase?: string;
  /**
   * 練習の組み方。
   *
   * 送っていなかったので、**冬季モードで相談してもレースに向けた期分けの前提で
   * 答えが返っていた**。10日周期で組んでいても週7日前提で返っていた。
   * 送っている文脈が実態とずれていると、答えは噛み合わない。
   */
  structure?: {
    /** N日周期で組んでいるなら「10日周期（1日目が起点）」のような説明 */
    cycle?: string;
    /** 冬季・基礎構築モードなら、そのブロックと理由 */
    offSeason?: { label: string; reason: string };
  };
  todaySessions: AssistantSessionInput[];
  upcomingSessions: AssistantSessionInput[];
  recentResults: AssistantResultInput[];
  violations: { rule: string; level: string; message: string }[];
  limiter?: { limiter: string; narrative: string; appliedNote?: string };
  coverage?: { narrative: string; weeks: number };
  /** CFEに反映できた最後の練習日。空白が長いと鈍化するので、その理由を説明できるように */
  lastCfeSourceDate?: string;
}

/** 履歴は直近だけ送る。全部送っても読めないし、古い分は今の疑問に答えない */
export const CFE_HISTORY_LINES = 6;
/** 直近の結果もここまで。1か月ぶんあれば「なぜ今この設定か」は説明できる */
export const RECENT_RESULT_LINES = 10;
/** 先の予定はこの日数まで。確定範囲（14日）と揃える */
export const UPCOMING_DAYS = 14;

function paceLine(s: AssistantSessionInput): string {
  const paces = (s.targetPaces ?? []).map(
    (p) =>
      `${p.distanceM}m ${fmtTime(p.targetSecFast)}〜${fmtTime(p.targetSecSlow)}` +
      // 推定であることは落とさない。実測と推定を混ぜて説明されると根拠を追えなくなる
      (p.isEstimated ? "（推定）" : "")
  );
  return paces.length > 0 ? `設定: ${paces.join(" / ")}` : "";
}

function sessionLines(s: AssistantSessionInput, withReasons: boolean): string[] {
  const when = s.timeOfDay === "am" ? "午前" : s.timeOfDay === "pm" ? "午後" : "";
  const head = `${s.date}${when ? `（${when}）` : ""} ${s.name}［${s.category}／${s.status}］`;
  const out = [head];
  if (s.prescription) out.push(`  ${s.prescription}`);
  const pace = paceLine(s);
  if (pace) out.push(`  ${pace}`);
  if (s.riskLevel) out.push(`  リスク: ${s.riskLevel}`);
  if (withReasons) {
    const reasons = s.selectionReasons ?? [];
    if (reasons.length > 0) {
      out.push(`  この日にこれを選んだ理由（生成器の記録）:`);
      for (const r of reasons) out.push(`    - ${r}`);
      if (s.confidence) out.push(`    （生成器の確信度: ${s.confidence}）`);
    } else {
      // 「理由が無い」ことも情報。手で足した予定か、古いデータかの区別がつく
      out.push(`  この日にこれを選んだ理由の記録は残っていません（手動追加または旧データ）`);
    }
  }
  return out;
}

function resultLine(r: AssistantResultInput): string {
  const laps = r.lapsSec.map((t) => fmtTime(t)).join(" / ");
  const dists = r.lapDistancesM && r.lapDistancesM.length > 0 ? `${[...new Set(r.lapDistancesM)].join("・")}m ` : "";
  const reps =
    r.completedReps !== undefined && r.prescribedReps !== undefined && r.completedReps !== r.prescribedReps
      ? ` 実施${r.completedReps}/${r.prescribedReps}本`
      : "";
  const aborted = r.aborted
    ? r.abortCauseLabel
      ? ` ※打ち切り（${r.abortCauseLabel}）`
      : " ※中止基準で打ち切り"
    : "";
  return `${r.date} ${r.sessionName}［${r.category}］ ${dists}${laps} RPE${r.rpe} ${r.achievement}${reps}${aborted}`;
}

/**
 * 送る文脈を作る。純関数。
 *
 * 引数が同じなら結果も必ず同じ。時刻もランダムも読まない。
 */
export function buildAssistantContext(input: AssistantContextInput): AssistantContext {
  const sections: AssistantContextSection[] = [];

  // ---- 目標と現在地 ----
  const basics: string[] = [`今日: ${input.today}`];
  if (input.pb800Sec !== undefined) basics.push(`800m自己ベスト: ${fmtTime(input.pb800Sec)}`);
  if (input.goal) {
    const race = input.goal.raceDate
      ? `${input.goal.raceDate}${input.goal.raceName ? `（${input.goal.raceName}）` : ""}`
      : "未設定";
    const days = input.goal.raceDate ? diffDays(input.today, input.goal.raceDate) : undefined;
    basics.push(`目標: ${fmtTime(input.goal.targetTimeSec)}`);
    basics.push(`目標レース: ${race}${days !== undefined ? `（あと${days}日）` : ""}`);
  }
  if (input.phase) basics.push(`現在のフェーズ: ${input.phase}`);
  /*
   * 組み方は「目標と現在地」に入れる。別の節にすると、
   * 目標レースが無いこと（冬季）と期分けの話が離れて読まれる。
   */
  if (input.structure?.cycle) {
    basics.push(`練習の組み方: ${input.structure.cycle}（曜日ではなく日数の周期で組んでいる）`);
  }
  if (input.structure?.offSeason) {
    basics.push(
      `冬季・基礎構築モード（目標レース未定・ピーキングしない）: ${input.structure.offSeason.label}`
    );
    basics.push(`このブロックの狙い: ${input.structure.offSeason.reason}`);
  }
  sections.push({ id: "basics", title: "目標と現在地", lines: basics });

  // ---- CFE ----
  const cfeLines: string[] = [];
  if (input.cfe) {
    cfeLines.push(`推定800mタイム(CFE): ${fmtTime(input.cfe.estimated800mSec)}`);
    cfeLines.push(`確信度: ${input.cfe.confidence.toFixed(2)}`);
    cfeLines.push(`最終更新: ${input.cfe.lastUpdated}`);
    if (input.lastCfeSourceDate) {
      cfeLines.push(`CFEに反映できた最後の練習: ${input.lastCfeSourceDate}`);
    }
    const history = input.cfe.history.slice(-CFE_HISTORY_LINES);
    if (history.length > 0) {
      cfeLines.push(`更新履歴（新しいものが下。全${input.cfe.history.length}件のうち直近${history.length}件）:`);
      for (const h of history) {
        const delta = h.after - h.before;
        const sign = delta > 0 ? "+" : "";
        cfeLines.push(
          `  ${h.date} ${fmtTime(h.before)} → ${fmtTime(h.after)}（${sign}${delta.toFixed(2)}秒）: ${h.source}`
        );
      }
    } else {
      cfeLines.push("更新履歴はまだありません（初期値のまま）");
    }
  } else {
    cfeLines.push("CFEはまだ算出されていません。");
  }
  sections.push({ id: "cfe", title: "推定800mタイム(CFE)とその履歴", lines: cfeLines });

  // ---- 今日 ----
  const todayLines: string[] =
    input.todaySessions.length === 0
      ? ["今日の予定はありません。"]
      : input.todaySessions.flatMap((s) => sessionLines(s, true));
  sections.push({ id: "today", title: "今日の予定と、それが選ばれた理由", lines: todayLines });

  // ---- これからの予定 ----
  const upcoming = input.upcomingSessions.filter(
    (s) => diffDays(input.today, s.date) > 0 && diffDays(input.today, s.date) <= UPCOMING_DAYS
  );
  sections.push({
    id: "upcoming",
    title: `これから${UPCOMING_DAYS}日の予定`,
    lines: upcoming.length === 0 ? ["予定はありません。"] : upcoming.flatMap((s) => sessionLines(s, false)),
  });

  // ---- 直近の結果 ----
  const results = input.recentResults.slice(-RECENT_RESULT_LINES);
  sections.push({
    id: "results",
    title: `直近の練習結果（新しいものが下・最大${RECENT_RESULT_LINES}件）`,
    lines: results.length === 0 ? ["記録された結果はありません。"] : results.map(resultLine),
  });

  // ---- 警告 ----
  sections.push({
    id: "violations",
    title: "いま出ている警告（ルールエンジンの判定）",
    lines:
      input.violations.length === 0
        ? ["警告はありません。"]
        : input.violations.map((v) => `[${v.level}] ${v.rule}: ${v.message}`),
  });

  // ---- 弱点と配分 ----
  const limiterLines: string[] = [];
  if (input.limiter) {
    limiterLines.push(`判定: ${input.limiter.limiter}`);
    if (input.limiter.narrative) limiterLines.push(input.limiter.narrative);
    if (input.limiter.appliedNote) limiterLines.push(input.limiter.appliedNote);
  }
  if (input.coverage) {
    limiterLines.push(`直近${input.coverage.weeks}週の配分: ${input.coverage.narrative}`);
  }
  if (limiterLines.length === 0) limiterLines.push("判定に足りるデータがまだありません。");
  sections.push({ id: "limiter", title: "弱点の判定と練習配分", lines: limiterLines });

  const text = sections
    .map((s) => `## ${s.title}\n${s.lines.join("\n")}`)
    .join("\n\n");

  const blocked =
    input.pb800Sec === undefined
      ? "先に選手情報（800mの自己ベスト）を登録してください。登録するまで送れる中身がありません。"
      : undefined;

  return { today: input.today, sections, text, blocked };
}

/**
 * LLMへの指示。
 *
 * ここで縛っているのは3つ。
 *   1. 渡した文脈の外から数値を作らない（読めなかったものを推測で埋めない、と同じ原則）
 *   2. 新しい設定ペースやCFEを提案しない（決めるのはコア。ここで別の数字が出ると本人が混乱する）
 *   3. きつい練習を良い練習として褒めない（FORGEはRPEの高さを加点にしない）
 */
export const ASSISTANT_SYSTEM_PROMPT = [
  "あなたは800m走者のトレーニング管理アプリ「FORGE」の中で、本人の質問に答える相談相手です。",
  "利用者は800m一種目に絞って練習している競技者本人です。",
  "",
  "答えるときの決まり:",
  "- 与えられた文脈に書かれていることだけを根拠にしてください。書かれていない数値を推測で作らないでください。",
  "- 分からないことは「その情報はアプリから渡されていません」と正直に言ってください。",
  "- 新しい設定ペースやCFEの値を提案しないでください。それらはアプリが決定的な計算で出しています。あなたの役割は、なぜその値になっているかを文脈から説明することです。",
  "- 数値を挙げるときは、文脈のどの行を根拠にしたかが分かるように書いてください。",
  "- RPEの高さや「きつかったこと」を良い練習として評価しないでください。狙いどおりに実行できたかで見てください。",
  "- 日本語で、結論から短く答えてください。前置き・繰り返し・箇条書きの多用は避けてください。",
].join("\n");

/** 送る本文（文脈＋質問）。ここも1か所にまとめて、画面表示と食い違わないようにする */
export function assistantUserMessage(context: AssistantContext, question: string): string {
  return `# 今のデータ\n\n${context.text}\n\n# 質問\n\n${question}`;
}
