/**
 * 冬季・基礎構築モード（目標レースが決まっていない期間）。
 *
 * いちばん怖いのは、**レースが無いのにピーキングしてしまうこと**。
 * 生成の区切りに使っている日付をレース日と取り違えると、
 * ただの区切りに向かってテーパーが始まり、作った期間の終わりが軽くなる。
 * 見た目には「予定が出ている」ので気づけない。
 */
import { describe, expect, it } from "vitest";
import { memRepo } from "./sqlite-helper";
import { buildRuleContext, regeneratePlan, saveGoalAndRaces } from "@/lib/service";
import { runRuleEngine } from "@/lib/core/rules";
import {
  OFF_SEASON_BLOCKS,
  OFF_SEASON_BLOCK_WEEKS,
  OFF_SEASON_HORIZON_WEEKS,
  describeOffSeasonBlock,
  isOffSeason,
  offSeasonBlockNumber,
  offSeasonEmphasis,
} from "@/lib/core/offSeason";
import { isHighLoadCategory } from "@/lib/core/trainingClassification";
import { addDays, diffDays } from "@/lib/core/dates";
import { makeRace, testAthlete } from "./helpers";

const TODAY = "2026-11-16"; // 月曜。冬季を想定

function planWithoutRace() {
  const repo = memRepo();
  repo.saveAthlete(testAthlete());
  repo.saveGoal({
    targetEvent: "800m",
    targetTimeSec: 108.9,
    targetRaceId: "",
    subRaceIds: [],
  });
  const result = regeneratePlan(repo, TODAY);
  return { repo, result };
}

function planWithRace() {
  const repo = memRepo();
  repo.saveAthlete(testAthlete());
  const race = makeRace("2027-05-15");
  repo.saveRace(race);
  repo.saveGoal({
    targetEvent: "800m",
    targetTimeSec: 108.9,
    targetRaceId: race.id,
    subRaceIds: [],
  });
  const result = regeneratePlan(repo, TODAY);
  return { repo, result };
}

describe("ブロックの回り方", () => {
  it("4週ごとに重心が移り、16週で一巡する", () => {
    expect(offSeasonEmphasis(0)).toBe("aerobic_volume");
    expect(offSeasonEmphasis(3)).toBe("aerobic_volume");
    expect(offSeasonEmphasis(4)).toBe("strength_hills");
    expect(offSeasonEmphasis(8)).toBe("aerobic_high");
    expect(offSeasonEmphasis(12)).toBe("speed_base");
    // 一巡したら最初に戻る
    expect(offSeasonEmphasis(16)).toBe("aerobic_volume");
  });

  it("1ブロックは4週。負荷サイクル（入り口→量→密度→回復）と同じ長さ", () => {
    expect(OFF_SEASON_BLOCK_WEEKS).toBe(4);
    expect(OFF_SEASON_HORIZON_WEEKS).toBe(OFF_SEASON_BLOCK_WEEKS * OFF_SEASON_BLOCKS.length);
  });

  it("見出しに週の範囲が出る", () => {
    expect(offSeasonBlockNumber(5)).toBe(2);
    expect(describeOffSeasonBlock(5)).toBe("第2ブロック 筋力・坂（5〜8週目）");
  });

  it("目標レースが無いことだけで判定する（目標タイムは冬でも使う）", () => {
    const goal = {
      targetEvent: "800m" as const,
      targetTimeSec: 108.9,
      targetRaceId: "",
      subRaceIds: [],
    };
    expect(isOffSeason(goal, [])).toBe(true);
    const race = makeRace("2027-05-15");
    expect(isOffSeason({ ...goal, targetRaceId: race.id }, [race])).toBe(false);
  });
});

