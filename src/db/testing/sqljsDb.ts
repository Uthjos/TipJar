/**
 * In-memory `Db` for tests, backed by sql.js (SQLite compiled to WebAssembly; devDependency).
 * Each call returns a fresh, empty database with foreign keys ON. Never imported by app code.
 */
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';

import type { Db, SqlParam } from '../types';

let sqlPromise: Promise<SqlJsStatic> | null = null;

function loadSqlJs(): Promise<SqlJsStatic> {
  if (!sqlPromise) sqlPromise = initSqlJs();
  return sqlPromise;
}

function query<T>(db: Database, sql: string, params: SqlParam[] = []): T[] {
  const stmt = db.prepare(sql);
  try {
    stmt.bind(params);
    const rows: T[] = [];
    while (stmt.step()) rows.push(stmt.getAsObject() as T);
    return rows;
  } finally {
    stmt.free();
  }
}

/** Wrap a sql.js Database in the async `Db` interface. */
export function wrapSqlJs(db: Database): Db {
  let inTransaction = false;
  return {
    async execAsync(sql) {
      db.exec(sql);
    },
    async runAsync(sql, params = []) {
      db.run(sql, params);
      const changes = db.getRowsModified();
      const row = query<{ id: number }>(db, 'SELECT last_insert_rowid() AS id')[0];
      return { lastInsertRowId: row?.id ?? 0, changes };
    },
    async getAllAsync<T>(sql: string, params: SqlParam[] = []) {
      return query<T>(db, sql, params);
    },
    async getFirstAsync<T>(sql: string, params: SqlParam[] = []) {
      return query<T>(db, sql, params)[0] ?? null;
    },
    async withTransactionAsync(fn) {
      // Like expo-sqlite, not re-entrant; a nested call just joins the outer transaction.
      if (inTransaction) {
        await fn();
        return;
      }
      inTransaction = true;
      db.run('BEGIN');
      try {
        await fn();
        db.run('COMMIT');
      } catch (e) {
        db.run('ROLLBACK');
        throw e;
      } finally {
        inTransaction = false;
      }
    },
  };
}

/** A fresh, empty in-memory database (foreign keys ON). */
export async function createTestDb(): Promise<Db> {
  const SQL = await loadSqlJs();
  const db = new SQL.Database();
  db.run('PRAGMA foreign_keys = ON');
  return wrapSqlJs(db);
}
