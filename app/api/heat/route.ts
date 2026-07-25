import { NextRequest, NextResponse } from "next/server";
import { openRepo } from "@/lib/db/node";
import {
  assessHeatBlock,
  HEAT_BLOCK_CONTENT,
  heatBlockTimingCheck,
  planHeatBlock,
  raceDayHeatChecklist,
} from "@/lib/core/heat";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const repo = openRepo();
  const athlete = repo.getAthlete();
  const blocks = repo.listHeatBlocks();
  const races = repo.listRaces();
  const detail = blocks.map((b) => {
    const entries = repo.listHeatEntries(b.id);
    const race = races.find((r) => r.id === b.targetRaceId);
    return {
      block: b,
      entries,
      assessment: athlete?.weightKg
        ? assessHeatBlock(entries, athlete.weightKg)
        : undefined,
      timingWarning: race ? heatBlockTimingCheck(b, race) : undefined,
    };
  });
  const expectedTemp = req.nextUrl.searchParams.get("temp");
  return NextResponse.json({
    blocks: detail,
    content: HEAT_BLOCK_CONTENT,
    raceDayChecklist: athlete
      ? raceDayHeatChecklist(athlete, expectedTemp ? Number(expectedTemp) : 30)
      : undefined,
  });
}

export async function POST(req: NextRequest) {
  const repo = openRepo();
  const body = await req.json();
  if (body.action === "plan") {
    const race = repo.listRaces().find((r) => r.id === body.raceId);
    if (!race) return NextResponse.json({ error: "レースが見つかりません" }, { status: 404 });
    const block = planHeatBlock(race, body.blockDays ?? 12);
    repo.saveHeatBlock(block);
    return NextResponse.json({ block });
  }
  if (body.action === "entry") {
    repo.saveHeatEntry(body.blockId, body.entry);
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "不明なaction" }, { status: 400 });
}
