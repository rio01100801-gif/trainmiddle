/**
 * Next.js / Node 実行用のドライバ生成。
 *
 * SQLiteの実体は環境に応じて選ぶ。
 *   1. node:sqlite      … Node 22.5以降に標準で入っている。ビルド不要
 *   2. better-sqlite3   … 上が無い古いNode向け
 *
 * node:sqlite を先に見るのは、better-sqlite3 がネイティブビルドを要求し、
 * WindowsではVisual Studio Build Toolsが無いと失敗するため。
 * 標準で入っているものを使えば、環境構築でつまずく箇所がひとつ減る。
 *
 * テスト環境（Bun）では bun:sqlite を使うため、このファイルはテスト対象外。
 */
import type { DbDriver } from "./driver";
import { Repo } from "./repo";
import path from "path";
import fs from "fs";
import * as nodeModule from "module";

let repoSingleton: Repo | undefined;

interface BetterSqliteDatabase extends DbDriver {
  pragma(sql: string): unknown;
}

type BetterSqliteConstructor = new (file: string) => BetterSqliteDatabase;

/**
 * 古いNode向けのoptional dependencyを実行時にだけ解決する。
 *
 * 文字列リテラルをrequireすると、実際にはnode:sqliteを使うNode 22.5以降でも
 * Next.jsがビルド時の必須依存として扱い、optional installが失敗した環境で
 * "Can't resolve better-sqlite3" になるため、Nodeの実行時requireを明示する。
 */
function loadBetterSqlite(): BetterSqliteConstructor {
  const createRuntimeRequire = Reflect.get(nodeModule, "createRequire") as typeof nodeModule.createRequire;
  const runtimeRequire = createRuntimeRequire(path.join(process.cwd(), "package.json"));
  const moduleName = ["better", "sqlite3"].join("-");
  return runtimeRequire(moduleName) as BetterSqliteConstructor;
}

/** 環境に応じてSQLiteの実体を選ぶ */
function openDriver(file: string): DbDriver {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(file);
    db.exec("PRAGMA journal_mode = WAL");
    const plain = (row: any) => (row ? { ...row } : row);
    return {
      exec: (sql: string) => db.exec(sql),
      prepare: (sql: string) => {
        const stmt = db.prepare(sql);
        return {
          run: (...p: unknown[]) => stmt.run(...p),
          get: (...p: unknown[]) => plain(stmt.get(...p)),
          all: (...p: unknown[]) => (stmt.all(...p) as any[]).map(plain),
        };
      },
      close: () => db.close(),
    };
  } catch {
    // node:sqlite が無い古いNodeのときだけ better-sqlite3 に落とす
  }
  const Database = loadBetterSqlite();
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  return {
    exec: (sql: string) => db.exec(sql),
    prepare: (sql: string) => db.prepare(sql),
    close: () => db.close(),
  };
}

export function openRepo(dbPath?: string): Repo {
  if (repoSingleton && !dbPath) return repoSingleton;
  const file = dbPath ?? path.join(process.cwd(), "data", "train800.db");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const driver = openDriver(file);
  const repo = new Repo(driver);
  if (!dbPath) repoSingleton = repo;
  return repo;
}
