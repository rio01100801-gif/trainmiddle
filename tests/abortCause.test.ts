/**
 * 途中でやめた理由。
 *
 * 一番大事なのは **設定ペースの自動補正に何を数えるか**。
 * 打ち切りが2回続くと設定を緩める仕組みがあるので、
 * 電車の時間で止めた回数が混ざると、実力は落ちていないのに設定だけが下がり続ける。
 * 下がった設定なら当然こなせるので、下がったことに気づけない。
 *
 * ここで守るのは3つ。
 *   1. 設定・疲労で止めたときだけ数える
 *   2. 理由の無い旧データは今までどおり数える（静かに挙動を止めない）
 *   3. 理由が何であってもCFEは動かさない（打ち切りは能力低下ではない）
 */
import { describe, expect, it } from "vitest";
import {
  ABORT_CAUSES,
  abortCauseLabel,
  countsTowardPaceEase,
  describeAbortCause,
  isStrainCause,
  needsInjuryLog,
  normalizeAbortCause,
  type AbortCause,
} from "@/lib/core/abortCause";
import { executionTrend, type ExecutionSample } from "@/lib/core/adaptive";
import { memRepo } from "./sqlite-helper";
import {
  finishSessionProgress,
  processResult,
  regeneratePlan,
  saveSessionProgress,
  sessionProgress,
} from "@/lib/service";
import { makeRace, testAthlete } from "./helpers";
import type { Goal, SessionResult } from "@/lib/core/types";
import { buildWeeklyReview } from "@/lib/core/weeklyReview";
import { weekStart } from "@/lib/core/dates";

