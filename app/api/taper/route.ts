import { NextRequest, NextResponse } from "next/server";
import { openRepo } from "@/lib/db/node";
import { applyTaperPlan, rejectTaperPlan, taperPlan } from "@/lib/service";
import { localToday } from "@/lib/core/dates";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const repo = openRepo();
  const today = req.nextUrl.searchParams.get("date") ?? localToday();
  return NextResponse.json(taperPlan(repo, today));
}

export async function POST(req: NextRequest) {
  const repo = openRepo();
  const body = await req.json();
  const today = body.today ?? localToday();
  if (body.action === "reject") {
    rejectTaperPlan(repo, today, body.reason);
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ ok: true, ...applyTaperPlan(repo, today, body.sessionIds) });
}
