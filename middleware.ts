import { NextRequest, NextResponse } from "next/server";

/**
 * 対象3: Next.js APIの認証・認可（P0監査）。
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
 * これはその上に重ねる備え。`FORGE_API_TOKEN` を設定した場合だけ、
 * 全APIルートに共有シークレットの一致を要求する。未設定（既定）なら
 * ローカル開発の摩擦を増やさないためチェックしない——ローカルのみ待受と
 * いう前提が崩れた場合（意図的なポート転送・将来のホスティング等）への
 * 備えとして、必要な人だけが有効化する。
 */
export function middleware(req: NextRequest) {
  const token = process.env.FORGE_API_TOKEN;
  if (!token) return NextResponse.next();

  const provided = req.headers.get("x-forge-api-token");
  if (provided !== token) {
    return NextResponse.json({ error: "認証が必要です（FORGE_API_TOKEN不一致）" }, { status: 401 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
