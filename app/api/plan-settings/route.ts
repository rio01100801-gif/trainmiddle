import { NextRequest, NextResponse } from "next/server";
import { openRepo } from "@/lib/db/node";
import {
  normalizeWeekTemplate,
  validateWeekTemplate,
  type CustomMenu,
} from "@/lib/core/weekTemplate";

export const dynamic = "force-dynamic";

export async function GET() {
  const repo = openRepo();
  const weekTemplate = repo.getWeekTemplate();
  return NextResponse.json({
    weekTemplate: weekTemplate ?? null,
    customMenus: repo.listCustomMenus(),
    templateViolations: weekTemplate ? validateWeekTemplate(weekTemplate) : [],
  });
}

export async function POST(req: NextRequest) {
  const repo = openRepo();
  const body = await req.json();
  if (body.weekTemplate) {
    repo.saveWeekTemplate(normalizeWeekTemplate(body.weekTemplate));
  }
  if (body.customMenu) {
    const m: CustomMenu = {
      id: body.customMenu.id ?? `cm-${Date.now()}`,
      name: body.customMenu.name,
      category: body.customMenu.category,
      source: body.customMenu.source ?? "self",
      prescription: body.customMenu.prescription,
      distanceM: body.customMenu.distanceM,
      reps: body.customMenu.reps,
      restNote: body.customMenu.restNote,
      note: body.customMenu.note,
      timesUsed: body.customMenu.timesUsed,
      lastUsedDate: body.customMenu.lastUsedDate,
      active: body.customMenu.active,
    };
    repo.saveCustomMenu(m);
  }
  return NextResponse.json({
    ok: true,
    templateViolations: body.weekTemplate
      ? validateWeekTemplate(normalizeWeekTemplate(body.weekTemplate))
      : [],
  });
}

export async function DELETE(req: NextRequest) {
  const repo = openRepo();
  const menuId = req.nextUrl.searchParams.get("menuId");
  if (!menuId) return NextResponse.json({ error: "menuId が必要です" }, { status: 400 });
  repo.deleteCustomMenu(menuId);
  return NextResponse.json({ ok: true });
}
