import { NextRequest, NextResponse } from "next/server";
import { openRepo } from "@/lib/db/node";
import { resultAudit } from "@/lib/service";

export const dynamic = "force-dynamic";

/**
 * 保存された結果の読み返し。
 * 「入れたタイムとレストがそのまま入っているか」「それが何に使われたか」を返す。
 */
export async function GET(req: NextRequest) {
  const repo = openRepo();
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id が必要です" }, { status: 400 });
  const audit = resultAudit(repo, id);
  if (!audit) return NextResponse.json({ error: "その記録が見つかりません" }, { status: 404 });
  return NextResponse.json({ audit });
}
