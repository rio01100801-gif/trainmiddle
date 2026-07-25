import { NextRequest, NextResponse } from "next/server";
import { openRepo } from "@/lib/db/node";

export const dynamic = "force-dynamic";

export async function GET() {
  const repo = openRepo();
  return NextResponse.json({ changes: repo.listChangeLog(100) });
}

/** 変更の却下（4-5-9: 却下時は理由を記録） */
export async function POST(req: NextRequest) {
  const repo = openRepo();
  const { change, accepted, rejectReason } = await req.json();
  repo.logChange(change, accepted, rejectReason);
  return NextResponse.json({ ok: true });
}
