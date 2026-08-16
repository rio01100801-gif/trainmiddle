/**
 * `shoeAdviceFor` — 推薦に渡す文脈を、既にある記録から組み立てる部分。
 *
 * 推薦そのものの理屈は `shoeRecommend.test.ts` で見ている。
 * ここで見るのは **何を材料にしたか**。
 *
 * この関数は痛み・疲労・路面・レースまでの日数を、本人に聞かずに集める。
 * 集め方を間違えると、画面には理由が出ているのに中身が違う——
 * 「疲れているから」と書いてあるのに疲労を見ていない、という状態になる。
 * それは黙って数値を書き換えるのと同じで、あとから追えない。
 */
import { describe, expect, it } from "vitest";
import { memRepo } from "./sqlite-helper";
import { hrUsage, processResult, regeneratePlan, saveShoe, shoeAdviceFor } from "@/lib/service";
import { makeRace, testAthlete } from "./helpers";
import type { DailyCheck, Goal, InjuryLog, SessionResult } from "@/lib/core/types";
import type { Shoe } from "@/lib/core/shoes";

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
  return repo;
}

function shoe(id: string, over: Partial<Shoe> = {}): Shoe {
  return { id, name: id, kind: "trainer", ...over } as Shoe;
}

/** 種類の違う2足。どちらが選ばれたかで、文脈が効いたかが分かる */
function twoShoes(repo: ReturnType<typeof memRepo>) {
  saveShoe(repo, shoe("spike", { name: "スパイク", kind: "spike" }));
  saveShoe(repo, shoe("trainer", { name: "デイリー", kind: "trainer" }));
}

function firstSession(repo: ReturnType<typeof memRepo>, category: string) {
  const s = repo
    .listSessions()
    .filter((x) => x.category === category && x.status === "planned")
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  if (!s) throw new Error(`対象の予定が無い（${category}）`);
  return s;
}

