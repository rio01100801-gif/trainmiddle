import { NextRequest, NextResponse } from "next/server";
import { openRepo } from "@/lib/db/node";
import {
  conditionComparison,
  deleteShoe,
  listShoes,
  saveShoe,
  shoeUsageList,
  shoeAdviceFor,
} from "@/lib/service";
import type { Shoe } from "@/lib/core/shoes";
import { localToday } from "@/lib/core/dates";

export const dynamic = "force-dynamic";

/**
 * シューズの登録と使用距離。
 *
 * ⚠️ 対になるPWA側の実装が `pwa/api-shim.ts` にある。片方だけ直さないこと。
 */
export async function GET(req: NextRequest) {
  const repo = openRepo();
  /*
   * その日の練習に合う靴。判断は core/shoeRecommend.ts だけが持つ。
   * 画面ごとに別の理屈を書かないよう、ここから配る。
   */
  const sessionId = req.nextUrl.searchParams.get("sessionId");
  if (sessionId) {
    const today = req.nextUrl.searchParams.get("date") ?? localToday();
    return NextResponse.json({ advice: shoeAdviceFor(repo, sessionId, today) });
  }
  return NextResponse.json({
    shoes: listShoes(repo),
    usage: shoeUsageList(repo),
    // 条件タグ別のRPE差。設定は動かさない（見て本人が判断する材料）
    conditionSplits: conditionComparison(repo),
  });
}

export async function POST(req: NextRequest) {
  const repo = openRepo();
  const body = await req.json();
  const shoe: Shoe = {
    id: body.id ?? `shoe-${Date.now()}`,
    name: body.name ?? "",
    kind: body.kind ?? "trainer",
    note: body.note,    retired: body.retired,    // 本人が設定した性格（推薦の材料）。未設定の項目は種類から埋める
    profile: body.profile,
  };
  try {
    return NextResponse.json({ ok: true, shoes: saveShoe(repo, shoe), usage: shoeUsageList(repo) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  const repo = openRepo();
  const shoeId = req.nextUrl.searchParams.get("shoeId");
  if (!shoeId) return NextResponse.json({ error: "shoeId が必要です" }, { status: 400 });
  const out = deleteShoe(repo, shoeId);
  if (!out.deleted) return NextResponse.json({ error: out.reason }, { status: 400 });
  return NextResponse.json({ ok: true, shoes: listShoes(repo), usage: shoeUsageList(repo) });
}
