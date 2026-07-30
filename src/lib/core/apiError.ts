/**
 * Next.js API（app/api/*）が返すエラー形式。
 *
 * 運用整備（2026-07-31）で追加。全ルートを調査した結果、既に
 * `{ error: string }` + 適切なHTTP status（主に400/401）という形に
 * 事実上揃っていた（スタックトレースを返さず、`.message`だけを渡す）。
 *
 * 新しい例外クラス階層は作らない。init/save/load/sync/OAuth/Storage/
 * backup/migration/FIT/ZIP/AppleHealth/SW更新/プラン生成を横断する
 * 大規模なerror code体系への統一は、単一利用者アプリの規模に対して
 * リスク（多数の呼び出し箇所を触る）が見合わないと判断し、今回は行わない。
 *
 * 代わりに、既に実践されている最小限の形をここで型として明文化するだけに留める
 * （挙動は一切変えない）。同期・OAuth周りは既に`ConnectionTest`
 * （app/components/supabase.ts）が`kind: "url"|"key"|"offline"|"timeout"`で
 * retryable相当の分類を持っており、そちらは元から十分に構造化されている。
 */
export interface ApiErrorResponse {
  error: string;
}