describe("シューズ推薦に渡す文脈", () => {
  it("知らないセッションidでも落ちず、無難な方（ジョグ想定）を返す", () => {
    const repo = setup();
    twoShoes(repo);
    const adv = shoeAdviceFor(repo, "no-such-session", TODAY);
    // 材料が無いときに勝手にポイント練習を想定しない
    expect(adv.best?.shoe.id).toBe("trainer");
  });

  it("登録が無ければ薦めず、登録を促す", () => {
    const repo = setup();
    const adv = shoeAdviceFor(repo, firstSession(repo, "aerobic").id, TODAY);
    expect(adv.best).toBeUndefined();
    expect(adv.emptyNote).toBeDefined();
  });

  it("ポイント練習ではスパイクが上がる", () => {
    const repo = setup();
    twoShoes(repo);
    const s = firstSession(repo, "high_lactate");
    expect(shoeAdviceFor(repo, s.id, TODAY).best?.shoe.id).toBe("spike");
  });

  it("ジョグにスパイクを薦めない", () => {
    const repo = setup();
    twoShoes(repo);
    const s = firstSession(repo, "aerobic");
    expect(shoeAdviceFor(repo, s.id, TODAY).best?.shoe.id).toBe("trainer");
  });

  describe("痛み", () => {
    it("続いている痛みがあれば、ポイント練習でもスパイクを外す", () => {
      const repo = setup();
      twoShoes(repo);
      const s = firstSession(repo, "high_lactate");
      const injury: InjuryLog = {
        id: "inj-1",
        date: s.date,
        bodyPart: "右アキレス腱",
        painLevel: 4,
        status: "ongoing",
      };
      repo.saveInjury(injury);
      const adv = shoeAdviceFor(repo, s.id, TODAY);
      expect(adv.best?.shoe.id).toBe("trainer");
      // 外した理由が読めること。黙って変えない
      expect((adv.best?.reasons ?? []).join("")).toMatch(/痛/);
    });

    it("治った痛みは効かせない（過去の記録で今日を縛らない）", () => {
      const repo = setup();
      twoShoes(repo);
      const s = firstSession(repo, "high_lactate");
      repo.saveInjury({
        id: "inj-2",
        date: s.date,
        bodyPart: "右アキレス腱",
        painLevel: 4,
        status: "recovered",
      } as InjuryLog);
      expect(shoeAdviceFor(repo, s.id, TODAY).best?.shoe.id).toBe("spike");
    });
  });

  describe("疲労", () => {
    const check = (date: string, over: Partial<DailyCheck> = {}): DailyCheck => ({
      date,
      ...over,
    });

    it("赤信号ならスパイクを外す", () => {
      const repo = setup();
      twoShoes(repo);
      const s = firstSession(repo, "high_lactate");
      repo.saveDailyCheck(check(s.date, { signal: "red" }));
      expect(shoeAdviceFor(repo, s.id, TODAY).best?.shoe.id).toBe("trainer");
    });

    it("黄信号でも外す", () => {
      const repo = setup();
      twoShoes(repo);
      const s = firstSession(repo, "high_lactate");
      repo.saveDailyCheck(check(s.date, { signal: "yellow" }));
      expect(shoeAdviceFor(repo, s.id, TODAY).best?.shoe.id).toBe("trainer");
    });

    it("脚の疲労が4以上なら外す（全体疲労が軽くても脚で判断する）", () => {
      const repo = setup();
      twoShoes(repo);
      const s = firstSession(repo, "high_lactate");
      repo.saveDailyCheck(check(s.date, { signal: "green", overallFatigue: 1, legFatigue: 4 }));
      expect(shoeAdviceFor(repo, s.id, TODAY).best?.shoe.id).toBe("trainer");
    });

    it("全体疲労が4以上でも外す", () => {
      const repo = setup();
      twoShoes(repo);
      const s = firstSession(repo, "high_lactate");
      repo.saveDailyCheck(check(s.date, { signal: "green", overallFatigue: 4, legFatigue: 1 }));
      expect(shoeAdviceFor(repo, s.id, TODAY).best?.shoe.id).toBe("trainer");
    });

    it("軽い疲労なら外さない（少しでも疲れていたら下げる、にはしない）", () => {
      const repo = setup();
      twoShoes(repo);
      const s = firstSession(repo, "high_lactate");
      repo.saveDailyCheck(check(s.date, { signal: "green", overallFatigue: 2, legFatigue: 2 }));
      expect(shoeAdviceFor(repo, s.id, TODAY).best?.shoe.id).toBe("spike");
    });

    it("4日以上前の記録は見ない（古い疲労で今日を決めない）", () => {
      const repo = setup();
      twoShoes(repo);
      const s = firstSession(repo, "high_lactate");
      const old = new Date(`${s.date}T00:00:00Z`);
      old.setUTCDate(old.getUTCDate() - 5);
      repo.saveDailyCheck(check(old.toISOString().slice(0, 10), { signal: "red" }));
      expect(shoeAdviceFor(repo, s.id, TODAY).best?.shoe.id).toBe("spike");
    });

    it("練習日より後の記録は見ない（まだ起きていないことで決めない）", () => {
      const repo = setup();
      twoShoes(repo);
      const s = firstSession(repo, "high_lactate");
      const later = new Date(`${s.date}T00:00:00Z`);
      later.setUTCDate(later.getUTCDate() + 1);
      repo.saveDailyCheck(check(later.toISOString().slice(0, 10), { signal: "red" }));
      expect(shoeAdviceFor(repo, s.id, TODAY).best?.shoe.id).toBe("spike");
    });
  });

  describe("路面", () => {
    it("トレッドミルはスパイクを薦めない", () => {
      const repo = setup();
      twoShoes(repo);
      const s = firstSession(repo, "high_lactate");
      repo.saveSession({ ...s, surface: "treadmill" });
      expect(shoeAdviceFor(repo, s.id, TODAY).best?.shoe.id).toBe("trainer");
    });

    it("トラックならスパイクのまま", () => {
      const repo = setup();
      twoShoes(repo);
      const s = firstSession(repo, "high_lactate");
      repo.saveSession({ ...s, surface: "track" });
      expect(shoeAdviceFor(repo, s.id, TODAY).best?.shoe.id).toBe("spike");
    });
  });

  describe("実績", () => {
    /*
     * 実績が少ないうちは補正しない。
     * 「使ってみて良かったから薦めている」と読まれないよう、
     * 足りないことを画面に出す必要がある。
     */
    it("記録が無いうちは、実績が足りないと断る", () => {
      const repo = setup();
      twoShoes(repo);
      const adv = shoeAdviceFor(repo, firstSession(repo, "aerobic").id, TODAY);
      expect(adv.dataNote).toBeDefined();
    });

    it("靴を付けていない記録は実績に数えない", () => {
      const repo = setup();
      twoShoes(repo);
      const s = firstSession(repo, "aerobic");
      processResult(repo, {
        id: `res-${s.id}`,
        sessionId: s.id,
        date: s.date,
        actualLapsSec: [],
        continuous: { distanceKm: 10, durationMin: 50 },
        achievement: "achieved",
        rpe: 5,
        subjective: "easy",
      } as SessionResult);
      // shoeId が無いので、実績は増えないまま
      const adv = shoeAdviceFor(repo, firstSession(repo, "aerobic").id, TODAY);
      expect(adv.dataNote).toBeDefined();
    });
  });
});

