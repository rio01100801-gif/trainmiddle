import { NextRequest, NextResponse } from "next/server";
import { openRepo } from "@/lib/db/node";
import { applyCoverageProposal, coverageReview } from "@/lib/service";
import { localToday } from "@/lib/core/dates";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const repo = openRepo();
  const today = req.nextUrl.searchParams.get("date") ?? localToday();
  return NextResponse.json({ review: coverageReview(repo, today) ?? null });
}

export async function POST(req: NextRequest) {
  const repo = openRepo();
  const body = await req.json();
  const today = body.today ?? localToday();
  if (!body.sessionId || !body.category) {
    return NextResponse.json({ error: "sessionId と category が必要です" }, { status: 400 });
  }
  const out = applyCoverageProposal(repo, body.sessionId, body.category, today);
  return NextResponse.json({ ...out, review: coverageReview(repo, today) ?? null });
}
