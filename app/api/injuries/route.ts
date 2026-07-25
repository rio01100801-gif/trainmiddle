import { NextRequest, NextResponse } from "next/server";
import { openRepo } from "@/lib/db/node";
import type { InjuryLog } from "@/lib/core/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const repo = openRepo();
  return NextResponse.json({ injuries: repo.listInjuries() });
}

export async function POST(req: NextRequest) {
  const repo = openRepo();
  const body = await req.json();
  const injury: InjuryLog = {
    id: body.id ?? `inj-${Date.now()}`,
    date: body.date,
    bodyPart: body.bodyPart,
    painLevel: Number(body.painLevel ?? 0),
    status: body.status ?? "onset",
    sessionId: body.sessionId,
    note: body.note,
  };
  repo.saveInjury(injury);
  return NextResponse.json({ ok: true, injury });
}

export async function DELETE(req: NextRequest) {
  const repo = openRepo();
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id が必要です" }, { status: 400 });
  repo.deleteInjury(id);
  return NextResponse.json({ ok: true });
}
