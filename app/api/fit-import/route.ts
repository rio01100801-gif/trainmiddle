import { NextRequest, NextResponse } from "next/server";
import { openRepo } from "@/lib/db/node";
import { importFitFile, rebuildFitDerived } from "@/lib/service";

export const dynamic = "force-dynamic";

export async function GET() {
  const repo = openRepo();
  return NextResponse.json({ imports: repo.listFitImports() });
}

export async function POST(req: NextRequest) {
  const repo = openRepo();
  const body = await req.json();
  // 保存してある元ファイルから、いまの解析ロジックで作り直す
  if (body?.rebuild) {
    try {
      return NextResponse.json({ ok: true, rebuild: rebuildFitDerived(repo) });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 400 });
    }
  }
  if (!body?.fileName || !body?.rawBytesBase64 || !body?.parse || !body?.autoClassification || !body?.confirmedKinds) {
    return NextResponse.json({ error: "取込内容が不足しています" }, { status: 400 });
  }
  try {
    return NextResponse.json({ ok: true, ...importFitFile(repo, body) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
