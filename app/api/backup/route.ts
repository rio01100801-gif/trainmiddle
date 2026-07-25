import { NextRequest, NextResponse } from "next/server";
import { openRepo } from "@/lib/db/node";
import { backupStatus, exportBackup, importBackup } from "@/lib/service";
import { localToday } from "@/lib/core/dates";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const repo = openRepo();
  const today = req.nextUrl.searchParams.get("date") ?? localToday();
  if (req.nextUrl.searchParams.get("download")) {
    return NextResponse.json(exportBackup(repo, new Date().toISOString()));
  }
  return NextResponse.json(backupStatus(repo, today));
}

export async function POST(req: NextRequest) {
  const repo = openRepo();
  const body = await req.json();
  try {
    return NextResponse.json({
      ok: true,
      report: importBackup(repo, body.file, body.mode === "merge" ? "merge" : "replace"),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
