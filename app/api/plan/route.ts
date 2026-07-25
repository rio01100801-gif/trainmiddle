import { NextRequest, NextResponse } from "next/server";
import { openRepo } from "@/lib/db/node";
import { regeneratePlan } from "@/lib/service";
import { localToday } from "@/lib/core/dates";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const repo = openRepo();
  const { startDate } = await req.json();
  try {
    const out = regeneratePlan(repo, startDate ?? localToday());
    return NextResponse.json(out);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
