import { NextRequest, NextResponse } from "next/server";
import { openRepo } from "@/lib/db/node";
import {
  discardSessionProgress,
  finishSessionProgress,
  saveSessionProgress,
  sessionProgress,
} from "@/lib/service";
import { localToday } from "@/lib/core/dates";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const repo = openRepo();
  const id = req.nextUrl.searchParams.get("sessionId");
  if (!id) return NextResponse.json({ error: "sessionId が必要です" }, { status: 400 });
  try {
    return NextResponse.json(sessionProgress(repo, id));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function POST(req: NextRequest) {
  const repo = openRepo();
  const body = await req.json();
  const today = body.today ?? localToday();
  try {
    if (body.action === "finish") {
      return NextResponse.json({ ok: true, ...finishSessionProgress(repo, body.sessionId, body) });
    }
    if (body.action === "discard") {
      discardSessionProgress(repo, body.sessionId);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json(saveSessionProgress(repo, body.sessionId, body.reps ?? [], today));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
