import type {
  Athlete,
  Race,
  Session,
  SessionCategory,
  SessionResult,
  StrengthSession,
} from "@/lib/core/types";
import type { RuleContext } from "@/lib/core/rules";

let seq = 0;

/** テスト用の署名なしJWT。中身（sub等のクレーム）だけを検査対象にする */
export function fakeJwt(payload: Record<string, unknown>): string {
  const part = (obj: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(obj)).toString("base64url");
  return `${part({ alg: "none" })}.${part(payload)}.sig`;
}

/** 伊藤選手相当のテスト用プロフィール */
export function testAthlete(overrides: Partial<Athlete> = {}): Athlete {
  return {
    id: "ath-1",
    name: "テスト選手",
    heightCm: 171,
    weightKg: 64.5,
    skeletalMuscleKg: 32.5,
    pb400mSec: 49.0,
    pb800mSec: 109.51, // 1:49.51
    pb1500mSec: 236.0, // 3:56
    heatTolerance: "low",
    recoveryProfile: "normal",
    injuryHistory: [],
    ...overrides,
  };
}

export function makeSession(
  date: string,
  category: SessionCategory,
  overrides: Partial<Session> = {}
): Session {
  seq++;
  return {
    id: `s-${seq}`,
    date,
    category,
    name: `${category}@${date}`,
    prescription: "",
    targetPaces: [],
    transfer800m: 3,
    transfer1500m: 3,
    riskLevel: "mid",
    phase: "Specific",
    status: "planned",
    isFixed: false,
    timeOfDay: "pm",
    ...overrides,
  };
}

export function makeStrength(
  date: string,
  overrides: Partial<StrengthSession> = {}
): StrengthSession {
  seq++;
  return {
    id: `st-${seq}`,
    date,
    timeOfDay: "pm",
    type: "strength",
    loadLevel: "heavy",
    exercises: ["スクワット"],
    ...overrides,
  };
}

export function makeRace(dateStart: string, overrides: Partial<Race> = {}): Race {
  seq++;
  return {
    id: `r-${seq}`,
    name: `テスト大会@${dateStart}`,
    dateStart,
    priority: "A",
    rounds: [{ type: "final", datetime: `${dateStart}T14:00:00` }],
    peakTargetRound: "final",
    ...overrides,
  };
}

export function makeResult(
  session: Session,
  overrides: Partial<SessionResult> = {}
): SessionResult {
  seq++;
  return {
    id: `res-${seq}`,
    sessionId: session.id,
    date: session.date,
    actualLapsSec: [],
    achievement: "achieved",
    rpe: 7,
    subjective: "moderate",
    ...overrides,
  };
}

export function ctx(overrides: Partial<RuleContext> = {}): RuleContext {
  const sessions = overrides.sessions ?? [];
  return {
    sessions,
    // backfilledを区別したいテストだけ明示的に上書きする。それ以外は
    // sessionsと同じにしておく（allSessions未設定によるランタイムエラー防止）。
    allSessions: overrides.allSessions ?? sessions,
    strengthSessions: [],
    races: [],
    athlete: testAthlete(),
    dailyChecks: [],
    heatBlocks: [],
    evaluationDate: "2026-04-01",
    ...overrides,
  };
}

export function violationsOf(vs: { rule: string }[], rule: string) {
  return vs.filter((v) => v.rule === rule);
}