describe("実際に履いた記録の集め方", () => {
  /**
   * 3回たまると、実績による補正が効き始める。
   * ここで見るのは「補正がどう効くか」ではなく、
   * **何を1回と数えるか**。数え方が緩いと、根拠が薄いまま断定的になる。
   */
  /*
   * 同じ狙いのジョグだけを使う。
   * ジョグにも「つなぎ」「距離走」があり、狙いが違えば別の実績として数える。
   * 混ぜて数えると、距離走の実績でつなぎを語ることになる。
   */
  const PURPOSE = "aerobic";

  function samePurposeJogs(repo: ReturnType<typeof memRepo>) {
    return repo
      .listSessions()
      .filter(
        (x) =>
          x.category === "aerobic" && x.status === "planned" && x.aerobicPurpose === PURPOSE
      )
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  function jogWithShoe(repo: ReturnType<typeof memRepo>, shoeId: string, over = {}) {
    const s = samePurposeJogs(repo)[0];
    if (!s) throw new Error("同じ狙いのジョグが足りない");
    processResult(repo, {
      id: `res-${s.id}`,
      sessionId: s.id,
      date: s.date,
      actualLapsSec: [],
      continuous: { distanceKm: 10, durationMin: 50 },
      achievement: "achieved",
      rpe: 5,
      subjective: "easy",
      shoeId,
      ...over,
    } as SessionResult);
    return s;
  }

  it("3回たまれば、実績が足りないという断りが消える", () => {
    const repo = setup();
    twoShoes(repo);
    jogWithShoe(repo, "trainer");
    jogWithShoe(repo, "trainer");
    jogWithShoe(repo, "trainer");
    const adv = shoeAdviceFor(repo, samePurposeJogs(repo)[0].id, TODAY);
    expect(adv.dataNote).toBeUndefined();
  });

  it("2回では消えない（足りないうちは足りないと言う）", () => {
    const repo = setup();
    twoShoes(repo);
    jogWithShoe(repo, "trainer");
    jogWithShoe(repo, "trainer");
    expect(shoeAdviceFor(repo, samePurposeJogs(repo)[0].id, TODAY).dataNote).toBeDefined();
  });

  it("狙いが違う練習の記録は数えない（ジョグの実績でポイント練習を語らない）", () => {
    const repo = setup();
    twoShoes(repo);
    jogWithShoe(repo, "trainer");
    jogWithShoe(repo, "trainer");
    jogWithShoe(repo, "trainer");
    const hl = firstSession(repo, "high_lactate");
    expect(shoeAdviceFor(repo, hl.id, TODAY).dataNote).toBeDefined();
  });

  it("翌日に脚が重かった記録も1回として数える（悪い結果を捨てない）", () => {
    const repo = setup();
    twoShoes(repo);
    jogWithShoe(repo, "trainer", { nextDayLegs: "heavy" });
    jogWithShoe(repo, "trainer", { nextDayLegs: "heavy" });
    jogWithShoe(repo, "trainer", { nextDayLegs: "heavy" });
    expect(shoeAdviceFor(repo, samePurposeJogs(repo)[0].id, TODAY).dataNote).toBeUndefined();
  });
});

describe("レースが無いとき", () => {
  it("目標レースが無くても薦められる（冬季でも使える）", () => {
    const repo = memRepo();
    repo.saveAthlete(testAthlete());
    // 目標レース未定（冬季）。日付が無いだけで、目標そのものは置く
    repo.saveGoal({
      targetEvent: "800m",
      targetTimeSec: 108.9,
      targetRaceId: "",
      subRaceIds: [],
    } as Goal);
    regeneratePlan(repo, TODAY);
    saveShoe(repo, shoe("trainer", { name: "デイリー", kind: "trainer" }));
    const s = repo.listSessions().filter((x) => x.status === "planned")[0];
    // レースまでの日数が無いことを理由に、推薦を止めない
    expect(shoeAdviceFor(repo, s.id, TODAY).best?.shoe.id).toBe("trainer");
  });
});

/*
 * 心拍の使いどころ。シューズとは無関係だが、
 * ここも「材料が足りないときに、それらしい値を返さないか」を見る場所なので同じ束に置く。
 * 画面（分析）とAPIからしか呼ばれておらず、境界が固定されていなかった。
 */
describe("心拍の使いどころ", () => {
  it("記録が無ければ何も出さない（推定で埋めない）", () => {
    const repo = setup();
    const hr = hrUsage(repo, TODAY);
    expect(hr.lines).toEqual([]);
    expect(hr.heat).toEqual([]);
  });

  it("記録があれば、その日の判定が1行ずつ出る", () => {
    const repo = setup();
    const s = firstSession(repo, "aerobic");
    processResult(repo, {
      id: `res-${s.id}`,
      sessionId: s.id,
      date: s.date,
      actualLapsSec: [],
      continuous: { distanceKm: 10, durationMin: 50 },
      achievement: "achieved",
      rpe: 5,
      subjective: "easy",
    } as SessionResult);
    const hr = hrUsage(repo, TODAY);
    expect(hr.lines.map((l) => l.date)).toContain(s.date);
    // 心拍が無い日は、判定できない理由が残ること
    expect(hr.lines[0].blockedReason ?? hr.lines[0].verdict).toBeDefined();
  });

  it("今日より後の記録は出さない", () => {
    const repo = setup();
    const s = firstSession(repo, "aerobic");
    processResult(repo, {
      id: `res-${s.id}`,
      sessionId: s.id,
      date: s.date,
      actualLapsSec: [],
      continuous: { distanceKm: 10, durationMin: 50 },
      achievement: "achieved",
      rpe: 5,
      subjective: "easy",
    } as SessionResult);
    // 練習日より前の日付で見れば、まだ何も無い
    expect(hrUsage(repo, "2026-07-01").lines).toEqual([]);
  });
});
