/**
 * 進め方の2案（S-9）と、設定ペースの調整（M-2）が扱える種目の食い違い。
 *
 * この2つは対象の選び方を揃えてあるが、**扱える種目が同じではない**。
 *   ・設定ペースの調整は神経系にも効く
 *   ・進め方の2案はテンプレートから作るので、神経系には案が無い
 * 神経系の日に、調整案は出るのに進め方カードだけが消える、という形で表に出た
 * （2026-08-14。E2Eが落ちて気づいた）。
 *
 * 消えたときに画面が黙ると、本人からは不具合と区別がつかない。
 * 画面側は案が作れなければ次のポイント練習へ移すようにしたが、
 * その前提であるこの食い違い自体をここで固定しておく。
 * 将来どちらかを直すなら、このテストが先に落ちる。
 */
import { describe, expect, it } from "vitest";
import { memRepo } from "./sqlite-helper";
import { adaptiveProposal, regeneratePlan, sessionPlanVariants } from "@/lib/service";
import { makeRace, testAthlete } from "./helpers";

const TODAY = "2026-08-13";

function setup() {
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
  regeneratePlan(repo, TODAY);
  return repo;
}

/** 指定カテゴリの未実施セッションを1つ取る */
function sessionOf(repo: ReturnType<typeof memRepo>, category: string) {
  return repo
    .listSessions()
    .filter((s) => s.category === category && s.status !== "completed")
    .sort((a, b) => a.date.localeCompare(b.date))[0];
}

describe("扱える種目の食い違いを固定する", () => {
  it("高乳酸には2案が出る", () => {
    const repo = setup();
    const s = sessionOf(repo, "high_lactate");
    expect(s).toBeDefined();
    const out = sessionPlanVariants(repo, s.id, TODAY);
    expect(out.variants?.length).toBe(2);
  });

  it("神経系には案が作れない（テンプレートが無い）", () => {
    const repo = setup();
    const s = sessionOf(repo, "neural");
    if (!s) return; // 生成されない週構成なら、この食い違いは起きない
    const out = sessionPlanVariants(repo, s.id, TODAY);
    // セッション自体は返るが、案は無い。ここが画面の分岐の根拠
    expect(out.session).toBeDefined();
    expect(out.variants ?? []).toHaveLength(0);
  });

  it("案が作れない種目でも、設定ペースの調整のほうは対象にできる", () => {
    const repo = setup();
    const s = sessionOf(repo, "neural");
    if (!s) return;
    const adaptive = adaptiveProposal(repo, TODAY, { sessionId: s.id });
    // 調整側は神経系を受け付ける。だから画面で対象がずれる
    expect(adaptive.session?.id).toBe(s.id);
  });

  it("対象を指定しなければ、案が作れるポイント練習が選ばれる", () => {
    const repo = setup();
    const picked = adaptiveProposal(repo, TODAY);
    expect(picked.session).toBeDefined();
    // 画面はここへ移すので、移した先には案があること
    const out = sessionPlanVariants(repo, picked.session!.id, TODAY);
    expect(out.variants?.length).toBe(2);
  });
});
