/**
 * 分析画面「推移」タブ向けの28日間統合タイムライン。
 *
 * なぜ作るか: 負荷・ACWR・睡眠・脚疲労・張り・安静時心拍・シグナルは
 * これまで別々のカードに分散しており、「負荷を上げた日から3日後に脚が重くなった」
 * のような時間差のある関係を画面上で見比べられなかった。
 * 新しいデータモデルは増やさず、既存の DailyCheck / 日次負荷 / セッション を
 * 同じ日付軸に並べ直すだけ（表示の統合であり、新規の推定ロジックは持たない）。
 */
import type { DailyCheck, Session, Signal } from "./types";
import { addDays } from "./dates";

export interface TimelineDay {
  date: string;
  load: number;
  acwr?: number;
  sleepQuality?: number;
  legFatigue?: number;
  muscleTightness?: number;
  restingHr?: number;
  signal?: Signal;
  /** その日が完全休養（予定または実施）だったか */
  isRest: boolean;
  /** その日にレース区分の実測（FitnessMarker type="race"）があったか */
  isRace: boolean;
}

export interface BuildTimelineInput {
  today: string;
  days?: number;
  loadSeries: { date: string; load: number; acwr?: number }[];
  dailyChecks: DailyCheck[];
  sessions: Session[];
  raceDates: string[];
}

/**
 * 直近 `days` 日分（既定28日）を作る。loadSeriesは呼び出し側が
 * 既に計算済みのものをそのまま使う（ACWRの計算をここで重複させない）。
 */
export function buildTimeline(input: BuildTimelineInput): TimelineDay[] {
  const days = input.days ?? 28;
  const loadByDate = new Map(input.loadSeries.map((p) => [p.date, p]));
  const checkByDate = new Map(input.dailyChecks.map((c) => [c.date, c]));
  const restDates = new Set(
    input.sessions.filter((s) => s.category === "off").map((s) => s.date)
  );
  const raceDates = new Set(input.raceDates);

  const out: TimelineDay[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = addDays(input.today, -i);
    const load = loadByDate.get(date);
    const check = checkByDate.get(date);
    out.push({
      date,
      load: load?.load ?? 0,
      acwr: load?.acwr,
      sleepQuality: check?.sleepQuality,
      legFatigue: check?.legFatigue,
      muscleTightness: check?.muscleTightness,
      restingHr: check?.restingHr,
      signal: check?.signal,
      isRest: restDates.has(date),
      isRace: raceDates.has(date),
    });
  }
  return out;
}
