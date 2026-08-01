import { NextRequest, NextResponse } from "next/server";
import { openRepo } from "@/lib/db/node";
import { processSkip, restoreSkippedSession } from "@/lib/service";
import { localToday } from "@/lib/core/dates";

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

/** 中止の取り消し（押し間違いを戻す） */
export async function DELETE(req: NextRequest) {
  const repo = openRepo();
  const sessionId = req.nextUrl.searchParams.get("sessionId") ?? "";
  const today = req.nextUrl.searchParams.get("date") ?? localToday();
  return NextResponse.json(restoreSkippedSession(repo, sessionId, today));
}
