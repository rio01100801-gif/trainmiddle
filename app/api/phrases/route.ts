import { NextRequest, NextResponse } from "next/server";
import { openRepo } from "@/lib/db/node";
import { listPhrases, savePhrase, deletePhrase } from "@/lib/service";
import type { PhraseRule } from "@/lib/core/bulkImport";

export const dynamic = "force-dynamic";

export async function GET() {
  const repo = openRepo();
  return NextResponse.json({ phrases: listPhrases(repo) });
}

export async function POST(req: NextRequest) {
  const repo = openRepo();
  const body = await req.json();
  const p = body.phrase as PhraseRule;
  if (!p?.phrase?.trim() || !p.kind) {
    return NextResponse.json({ error: "語と種類は必須です" }, { status: 400 });
  }
  savePhrase(repo, { ...p, id: p.id ?? `ph-${Date.now()}`, phrase: p.phrase.trim() });
  return NextResponse.json({ ok: true, phrases: listPhrases(repo) });
}

export async function DELETE(req: NextRequest) {
  const repo = openRepo();
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id が必要です" }, { status: 400 });
  deletePhrase(repo, id);
  return NextResponse.json({ ok: true, phrases: listPhrases(repo) });
}
