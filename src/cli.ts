/**
 * CLI: UIなしでも診断・プラン生成・ルールチェック・結果入力が使える。
 * 実行: npx tsx src/cli.ts <command> [options]  または  bun src/cli.ts <command>
 * DB: data/train800.db（Webアプリと共有）
 */
import type { DbDriver } from "./lib/db/driver";
import { Repo } from "./lib/db/repo";
import {
  dashboard,
  processDailyCheck,
  processResult,
  processSkip,
  regeneratePlan,
} from "./lib/service";
import { diagnose } from "./lib/core/diagnosis";
import { buildAerobicProfile } from "./lib/core/pace";
import { fmtPacePerKm, fmtTime, localToday } from "./lib/core/dates";
import type { Achievement, SkipReason, Subjective } from "./lib/core/types";

// ---------------------------------------------------------------------------

function openAnyRepo(): Repo {
  const path = require("path");
  const fs = require("fs");
  const file = path.join(process.cwd(), "data", "train800.db");
  fs.mkdirSync(path.dirname(file), { recursive: true });

  if (typeof (process as { versions: { bun?: string } }).versions.bun === "string") {
    // Bun 実行時は内蔵SQLiteを使う
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Database } = require("bun:sqlite");
    const db = new Database(file);
    const driver: DbDriver = {
      exec: (sql: string) => db.exec(sql),
      prepare: (sql: string) => {
        const stmt = db.query(sql);
        return {
          run: (...p: unknown[]) => stmt.run(...(p as never[])),
          get: (...p: unknown[]) => stmt.get(...(p as never[])),
          all: (...p: unknown[]) => stmt.all(...(p as never[])),
        };
      },
      close: () => db.close(),
    };
    return new Repo(driver);
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Database = require("better-sqlite3");
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  const driver: DbDriver = {
    exec: (sql: string) => db.exec(sql),
    prepare: (sql: string) => db.prepare(sql),
    close: () => db.close(),
  };
  return new Repo(driver);
}

/** "1:49.51" / "109.51" → 秒 */
export function parseTimeArg(v: string): number {
  if (v.includes(":")) {
    const [m, s] = v.split(":");
    return Number(m) * 60 + Number(s);
  }
  return Number(v);
}

function args(): { cmd: string; flags: Record<string, string>; positional: string[] } {
  const argv = process.argv.slice(2);
  const cmd = argv[0] ?? "help";
  const flags: Record<string, string> = {};
  const positional: string[] = [];
  for (let i = 1; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      flags[argv[i].slice(2)] = argv[i + 1] ?? "true";
      i++;
    } else positional.push(argv[i]);
  }
  return { cmd, flags, positional };
}

function today(): string {
  return localToday();
}

const HELP = `800m特化トレーニングツール CLI

コマンド:
  setup     --name 名前 --pb800 1:49.51 [--pb400 49.0] [--pb1500 3:56]
            [--heat low|normal|high] [--recovery slow|normal|fast]
  goal      --target 1:48.9 --race-date 2026-09-25 --race-name 大会名
            [--priority A] [--heat-date 2026-09-25T10:00] [--final-date 2026-09-27T15:00]
            [--advance place|time|place_and_time] [--border 1:51.0]
  diagnose  タイプ判定を表示
  plan      [--start 2026-06-08] プランを自動生成
  week      [--date 2026-06-08] 週のメニューを表示
  checkrules ルールエンジンを実行して違反を表示
  result    <sessionId> --rpe 8 --achievement achieved|partial|failed
            [--subjective easy|moderate|hard|very_hard] [--laps 39.2,39.5,40.1]
            [--reps 4/5] [--legs fresh|normal|heavy] [--temp 30]
  skip      <sessionId> --reason fatigue|red_signal|injury|schedule|weather|other
  daily     --hr 48 [--sleep 1-5] [--tightness 1-5] [--fatigue 1-5]
  marker    --km 8 --time 30:40 [--hr 186] [--date 2026-07-24] [--type workout|test|race]
            有酸素の実測データを登録（LT/CV/ジョグの設定はここから算出される）
  dash      ダッシュボード表示
`;

