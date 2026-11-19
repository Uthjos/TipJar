import type { Db } from './types';

/** Current schema version (milestone 4). */
export const SCHEMA_VERSION = 1;

/**
 * Ordered migrations. `MIGRATIONS[i]` upgrades the schema from version i to i + 1.
 * Money columns are INTEGER cents. Child rows cascade with their parent.
 *
 * Saved shifts keep the exact `input` / `result` objects as JSON (the snapshot, so editing a
 * profile later never rewrites history); the scalar columns and `shift_members` rows are
 * denormalised copies for querying (History / CSV in milestone 7).
 */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE IF NOT EXISTS profiles (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    applies_to TEXT NOT NULL,
    pool_percent REAL NOT NULL,
    pool_basis TEXT,
    is_default INTEGER NOT NULL DEFAULT 0,
    position INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS profile_rules (
    profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    role TEXT NOT NULL,
    type TEXT NOT NULL,
    basis TEXT,
    percent REAL,
    weight REAL,
    PRIMARY KEY (profile_id, position)
  );

  CREATE TABLE IF NOT EXISTS shifts (
    id TEXT PRIMARY KEY NOT NULL,
    saved_at TEXT NOT NULL,
    date TEXT NOT NULL,
    user_role TEXT NOT NULL,
    profile_id TEXT NOT NULL,
    total_tips INTEGER NOT NULL,
    net_sales INTEGER NOT NULL,
    food_sales INTEGER NOT NULL,
    missing_role_handling TEXT NOT NULL,
    round_to_dollar INTEGER NOT NULL,
    input_json TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS shifts_date_idx ON shifts (date, saved_at);

  CREATE TABLE IF NOT EXISTS shift_members (
    shift_id TEXT NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    member_id TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    is_user INTEGER NOT NULL DEFAULT 0,
    hours REAL,
    clock_in TEXT,
    clock_out TEXT,
    PRIMARY KEY (shift_id, position)
  );

  CREATE TABLE IF NOT EXISTS shift_results (
    shift_id TEXT PRIMARY KEY NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
    pool INTEGER NOT NULL,
    kept INTEGER NOT NULL,
    kept_change INTEGER NOT NULL,
    retained INTEGER NOT NULL,
    rounding_adjustment INTEGER NOT NULL,
    result_json TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS coworkers (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    name_key TEXT NOT NULL,
    usual_role TEXT NOT NULL,
    last_worked TEXT
  );
  CREATE INDEX IF NOT EXISTS coworkers_name_key_idx ON coworkers (name_key);

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
  );
  `,
];

async function currentVersion(db: Db): Promise<number> {
  await db.execAsync('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);');
  const row = await db.getFirstAsync<{ version: number }>(
    'SELECT MAX(version) AS version FROM schema_version',
  );
  return row?.version ?? 0;
}

/**
 * Create / upgrade tables to SCHEMA_VERSION and record the version. Idempotent: calling it on an
 * up-to-date database does nothing. Returns the resulting version.
 */
export async function migrate(db: Db): Promise<number> {
  let version = await currentVersion(db);
  while (version < MIGRATIONS.length) {
    const sql = MIGRATIONS[version]!;
    const next = version + 1;
    await db.withTransactionAsync(async () => {
      await db.execAsync(sql);
      await db.runAsync('DELETE FROM schema_version');
      await db.runAsync('INSERT INTO schema_version (version) VALUES (?)', [next]);
    });
    version = next;
  }
  return version;
}
