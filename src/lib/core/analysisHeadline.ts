/**
 * 分析画面の一番上に出す3つ。
 *
 * これまで「課題」「判定材料」「4週間の変更」「不足データ」が**同じ強さで並んでいた**。
 * どれも読める代わりに、どれが結論なのかが分からない。
 *
 * 分析は練習前に3秒で読むものではないが、
 * **結論を先に把握できる**必要はある。順番を決める:
 *
 *   1. 最大の課題（いま何が足りていないか）
 *   2. 今週変えること（そのために何をするか）
 *   3. 現在のリスク（やっていいのか）
 *
 * 根拠（400m/1500mからの推定・変更理由・使った記録・信頼度）は畳む。
 * 数字を疑うときにだけ開けばいい。
 *
 * ---
 *
 * **ここでは何も判定しない。** 制限因子は `limiter.ts`、配分は `coverage.ts`、
 * 負荷は `load.ts` が決めている。この関数は並べ替えて短く言い直すだけ。
 * 判定を持たせると、同じことを2か所で決めることになる。
 */
import type { SessionCategory } from "./types";

/** 不足しているデータ。**別々の大きなカードにせず1つにまとめる** */
export interface MissingDataItem {
  label: string;
  detail: string;
}

export interface AnalysisHeadline {
  /** 最大の課題。判定できないときはそう言う */
  problem: string;
  /** 今週変えること。無ければ空（「変えなくていい」を伝えるのは呼ぶ側） */
  actions: string[];
  /** 現在のリスク */
  risk: string;
  riskLevel: "unknown" | "ok" | "watch" | "high";
  /** 足りていないデータ。1つのカードに統合して出す */
  missing: MissingDataItem[];
}

export interface AnalysisHeadlineInput {
  /** `limiter.ts` の判定。日本語の表示名まで済んだもの */
  limiterLabel?: string;
  /** `coverage.ts` の目標。不足しているものだけ使う */
  targets?: { category: SessionCategory; shortfall: number }[];
  categoryLabels: Record<string, string>;
  /** `load.ts` の ACWR */
  acwr?: { rating: string; label: string };
  /** 600m通過の材料。足りているか、あと何本要るか */
  split?: { enough: boolean; have: number; need: number };
  /** 接地時間の記録があるか */
  hasContactSamples?: boolean;
  /** 最大心拍の基準があるか */
  hasHrMaxReference?: boolean;
}

/**
 * リスクの言い方。
 *
 * **「危険」と書かない。** ACWRは補助指標で、これ単体で練習をやめる判断はしない。
 * 「積み上がっている」までにとどめ、判断は本人に残す。
 */
const RISK_TEXT: Record<string, { text: string; level: AnalysisHeadline["riskLevel"] }> = {
  insufficient_data: { text: "負荷の記録が足りず、まだ出せません", level: "unknown" },
  low: { text: "負荷は低め", level: "ok" },
  optimal: { text: "負荷は妥当な範囲", level: "ok" },
  caution: { text: "負荷が上がってきています", level: "watch" },
  high_risk: { text: "負荷が急に増えています", level: "high" },
};

export function analysisHeadline(input: AnalysisHeadlineInput): AnalysisHeadline {
  const problem = input.limiterLabel?.trim() || "判定できるだけの記録がまだありません";

  /*
   * 今週変えること。不足が多い順に、**回数で書く**。
   *
   * 割合（＋30%）にしないのは、持っている値が回数だからで、
   * 割合に直すには基準を決める必要がある。
   * 決めた基準が画面に出ないと、あとで「なぜ30%なのか」を追えない。
   */
  const actions = (input.targets ?? [])
    .filter((t) => t.shortfall > 0)
    .sort((a, b) => b.shortfall - a.shortfall)
    .map((t) => `${input.categoryLabels[t.category] ?? t.category} あと${t.shortfall}回`);

  const risk = input.acwr
    ? (RISK_TEXT[input.acwr.rating] ?? { text: input.acwr.label, level: "unknown" as const })
    : { text: "負荷の記録が足りず、まだ出せません", level: "unknown" as const };

  /*
   * 足りていないデータ。
   * **空欄を良い状態として扱わない**——「未記録」と書いて、
   * 何を入れれば出せるかが分かるようにする。
   */
  const missing: MissingDataItem[] = [];
  if (input.split && !input.split.enough) {
    const more = Math.max(0, input.split.need - input.split.have);
    missing.push({
      label: "600m通過",
      detail: more > 0 ? `あと${more}本` : "材料が足りません",
    });
  }
  if (input.hasContactSamples === false) {
    missing.push({ label: "接地時間", detail: "未記録" });
  }
  if (input.hasHrMaxReference === false) {
    missing.push({ label: "最大心拍", detail: "基準未設定" });
  }

  return { problem, actions, risk: risk.text, riskLevel: risk.level, missing };
}
