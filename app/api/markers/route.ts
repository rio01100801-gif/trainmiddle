import { NextRequest, NextResponse } from "next/server";
import { openRepo } from "@/lib/db/node";
import { buildAerobicProfile } from "@/lib/core/pace";
import type { FitnessMarker } from "@/lib/core/types";
import { localToday } from "@/lib/core/dates";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const repo = openRepo();
  const today =
    req.nextUrl.searchParams.get("date") ?? localToday();
  const markers = repo.listMarkers();
  return NextResponse.json({
    markers,
    aerobicProfile: buildAerobicProfile(
      markers,
      today,
      repo.getCfe()?.estimated800mSec
    ),
  });
}

/**
 * 有酸素系の実測データ（3-3 FitnessMarker）の登録。
 * 有酸素の設定ペースは800mタイムからの逆算では精度が出ないため、
 * ここに入力された実測からLT・CV・ジョグを算出する（仕様書 4-2）。
 */
export async function POST(req: NextRequest) {
  const repo = openRepo();
  const body = await req.json();
  const marker: FitnessMarker = {
    id: body.id ?? `fm-${Date.now()}`,
    date: body.date,
    type: body.type ?? "workout",
    description: body.description ?? "",
    resultLapsSec: body.resultLapsSec ?? [],
    lapDistancesM: body.lapDistancesM,
    avgHr: body.avgHr,
    maxHr: body.maxHr,
    rpe: body.rpe,
    conditionNote: body.conditionNote,
  };
  repo.saveMarker(marker);
  const markers = repo.listMarkers();
  return NextResponse.json({
    ok: true,
    aerobicProfile: buildAerobicProfile(
      markers,
      marker.date,
      repo.getCfe()?.estimated800mSec
    ),
  });
}
