import { NextRequest, NextResponse } from "next/server";
import { openRepo } from "@/lib/db/node";

export const dynamic = "force-dynamic";

export async function GET() {
  const repo = openRepo();
  return NextResponse.json({ athlete: repo.getAthlete() ?? null });
}

export async function POST(req: NextRequest) {
  const repo = openRepo();
  const body = await req.json();
  repo.saveAthlete({ id: "athlete-1", injuryHistory: [], ...body });
  return NextResponse.json({ ok: true });
}
