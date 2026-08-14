/**
 * 補強のフェーズ別の内容。
 *
 * 同じ知識が2か所にあった——`strength.ts` の `STRENGTH_PHASE_TABLE`（画面に出す用と
 * 書いてあるが出している画面が無かった）と、`periodization.ts` の中の別テーブル
 * （実際に生成に効くほう）。片方を直しても、もう片方は静かに古いままになる。
 *
 * 出どころを1つに寄せるが、**寄せた拍子に生成される補強が変われば意味が無い**。
 * このテストは寄せる前の出力をそのまま固定してある。
 * 文言・負荷・種目が1文字でも変わったらここが落ちる。
 */
import { describe, expect, it } from "vitest";
import { memRepo } from "./sqlite-helper";
import { regeneratePlan } from "@/lib/service";
import { STRENGTH_PHASE_TABLE } from "@/lib/core/strength";
import { isHighLoadCategory } from "@/lib/core/trainingClassification";
import type { Phase } from "@/lib/core/types";
import { makeRace, testAthlete } from "./helpers";

const TODAY = "2026-08-15";

/** 全フェーズが出るように、レースを十分先に置く */
function planned() {
  const repo = memRepo();
  repo.saveAthlete(testAthlete());
  const race = makeRace("2027-02-15");
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

describe("フェーズ別の内容（寄せる前の出力を固定する）", () => {
  const expected: Record<Phase, { load: string; type: string; exercises: string[] }> = {
    Base: {
      load: "heavy",
      type: "strength",
      exercises: ["スクワット 5×5", "デッドリフト 3×5", "低強度ホッピング 3×20m"],
    },
    Build: {
      load: "moderate",
      type: "strength",
      exercises: ["スクワット(速度重視) 4×4", "ルーマニアンDL 3×6", "ボックスジャンプ 3×5"],
    },
    Specific: {
      load: "moderate",
      type: "strength",
      exercises: ["スクワット(速度重視) 3×3", "バウンディング 3×30m", "MBスロー 3×5"],
    },
    Modeling: {
      load: "light",
      type: "strength",
      exercises: ["自重スクワット 2×10", "低強度ホップ 2×15m（維持のみ）"],
    },
    Taper: {
      load: "light",
      type: "core",
      exercises: ["体幹サーキット 2周（coreのみ）"],
    },
  };

  it("表の中身がそのまま", () => {
    for (const phase of Object.keys(expected) as Phase[]) {
      const spec = STRENGTH_PHASE_TABLE[phase];
      expect(spec.load, phase).toBe(expected[phase].load);
      expect(spec.type, phase).toBe(expected[phase].type);
      expect(spec.exercises, phase).toEqual(expected[phase].exercises);
    }
  });

  it("生成される補強が表のとおりになる", () => {
    const repo = planned();
    const sessions = new Map(repo.listSessions().map((s) => [s.date, s]));
    const strengths = repo.listStrengths();
    expect(strengths.length).toBeGreaterThan(10);

    for (const st of strengths) {
      const session = sessions.get(st.date);
      expect(session, st.date).toBeDefined();
      const want = expected[session!.phase];
      expect(st.loadLevel, `${st.date} ${session!.phase}`).toBe(want.load);
      expect(st.type, `${st.date} ${session!.phase}`).toBe(want.type);
      expect(st.exercises, `${st.date} ${session!.phase}`).toEqual(want.exercises);
      expect(st.durationMin).toBe(40);
      expect(st.note).toContain("ポイント練習日のpmにブロック化");
      expect(st.note).toContain(`${session!.phase}期`);
    }
  });

  it("補強は高負荷の日にだけ置く（回復日を汚さない）", () => {
    const repo = planned();
    const byDate = new Map(
      repo
        .listSessions()
        .filter((s) => s.timeOfDay !== "am")
        .map((s) => [s.date, s])
    );
    for (const st of repo.listStrengths()) {
      const session = byDate.get(st.date);
      expect(session && isHighLoadCategory(session.category), st.date).toBe(true);
    }
  });

  it("すべてのフェーズが実際に出ている（固定できていない期が無い）", () => {
    const repo = planned();
    const sessions = new Map(repo.listSessions().map((s) => [s.date, s]));
    const phases = new Set(repo.listStrengths().map((st) => sessions.get(st.date)!.phase));
    // Taper は補強がcoreだけになるが、置かれること自体は変わらない
    expect([...phases].sort()).toEqual(["Base", "Build", "Modeling", "Specific", "Taper"]);
  });
});

describe("画面に出す説明", () => {
  it("全フェーズぶんある", () => {
    for (const phase of ["Base", "Build", "Specific", "Modeling", "Taper"] as Phase[]) {
      const spec = STRENGTH_PHASE_TABLE[phase];
      expect(spec.strength, phase).toBeTruthy();
      expect(spec.plyometrics, phase).toBeTruthy();
      expect(spec.frequency, phase).toBeTruthy();
    }
  });

  it("説明と実際の負荷が食い違わない", () => {
    // 「heavy」と書いてあるのに light を生成する、のような食い違いを弾く
    expect(STRENGTH_PHASE_TABLE.Base.strength).toContain("heavy");
    expect(STRENGTH_PHASE_TABLE.Base.load).toBe("heavy");
    expect(STRENGTH_PHASE_TABLE.Taper.strength).toContain("core");
    expect(STRENGTH_PHASE_TABLE.Taper.type).toBe("core");
    expect(STRENGTH_PHASE_TABLE.Modeling.strength).toContain("light");
    expect(STRENGTH_PHASE_TABLE.Modeling.load).toBe("light");
  });
});
