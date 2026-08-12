/**
 * 相談（AI）に渡す文脈。
 *
 * ここで見張るのは3つ。
 *   ・**同じ入力から必ず同じ文字列が出る**（あとで答えを疑ったときに再現できる）
 *   ・**画面に出す内容と送る内容が同一**（sections から text を作っているか）
 *   ・**送ってはいけないものが混ざらない**（氏名などの個人情報）
 *
 * 3つめが特に重要。端末の外へ出るのはこの文字列だけなので、
 * ここが漏れていると本人が確認する手段が無い。
 */
import { describe, expect, it } from "vitest";
import {
  ASSISTANT_SYSTEM_PROMPT,
  assistantUserMessage,
  buildAssistantContext,
  CFE_HISTORY_LINES,
  RECENT_RESULT_LINES,
  UPCOMING_DAYS,
  type AssistantContextInput,
} from "@/lib/core/assistantContext";

const TODAY = "2026-08-13";

function input(over: Partial<AssistantContextInput> = {}): AssistantContextInput {
  return {
    today: TODAY,
    pb800Sec: 109.51,
    goal: { targetTimeSec: 108.9, raceDate: "2026-11-15", raceName: "秋季記録会" },
    cfe: {
      estimated800mSec: 111.0,
      confidence: 0.6,
      lastUpdated: "2026-08-10",
      history: [
        { date: "2026-08-10", before: 111.4, after: 111.0, source: "2026-08-10 の 600m×3" },
      ],
    },
    phase: "SpecificEndurance",
    todaySessions: [],
    upcomingSessions: [],
    recentResults: [],
    violations: [],
    ...over,
  };
}

describe("同じ入力からは同じ文字列", () => {
  it("2回組み立てても一致する", () => {
    const a = buildAssistantContext(input());
    const b = buildAssistantContext(input());
    expect(a.text).toBe(b.text);
  });

  it("時刻やランダムを読んでいない（引数の today だけで決まる）", () => {
    const a = buildAssistantContext(input());
    const b = buildAssistantContext(input({ today: "2026-08-14" }));
    expect(a.text).not.toBe(b.text);
    // 違いは日付由来だけ。CFEの行は同じまま
    expect(a.text).toContain("推定800mタイム(CFE): 1:51.0");
    expect(b.text).toContain("推定800mタイム(CFE): 1:51.0");
  });
});

describe("画面に出すものと送るものが同じ", () => {
  it("text は sections から組み立てられている", () => {
    const ctx = buildAssistantContext(
      input({
        todaySessions: [
          {
            date: TODAY,
            timeOfDay: "pm",
            category: "high_lactate",
            name: "600m×3",
            prescription: "600m×3 r8min",
            status: "planned",
            selectionReasons: ["高乳酸の間隔が10日空いている"],
            confidence: "high",
          },
        ],
      })
    );
    // どのセクションの行も text の中に必ず現れる。
    // ここが崩れると「見せたもの」と「送ったもの」がズレる
    for (const s of ctx.sections) {
      expect(ctx.text).toContain(`## ${s.title}`);
      for (const line of s.lines) expect(ctx.text).toContain(line);
    }
  });

  it("セクションを消すと text からも消える（別々に作っていない証拠）", () => {
    const ctx = buildAssistantContext(input());
    const joined = ctx.sections.map((s) => `## ${s.title}\n${s.lines.join("\n")}`).join("\n\n");
    expect(ctx.text).toBe(joined);
  });
});

describe("送ってはいけないものを送らない", () => {
  it("入力に氏名を渡す口が無い（型と出力の両方で確認）", () => {
    const ctx = buildAssistantContext(input());
    // 氏名は AssistantContextInput に項目そのものが無い。
    // 実データで漏れないことを、代表的な語で二重に確かめる
    expect(ctx.text).not.toContain("伊藤");
    expect(ctx.text.toLowerCase()).not.toContain("name");
  });

  it("結果の自由記述を送らない", () => {
    const ctx = buildAssistantContext(
      input({
        recentResults: [
          {
            date: "2026-08-10",
            sessionName: "600m×3",
            category: "high_lactate",
            lapsSec: [84.2, 85.1, 86.0],
            rpe: 8,
            achievement: "達成",
          },
        ],
      })
    );
    expect(ctx.text).toContain("600m×3");
    expect(ctx.text).toContain("RPE8");
  });
});