describe("理由の語彙", () => {
  it("IDが重複していない（過去の記録が指すため）", () => {
    const ids = ABORT_CAUSES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("8つそろっている", () => {
    expect(ABORT_CAUSES.map((c) => c.id)).toEqual([
      "pace",
      "fatigue",
      "pain",
      "too_fast",
      "taper",
      "condition",
      "schedule",
      "other",
    ]);
  });

  it("どれにも手がかりの一文がある（選ぶ前に扱いが分かるように）", () => {
    for (const c of ABORT_CAUSES) {
      expect(c.hint.length, c.id).toBeGreaterThan(5);
    }
  });

  it("一覧に無い値は捨てる", () => {
    expect(normalizeAbortCause("pace")).toBe("pace");
    for (const bad of ["nonsense", "", undefined, null, 3, {}]) {
      expect(normalizeAbortCause(bad)).toBeUndefined();
    }
  });
});

describe("設定を緩める材料に数えるか", () => {
  it("設定・疲労だけ数える", () => {
    expect(countsTowardPaceEase("pace")).toBe(true);
    expect(countsTowardPaceEase("fatigue")).toBe(true);
  });

  it("痛み・天候・時間・その他は数えない", () => {
    for (const c of ["pain", "condition", "schedule", "other", "too_fast", "taper"] as AbortCause[]) {
      expect(countsTowardPaceEase(c), c).toBe(false);
    }
  });

  it("未入力は数える（旧データの打ち切りは中止基準そのものだった）", () => {
    /*
     * ここを false に倒すと、これまでの打ち切りが一斉に無効になり、
     * 今動いている補正が静かに止まる。
     */
    expect(countsTowardPaceEase(undefined)).toBe(true);
  });
});

describe("体への負担として数えるか", () => {
  it("痛みは数える（設定の話ではないが体の話ではある）", () => {
    expect(isStrainCause("pain")).toBe(true);
    expect(countsTowardPaceEase("pain")).toBe(false);
  });

  it("天候・時間は数えない", () => {
    expect(isStrainCause("condition")).toBe(false);
    expect(isStrainCause("schedule")).toBe(false);
  });

  it("未入力は数える", () => {
    expect(isStrainCause(undefined)).toBe(true);
  });
});

describe("表示", () => {
  it("扱いまで書く（黙って数えない・数えるをしない）", () => {
    expect(describeAbortCause("pace")).toContain("材料に数えます");
    expect(describeAbortCause("condition")).toContain("数えません");
    expect(describeAbortCause(undefined)).toBe("");
  });

  it("その他は書いた内容を添える", () => {
    expect(describeAbortCause("other", "犬に追われた")).toContain("犬に追われた");
    // 空白だけなら括弧を出さない
    expect(describeAbortCause("other", "   ")).not.toContain("（");
  });

  it("痛みだけ故障ログを求める", () => {
    expect(needsInjuryLog("pain")).toBe(true);
    expect(needsInjuryLog("fatigue")).toBe(false);
    expect(needsInjuryLog(undefined)).toBe(false);
    expect(abortCauseLabel("pain")).toBe("痛み・違和感");
    expect(abortCauseLabel(undefined)).toBe("");
  });
});

// ---------------------------------------------------------------------------
// 設定ペースの補正（ここが本題）
// ---------------------------------------------------------------------------

function sample(over: Partial<ExecutionSample> = {}): ExecutionSample {
  return {
    date: "2026-08-10",
    sessionId: "s1",
    category: "high_lactate",
    distanceM: 300,
    targetSec: 41,
    actualMeanSec: 41.5,
    deviationSec: 0.5,
    ratio: 41.5 / 41,
    aborted: false,
    heatFlagged: false,
    achievement: "achieved",
    rpe: 7,
    ...over,
  };
}

describe("打ち切りから設定を緩めるか", () => {
  it("設定が高すぎたが2回続けば緩める", () => {
    const trend = executionTrend([
      sample({ aborted: true, abortCause: "pace" }),
      sample({ aborted: true, abortCause: "pace" }),
    ]);
    expect(trend.verdict).toBe("ease");
    expect(trend.paceAbortCount).toBe(2);
    expect(trend.factor).toBeGreaterThan(1);
  });

  it("疲労が残っていたも数える（今日出せる値は下がっている）", () => {
    const trend = executionTrend([
      sample({ aborted: true, abortCause: "fatigue" }),
      sample({ aborted: true, abortCause: "pace" }),
    ]);
    expect(trend.verdict).toBe("ease");
  });

  it("天候で2回止めても設定は下げない", () => {
    const trend = executionTrend([
      sample({ aborted: true, abortCause: "condition" }),
      sample({ aborted: true, abortCause: "condition" }),
    ]);
    expect(trend.abortCount).toBe(2);
    expect(trend.paceAbortCount).toBe(0);
    expect(trend.verdict).toBe("hold");
  });

  it("時間切れ・痛みでも下げない", () => {
    for (const c of ["schedule", "pain"] as AbortCause[]) {
      const trend = executionTrend([
        sample({ aborted: true, abortCause: c }),
        sample({ aborted: true, abortCause: c }),
      ]);
      expect(trend.verdict, c).toBe("hold");
    }
  });

  it("外的な理由が混ざると、体の理由だけでは足りなくなる", () => {
    // 設定1回＋天候1回では、設定が高いとは言えない
    const trend = executionTrend([
      sample({ aborted: true, abortCause: "pace" }),
      sample({ aborted: true, abortCause: "schedule" }),
    ]);
    expect(trend.abortCount).toBe(2);
    expect(trend.paceAbortCount).toBe(1);
    expect(trend.verdict).toBe("hold");
  });

  it("理由の無い旧データは今までどおり緩める", () => {
    const trend = executionTrend([sample({ aborted: true }), sample({ aborted: true })]);
    expect(trend.verdict).toBe("ease");
  });

  it("数えなかったぶんも理由の文に出す", () => {
    const trend = executionTrend([
      sample({ aborted: true, abortCause: "pace" }),
      sample({ aborted: true, abortCause: "pace" }),
      sample({ aborted: true, abortCause: "condition" }),
    ]);
    expect(trend.verdict).toBe("ease");
    expect(trend.reason).toContain("数えていません");
  });

  it("打ち切りが無ければ両方0", () => {
    const trend = executionTrend([sample(), sample()]);
    expect(trend.abortCount).toBe(0);
    expect(trend.paceAbortCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 保存経路
// ---------------------------------------------------------------------------

const TODAY = "2026-07-26";

function setup() {
  const repo = memRepo();
  repo.saveAthlete(testAthlete());
  const race = makeRace("2026-09-25");
  repo.saveRace(race);
  const goal: Goal = {
    targetEvent: "800m",
    targetTimeSec: 108.9,
    targetRaceId: race.id,
    subRaceIds: [],
  };
  repo.saveGoal(goal);
  regeneratePlan(repo, TODAY);
  const s = repo.listSessions().find((x) => x.category === "high_lactate")!;
  return { repo, s };
}

describe("セッション実行からの保存", () => {
  it("理由を選べば、設定どおりに走れていても打ち切りになる", () => {
    /*
     * 以前は「中止基準に引っかかったか」だけで決めていたので、
     * 痛くて止めた場合は設定どおりのタイムのぶん完走として記録されていた。
     */
    const { repo, s } = setup();
    const target = sessionProgress(repo, s.id).progress.targetSec;
    saveSessionProgress(repo, s.id, [target, target], TODAY);
    const out = finishSessionProgress(repo, s.id, {
      rpe: 6,
      subjective: "moderate",
      abortCause: "pain",
    });

    const saved = repo.resultForSession(s.id)!;
    expect(saved.aborted).toBe(true);
    expect(saved.abortCause).toBe("pain");
    expect(out.guardrailNotes.join(" ")).toContain("故障ログ");
  });

  it("選んだ理由が何に効いたかをその場で返す", () => {
    const { repo, s } = setup();
    const target = sessionProgress(repo, s.id).progress.targetSec;
    saveSessionProgress(repo, s.id, [target, target + 3.0], TODAY);
    const out = finishSessionProgress(repo, s.id, {
      rpe: 9,
      subjective: "very_hard",
      abortCause: "condition",
    });
    expect(out.guardrailNotes.join(" ")).toContain("設定の判断には数えません");
  });

  it("その他の記述を残す", () => {
    const { repo, s } = setup();
    const target = sessionProgress(repo, s.id).progress.targetSec;
    saveSessionProgress(repo, s.id, [target], TODAY);
    finishSessionProgress(repo, s.id, {
      rpe: 7,
      subjective: "hard",
      abortCause: "other",
      abortNote: "スパイクの紐が切れた",
    });
    expect(repo.resultForSession(s.id)!.abortNote).toBe("スパイクの紐が切れた");
  });

  it("理由を選ばなければ今までどおり（中止基準で判断する）", () => {
    const { repo, s } = setup();
    const target = sessionProgress(repo, s.id).progress.targetSec;
    saveSessionProgress(repo, s.id, [target, target + 3.0], TODAY);
    finishSessionProgress(repo, s.id, { rpe: 9, subjective: "very_hard" });
    const saved = repo.resultForSession(s.id)!;
    expect(saved.aborted).toBe(true);
    expect(saved.abortCause).toBeUndefined();
  });
});

describe("結果入力からの保存", () => {
  function saveWith(over: Partial<SessionResult>) {
    const { repo, s } = setup();
    processResult(repo, {
      id: "r1",
      sessionId: s.id,
      date: s.date,
      actualLapsSec: [41, 41.4],
      interval: {
        reps: 2,
        distanceM: 300,
        targetSec: 41,
        restSec: 300,
        restType: "jog",
        results: [
          { index: 1, distanceM: 300, targetSec: 41, actualSec: 41 },
          { index: 2, distanceM: 300, targetSec: 41, actualSec: 41.4 },
        ],
      },
      achievement: "achieved",
      rpe: 7,
      subjective: "moderate",
      ...over,
    } as SessionResult);
    return repo.resultForSession(s.id)!;
  }

  it("理由が入っていれば打ち切りとして残る", () => {
    const saved = saveWith({ abortCause: "schedule" });
    expect(saved.aborted).toBe(true);
    expect(saved.abortCause).toBe("schedule");
  });

  it("知らない値は捨てる（手書きJSON・旧データで壊れない）", () => {
    const saved = saveWith({ abortCause: "nonsense" as AbortCause });
    expect(saved.abortCause).toBeUndefined();
    expect(saved.aborted).toBeFalsy();
  });

  it("理由が無ければ記述も残さない", () => {
    const saved = saveWith({ abortNote: "書いただけ" });
    expect(saved.abortNote).toBeUndefined();
  });

  it("その他以外を選び直したら記述は残るが、理由を消せば消える", () => {
    expect(saveWith({ abortCause: "other", abortNote: "犬" }).abortNote).toBe("犬");
    expect(saveWith({ abortNote: "犬" }).abortNote).toBeUndefined();
  });
});

describe("CFEは理由に関わらず動かさない", () => {
  it("どの理由で打ち切ってもCFEの信頼度を下げない", () => {
    /*
     * 打ち切りは能力低下ではない。止めろと指示しておいて、
     * 止めたことを能力の推定に響かせない（cfe.ts のSKIP-06と対）。
     */
    for (const c of ["pace", "condition", "pain"] as AbortCause[]) {
      const { repo, s } = setup();
      const before = repo.getCfe()?.estimated800mSec;
      const target = sessionProgress(repo, s.id).progress.targetSec;
      saveSessionProgress(repo, s.id, [target + 5, target + 6], TODAY);
      finishSessionProgress(repo, s.id, {
        rpe: 9,
        subjective: "very_hard",
        abortCause: c,
      });
      const after = repo.getCfe()?.estimated800mSec;
      // 打ち切りぶんは未達に数えないので、遅い実測でCFEが跳ねない
      expect(Math.abs((after ?? 0) - (before ?? 0)), c).toBeLessThanOrEqual(1.5);
    }
  });
});

describe("週次レビューに理由を出す", () => {
  it("何本で止めたかだけでなく、なぜ止めたかを書く", () => {
    const { repo, s } = setup();
    const target = sessionProgress(repo, s.id).progress.targetSec;
    saveSessionProgress(repo, s.id, [target, target], TODAY);
    finishSessionProgress(repo, s.id, {
      rpe: 7,
      subjective: "hard",
      abortCause: "condition",
    });
    const review = buildWeeklyReview({
      weekStart: weekStart(s.date),
      sessions: repo.listSessions(),
      results: repo.listResults(),
      checks: [],
      violations: [],
    });
    const line = review.qualityLines.find((q) => q.aborted);
    expect(line?.abortCauseLabel).toBe("天候・路面");
    expect(review.text).toContain("天候・路面");
  });
});

describe("出力が出すぎた・レースの調整", () => {
  it("どちらも設定を緩める材料にしない", () => {
    // 「速すぎて止めた」を緩める材料にしたら、設定が下がって余計に速くなる
    expect(countsTowardPaceEase("too_fast")).toBe(false);
    expect(countsTowardPaceEase("taper")).toBe(false);
  });

  it("体への負担としても数えない", () => {
    /*
     * どちらも「途中で止めたから負荷が入っていない」側。
     * 疲労の裏付けに使うと、調子が良い日ほど疲れている扱いになる。
     */
    expect(isStrainCause("too_fast")).toBe(false);
    expect(isStrainCause("taper")).toBe(false);
  });

  it("締める側の判定にも入れない（数値ロジックは検証まで動かさない）", () => {
    const trend = executionTrend([
      sample({ aborted: true, abortCause: "too_fast" }),
      sample({ aborted: true, abortCause: "too_fast" }),
    ]);
    expect(trend.verdict).toBe("hold");
    expect(trend.paceAbortCount).toBe(0);
  });

  it("故障ログは求めない", () => {
    expect(needsInjuryLog("too_fast")).toBe(false);
    expect(needsInjuryLog("taper")).toBe(false);
  });
});
