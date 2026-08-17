/**
 * アップが**どこに流れ、どこに流れないか**。
 *
 * この境界がこの機能の全部と言っていい。
 * アップは主練習の一部なので、走った量としては実在するが、練習の回数としては存在しない。
 *
 * 流す: 距離・時間・負荷・シューズの走行距離
 * 流さない: 週間の刺激回数・カテゴリ配分・CFE・進行段階・主練習のカテゴリ
 *
 * 右側に流れると、**アップを記録しただけでポイント練習が1回増えたことになる**。
 * 生成器が「今週は3本入っている」と判断して休養を挟み、
 * 記録を細かく付けた週ほど練習が減るという逆のことが起きる。
 */
import { describe, expect, it } from "vitest";
import { memRepo } from "./sqlite-helper";
import { makeRace, testAthlete } from "./helpers";
import {
  dashboard,
  processResult,
  regeneratePlan,
  saveShoe,
  shoeUsageList,
  warmupAnalysis,
  warmupOptionsFor,
} from "@/lib/service";
import { sessionLoad } from "@/lib/core/load";
import { shoeUsage } from "@/lib/core/shoes";
import type { Goal, Session, SessionResult } from "@/lib/core/types";
import type { Shoe } from "@/lib/core/shoes";
import type { WarmupRecord } from "@/lib/core/warmup";

const TODAY = "2026-07-26";

function setup() {
  const repo = memRepo();
  repo.saveAthlete(testAthlete());
  const race = makeRace("2026-09-25");
  repo.saveRace(race);
  repo.saveGoal({
    targetEvent: "800m",
    targetTimeSec: 108.9,
    targetRaceId: race.id,
    subRaceIds: [],
  } as Goal);
  regeneratePlan(repo, TODAY);
  return repo;
}

const WARMUP: WarmupRecord = {
  totalDistanceKm: 3,
  totalDurationMin: 20,
  segments: [
    { kind: "easy_jog", distanceM: 2600 },
    { kind: "strides", distanceM: 100, reps: 4 },
  ],
  legs: "normal",
  breathing: "normal",
  source: "manual",
};

function record(
  repo: ReturnType<typeof memRepo>,
  session: Session,
  over: Partial<SessionResult> = {}
) {
  processResult(repo, {
    id: `res-${session.id}`,
    sessionId: session.id,
    date: session.date,
    actualLapsSec: [],
    continuous: { distanceKm: 10, durationMin: 50 },
    achievement: "achieved",
    rpe: 6,
    subjective: "normal",
    durationMin: 50,
    ...over,
  } as SessionResult);
}

function firstPlanned(repo: ReturnType<typeof memRepo>, category: string) {
  const s = repo
    .listSessions()
    .filter((x) => x.category === category && x.status === "planned")
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  if (!s) throw new Error(`対象の予定が無い（${category}）`);
  return s;
}

describe("負荷（ACWRの材料）", () => {
  const session = { id: "s1", date: TODAY, durationMin: 50 } as Session;
  const base = {
    id: "r1",
    sessionId: "s1",
    date: TODAY,
    actualLapsSec: [],
    achievement: "achieved",
    rpe: 6,
    subjective: "normal",
    durationMin: 50,
  } as SessionResult;

  it("アップのぶんだけ増える", () => {
    const without = sessionLoad(session, base);
    const withWu = sessionLoad(session, { ...base, warmup: WARMUP });
    expect(withWu).toBeGreaterThan(without);
  });

  it("主練習のRPEをアップに使い回さない", () => {
    const easy = sessionLoad(session, { ...base, rpe: 3, warmup: WARMUP });
    const hard = sessionLoad(session, { ...base, rpe: 9, warmup: WARMUP });
    // 差は主練習のRPEの差（6 × 50分）だけ。アップぶんは同じ
    expect(hard - easy).toBeCloseTo((9 - 3) * 50);
  });

  it("主練習側に含まれていれば増えない（二重計上しない）", () => {
    const without = sessionLoad(session, base);
    const included = sessionLoad(session, {
      ...base,
      warmup: { ...WARMUP, includedInMainTotals: true },
    });
    expect(included).toBe(without);
  });
});

