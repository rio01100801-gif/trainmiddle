import { NextRequest, NextResponse } from "next/server";
import { openRepo } from "@/lib/db/node";
import { refreshNearHorizon } from "@/lib/service";
import { localToday } from "@/lib/core/dates";
import { CONFIRM_HORIZON_DAYS } from "@/lib/core/horizon";

export const dynamic = "force-dynamic";

/**
 * 確定範囲（今日〜14日）だけを今のCFEで作り直す。
 *
 * 通常は結果を登録したときに自動で走るので、ここを叩く必要はない。
 * 手で叩けるようにしてあるのは、CFEを直接いじったあとや、
 * 「いま画面に出ている設定が古くないか」を確かめたいときのため。
 * 予定を増やしたり日付を動かしたりはしない（それは /api/plan の再生成）。
 */
export async function POST(req: NextRequest) {
  const repo = openRepo();
  const body = await req.json().catch(() => ({}));
  const today = body?.today ?? localToday();
  try {
    const changes = refreshNearHorizon(repo, today);
    return NextResponse.json({ changes, horizonDays: CONFIRM_HORIZON_DAYS });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
