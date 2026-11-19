import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';

import { initDb } from './seed';
import type { Db } from './types';

const DB_NAME = 'tipjar.db';

let dbPromise: Promise<Db> | null = null;

/**
 * Adapt expo-sqlite to `Db`. At runtime SQLiteDatabase already has these methods, but its typings
 * require `params` (no `undefined`), so pass `[]` when omitted.
 */
export function fromExpoSqlite(db: SQLiteDatabase): Db {
  return {
    execAsync: (sql) => db.execAsync(sql),
    runAsync: (sql, params = []) => db.runAsync(sql, params),
    getAllAsync: <T>(sql: string, params: (string | number | null)[] = []) =>
      db.getAllAsync<T>(sql, params),
    getFirstAsync: <T>(sql: string, params: (string | number | null)[] = []) =>
      db.getFirstAsync<T>(sql, params),
    withTransactionAsync: (fn) => db.withTransactionAsync(fn),
  };
}

/**
 * Open the on-device database (once), turn on foreign keys, migrate and seed defaults.
 * All data stays on the device (CLAUDE.md §3).
 */
export function getDb(): Promise<Db> {
  if (!dbPromise) {
    const opening = (async () => {
      const raw = await openDatabaseAsync(DB_NAME);
      await raw.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
      const db = fromExpoSqlite(raw);
      await initDb(db);
      return db;
    })();
    dbPromise = opening;
    // Let a later call retry if opening failed.
    opening.catch(() => {
      if (dbPromise === opening) dbPromise = null;
    });
  }
  return dbPromise;
}
