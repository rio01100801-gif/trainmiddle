import { NextRequest, NextResponse } from "next/server";
import { openRepo } from "@/lib/db/node";
import { dashboard } from "@/lib/service";
import { localToday } from "@/lib/core/dates";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const repo = openRepo();
  const date =
    req.nextUrl.searchParams.get("date") ?? localToday();
  try {
    return NextResponse.json(dashboard(repo, date));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
