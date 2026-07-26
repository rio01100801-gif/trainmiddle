import { NextRequest, NextResponse } from "next/server";
import { openRepo } from "@/lib/db/node";
import {
  contactTimeStatus,
  hrUsage,
  limiterAssessment,
  splitAnalysis,
  weeklyReview,
} from "@/lib/service";
import { localToday } from "@/lib/core/dates";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const repo = openRepo();
  const p = req.nextUrl.searchParams;
  const today = p.get("date") ?? localToday();
  if (!repo.getAthlete()) return NextResponse.json({ empty: true });
  return NextResponse.json({
    limiter: limiterAssessment(repo),
    split: splitAnalysis(repo),
    contact: contactTimeStatus(repo, today),
    hr: hrUsage(repo, today),
    review: weeklyReview(repo, today, p.get("weekStart") ?? undefined),
  });
}
