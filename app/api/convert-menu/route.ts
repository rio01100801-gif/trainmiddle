import { NextRequest, NextResponse } from "next/server";
import { openRepo } from "@/lib/db/node";
import { convertMenuForMe } from "@/lib/service";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const repo = openRepo();
  const body = await req.json();
  return NextResponse.json(
    convertMenuForMe(repo, String(body.prescription ?? ""), Number(body.theirPb800Sec))
  );
}
