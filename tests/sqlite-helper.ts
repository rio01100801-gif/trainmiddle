/**
 * テスト用インメモリDB。実行環境で自動的に切り替える。
 *
 *  1. Bun          … bun:sqlite（このリポジトリのサンドボックス検証用）
 *  2. Node 22.5+   … node:sqlite（Node本体に入っているSQLite。ビルド不要）
 *  3. それ以外      … better-sqlite3
 *
 * node:sqlite を2番目に置いているのは、Windowsで better-sqlite3 のビルドが
 * よく失敗するため。Node 24 では標準で入っているので、
 * Visual Studio Build Tools を入れなくてもテストが走る。
 * どれを通っても Repo と SQL は同一なので、検証対象は変わらない。
 */
import { createRequire } from "module";
import type { DbDriver } from "@/lib/db/driver";
import { Repo } from "@/lib/db/repo";

const req = createRequire(import.meta.url);

export function memRepo(): Repo {
  return new Repo(memDriver());
}

export function memDriver(): DbDriver {
  const isBun =
    typeof (process as { versions?: { bun?: string } }).versions?.bun === "string";

  if (isBun) {
    const { Database } = req("bun:sqlite");
    const db = new Database(":memory:");
    return {
      exec: (sql: string) => db.exec(sql),
      prepare: (sql: string) => {
        const stmt = db.query(sql);
        return {
          run: (...p: unknown[]) => stmt.run(...(p as never[])),
          get: (...p: unknown[]) => stmt.get(...(p as never[])),
          all: (...p: unknown[]) => stmt.all(...(p as never[])),
        };
      },
      close: () => db.close(),
    };
  }

  try {
    const { DatabaseSync } = req("node:sqlite");
    const db = new DatabaseSync(":memory:");
    return nodeSqliteDriver(db);
  } catch {
    // node:sqlite が無い古いNodeのときだけ better-sqlite3 に落とす
  }

  const Database = req("better-sqlite3");
  const db = new Database(":memory:");
  return {
    exec: (sql: string) => db.exec(sql),
    prepare: (sql: string) => db.prepare(sql),
    close: () => db.close(),
  };
}

/**
 * node:sqlite の薄いラッパ。
 * better-sqlite3 とほぼ同じ形だが、
 * 取り出した行が null プロトタイプのオブジェクトになる点だけ違う。
 * JSONカラムを読むだけなので実害は無いが、明示的に普通のオブジェクトへ写す。
 */
export function nodeSqliteDriver(db: any): DbDriver {
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
}
