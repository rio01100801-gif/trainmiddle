import { NextRequest, NextResponse } from "next/server";
import { openRepo } from "@/lib/db/node";
import { addSession, deletePlannedSession, editSession } from "@/lib/service";
import { localToday } from "@/lib/core/dates";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const repo = openRepo();
  const body = await req.json();
  const today = body.today ?? localToday();
  if (body.action === "add") {
    return NextResponse.json(addSession(repo, body.session, today));
  }
  if (!body.sessionId) {
    return NextResponse.json({ error: "sessionId が必要です" }, { status: 400 });
  }
  return NextResponse.json(
    editSession(repo, body.sessionId, body.updates ?? {}, today, {
      force: !!body.force,
      dryRun: !!body.dryRun,
    })
  );
}

export async function DELETE(req: NextRequest) {
  const repo = openRepo();
  const id = req.nextUrl.searchParams.get("sessionId");
  if (!id) return NextResponse.json({ error: "sessionId が必要です" }, { status: 400 });
  const today = req.nextUrl.searchParams.get("date") ?? localToday();
  return NextResponse.json(deletePlannedSession(repo, id, today));
}
