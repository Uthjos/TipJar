/**
 * Milestone 4 acceptance: schema & migrations (docs/m4-contract.md, CLAUDE.md §7).
 * Column names are not part of the contract, so these tests only rely on table names,
 * row counts and SQLite's own metadata.
 */
import { migrate, SCHEMA_VERSION } from '../migrations';
import { deleteProfile, getShift, saveProfile, saveShift } from '../repositories';
import { initDb } from '../seed';
import { createTestDb } from '../testing/sqljsDb';
import type { Db } from '../types';
import { clone, rowCount, shiftFixtures } from '../../test-support/shiftFixtures';
import { at } from '../../test-support/builders';

const TABLES = [
  'shifts',
  'shift_members',
  'shift_results',
  'profiles',
  'profile_rules',
  'coworkers',
  'settings',
  'schema_version',
] as const;

async function tableNames(db: Db): Promise<string[]> {
  const rows = await db.getAllAsync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
  );
  return rows.map((r) => r.name);
}

let db: Db;
beforeEach(async () => {
  db = await createTestDb();
});

describe('migrate', () => {
  it('SCHEMA_VERSION is 1 for milestone 4', () => {
    expect(SCHEMA_VERSION).toBe(1);
  });

  it('a fresh database starts empty (test adapter sanity)', async () => {
    expect(await tableNames(db)).toEqual([]);
  });

  it('creates every table from CLAUDE.md §7 and returns the version', async () => {
    const version = await migrate(db);
    expect(version).toBe(SCHEMA_VERSION);
    const names = await tableNames(db);
    for (const t of TABLES) expect(names).toContain(t);
  });

  it('records the version in schema_version', async () => {
    await migrate(db);
    const rows = await db.getAllAsync<Record<string, unknown>>('SELECT * FROM schema_version');
    expect(rows.length).toBeGreaterThanOrEqual(1);
    // the column name is not in the contract: the version must appear as a value in some row
    const values = rows.flatMap((r) => Object.values(r));
    expect(values).toContain(SCHEMA_VERSION);
  });

  it('is idempotent: a second call returns the same version and changes nothing', async () => {
    await migrate(db);
    const versionRowsBefore = await rowCount(db, 'schema_version');
    const namesBefore = (await tableNames(db)).sort();
    expect(await migrate(db)).toBe(SCHEMA_VERSION);
    expect(await migrate(db)).toBe(SCHEMA_VERSION);
    expect((await tableNames(db)).sort()).toEqual(namesBefore);
    expect(await rowCount(db, 'schema_version')).toBe(versionRowsBefore);
  });

  it('re-running migrate keeps existing data', async () => {
    await initDb(db);
    const f = at(shiftFixtures(), 0);
    const id = await saveShift(db, { input: f.input, result: f.result });
    await migrate(db);
    const saved = await getShift(db, id);
    expect(saved?.input).toEqual(f.input);
    expect(saved?.result).toEqual(f.result);
  });

  it('runs inside the real initDb (migrate + seed) twice without error', async () => {
    await initDb(db);
    await expect(initDb(db)).resolves.toBeUndefined();
  });
});

