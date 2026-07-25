import { NextRequest, NextResponse } from "next/server";
import { openRepo } from "@/lib/db/node";
import { processDailyCheck } from "@/lib/service";

export const dynamic = "force-dynamic";

export async function GET() {
  const repo = openRepo();
  return NextResponse.json({ checks: repo.listDailyChecks() });
}

export async function POST(req: NextRequest) {
  const repo = openRepo();
  const body = await req.json();
  const out = processDailyCheck(repo, body);
  return NextResponse.json(out);
}
