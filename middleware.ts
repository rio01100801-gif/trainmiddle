import { NextRequest, NextResponse } from "next/server";
import { checkApiAuth } from "./src/lib/core/apiAuth";

/**
 * 対象3: Next.js APIの認証・認可（P0監査）。セキュリティ・プライバシー監査で拡張。
 *
 * 配信されているPWA（gh-pages）はこのNext.jsサーバーを一切使わない
 * （`pwa/api-shim.ts` がIndexedDBに直接アクセスするため）。このAPIが
 * 動くのは `npm run dev` / `npm run start` でのローカル動作確認時だけだが、
 * 「1人利用だから認可は不要」とは判断しない（CLAUDE.md）。
 *
 * 一番の対策は `package.json` の `dev`/`start` を `-H 127.0.0.1` に固定した
 * ことそのもの（既定の `0.0.0.0` 待受だと同じLAN上の別端末から
 * `/api/backup?download=1` で全データを読めてしまっていた）。
 *
 * これはその上に重ねる備え。判定ロジックは `src/lib/core/apiAuth.ts`
 * （フレームワーク非依存・単体テスト可能）。`FORGE_API_TOKEN` を設定した
 * 場合はヘッダの一致を要求し、未設定でも`NODE_ENV=production`（本番相当の
 * 起動）なら無認証で通さず閉じる。`npm run dev`は development のため、
 * ローカル開発の摩擦は増えない。
 */
export function middleware(req: NextRequest) {
  const result = checkApiAuth({
    token: process.env.FORGE_API_TOKEN,
    provided: req.headers.get("x-forge-api-token"),
    nodeEnv: process.env.NODE_ENV,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: result.status });
  }
  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
