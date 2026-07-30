/**
 * Next.js API（app/api/*）の認可判定。フレームワーク非依存にして単体テスト可能にする。
 *
 * セキュリティ・プライバシー監査（2026-07-31）で追加。
 * 「1人利用だから認可は不要」とは判断しない（CLAUDE.md）。
 *
 * 既定の防御は `package.json` の `dev`/`start` を `-H 127.0.0.1` に固定したこと
 * そのもの（同じLAN上の別端末からアクセスできない）。`FORGE_API_TOKEN` は
 * その上に重ねる備えで、未設定なら開発時の摩擦を増やさないためチェックしない。
 *
 * ただし「存在する以上は安全に」という要件があるため、`NODE_ENV=production`
 * （`next build && next start` 相当。ローカル限定待受という前提が崩れて
 * 本番相当でホスティングされる場合）で`FORGE_API_TOKEN`が未設定なら、
 * 黙って無認証で通すのではなく全APIを閉じる（fail closed）。
 * `npm run dev` は`NODE_ENV=development`なので、既存のローカル開発体験は変わらない。
 */
export interface ApiAuthCheck {
  token: string | undefined;
  provided: string | null;
  nodeEnv: string | undefined;
}

export type ApiAuthResult =
  | { ok: true }
  | { ok: false; status: number; message: string };

export function checkApiAuth(input: ApiAuthCheck): ApiAuthResult {
  const { token, provided, nodeEnv } = input;
  if (!token) {
    if (nodeEnv === "production") {
      return {
        ok: false,
        status: 401,
        message:
          "FORGE_API_TOKENが未設定です。本番相当（NODE_ENV=production）ではAPIを保護するため、環境変数FORGE_API_TOKENを設定してください。",
      };
    }
    return { ok: true };
  }
  if (provided !== token) {
    return { ok: false, status: 401, message: "認証が必要です（FORGE_API_TOKEN不一致）" };
  }
  return { ok: true };
}
