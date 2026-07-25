import { NextRequest, NextResponse } from "next/server";
import { openRepo } from "@/lib/db/node";
import { assignExpectedPaces } from "@/lib/core/rounds";

export const dynamic = "force-dynamic";

export async function GET() {
  const repo = openRepo();
  return NextResponse.json({
    goal: repo.getGoal() ?? null,
    races: repo.listRaces(),
  });
}

export async function POST(req: NextRequest) {
  const repo = openRepo();
  const { goal, races } = await req.json();
  if (races) {
    for (const r of races) {
      repo.saveRace(goal ? assignExpectedPaces(r, goal.targetTimeSec) : r);
    }
  }
  if (goal) repo.saveGoal(goal);
  return NextResponse.json({ ok: true });
}
