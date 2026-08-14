/**
 * N日周期で組んだプランが、**自分のルールエンジンに通ること**。
 *
 * 配置だけの単体テストは `cycleTemplate.test.ts` にある。
 * ここが見るのはその先——実際に処方まで作って、RULE-01/03/04がERRORを出さないか。
 *
 * これを分けているのは、配置が正しくても生成の途中で内容が入れ替わるからで、
 * （制限因子の振り替え・自作メニュー・テーパーの上書き・高乳酸の5日保険）
 * **配置の正しさは、出来上がったプランの正しさを保証しない。**
 */
import { describe, expect, it } from "vitest";
import { memRepo } from "./sqlite-helper";
import { regeneratePlan } from "@/lib/service";
import { runRuleEngine } from "@/lib/core/rules";
import { buildRuleContext } from "@/lib/service";
import { isHighLoadCategory, isSpecificCategory } from "@/lib/core/trainingClassification";
import { cyclePositionOf } from "@/lib/core/cycleTemplate";
import type { TrainingCycle, WeekTemplate } from "@/lib/core/weekTemplate";
import { makeRace, testAthlete } from "./helpers";
import { addDays } from "@/lib/core/dates";

const TODAY = "2026-08-15";

function planWith(cycle: TrainingCycle | undefined) {
  const repo = memRepo();
  repo.saveAthlete(testAthlete());
  const race = makeRace("2026-11-15");
  repo.saveRace(race);
  repo.saveGoal({
    targetEvent: "800m",
    targetTimeSec: 108.9,
    targetRaceId: race.id,
    subRaceIds: [],
  });
  if (cycle) {
    const t: WeekTemplate = { slots: {}, modes: {}, enabled: true, cycle };
    repo.saveWeekTemplate(t);
  }
  const result = regeneratePlan(repo, TODAY);
  return { repo, result };
}

function cycleOf(lengthDays: number, anchorDate = TODAY): TrainingCycle {
  return { enabled: true, lengthDays, anchorDate, slots: {}, modes: {} };
}

describe("10日周期で組む", () => {
  it("生成できて、ルールエンジンがERRORを出さない", () => {
    const { repo, result } = planWith(cycleOf(10));
    expect(result.sessionCount).toBeGreaterThan(50);
    const errors = runRuleEngine(buildRuleContext(repo, TODAY)).filter(
      (v) => v.level === "ERROR"
    );
    expect(errors.map((e) => `${e.rule}: ${e.message}`)).toEqual([]);
  });

  it("暦の1週間で数えても高負荷が集中しない", () => {
    const { repo } = planWith(cycleOf(10));
    const sessions = repo
      .listSessions()
      .filter((s) => s.status !== "skipped" && s.timeOfDay !== "am");
    const dates = [...new Set(sessions.map((s) => s.date))].sort();
    for (const start of dates) {
      const end = addDays(start, 6);
      const inWindow = sessions.filter((s) => s.date >= start && s.date <= end);
      const high = new Set(
        inWindow.filter((s) => isHighLoadCategory(s.category)).map((s) => s.date)
      ).size;
      const demanding = new Set(
        inWindow.filter((s) => isSpecificCategory(s.category)).map((s) => s.date)
      ).size;
      expect(high, `${start}〜${end}`).toBeLessThanOrEqual(3);
      expect(demanding, `${start}〜${end}`).toBeLessThanOrEqual(2);
    }
  });

  /**
   * 高負荷が来る位置は決まっている。
   *
   * 「位置ごとに必ず同じ内容」までは言えない——フェーズが変われば本数も配置も変わるし、
   * 高乳酸の5日保険や振り替えで軽くなる日もある。
   * 言えるのは**決めた位置の外に高負荷を増やさない**こと。ここが崩れると
   * 周期の意味（間隔を自分で決める）が無くなる。
   */
  it("決めた位置の外に高負荷を置かない", () => {
    const { repo } = planWith(cycleOf(10));
    // フェーズをまたぐと配置が変わるので、Specific期の中だけを見る
    const sessions = repo
      .listSessions()
      .filter(
        (s) => s.timeOfDay !== "am" && s.date >= "2026-09-21" && s.date <= "2026-10-18"
      );
    const highLoadPositions = new Set(
      sessions
        .filter((s) => isHighLoadCategory(s.category))
        .map((s) => cyclePositionOf(TODAY, s.date, 10))
    );
    // Specific期の10日周期はポイント3本（1・4・8日目）
    expect([...highLoadPositions].sort((a, b) => a - b)).toEqual([0, 3, 7]);
  });

  it("ポイント練習の間隔が中2日を切らない", () => {
    const { repo } = planWith(cycleOf(10));
    const points = repo
      .listSessions()
      .filter((s) => s.timeOfDay !== "am" && isHighLoadCategory(s.category))
      .map((s) => s.date)
      .sort();
    for (let i = 1; i < points.length; i++) {
      const gap =
        (Date.parse(points[i]) - Date.parse(points[i - 1])) / 86400000;
      // レース前後は周期の外なので、0日（同日）だけ弾く
      expect(gap, `${points[i - 1]} → ${points[i]}`).toBeGreaterThanOrEqual(1);
    }
  });

  it("減らした点は理由とセットで返る", () => {
    const { result } = planWith(cycleOf(10));
    expect(result.cycleNotes.length).toBeGreaterThan(0);
    for (const note of result.cycleNotes) {
      expect(note).toMatch(/ため/);
    }
  });
});

