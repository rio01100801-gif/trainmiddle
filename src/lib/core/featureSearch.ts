/**
 * 機能検索。「どこに何があるか」を探せるようにする。
 *
 * 画面が増えた結果、設定の中にある機能（現在地の測定・書き出し・FIT取込など）に
 * 辿り着けなくなっていた。実際、CFEが感覚とズレたときに直す手段
 * （過去データ → 現在地の測定）があるのに、その存在自体が埋もれていた。
 *
 * **LLMは使わない。** 同じ入力からは必ず同じ結果が出る。
 * あとで「なぜこれが出たのか」を追えないと、検索結果を信じられなくなる。
 * 一致した理由（matchedOn）も返すのはそのため。
 *
 * カタログは手で持つ。画面から自動収集しないのは、
 * 「何ができるか」は画面名ではなく本人の言葉（「タイムが合ってない」等）で
 * 引けないと意味がないため。keywords はその言い換えを入れる場所。
 */

export interface Feature {
  id: string;
  /** 画面に出す名前 */
  label: string;
  /** 何ができるか。1行 */
  description: string;
  /** 行き先。ハッシュルーティングのパス（例: "/past"） */
  href: string;
  /** 行った先のどこにあるか。画面の中の機能はここで補う */
  where?: string;
  /** 本人が使いそうな言い換え。ここが検索の主戦力 */
  keywords: string[];
}

/**
 * ひらがな・カタカナ・大文字小文字・記号の違いを吸収する。
 * 「CFE」「cfe」「ｃｆｅ」、「ペース」「ぺーす」を同じに扱う。
 */
export function normalizeQuery(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/[\s・、。,.\-_/]/g, "");
}