describe("シューズの走行距離", () => {
  const shoe = (id: string): Shoe => ({ id, name: id, kind: "trainer" } as Shoe);

  it("同じ靴なら足し上げる", () => {
    const usage = shoeUsage(
      [shoe("a")],
      [{ id: "r", sessionId: "s", date: TODAY, shoeId: "a", continuous: { distanceKm: 10 }, warmup: WARMUP } as SessionResult],
      []
    );
    expect(usage[0].totalKm).toBeCloseTo(13);
  });

  it("履き替えたら、アップのぶんはアップの靴に付く", () => {
    const usage = shoeUsage(
      [shoe("spike"), shoe("trainer")],
      [
        {
          id: "r",
          sessionId: "s",
          date: TODAY,
          shoeId: "spike",
          continuous: { distanceKm: 10 },
          warmup: { ...WARMUP, shoeId: "trainer" },
        } as SessionResult,
      ],
      []
    );
    const spike = usage.find((u) => u.shoe.id === "spike")!;
    const trainer = usage.find((u) => u.shoe.id === "trainer")!;
    expect(spike.totalKm).toBeCloseTo(10);
    expect(trainer.totalKm).toBeCloseTo(3);
  });

  it("アップだけの靴は、練習回数としては数えない", () => {
    const usage = shoeUsage(
      [shoe("spike"), shoe("trainer")],
      [
        {
          id: "r",
          sessionId: "s",
          date: TODAY,
          shoeId: "spike",
          continuous: { distanceKm: 10 },
          warmup: { ...WARMUP, shoeId: "trainer" },
        } as SessionResult,
      ],
      []
    );
    // 距離は付くが「この靴で1回練習した」にはしない
    expect(usage.find((u) => u.shoe.id === "trainer")!.sessions).toBe(0);
    expect(usage.find((u) => u.shoe.id === "spike")!.sessions).toBe(1);
  });

  it("主練習側に含まれていれば足さない", () => {
    const usage = shoeUsage(
      [shoe("a")],
      [
        {
          id: "r",
          sessionId: "s",
          date: TODAY,
          shoeId: "a",
          continuous: { distanceKm: 10 },
          warmup: { ...WARMUP, includedInMainTotals: true },
        } as SessionResult,
      ],
      []
    );
    expect(usage[0].totalKm).toBeCloseTo(10);
  });

  it("アップだけ履いた靴にも最終使用日が付く", () => {
    const usage = shoeUsage(
      [shoe("trainer")],
      [
        {
          id: "r",
          sessionId: "s",
          date: TODAY,
          shoeId: "spike",
          continuous: { distanceKm: 10 },
          warmup: { ...WARMUP, shoeId: "trainer" },
        } as SessionResult,
      ],
      []
    );
    expect(usage[0].lastUsed).toBe(TODAY);
  });
});

describe("週間の合計", () => {
  it("距離と時間にアップが足される", () => {
    const a = setup();
    const b = setup();
    const sa = firstPlanned(a, "high_lactate");
    const sb = firstPlanned(b, "high_lactate");
    record(a, sa);
    record(b, sb, { warmup: WARMUP });

    const wa = dashboard(a, sa.date).weekTotals;
    const wb = dashboard(b, sb.date).weekTotals;
    expect(wb.distanceKm - wa.distanceKm).toBeCloseTo(3, 1);
    expect(wb.durationMin - wa.durationMin).toBe(20);
  });

  it("主練習側に含まれていれば足さない", () => {
    const a = setup();
    const b = setup();
    const sa = firstPlanned(a, "high_lactate");
    const sb = firstPlanned(b, "high_lactate");
    record(a, sa);
    record(b, sb, { warmup: { ...WARMUP, includedInMainTotals: true } });

    expect(dashboard(b, sb.date).weekTotals.distanceKm).toBeCloseTo(
      dashboard(a, sa.date).weekTotals.distanceKm,
      1
    );
  });
});

describe("流してはいけない先", () => {
  /*
   * ここが崩れると、記録を細かく付けた週ほど練習が減る。
   * 「アップを書いたらポイントが1回増えた」は、利用者から見て理由が分からない。
   */
  it("カレンダーに独立したセッションを作らない", () => {
    const repo = setup();
    const before = repo.listSessions().length;
    const s = firstPlanned(repo, "high_lactate");
    record(repo, s, { warmup: WARMUP });
    expect(repo.listSessions().length).toBe(before);
  });

  it("主練習のカテゴリを変えない", () => {
    const repo = setup();
    const s = firstPlanned(repo, "high_lactate");
    record(repo, s, { warmup: WARMUP });
    expect(repo.getSession(s.id)?.category).toBe("high_lactate");
  });

  it("その日のセッション数が増えない（週間の刺激回数の材料）", () => {
    const repo = setup();
    const s = firstPlanned(repo, "high_lactate");
    const sameDay = repo.listSessions().filter((x) => x.date === s.date).length;
    record(repo, s, { warmup: WARMUP });
    expect(repo.listSessions().filter((x) => x.date === s.date).length).toBe(sameDay);
  });

  it("CFEがアップの有無で変わらない", () => {
    const a = setup();
    const b = setup();
    const sa = firstPlanned(a, "high_lactate");
    const sb = firstPlanned(b, "high_lactate");
    const detail = {
      interval: {
        reps: 5,
        distanceM: 300,
        targetSec: 41.4,
        restType: "jog" as const,
        restSec: 300,
        results: Array.from({ length: 5 }, (_, i) => ({ index: i + 1, distanceM: 300, timeSec: 41.2 })),
      },
      continuous: undefined,
    };
    record(a, sa, detail);
    record(b, sb, { ...detail, warmup: WARMUP });
    expect(b.getCfe()?.value).toBe(a.getCfe()?.value);
  });

  it("記録の件数が増えない（1回の練習は1件のまま）", () => {
    const repo = setup();
    const s = firstPlanned(repo, "high_lactate");
    record(repo, s, { warmup: WARMUP });
    expect(repo.listResults().length).toBe(1);
  });
});

