/**
 * SQLiteドライバの抽象化。
 * - 本番(Next.js / CLI): better-sqlite3（node.ts）
 * - テスト: bun:sqlite（同一SQLを検証する）
 * どちらも prepare().run/get/all の同期APIを持つため、この最小インターフェースで揃える。
 */
export interface DbStatement {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

export interface DbDriver {
  exec(sql: string): void;
  prepare(sql: string): DbStatement;
  close(): void;
}
