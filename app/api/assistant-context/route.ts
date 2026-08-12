import { NextRequest, NextResponse } from "next/server";
import { openRepo } from "@/lib/db/node";
import { assistantContext } from "@/lib/service";
import { localToday } from "@/lib/core/dates";

export const dynamic = "force-dynamic";

/**
 * 相談（AI）に渡す文脈を返す。読むだけで、何も保存しない。
 *
 * ⚠️ 対になるPWA側の実装が `pwa/api-shim.ts` にある。片方だけ直さないこと。
 */
export async function GET(req: NextRequest) {
  const repo = openRepo();
  const today = req.nextUrl.searchParams.get("date") ?? localToday();
  return NextResponse.json({ context: assistantContext(repo, today) });
}