describe("保存経路", () => {
  it("知らない区間種別は保存されない（画面を通さなくても落ちる）", () => {
    const repo = setup();
    const s = firstPlanned(repo, "high_lactate");
    record(repo, s, {
      warmup: {
        totalDistanceKm: 3,
        segments: [{ kind: "sauna" }, { kind: "strides", distanceM: 100, reps: 4 }],
        source: "manual",
      } as unknown as WarmupRecord,
    });
    expect(repo.resultForSession(s.id)?.warmup?.segments.map((x) => x.kind)).toEqual(["strides"]);
  });

  it("成立しない値なら保存せずに理由を返す", () => {
    const repo = setup();
    const s = firstPlanned(repo, "high_lactate");
    expect(() =>
      record(repo, s, { warmup: { totalDistanceKm: 3200, segments: [], source: "manual" } })
    ).toThrow(/km/);
    expect(repo.resultForSession(s.id)).toBeUndefined();
  });

  it("空のアップは記録として残さない", () => {
    const repo = setup();
    const s = firstPlanned(repo, "high_lactate");
    record(repo, s, { warmup: { segments: [], source: "manual" } });
    expect(repo.resultForSession(s.id)?.warmup).toBeUndefined();
  });

  it("入れ直しても記録は1件のまま（アップも上書きされる）", () => {
    const repo = setup();
    const s = firstPlanned(repo, "high_lactate");
    record(repo, s, { warmup: WARMUP });
    record(repo, s, { warmup: { ...WARMUP, totalDistanceKm: 4 } });
    expect(repo.listResults().length).toBe(1);
    expect(repo.resultForSession(s.id)?.warmup?.totalDistanceKm).toBe(4);
  });

  it("シューズの一覧にもアップの距離が出る（サービス層まで通っている）", () => {
    const repo = setup();
    saveShoe(repo, { id: "trainer", name: "デイリー", kind: "trainer" } as Shoe);
    const s = firstPlanned(repo, "high_lactate");
    record(repo, s, { shoeId: "trainer", warmup: WARMUP });
    expect(shoeUsageList(repo).find((u) => u.shoe.id === "trainer")!.totalKm).toBeCloseTo(13);
  });
});

describe("記録画面に出す選択肢", () => {
  /*
   * 毎回ゼロから入力させないための材料。
   * ここで見るのは「既定で選ばれた状態にしないこと」と
   * 「前回を同じカテゴリから探すこと」。
   * ポイント練習のアップをジョグの日に持ってきても意味が無い。
   */
  it("記録が無くても型は出る（最初の1回でも押すだけで入る）", () => {
    const repo = setup();
    const out = warmupOptionsFor(repo, firstPlanned(repo, "aerobic").id, {
      mainIsContinuous: true,
    });
    expect(out.templates.length).toBeGreaterThan(0);
    expect(out.previous).toBeUndefined();
  });

  it("前回は同じカテゴリから探す", () => {
    const repo = setup();
    const jog = firstPlanned(repo, "aerobic");
    record(repo, jog, { warmup: WARMUP });

    const nextJog = firstPlanned(repo, "aerobic");
    expect(warmupOptionsFor(repo, nextJog.id, { mainIsContinuous: true }).previous?.date).toBe(
      jog.date
    );

    // ポイント練習からは、ジョグのアップを持ってこない
    const point = firstPlanned(repo, "high_lactate");
    expect(
      warmupOptionsFor(repo, point.id, { mainIsContinuous: false }).previous
    ).toBeUndefined();
  });

  it("アップを付けていない記録は前回にしない", () => {
    const repo = setup();
    record(repo, firstPlanned(repo, "aerobic"));
    const next = firstPlanned(repo, "aerobic");
    expect(warmupOptionsFor(repo, next.id, { mainIsContinuous: true }).previous).toBeUndefined();
  });

  it("自分自身は前回にしない（開き直したときに自分を持ってこない）", () => {
    const repo = setup();
    const jog = firstPlanned(repo, "aerobic");
    record(repo, jog, { warmup: WARMUP });
    expect(
      warmupOptionsFor(repo, jog.id, { mainIsContinuous: true }).previous?.date
    ).not.toBe(jog.date);
  });

  it("知らないセッションidでも落ちず、型だけ返す", () => {
    const repo = setup();
    const out = warmupOptionsFor(repo, "no-such-session", { mainIsContinuous: true });
    expect(out.previous).toBeUndefined();
    expect(out.templates.length).toBeGreaterThan(0);
  });

  it("FITが無ければ候補も空（無いものを作らない）", () => {
    const repo = setup();
    expect(
      warmupOptionsFor(repo, firstPlanned(repo, "aerobic").id, { mainIsContinuous: true }).fromFit
    ).toEqual([]);
  });
});

