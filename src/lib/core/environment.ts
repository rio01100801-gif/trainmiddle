/**
 * 2-1. 環境条件とWBGT（暑さ指数）推定
 *
 * 屋外の正式なWBGTは黒球温度・湿球温度の実測が必要だが、
 * 一般ランナーが持っている情報は気温と湿度だけである。
 * ここでは気温・湿度から推定する近似式を使い、
 * 「推定値である」ことを必ず明示する。
 *
 * 採用式: 日本国内で広く使われている簡易推定（気温Tと相対湿度RHからの回帰）
 *   WBGT ≈ 0.735·T + 0.0374·RH + 0.00292·T·RH − 4.064
 * 屋外・日射下を想定した近似のため、屋内やトラックの日陰では過大評価になりうる。
 */

export type Wind = "calm" | "light" | "strong";

export interface EnvironmentConditions {
  tempC?: number;
  humidityPct?: number;
  wind?: Wind;
  /** 風向（任意。"北西"などの自由記述） */
  windDirection?: string;
  rain?: boolean;
}

export const WIND_LABELS: Record<Wind, string> = {
  calm: "無風",
  light: "微風",
  strong: "強風",
};

/** WBGTの区分（日本スポーツ協会の熱中症予防運動指針に対応） */
export type WbgtLevel = "safe" | "caution" | "warning" | "severe" | "danger";

export const WBGT_LEVEL_LABELS: Record<WbgtLevel, string> = {
  safe: "ほぼ安全",
  caution: "注意",
  warning: "警戒",
  severe: "厳重警戒",
  danger: "運動は原則中止",
};

export interface WbgtResult {
  wbgt: number;
  level: WbgtLevel;
  /** 暑熱条件フラグ。true の練習はペース比較・能力推定から除外する */
  isHeatFlagged: boolean;
  note: string;
}

/** 気温・湿度からWBGTを推定する（推定値であることを前提に扱うこと） */
export function estimateWbgt(tempC: number, humidityPct: number): number {
  const t = tempC;
  const rh = humidityPct;
  return 0.735 * t + 0.0374 * rh + 0.00292 * t * rh - 4.064;
}

export function wbgtLevel(wbgt: number): WbgtLevel {
  if (wbgt >= 31) return "danger";
  if (wbgt >= 28) return "severe";
  if (wbgt >= 25) return "warning";
  if (wbgt >= 21) return "caution";
  return "safe";
}

/**
 * 暑熱条件フラグの判定。
 *
 * 判定条件: 推定WBGT 25以上（警戒域）**または** 気温28℃以上。
 *
 * 気温28℃をORで併用する理由は2つある。
 *  ① この採用式は日射を含まない近似のため、屋外トラックの日向では実際のWBGTより
 *     低めに出る（28℃/湿度60%で23.7と算出され、警戒域に届かない）。
 *  ② 既存のRULE-10が「気温28℃以上」を暑熱の境界にしており、
 *     湿度の有無で判定が食い違うと、同じ練習に対して警告と除外の扱いが矛盾する。
 * 暑熱耐性の低い選手を想定し、安全側（フラグを立てる側）に倒している。
 */
export const HEAT_FLAG_WBGT_THRESHOLD = 25;
export const HEAT_FLAG_TEMP_THRESHOLD = 28;

export function evaluateEnvironment(env: EnvironmentConditions): WbgtResult | undefined {
  const { tempC, humidityPct } = env;
  if (tempC === undefined) return undefined;

  if (humidityPct === undefined) {
    const flagged = tempC >= HEAT_FLAG_TEMP_THRESHOLD;
    return {
      wbgt: NaN,
      level: flagged ? "severe" : "caution",
      isHeatFlagged: flagged,
      note: `湿度未入力のため気温${tempC}℃のみで判定（WBGT未算出）。湿度を入れると精度が上がります。`,
    };
  }

  const wbgt = estimateWbgt(tempC, humidityPct);
  const level = wbgtLevel(wbgt);
  const byWbgt = wbgt >= HEAT_FLAG_WBGT_THRESHOLD;
  const byTemp = tempC >= HEAT_FLAG_TEMP_THRESHOLD;
  const isHeatFlagged = byWbgt || byTemp;
  const why = byWbgt
    ? `推定WBGT ${wbgt.toFixed(1)}が警戒域(25)以上`
    : `気温${tempC}℃が28℃以上（この式は日射を含まないため、屋外の日向では実際のWBGTはこれより高くなります）`;
  return {
    wbgt,
    level,
    isHeatFlagged,
    note: `推定WBGT ${wbgt.toFixed(1)}（${WBGT_LEVEL_LABELS[level]}）。気温${tempC}℃・湿度${humidityPct}%からの推定値です。${
      isHeatFlagged ? `暑熱条件フラグ: ${why}。この練習はペース比較・能力推定から除外されます。` : ""
    }`,
  };
}

/**
 * 風・雨による補正の目安（表示用。自動でペースを書き換えることはしない）。
 * 「条件が悪かったのに達成できなかった」を実力低下と誤認しないための材料。
 */
export function environmentNote(env: EnvironmentConditions): string[] {
  const notes: string[] = [];
  if (env.wind === "strong") {
    notes.push("強風: 400mトラックでは向かい風区間で1周あたり1〜2秒の遅れが出ます。達成度の判定を緩めてください。");
  }
  if (env.rain) {
    notes.push("雨: 接地の安定性が落ちるため、設定どおりでも体感強度は上がります。");
  }
  const w = evaluateEnvironment(env);
  if (w?.isHeatFlagged) {
    notes.push(w.note);
  }
  return notes;
}
