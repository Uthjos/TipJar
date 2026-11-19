/**
 * Minimal async database interface (docs/m4-contract.md). A subset of expo-sqlite's
 * `SQLiteDatabase`, so the real database satisfies it directly and tests can use the sql.js
 * in-memory adapter (`src/db/testing/sqljsDb.ts`).
 */
export type SqlParam = string | number | null;

export interface Db {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, params?: SqlParam[]): Promise<{ lastInsertRowId: number; changes: number }>;
  getAllAsync<T>(sql: string, params?: SqlParam[]): Promise<T[]>;
  getFirstAsync<T>(sql: string, params?: SqlParam[]): Promise<T | null>;
  withTransactionAsync(fn: () => Promise<void>): Promise<void>;
}
