import { NextRequest, NextResponse } from "next/server";
import { openRepo } from "@/lib/db/node";
import { importAppleHealth } from "@/lib/service";
import { localToday } from "@/lib/core/dates";

export const dynamic = "force-dynamic";

export async function GET() {
  const repo = openRepo();
  return NextResponse.json({ syncs: repo.listSyncs(10) });
}

export async function POST(req: NextRequest) {
  const repo = openRepo();
  const body = await req.json();
  if (!body?.xml) {
    return NextResponse.json({ error: "ファイルの中身が空です" }, { status: 400 });
  }
  try {
    return NextResponse.json(
      importAppleHealth(repo, body.xml, localToday(), { days: body.days ?? 120 })
    );
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
