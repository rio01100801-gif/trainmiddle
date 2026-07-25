import { NextRequest, NextResponse } from "next/server";
import { openRepo } from "@/lib/db/node";
import {
  adaptiveProposal,
  adaptiveProposals,
  applyAdaptiveProposal,
  rejectAdaptiveProposal,
} from "@/lib/service";
import { localToday } from "@/lib/core/dates";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const repo = openRepo();
  const p = req.nextUrl.searchParams;
  const today = p.get("date") ?? localToday();
  const env = {
    wbgt: p.get("wbgt") ? Number(p.get("wbgt")) : undefined,
    tempC: p.get("tempC") ? Number(p.get("tempC")) : undefined,
    humidityPct: p.get("humidity") ? Number(p.get("humidity")) : undefined,
  };
  if (p.get("all")) {
    return NextResponse.json({ proposals: adaptiveProposals(repo, today, env) });
  }
  return NextResponse.json(
    adaptiveProposal(repo, today, { sessionId: p.get("sessionId") ?? undefined, ...env })
  );
}

export async function POST(req: NextRequest) {
  const repo = openRepo();
  const body = await req.json();
  const today = body.today ?? localToday();
  if (!body.sessionId) {
    return NextResponse.json({ error: "sessionId が必要です" }, { status: 400 });
  }
  if (body.action === "reject") {
    rejectAdaptiveProposal(repo, body.sessionId, today, body.reason);
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ ok: true, ...applyAdaptiveProposal(repo, body.sessionId, today) });
}