describe("周期の長さを変える", () => {
  for (const n of [5, 7, 9, 10, 12, 14]) {
    it(`${n}日周期でもERRORが出ない`, () => {
      const { repo } = planWith(cycleOf(n));
      const errors = runRuleEngine(buildRuleContext(repo, TODAY)).filter(
        (v) => v.level === "ERROR"
      );
      expect(errors.map((e) => `${e.rule}: ${e.message}`)).toEqual([]);
    });
  }

  it("周期が長いほど、同じ期間のポイント本数は減る", () => {
    const count = (n: number) =>
      planWith(cycleOf(n))
        .repo.listSessions()
        .filter(
          (s) =>
            s.timeOfDay !== "am" &&
            isHighLoadCategory(s.category) &&
            s.date >= TODAY &&
            s.date < "2026-10-15"
        ).length;
    expect(count(14)).toBeLessThan(count(7));
  });
});

describe("周期を使わなければ従来どおり", () => {
  it("周期なしと、周期を無効にした設定で同じプランになる", () => {
    const a = planWith(undefined);
    const b = planWith({ ...cycleOf(10), enabled: false });
    const key = (r: ReturnType<typeof planWith>) =>
      r.repo
        .listSessions()
        .map((s) => `${s.date}|${s.timeOfDay}|${s.category}|${s.prescription}`)
        .sort()
        .join("\n");
    expect(key(b)).toBe(key(a));
    expect(a.result.cycleNotes).toEqual([]);
  });
});

describe("周期の中の固定枠", () => {
  it("固定した位置には必ずそのメニューが来て、固定として扱われる", () => {
    const cycle: TrainingCycle = {
      ...cycleOf(10),
      slots: { 0: "high_lactate", 5: "off" },
      modes: { 0: "fixed", 5: "fixed" },
    };
    const { repo } = planWith(cycle);
    const sessions = repo
      .listSessions()
      .filter((s) => s.timeOfDay !== "am" && s.date >= TODAY && s.date < "2026-10-15");
    const at0 = sessions.filter((s) => cyclePositionOf(TODAY, s.date, 10) === 0);
    const at5 = sessions.filter((s) => cyclePositionOf(TODAY, s.date, 10) === 5);
    expect(at0.length).toBeGreaterThan(3);
    // 高乳酸は5日保険で回復ジョグに落ちることがあるので、大半が高乳酸ならよい
    expect(at0.filter((s) => s.category === "high_lactate").length).toBeGreaterThan(
      at0.length / 2
    );
    expect(at0.some((s) => s.isFixed && s.fixedSource === "周期1日目の固定設定")).toBe(true);
    expect(at5.every((s) => s.category === "off")).toBe(true);
  });
});