export function main(): void {
  const { cmd, flags, positional } = args();
  if (cmd === "help" || cmd === "--help") {
    console.log(HELP);
    return;
  }
  const repo = openAnyRepo();

  switch (cmd) {
    case "setup": {
      repo.saveAthlete({
        id: "athlete-1",
        name: flags["name"] ?? "選手",
        pb800mSec: parseTimeArg(flags["pb800"] ?? "110.0"),
        pb400mSec: flags["pb400"] ? parseTimeArg(flags["pb400"]) : undefined,
        pb1500mSec: flags["pb1500"] ? parseTimeArg(flags["pb1500"]) : undefined,
        heatTolerance: (flags["heat"] as "low" | "normal" | "high") ?? "normal",
        recoveryProfile: (flags["recovery"] as "slow" | "normal" | "fast") ?? "normal",
        heightCm: flags["height"] ? Number(flags["height"]) : undefined,
        weightKg: flags["weight"] ? Number(flags["weight"]) : undefined,
        injuryHistory: [],
      });
      console.log("プロフィールを保存しました。`diagnose` でタイプ判定を確認できます。");
      break;
    }
    case "goal": {
      const raceId = "race-target";
      const dateStart = flags["race-date"];
      if (!dateStart) throw new Error("--race-date が必要です");
      const rounds = [];
      if (flags["heat-date"]) rounds.push({ type: "heat" as const, datetime: flags["heat-date"] });
      if (flags["semi-date"]) rounds.push({ type: "semifinal" as const, datetime: flags["semi-date"] });
      rounds.push({
        type: "final" as const,
        datetime: flags["final-date"] ?? `${dateStart}T15:00:00`,
      });
      repo.saveRace({
        id: raceId,
        name: flags["race-name"] ?? "本命レース",
        dateStart,
        priority: (flags["priority"] as "A" | "B" | "C") ?? "A",
        rounds,
        peakTargetRound: "final",
        advancementRule: flags["advance"] as "place" | "time" | "place_and_time" | undefined,
        borderTimeSec: flags["border"] ? parseTimeArg(flags["border"]) : undefined,
      });
      repo.saveGoal({
        targetEvent: "800m",
        targetTimeSec: parseTimeArg(flags["target"] ?? "108.9"),
        targetRaceId: raceId,
        subRaceIds: [],
      });
      console.log("目標とレースを保存しました。`plan` でメニューを生成できます。");
      break;
    }
    case "diagnose": {
      const athlete = repo.getAthlete();
      if (!athlete) throw new Error("先に setup を実行してください");
      const goal = repo.getGoal();
      const d = diagnose(athlete, goal?.targetTimeSec);
      console.log(`タイプ: ${d.athleteType} / 最大の伸びしろ: ${d.primaryGap}`);
      console.log(d.narrative);
      break;
    }
    case "plan": {
      const start = flags["start"] ?? today();
      const out = regeneratePlan(repo, start);
      console.log(
        `プラン生成: ${out.sessionCount}セッション + 補強${out.strengthCount}件`
      );
      const errs = out.violations.filter((v) => v.level === "ERROR");
      console.log(
        errs.length === 0
          ? "ルール違反(ERROR)なし"
          : `⚠ ERROR ${errs.length}件: ${errs.map((v) => v.rule).join(", ")}`
      );
      for (const v of out.violations.filter((v) => v.level === "WARN").slice(0, 5)) {
        console.log(`  [WARN] ${v.rule}: ${v.message}`);
      }
      break;
    }
    case "week": {
      const date = flags["date"] ?? today();
      const d = dashboard(repo, date);
      console.log(`=== 週間メニュー (${date} の週) フェーズ: ${d.currentPhase ?? "-"} ===`);
      for (const s of d.weekSessions) {
        const fixed = s.isFixed ? " [固定]" : "";
        console.log(`${s.date} [${s.category}]${fixed} ${s.name} (id: ${s.id})`);
        console.log(`   ${s.prescription}`);
      }
      for (const st of d.weekStrengths) {
        console.log(`${st.date} [補強/${st.loadLevel}] ${st.exercises.join(" / ")}`);
      }
      break;
    }
    case "checkrules": {
      const d = dashboard(repo, flags["date"] ?? today());
      if (d.violations.length === 0) {
        console.log("違反なし");
        break;
      }
      for (const v of d.violations) {
        console.log(`[${v.level}] ${v.rule}${v.unavoidable ? "（回避不能）" : ""}: ${v.message}`);
        if (v.suggestion) console.log(`   → ${v.suggestion}`);
      }
      break;
    }
    case "result": {
      const sessionId = positional[0];
      if (!sessionId) throw new Error("sessionId が必要です（`week` で確認）");
      const session = repo.getSession(sessionId);
      if (!session) throw new Error("セッションが見つかりません");
      const laps = flags["laps"] ? flags["laps"].split(",").map(Number) : [];
      const reps = flags["reps"]?.split("/");
      const out = processResult(repo, {
        id: `res-${Date.now()}`,
        sessionId,
        date: session.date,
        actualLapsSec: laps,
        achievement: (flags["achievement"] as Achievement) ?? "achieved",
        rpe: Number(flags["rpe"] ?? 7),
        subjective: (flags["subjective"] as Subjective) ?? "moderate",
        nextDayLegs: flags["legs"] as "fresh" | "normal" | "heavy" | undefined,
        weatherTempC: flags["temp"] ? Number(flags["temp"]) : undefined,
        completedReps: reps ? Number(reps[0]) : undefined,
        prescribedReps: reps ? Number(reps[1]) : undefined,
      });
      console.log(
        `CFE: ${fmtTime(out.cfeBefore)} → ${fmtTime(out.cfeAfter)}${out.cfeApplied ? "" : "（更新なし）"}`
      );
      for (const n of out.guardrailNotes) console.log(`  ${n}`);
      if (out.changes.length > 0) {
        console.log("変更差分:");
        for (const c of out.changes) {
          console.log(`  [${c.triggeredBy}] ${c.sessionId}: ${c.before} → ${c.after}`);
          console.log(`    理由: ${c.reason}`);
        }
      }
      const errs = out.violations.filter((v) => v.level === "ERROR");
      if (errs.length > 0) {
        console.log(`⚠ ルール違反: ${errs.map((v) => v.rule).join(", ")}`);
      }
      break;
    }
    case "skip": {
      const sessionId = positional[0];
      if (!sessionId) throw new Error("sessionId が必要です");
      const out = processSkip(repo, sessionId, (flags["reason"] as SkipReason) ?? "other");
      console.log(`[${out.decision.triggeredBy}] ${out.decision.message}`);
      if (out.decision.phaseRollbackSuggested) {
        console.log("⚠ SKIP-04: 質練習2回連続スキップ。フェーズを1段階戻すことを検討してください。");
      }
      break;
    }
    case "daily": {
      const out = processDailyCheck(repo, {
        date: flags["date"] ?? today(),
        restingHr: flags["hr"] ? Number(flags["hr"]) : undefined,
        sleepQuality: flags["sleep"] ? Number(flags["sleep"]) : undefined,
        muscleTightness: flags["tightness"] ? Number(flags["tightness"]) : undefined,
        overallFatigue: flags["fatigue"] ? Number(flags["fatigue"]) : undefined,
      });
      console.log(`信号: ${out.signal} → ${out.action}`);
      for (const r of out.reasons) console.log(`  ${r}`);
      if (out.changes.length > 0) {
        console.log(`質練習${out.changes.length}件を自動置換しました。`);
      }
      break;
    }
    case "marker": {
      const km = Number(flags["km"]);
      const sec = parseTimeArg(flags["time"] ?? "");
      if (!km || !sec) throw new Error("--km と --time が必要です（例: --km 8 --time 30:40）");
      if (km < 3) throw new Error("LT推定には合計3km以上が必要です");
      const date = flags["date"] ?? today();
      repo.saveMarker({
        id: `fm-${Date.now()}`,
        date,
        type: (flags["type"] as "workout" | "test" | "race") ?? "workout",
        description: flags["note"] ?? `${km}km 走`,
        resultLapsSec: [sec],
        lapDistancesM: [km * 1000],
        avgHr: flags["hr"] ? Number(flags["hr"]) : undefined,
      });
      const profile = buildAerobicProfile(
        repo.listMarkers(),
        date,
        repo.getCfe()?.estimated800mSec,
        undefined,
        repo.getAthlete()?.pb1500mSec
      );
      console.log(
        `実測を登録しました（${km}km ${fmtTime(sec)}）。有酸素設定を更新します。`
      );
      console.log(
        `  ${profile.isEstimated ? "⚠ 推定値" : "実測ベース"} / 根拠: ${profile.sourceDescription}`
      );
      console.log(`  閾値(LT): ${fmtPacePerKm(profile.ltPaceSecPerKm)}`);
      console.log(
        `  CV: ${fmtPacePerKm(profile.cvPaceSecPerKm.fast)}〜${fmtPacePerKm(profile.cvPaceSecPerKm.slow)}`
      );
      console.log(
        `  ジョグ: ${fmtPacePerKm(profile.jogPaceSecPerKm.fast)}〜${fmtPacePerKm(profile.jogPaceSecPerKm.slow)}`
      );
      console.log("反映するには `plan` を再実行してください。");
      break;
    }
    case "dash": {
      const d = dashboard(repo, flags["date"] ?? today());
      console.log(`=== ダッシュボード ===`);
      if (d.cfe) console.log(`CFE(推定800m): ${fmtTime(d.cfe.estimated800mSec)} (信頼度 ${d.cfe.confidence})`);
      if (d.diagnosis) console.log(`タイプ: ${d.diagnosis.athleteType} / 伸びしろ: ${d.diagnosis.primaryGap}`);
      if (d.currentPhase) console.log(`現在フェーズ: ${d.currentPhase}`);
      if (d.feasibility) {
        console.log(
          d.feasibility.warn
            ? `⚠ ${d.feasibility.message}`
            : `目標は現実的なペース内（必要改善 ${d.feasibility.requiredSecPerWeek.toFixed(2)}秒/週）`
        );
      }
      if (d.acwr.acwr !== undefined) console.log(`ACWR: ${d.acwr.acwr.toFixed(2)} (${d.acwr.rating})`);
      console.log(`週間転移度スコア: ${d.weeklySummary.transfer800mScore.toFixed(2)} / 5`);
      console.log(`高乳酸 直近28日: ${d.weeklySummary.highLactateLast28d}回`);
      const errs = d.violations.filter((v) => v.level === "ERROR");
      const warns = d.violations.filter((v) => v.level === "WARN");
      console.log(`違反: ERROR ${errs.length} / WARN ${warns.length}`);
      for (const v of [...errs, ...warns].slice(0, 8)) {
        console.log(`  [${v.level}] ${v.rule}: ${v.message}`);
      }
      break;
    }
    default:
      console.log(HELP);
  }
}

main();