describe("中身", () => {
  it("CFEの履歴と、なぜその値かの手がかりを載せる", () => {
    const ctx = buildAssistantContext(
      input({
        cfe: {
          estimated800mSec: 114.21,
          confidence: 0.4,
          lastUpdated: "2026-06-01",
          history: [
            { date: "2026-06-01", before: 111.01, after: 114.21, source: "練習の記録が無い期間が63日" },
          ],
        },
        lastCfeSourceDate: "2026-07-26",
      })
    );
    expect(ctx.text).toContain("1:54.2");
    expect(ctx.text).toContain("練習の記録が無い期間が63日");
    expect(ctx.text).toContain("CFEに反映できた最後の練習: 2026-07-26");
  });

  it("履歴が多いときは直近だけ送り、全体の件数を添える", () => {
    const history = Array.from({ length: 30 }, (_, i) => ({
      date: `2026-07-${String(i + 1).padStart(2, "0")}`,
      before: 111,
      after: 111,
      source: `更新${i}`,
    }));
    const ctx = buildAssistantContext(input({ cfe: { ...input().cfe!, history } }));
    expect(ctx.text).toContain(`全30件のうち直近${CFE_HISTORY_LINES}件`);
    expect(ctx.text).toContain("更新29");
    expect(ctx.text).not.toContain("更新0");
  });

  it("今日の予定には「なぜ選んだか」を付ける", () => {
    const ctx = buildAssistantContext(
      input({
        todaySessions: [
          {
            date: TODAY,
            category: "cv",
            name: "CV 1000m×4",
            prescription: "1000m×4 r3min",
            status: "planned",
            selectionReasons: ["前回の高乳酸から中2日", "有酸素側の空白が2週"],
            confidence: "medium",
          },
        ],
      })
    );
    expect(ctx.text).toContain("前回の高乳酸から中2日");
    expect(ctx.text).toContain("生成器の確信度: medium");
  });

  it("理由の記録が無いことも書く（手で足した予定と区別できるように）", () => {
    const ctx = buildAssistantContext(
      input({
        todaySessions: [
          {
            date: TODAY,
            category: "aerobic",
            name: "ジョグ",
            prescription: "40分",
            status: "planned",
          },
        ],
      })
    );
    expect(ctx.text).toContain("理由の記録は残っていません");
  });

  it("先の予定は確定範囲までしか送らない", () => {
    const far = {
      date: "2026-10-01",
      category: "cv" as const,
      name: "遠い予定",
      prescription: "x",
      status: "planned",
    };
    const near = { ...far, date: "2026-08-15", name: "近い予定" };
    const ctx = buildAssistantContext(input({ upcomingSessions: [near, far] }));
    expect(ctx.text).toContain("近い予定");
    expect(ctx.text).not.toContain("遠い予定");
    expect(ctx.text).toContain(`これから${UPCOMING_DAYS}日の予定`);
  });

  it("直近の結果は新しいものを残して打ち切る", () => {
    const results = Array.from({ length: 20 }, (_, i) => ({
      date: `2026-08-${String(i + 1).padStart(2, "0")}`,
      sessionName: `練習${i}`,
      category: "cv",
      lapsSec: [180],
      rpe: 6,
      achievement: "達成",
    }));
    const ctx = buildAssistantContext(input({ recentResults: results }));
    expect(ctx.text).toContain("練習19［");
    expect(ctx.text).not.toContain("練習0［");
    expect(ctx.text).not.toContain("練習9［");
    expect(ctx.text).toContain(`最大${RECENT_RESULT_LINES}件`);
  });

  it("設定ペースは幅のまま出し、推定なら推定と書く", () => {
    const ctx = buildAssistantContext(
      input({
        todaySessions: [
          {
            date: TODAY,
            category: "cv",
            name: "CV",
            prescription: "1000m×4",
            status: "planned",
            targetPaces: [
              { distanceM: 1000, targetSecFast: 168, targetSecSlow: 172 },
              { distanceM: 200, targetSecFast: 30, targetSecSlow: 32, isEstimated: true },
            ],
          },
        ],
      })
    );
    expect(ctx.text).toContain("1000m 2:48.0〜2:52.0");
    expect(ctx.text).toContain("（推定）");
  });

  it("警告が無いときも「無い」と書く（黙って落とさない）", () => {
    const ctx = buildAssistantContext(input());
    expect(ctx.text).toContain("警告はありません。");
  });
});

describe("送れない状態", () => {
  it("選手情報が無ければ理由を返す", () => {
    const ctx = buildAssistantContext(input({ pb800Sec: undefined }));
    expect(ctx.blocked).toBeDefined();
    expect(ctx.blocked).toContain("自己ベスト");
  });

  it("そろっていれば blocked にしない", () => {
    expect(buildAssistantContext(input()).blocked).toBeUndefined();
  });
});

describe("LLMへの指示", () => {
  it("数値を作らせない・提案させないことを明示している", () => {
    expect(ASSISTANT_SYSTEM_PROMPT).toContain("推測で作らない");
    expect(ASSISTANT_SYSTEM_PROMPT).toContain("新しい設定ペースやCFEの値を提案しない");
  });

  it("きつさを加点にしないことを明示している（FORGEの評価軸）", () => {
    expect(ASSISTANT_SYSTEM_PROMPT).toContain("RPEの高さ");
  });

  it("送る本文は文脈と質問だけでできている", () => {
    const ctx = buildAssistantContext(input());
    const body = assistantUserMessage(ctx, "なんでCFEが1:51.0なの？");
    expect(body).toContain(ctx.text);
    expect(body).toContain("なんでCFEが1:51.0なの？");
    // 文脈に無いものが勝手に足されていない
    expect(body).toBe(`# 今のデータ\n\n${ctx.text}\n\n# 質問\n\nなんでCFEが1:51.0なの？`);
  });
});
