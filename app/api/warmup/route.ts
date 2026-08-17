import { NextRequest, NextResponse } from "next/server";
import { openRepo } from "@/lib/db/node";
import { warmupAnalysis, warmupOptionsFor } from "@/lib/service";

export const dynamic = "force-dynamic";

/**
 * ポイント練習前のアップ（主練習の子データ）。
 *
 * 保存は `/api/results` を通る——アップは結果の一部なので、
 * 別の保存口を作らない。ここは**読むだけ**。
 * 書き込む口を分けると、アップだけ保存されて主練習が保存されない状態が作れてしまう。
 *
 * ⚠️ 対になるPWA側の実装が `pwa/api-shim.ts` にある。片方だけ直さないこと。
 */
export async function GET(req: NextRequest) {
  const repo = openRepo();
  const sessionId = req.nextUrl.searchParams.get("sessionId");

  if (sessionId) {
    /*
     * 二重計上の判断に要るので、画面がいまどちらのモードで入力しているかを受け取る。
     * 持続走はファイル全体を1本として扱うため、アップが主練習側に既に入っている。
     */
    const mainIsContinuous = req.nextUrl.searchParams.get("mode") === "continuous";
    return NextResponse.json({ options: warmupOptionsFor(repo, sessionId, { mainIsContinuous }) });
  }

  // 分析。ここでは何も変えない（提案として出すだけ）
  return NextResponse.json({ insight: warmupAnalysis(repo) });
}
