import { NextRequest, NextResponse } from "next/server";
import { openRepo } from "@/lib/db/node";
import { importFitFile } from "@/lib/service";

export const dynamic = "force-dynamic";

export async function GET() {
  const repo = openRepo();
  return NextResponse.json({ imports: repo.listFitImports() });
}

export async function POST(req: NextRequest) {
  const repo = openRepo();
  const body = await req.json();
  if (!body?.fileName || !body?.rawBytesBase64 || !body?.parse || !body?.autoClassification || !body?.confirmedKinds) {
    return NextResponse.json({ error: "取込内容が不足しています" }, { status: 400 });
  }
  try {
    return NextResponse.json({ ok: true, ...importFitFile(repo, body) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
