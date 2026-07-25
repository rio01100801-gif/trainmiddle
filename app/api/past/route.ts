import { NextRequest, NextResponse } from "next/server";
import { openRepo } from "@/lib/db/node";
import {
  addPastEntry,
  assessFitness,
  applyAssessedCfe,
  deletePastEntry,
  importBulkRows,
  previewBulkText,
} from "@/lib/service";
import { localToday } from "@/lib/core/dates";
import type { PastEntry } from "@/lib/core/backfill";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const repo = openRepo();
  const today = req.nextUrl.searchParams.get("date") ?? localToday();
  return NextResponse.json({
    entries: repo.listPastEntries(),
    assessment: repo.getAthlete() ? assessFitness(repo, today) : null,
  });
}

export async function POST(req: NextRequest) {
  const repo = openRepo();
  const body = await req.json();
  const today = body.today ?? localToday();

  // F-2: 貼り付けテキストの解釈（保存しない）
  if (body.previewText !== undefined) {
    return NextResponse.json({ rows: previewBulkText(repo, String(body.previewText), today) });
  }

  // F-2: 確定した行をまとめて登録
  if (Array.isArray(body.rows)) {
    const out = importBulkRows(repo, body.rows);
    return NextResponse.json({
      ok: true,
      ...out,
      entries: repo.listPastEntries(),
      assessment: assessFitness(repo, today),
    });
  }

  if (body.apply) {
    try {
      const out = applyAssessedCfe(repo, today);
      return NextResponse.json({ ok: true, ...out, assessment: assessFitness(repo, today) });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 400 });
    }
  }

  const e = body.entry as PastEntry;
  if (!e || !e.date || !e.kind) {
    return NextResponse.json({ error: "日付と種類は必須です" }, { status: 400 });
  }
  addPastEntry(repo, { ...e, id: e.id ?? `pe-${Date.now()}` });
  return NextResponse.json({
    ok: true,
    entries: repo.listPastEntries(),
    assessment: assessFitness(repo, today),
  });
}

export async function DELETE(req: NextRequest) {
  const repo = openRepo();
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id が必要です" }, { status: 400 });
  deletePastEntry(repo, id);
  const today = req.nextUrl.searchParams.get("date") ?? localToday();
  return NextResponse.json({
    ok: true,
    entries: repo.listPastEntries(),
    assessment: assessFitness(repo, today),
  });
}
