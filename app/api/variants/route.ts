import { NextRequest, NextResponse } from "next/server";
import { openRepo } from "@/lib/db/node";
import { applySessionVariant, sessionPlanVariants } from "@/lib/service";
import { localToday } from "@/lib/core/dates";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const repo = openRepo();
  const p = req.nextUrl.searchParams;
  const id = p.get("sessionId");
  if (!id) return NextResponse.json({ error: "sessionId が必要です" }, { status: 400 });
  return NextResponse.json(sessionPlanVariants(repo, id, p.get("date") ?? localToday()));
}

export async function POST(req: NextRequest) {
  const repo = openRepo();
  const body = await req.json();
  const today = body.today ?? localToday();
  if (!body.sessionId || !body.variantKey) {
    return NextResponse.json({ error: "sessionId と variantKey が必要です" }, { status: 400 });
  }
  return NextResponse.json(applySessionVariant(repo, body.sessionId, body.variantKey, today));
}