export const FEATURES: Feature[] = [
  // ---- 主要4画面 ----
  {
    id: "today",
    label: "ホーム（TODAY）",
    description: "今日やる練習と、やるかどうかの判断材料",
    href: "/",
    keywords: ["today", "ホーム", "今日", "きょう", "今日の練習", "準備度", "回復", "recovery"],
  },
  {
    id: "calendar",
    label: "カレンダー（PLAN）",
    description: "予定の確認・日付の移動・練習の追加",
    href: "/calendar",
    keywords: ["plan", "カレンダー", "予定", "日程", "スケジュール", "移動", "week", "月表示"],
  },
  {
    id: "results",
    label: "記録（RECORD）",
    description: "練習結果の入力と、過去の記録の確認・削除",
    href: "/results",
    keywords: ["record", "記録", "入力", "結果", "タイム入力", "ラップ", "削除"],
  },
  {
    id: "analysis",
    label: "分析（ANALYTICS）",
    description: "現在地・レース分析・4週間のバランス",
    href: "/analysis",
    keywords: ["analytics", "分析", "グラフ", "推移", "パフォーマンス", "現在地"],
  },

  // ---- CFE まわり（いちばん探されるはず） ----
  {
    id: "refit-cfe",
    label: "現在地の測定（CFEを測り直す）",
    description: "過去の実測タイムから今の800m能力を測り直し、CFEに反映する",
    href: "/past",
    where: "過去データの一括入力 → 「現在地を測る」",
    keywords: [
      "cfe", "推定タイム", "推定800m", "800m", "現在地", "測り直し", "測定", "測る",
      "合ってない", "ずれてる", "ズレ", "おかしい", "遅い", "速い", "実力", "能力",
      "フィットネス", "fitness",
    ],
  },
  {
    id: "past",
    label: "過去データの一括入力",
    description: "これまでの練習を文章のまま貼り付けて取り込む",
    href: "/past",
    keywords: [
      "過去", "一括", "まとめて", "貼り付け", "ペースト", "インポート", "取り込み",
      "日誌", "ログ", "履歴", "backfill",
    ],
  },
  {
    id: "goal",
    label: "目標・レース",
    description: "目標タイムと出場レースの登録。プランの再生成もここ",
    href: "/goal",
    keywords: [
      "目標", "ゴール", "goal", "レース", "race", "試合", "大会", "target",
      "再生成", "プラン生成", "作り直し", "メニュー生成",
    ],
  },

  // ---- 設定の中 ----
  {
    id: "setup",
    label: "プロフィール",
    description: "PB・身長体重など。換算式の土台になる",
    href: "/setup",
    keywords: ["プロフィール", "profile", "pb", "自己ベスト", "選手", "身長", "体重", "400m", "1500m"],
  },
  {
    id: "plan-settings",
    label: "メニュー設定",
    description: "曜日ごとの枠、自作メニューの登録、他選手メニューの換算",
    href: "/plan-settings",
    keywords: [
      "メニュー", "曜日", "固定", "テンプレート", "自作", "オリジナル", "登録",
      "他の選手", "換算", "借りる", "設定ペース",
    ],
  },
  {
    id: "heat",
    label: "暑熱順化",
    description: "暑さへの慣らしの計画と、レース当日の暑さ対策",
    href: "/heat",
    keywords: ["暑熱", "暑さ", "暑い", "熱", "wbgt", "気温", "夏", "順化", "heat"],
  },
  {
    id: "data",
    label: "データ管理",
    description: "書き出し・復元、FITファイルの取り込み、接地時間の取り込み",
    href: "/data",
    keywords: [
      "データ", "バックアップ", "書き出し", "書出", "エクスポート", "export",
      "復元", "インポート", "import", "fit", "ガーミン", "garmin", "時計",
      "接地時間", "接地", "csv", "消えた", "移行",
    ],
  },
  {
    id: "sync",
    label: "同期（他の端末と）",
    description: "別の端末と記録を合わせる。接続診断もここ",
    href: "/sync",
    keywords: ["同期", "sync", "端末", "iphone", "pc", "クラウド", "supabase", "ログイン", "接続"],
  },
  {
    id: "diagnostics",
    label: "診断情報",
    description: "動いている版数と、不具合を追うための情報",
    href: "/diagnostics",
    keywords: ["診断", "バージョン", "版", "version", "不具合", "バグ", "調子が悪い", "更新されない"],
  },
  {
    id: "settings",
    label: "設定",
    description: "上のすべての入口",
    href: "/settings",
    keywords: ["設定", "せってい", "settings", "メニュー", "その他"],
  },

  // ---- 分析画面の中の機能 ----
  {
    id: "coverage",
    label: "4週間のバランス",
    description: "足りていないカテゴリと、予定を入れ替える提案",
    href: "/analysis",
    where: "分析 → 現在地",
    keywords: [
      "バランス", "配分", "足りない", "不足", "偏り", "入れ替え", "替える",
      "経済走", "高乳酸", "モデリング", "神経系",
    ],
  },
  {
    id: "weekly-review",
    label: "週次レビュー",
    description: "指導者にそのまま見せられる形の週まとめ",
    href: "/analysis",
    where: "分析 → 現在地の下",
    keywords: ["週次", "レビュー", "まとめ", "報告", "コーチ", "指導者", "先生", "提出"],
  },
  {
    id: "race-analysis",
    label: "レース分析",
    description: "前後半の落ち幅と、次のレースの配分案",
    href: "/race",
    keywords: ["レース分析", "配分", "ペース配分", "前半", "後半", "失速", "スプリット", "split"],
  },
  {
    id: "meet",
    label: "大会モード",
    description: "当日の予選・準決・決勝のあいだの過ごし方",
    href: "/meet",
    keywords: ["大会", "当日", "予選", "準決勝", "決勝", "ラウンド", "アップ", "meet"],
  },
  {
    id: "warnings",
    label: "警告一覧",
    description: "今のプランがルールに反している箇所",
    href: "/warnings",
    keywords: ["警告", "アラート", "ルール", "違反", "赤", "注意", "rule"],
  },
];

export interface FeatureHit {
  feature: Feature;
  score: number;
  /** なぜ一致したか（名前・言い換え・説明） */
  matchedOn: "label" | "keyword" | "description";
}

/**
 * 機能を探す。
 *
 * 完全一致 > 前方一致 > 部分一致 の順に強くする。
 * 同点のときはカタログの並び順を保つ（毎回同じ結果を返すため）。
 */
export function searchFeatures(query: string, limit = 8): FeatureHit[] {
  const q = normalizeQuery(query);
  if (q.length === 0) return [];

  const hits: FeatureHit[] = [];
  for (const feature of FEATURES) {
    const label = normalizeQuery(feature.label);
    const desc = normalizeQuery(feature.description);
    let best: FeatureHit | undefined;

    const consider = (score: number, matchedOn: FeatureHit["matchedOn"]) => {
      if (!best || score > best.score) best = { feature, score, matchedOn };
    };

    if (label === q) consider(100, "label");
    else if (label.startsWith(q)) consider(80, "label");
    else if (label.includes(q)) consider(60, "label");

    for (const k of feature.keywords) {
      const key = normalizeQuery(k);
      if (key === q) consider(70, "keyword");
      else if (key.startsWith(q)) consider(45, "keyword");
      else if (key.includes(q) || q.includes(key)) consider(30, "keyword");
    }

    if (desc.includes(q)) consider(15, "description");

    if (best) hits.push(best);
  }

  return hits
    .map((h, i) => ({ h, i }))
    .sort((a, b) => b.h.score - a.h.score || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.h);
}
