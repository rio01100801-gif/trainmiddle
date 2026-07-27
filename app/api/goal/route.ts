import { NextRequest, NextResponse } from "next/server";
import { openRepo } from "@/lib/db/node";
import { saveGoalAndRaces } from "@/lib/service";

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
  if (!goal || !races) {
    return NextResponse.json({ error: "目標とレースが必要です" }, { status: 400 });
  }
  try {
    return NextResponse.json({ ok: true, ...saveGoalAndRaces(repo, goal, races) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 }
    );
  }
}
