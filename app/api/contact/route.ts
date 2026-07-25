import { NextRequest, NextResponse } from "next/server";
import { openRepo } from "@/lib/db/node";
import { contactTimeStatus, importContactSamples, listContactSamples } from "@/lib/service";
import { parseContactCsv } from "@/lib/core/contactTime";
import { localToday } from "@/lib/core/dates";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const repo = openRepo();
  const today = req.nextUrl.searchParams.get("date") ?? localToday();
  return NextResponse.json({
    samples: listContactSamples(repo),
    assessment: contactTimeStatus(repo, today),
  });
}

export async function POST(req: NextRequest) {
  const repo = openRepo();
  const body = await req.json();
  const today = body.today ?? localToday();
  const samples = body.csv ? parseContactCsv(String(body.csv)) : body.samples ?? [];
  if (samples.length === 0) {
    return NextResponse.json({ error: "読み取れる行がありませんでした" }, { status: 400 });
  }
  const out = importContactSamples(repo, samples);
  return NextResponse.json({ ok: true, ...out, assessment: contactTimeStatus(repo, today) });
}
