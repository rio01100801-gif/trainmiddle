import { NextRequest, NextResponse } from "next/server";
import { openRepo } from "@/lib/db/node";
import { deleteResult, previousEntryFor, processResult } from "@/lib/service";
import type { SessionResult } from "@/lib/core/types";

export const dynamic = "force-dynamic";

/** カレンダーの日付状態（記録済み/暑熱フラグ）の判定に使う */
export async function GET(req: NextRequest) {
  const repo = openRepo();
  // D-3: 「前回と同じ」で読み込む対象を返す
  const prevFor = req.nextUrl.searchParams.get("previousFor");
  if (prevFor) {
    return NextResponse.json({ previous: previousEntryFor(repo, prevFor) ?? null });
  }
  return NextResponse.json({ results: repo.listResults() });
}

export async function POST(req: NextRequest) {
  const repo = openRepo();
  const body = await req.json();
  try {
    const out = processResult(repo, {
      id: `res-${Date.now()}`,
      actualLapsSec: [],
      ...body,
    } as SessionResult);
    return NextResponse.json(out);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  const repo = openRepo();
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id が必要です" }, { status: 400 });
  try {
    deleteResult(repo, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
