import { NextRequest, NextResponse } from "next/server";
import { openRepo } from "@/lib/db/node";
import { interpretPrescription } from "@/lib/service";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const repo = openRepo();
  const body = await req.json();
  return NextResponse.json(interpretPrescription(repo, String(body.text ?? "")));
}
