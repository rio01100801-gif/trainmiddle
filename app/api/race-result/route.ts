import { NextRequest, NextResponse } from "next/server";
import { openRepo } from "@/lib/db/node";
import { processRaceResult } from "@/lib/service";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const repo = openRepo();
  const { raceId, rounds, date } = await req.json();
  try {
    const out = processRaceResult(repo, raceId, rounds, date);
    return NextResponse.json(out);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
