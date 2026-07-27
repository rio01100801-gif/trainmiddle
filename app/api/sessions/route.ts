import { NextRequest, NextResponse } from "next/server";
import { openRepo } from "@/lib/db/node";
import { buildRuleContext } from "@/lib/service";
import { runRuleEngine } from "@/lib/core/rules";
import type { Session } from "@/lib/core/types";
import { localToday } from "@/lib/core/dates";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const repo = openRepo();
  const from = req.nextUrl.searchParams.get("from") ?? undefined;
  const to = req.nextUrl.searchParams.get("to") ?? undefined;
  return NextResponse.json({
    sessions: repo.listSessions(from, to),
    strengthSessions: repo.listStrengths(from, to),
  });
}

/** 新規セッション追加（チーム練習等の固定枠を含む） */
export async function POST(req: NextRequest) {
  const repo = openRepo();
  const body = await req.json();
  const session = {
    id: `s-user-${Date.now()}`,
    status: "planned",
    origin: "manual",
    userEdited: true,
    targetPaces: [],
    transfer800m: 3,
    transfer1500m: 3,
    riskLevel: "mid",
    phase: "Specific",
    timeOfDay: "pm",
    isFixed: false,
    ...body,
  } as Session;
  repo.saveSession(session);
  const violations = runRuleEngine(
    buildRuleContext(repo, localToday())
  );
  return NextResponse.json({ session, violations });
}

/** セッション移動・変更（ドラッグ移動 → 即座にルール再チェック） */
export async function PATCH(req: NextRequest) {
  const repo = openRepo();
  const { id, ...updates } = await req.json();
  const session = repo.getSession(id);
  if (!session) {
    return NextResponse.json({ error: "セッションが見つかりません" }, { status: 404 });
  }
  // RULE-15: 固定セッションは移動・削除・強度変更をしない
  if (session.isFixed && (updates.date || updates.category || updates.prescription)) {
    return NextResponse.json(
      {
        error:
          "固定セッション（チーム練習等）は移動・変更できません（RULE-15）。前後の自由枠を組み替えてください。",
      },
      { status: 400 }
    );
  }
  repo.saveSession({ ...session, ...updates, status: "modified", userEdited: true });
  const violations = runRuleEngine(
    buildRuleContext(repo, localToday())
  );
  return NextResponse.json({ ok: true, violations });
}