describe("レースが無くても生成できる", () => {
  it("例外にならず、16週ぶんが出る", () => {
    const { result } = planWithoutRace();
    expect(result.offSeason).toBe(true);
    expect(result.sessionCount).toBeGreaterThan(80);
  });

  it("ルールエンジンがERRORを出さない", () => {
    const { repo } = planWithoutRace();
    const errors = runRuleEngine(buildRuleContext(repo, TODAY)).filter(
      (v) => v.level === "ERROR"
    );
    expect(errors.map((e) => `${e.rule}: ${e.message}`)).toEqual([]);
  });

  it("生成した最後の週まで、末尾が軽くならない（テーパーしていない）", () => {
    const { repo } = planWithoutRace();
    const sessions = repo.listSessions().filter((s) => s.timeOfDay !== "am");
    const last = sessions.map((s) => s.date).sort().at(-1)!;
    // 最後の2週間にも高負荷が入っていること
    const tail = sessions.filter(
      (s) => diffDays(s.date, last) <= 14 && isHighLoadCategory(s.category)
    );
    expect(tail.length).toBeGreaterThan(0);
    // 「調整ジョグ」「刺激入れ」はレース前の文面。冬季には出てはいけない
    expect(sessions.filter((s) => /調整ジョグ|刺激入れ|最終高乳酸/.test(s.name))).toEqual([]);
  });

  it("フェーズはBaseのまま上がらない", () => {
    const { repo } = planWithoutRace();
    const phases = new Set(repo.listSessions().map((s) => s.phase));
    expect([...phases]).toEqual(["Base"]);
  });

  it("ブロックが順に出て、理由も返る", () => {
    const { result } = planWithoutRace();
    const labels = [...new Set(result.offSeasonBlocks.map((b) => b.label))];
    expect(labels).toHaveLength(4);
    expect(labels[0]).toContain("有酸素の土台");
    expect(labels[1]).toContain("筋力・坂");
    expect(labels[2]).toContain("閾値・CVの量");
    expect(labels[3]).toContain("スピードの土台");
  });

  it("ブロックごとに中身が変わる（同じ4週の繰り返しにしない）", () => {
    const { repo } = planWithoutRace();
    const start = repo.listSessions().map((s) => s.date).sort()[0];
    const namesInBlock = (blockIndex: number) => {
      const from = addDays(start, blockIndex * OFF_SEASON_BLOCK_WEEKS * 7);
      const to = addDays(from, OFF_SEASON_BLOCK_WEEKS * 7 - 1);
      return repo
        .listSessions()
        .filter((s) => s.date >= from && s.date <= to && s.timeOfDay !== "am")
        // カテゴリだけでは足りない——坂も流しも neural なので、
        // 「坂を週2本」のブロックと「坂1・流し1」のブロックが同じに見える
        .map((s) => `${s.category}:${s.name}`)
        .join(",");
    };
    const blocks = [0, 1, 2, 3].map(namesInBlock);
    expect(new Set(blocks).size).toBe(4);
  });

  it("坂のブロックでは坂が週2回入り、補強も付く", () => {
    const { repo } = planWithoutRace();
    const start = repo.listSessions().map((s) => s.date).sort()[0];
    const from = addDays(start, OFF_SEASON_BLOCK_WEEKS * 7);
    const to = addDays(from, OFF_SEASON_BLOCK_WEEKS * 7 - 1);
    const hills = repo
      .listSessions()
      .filter((s) => s.date >= from && s.date <= to && /坂/.test(s.name));
    // 4週で8回前後
    expect(hills.length).toBeGreaterThanOrEqual(6);
    const strengthDates = new Set(
      repo.listStrengths().filter((s) => s.date >= from && s.date <= to).map((s) => s.date)
    );
    expect([...strengthDates].some((d) => hills.some((h) => h.date === d))).toBe(true);
  });

  it("高乳酸を冬に積み上げない（スピードの土台ブロックの隔週だけ）", () => {
    const { repo } = planWithoutRace();
    const hl = repo.listSessions().filter((s) => s.category === "high_lactate");
    // 16週で数本まで。週1で回すのは専門期の話
    expect(hl.length).toBeLessThanOrEqual(4);
  });
});

describe("レースを設定すれば従来どおり", () => {
  it("Base以外のフェーズが出て、テーパーもある", () => {
    const { repo, result } = planWithRace();
    expect(result.offSeason).toBe(false);
    expect(result.offSeasonBlocks).toEqual([]);
    const phases = new Set(repo.listSessions().map((s) => s.phase));
    expect(phases.has("Base")).toBe(true);
    expect(phases.has("Taper")).toBe(true);
  });

  it("冬季モードのブロックは混ざらない", () => {
    const { repo } = planWithRace();
    // 冬季だけの並び（坂が週2本）にはならない
    const firstWeek = repo
      .listSessions()
      .filter((s) => s.date >= TODAY && s.date <= addDays(TODAY, 6) && /坂/.test(s.name));
    expect(firstWeek.length).toBeLessThanOrEqual(1);
  });
});

describe("保存", () => {
  it("本命レースが無い目標を保存できる", () => {
    const repo = memRepo();
    repo.saveAthlete(testAthlete());
    const saved = saveGoalAndRaces(
      repo,
      {
        targetEvent: "800m",
        targetTimeSec: 108.9,
        targetRaceId: "",
        subRaceIds: [],
      },
      []
    );
    expect(saved.goal.targetRaceId).toBe("");
    expect(saved.races).toEqual([]);
  });

  it("IDを書いたのにそのレースが無いのは、これまでどおり弾く（打ち間違い）", () => {
    const repo = memRepo();
    repo.saveAthlete(testAthlete());
    expect(() =>
      saveGoalAndRaces(
        repo,
        {
          targetEvent: "800m",
          targetTimeSec: 108.9,
          targetRaceId: "race-missing",
          subRaceIds: [],
        },
        []
      )
    ).toThrow(/本命レース/);
  });
});