describe("アップの分析（サービス層から）", () => {
  it("記録が無ければ案内だけ", () => {
    const out = warmupAnalysis(setup());
    expect(out.samples).toEqual([]);
    expect(out.emptyNote).toBeDefined();
  });

  it("アップを付けた記録だけが材料になる", () => {
    const repo = setup();
    record(repo, firstPlanned(repo, "aerobic"));
    record(repo, firstPlanned(repo, "aerobic"), { warmup: WARMUP });
    const out = warmupAnalysis(repo);
    expect(out.samples.length).toBe(1);
  });

  it("1回では傾向を出さない（サービス層を通しても閾値は変わらない）", () => {
    const repo = setup();
    record(repo, firstPlanned(repo, "aerobic"), { warmup: WARMUP });
    expect(warmupAnalysis(repo).readouts).toEqual([]);
  });
});

describe("FITからアップを拾う（サービス層から）", () => {
  /*
   * ここは**二重計上の分かれ目**なので、サービス層でも確かめる。
   * 画面は自分がどちらのモードで入力しているかを知っているので、
   * その判断を引数として渡す。サービス層が推測しない。
   */
  function saveFit(repo: ReturnType<typeof memRepo>) {
    repo.saveFitImport({
      id: "fit-wu-1",
      importedAtUtc: "2026-07-26T00:00:00Z",
      fileName: "warmup-sample.fit",
      rawBytesBase64: "",
      parse: {
        sessions: [],
        laps: [
          { index: 0, distanceKm: 2, timerSec: 720, avgHr: 130, maxHr: 145 },
          { index: 1, distanceKm: 1, timerSec: 360, avgHr: 140, maxHr: 160 },
          { index: 2, distanceKm: 1.5, timerSec: 300, avgHr: 175, maxHr: 188 },
        ],
        records: [],
        eventCount: 0,
        hasDeveloperFields: false,
      },
      autoClassification: { laps: [] },
      confirmedKinds: ["warmup", "warmup", "main"],
    } as never);
  }

  it("アップと判定された周から候補が出る", () => {
    const repo = setup();
    saveFit(repo);
    const out = warmupOptionsFor(repo, firstPlanned(repo, "aerobic").id, {
      mainIsContinuous: false,
    });
    expect(out.fromFit.length).toBe(1);
    expect(out.fromFit[0].warmup.totalDistanceKm).toBeCloseTo(3);
    expect(out.fromFit[0].warmup.source).toBe("fit");
  });

  it("持続走として入力しているなら、合計に足さない印が付く", () => {
    const repo = setup();
    saveFit(repo);
    const out = warmupOptionsFor(repo, firstPlanned(repo, "aerobic").id, {
      mainIsContinuous: true,
    });
    expect(out.fromFit[0].warmup.includedInMainTotals).toBe(true);
  });

  it("インターバルとして入力しているなら、足す", () => {
    const repo = setup();
    saveFit(repo);
    const out = warmupOptionsFor(repo, firstPlanned(repo, "high_lactate").id, {
      mainIsContinuous: false,
    });
    expect(out.fromFit[0].warmup.includedInMainTotals).toBeUndefined();
  });

  it("アップの周が無いFITは候補にしない", () => {
    const repo = setup();
    repo.saveFitImport({
      id: "fit-nowu",
      importedAtUtc: "2026-07-26T00:00:00Z",
      fileName: "main-only.fit",
      rawBytesBase64: "",
      parse: {
        sessions: [],
        laps: [{ index: 0, distanceKm: 1.5, timerSec: 300 }],
        records: [],
        eventCount: 0,
        hasDeveloperFields: false,
      },
      autoClassification: { laps: [] },
      confirmedKinds: ["main"],
    } as never);
    expect(
      warmupOptionsFor(repo, firstPlanned(repo, "aerobic").id, { mainIsContinuous: false }).fromFit
    ).toEqual([]);
  });
});