describe('cascade deletes (ON DELETE CASCADE)', () => {
  beforeEach(async () => {
    await initDb(db);
  });

  it('saving a shift writes member rows and a result row', async () => {
    const f = at(shiftFixtures(), 0); // Golden 1: 5 team members
    await saveShift(db, { input: f.input, result: f.result });
    expect(await rowCount(db, 'shifts')).toBe(1);
    expect(await rowCount(db, 'shift_members')).toBe(f.input.team.length);
    expect(await rowCount(db, 'shift_results')).toBeGreaterThanOrEqual(1);
  });

  it('deleting a shifts row directly in SQL removes its members and result', async () => {
    const [a, b] = shiftFixtures();
    await saveShift(db, { input: a!.input, result: a!.result });
    const keepId = await saveShift(db, { input: b!.input, result: b!.result });
    const membersOfB = b!.input.team.length;
    // delete the first-inserted shift (A) straight in SQL: the database itself must cascade
    expect(await rowCount(db, 'shifts')).toBe(2);
    await db.runAsync('DELETE FROM shifts WHERE rowid = (SELECT MIN(rowid) FROM shifts)');
    expect(await rowCount(db, 'shifts')).toBe(1);
    expect(await rowCount(db, 'shift_members')).toBe(membersOfB);
    expect(await getShift(db, keepId)).not.toBeNull();
    await db.runAsync('DELETE FROM shifts');
    expect(await rowCount(db, 'shift_members')).toBe(0);
    expect(await rowCount(db, 'shift_results')).toBe(0);
  });

  it('deleting a profiles row directly in SQL removes its rules', async () => {
    expect(await rowCount(db, 'profile_rules')).toBe(4 + 3); // both seeded default profiles
    await db.runAsync('DELETE FROM profiles');
    expect(await rowCount(db, 'profile_rules')).toBe(0);
  });

  it('deleteProfile removes only that profile’s rules', async () => {
    await deleteProfile(db, 'server-default');
    expect(await rowCount(db, 'profile_rules')).toBe(3); // bartender default remains
  });

  it('saveProfile replaces (not appends) a profile’s rules', async () => {
    await saveProfile(db, {
      id: 'server-default',
      name: 'Server default',
      appliesTo: 'server',
      totalTipOutPercentOfTips: 30,
      rules: [{ role: 'bartender', type: 'shareOfRemainder', weight: 1 }],
    });
    expect(await rowCount(db, 'profile_rules')).toBe(1 + 3);
  });
});

describe('money is stored as INTEGER cents (no floats)', () => {
  // Columns whose names look like money must hold SQLite integers. Columns for hours, clock
  // times, percentages and weights may legitimately be REAL. (Column names are not in the
  // contract; see findings #40.)
  const MONEY = /tip|sales|amount|pool|kept|retained|cents|adjust|change|held/i;
  const NON_MONEY = /hour|clock|percent|pct|weight|rate|version|basis|date|_at$|savedat|id$/i;

  it('every stored value in a money-like column is an integer', async () => {
    await initDb(db);
    for (const f of shiftFixtures()) await saveShift(db, { input: f.input, result: f.result });

    for (const table of ['shifts', 'shift_members', 'shift_results'] as const) {
      const cols = await db.getAllAsync<{ name: string; type: string }>(
        `PRAGMA table_info(${table})`,
      );
      for (const col of cols) {
        if (!MONEY.test(col.name) || NON_MONEY.test(col.name)) continue;
        const types = await db.getAllAsync<{ t: string }>(
          `SELECT DISTINCT typeof("${col.name}") AS t FROM ${table}`,
        );
        for (const { t } of types) {
          expect({ table, column: col.name, type: t }).toEqual({
            table,
            column: col.name,
            type: expect.stringMatching(/^(integer|null|text)$/),
          });
        }
        // a money column declared REAL/FLOAT would store 100 as 100.0
        expect({ table, column: col.name, declared: col.type.toUpperCase() }).not.toEqual({
          table,
          column: col.name,
          declared: expect.stringMatching(/REAL|FLOA|DOUB/),
        });
      }
    }
  });

  it('large integer cents round-trip exactly', async () => {
    await initDb(db);
    const f = clone(at(shiftFixtures(), 0));
    f.input.totalTips = 2_147_483_647_00; // ~$2.1bn in cents, beyond 32-bit
    f.input.netSales = 9_007_199_254_740_99; // < Number.MAX_SAFE_INTEGER
    const id = await saveShift(db, { input: f.input, result: f.result });
    const saved = await getShift(db, id);
    expect(saved?.input.totalTips).toBe(2_147_483_647_00);
    expect(saved?.input.netSales).toBe(9_007_199_254_740_99);
    expect(Number.isInteger(saved?.input.totalTips)).toBe(true);
  });
});
