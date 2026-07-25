import { NextRequest, NextResponse } from "next/server";
import { openRepo } from "@/lib/db/node";
import { processSkip } from "@/lib/service";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const repo = openRepo();
  const { sessionId, reason } = await req.json();
  try {
    const out = processSkip(repo, sessionId, reason);
    return NextResponse.json(out);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
