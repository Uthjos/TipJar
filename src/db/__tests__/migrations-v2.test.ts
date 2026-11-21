/**
 * Milestone 5 acceptance: schema v2 (docs/m5-contract.md "Type change — custom role labels").
 * `profile_rules` gains a nullable `label` column through a real migration from v1, keeping all
 * existing data. The v1 database is built by hand from the pinned v1 schema in
 * docs/m4-contract.md ("Pinned schema (#40)"), not by importing old code.
 */
import { calculateShift } from '../../engine/calculate';
import { SERVER_DEFAULT_PROFILE } from '../../engine/profiles';
import type { TipOutProfile } from '../../engine/types';
import { migrate, SCHEMA_VERSION } from '../migrations';
import {
  getProfile,
  getSetting,
  getShift,
  listCoworkers,
  listProfiles,
  saveProfile,
} from '../repositories';
import { createTestDb } from '../testing/sqljsDb';
import type { Db } from '../types';
import { golden1Input } from '../../test-support/builders';

// --- v1 schema, copied from the pinned M4 schema -------------------------------------------

const V1_DDL = `
  CREATE TABLE schema_version (version INTEGER NOT NULL);
  CREATE TABLE profiles (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    applies_to TEXT NOT NULL,
    pool_percent REAL NOT NULL,
    pool_basis TEXT,
    is_default INTEGER NOT NULL DEFAULT 0,
    position INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE profile_rules (
    profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    role TEXT NOT NULL,
    type TEXT NOT NULL,
    basis TEXT,
    percent REAL,
    weight REAL,
    PRIMARY KEY (profile_id, position)
  );
  CREATE TABLE shifts (
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
  CREATE INDEX shifts_date_idx ON shifts (date, saved_at);
  CREATE TABLE shift_members (
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
  CREATE TABLE shift_results (
    shift_id TEXT PRIMARY KEY NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
    pool INTEGER NOT NULL,
    kept INTEGER NOT NULL,
    kept_change INTEGER NOT NULL,
    retained INTEGER NOT NULL,
    rounding_adjustment INTEGER NOT NULL,
    result_json TEXT NOT NULL
  );
  CREATE TABLE coworkers (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    name_key TEXT NOT NULL,
    usual_role TEXT NOT NULL,
    last_worked TEXT
  );
  CREATE INDEX coworkers_name_key_idx ON coworkers (name_key);
  CREATE TABLE settings (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
  );
  INSERT INTO schema_version (version) VALUES (1);
`;

const TABLES = [
  'profiles',
  'profile_rules',
  'shifts',
  'shift_members',
  'shift_results',
  'coworkers',
  'settings',
] as const;

/** v1 data as the M4 app would have written it. */
const golden = {
  input: golden1Input(),
  result: calculateShift(golden1Input(), SERVER_DEFAULT_PROFILE).result,
};

const V1_CUSTOM: TipOutProfile = {
  id: 'patio',
  name: 'Patio',
  appliesTo: 'server',
  totalTipOutPercentOfTips: 25,
  poolBasis: 'netSales',
  rules: [
    { role: 'busser', type: 'percentOfBasis', basis: 'netSales', percent: 1.5 },
    { role: 'bartender', type: 'shareOfRemainder', weight: 4 },
    { role: 'host', type: 'shareOfRemainder', weight: 1 },
  ],
};

async function insertProfile(db: Db, p: TipOutProfile, isDefault: number, position: number) {
  await db.runAsync(
    'INSERT INTO profiles (id, name, applies_to, pool_percent, pool_basis, is_default, position) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [
      p.id,
      p.name,
      p.appliesTo,
      p.totalTipOutPercentOfTips,
      p.poolBasis ?? null,
      isDefault,
      position,
    ],
  );
  let i = 0;
  for (const r of p.rules) {
    await db.runAsync(
      'INSERT INTO profile_rules (profile_id, position, role, type, basis, percent, weight) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        p.id,
        i++,
        r.role,
        r.type,
        r.type === 'percentOfBasis' ? r.basis : null,
        r.type === 'percentOfBasis' ? r.percent : null,
        r.type === 'shareOfRemainder' ? r.weight : null,
      ],
    );
  }
}

async function buildV1(): Promise<Db> {
  const db = await createTestDb();
  await db.execAsync(V1_DDL);
  await insertProfile(db, SERVER_DEFAULT_PROFILE, 1, 0);
  await insertProfile(db, V1_CUSTOM, 0, 2);
  const { input, result } = golden;
  await db.runAsync(
    `INSERT INTO shifts (id, saved_at, date, user_role, profile_id, total_tips, net_sales, food_sales,
       missing_role_handling, round_to_dollar, input_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      'shift-1',
      '2026-11-18T04:00:00.000Z',
      input.date,
      input.userRole,
      input.profileId,
      input.totalTips,
      input.netSales,
      input.foodSales,
      input.missingRoleHandling,
      input.roundToDollar ? 1 : 0,
      JSON.stringify(input),
    ],
  );
  let i = 0;
  for (const m of input.team) {
    await db.runAsync(
      'INSERT INTO shift_members (shift_id, position, member_id, name, role, is_user, hours, clock_in, clock_out) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        'shift-1',
        i++,
        m.id,
        m.name,
        m.role,
        m.isUser ? 1 : 0,
        m.hours ?? null,
        m.clockIn ?? null,
        m.clockOut ?? null,
      ],
    );
  }
  await db.runAsync(
    'INSERT INTO shift_results (shift_id, pool, kept, kept_change, retained, rounding_adjustment, result_json) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [
      'shift-1',
      result.pool,
      result.kept,
      result.keptChange,
      result.retained,
      result.roundingAdjustment,
      JSON.stringify(result),
    ],
  );
  await db.runAsync(
    'INSERT INTO coworkers (id, name, name_key, usual_role, last_worked) VALUES (?, ?, ?, ?, ?)',
    ['cw-1', 'Joseph', 'joseph', 'bartender', '2026-11-17'],
  );
  await db.runAsync(
    'INSERT INTO coworkers (id, name, name_key, usual_role, last_worked) VALUES (?, ?, ?, ?, ?)',
    ['cw-2', 'Zoë', 'zoë', 'host', null],
  );
  await db.runAsync('INSERT INTO settings (key, value) VALUES (?, ?)', [
    'defaultRoundToDollar',
    'false',
  ]);
  await db.runAsync('INSERT INTO settings (key, value) VALUES (?, ?)', [
    'defaultProfileId',
    '"patio"',
  ]);
  return db;
}

async function dump(db: Db): Promise<Record<string, Record<string, unknown>[]>> {
  const out: Record<string, Record<string, unknown>[]> = {};
  for (const t of TABLES) out[t] = await db.getAllAsync(`SELECT * FROM ${t} ORDER BY rowid`);
  return out;
}
async function columns(db: Db, table: string) {
  return db.getAllAsync<{ name: string; type: string; notnull: number; dflt_value: unknown }>(
    `PRAGMA table_info(${table})`,
  );
}
async function maxVersion(db: Db): Promise<number | null> {
  const row = await db.getFirstAsync<{ v: number | null }>(
    'SELECT MAX(version) AS v FROM schema_version',
  );
  return row?.v ?? null;
}

// ---------------------------------------------------------------------------

describe('schema v2', () => {
  it('SCHEMA_VERSION is 2 for milestone 5', () => {
    expect(SCHEMA_VERSION).toBe(2);
  });

  it('the hand-built v1 database really is v1 (no label column)', async () => {
    const db = await buildV1();
    expect(await maxVersion(db)).toBe(1);
    expect((await columns(db, 'profile_rules')).map((c) => c.name)).not.toContain('label');
  });

  describe('upgrading a v1 database', () => {
    let db: Db;
    let before: Record<string, Record<string, unknown>[]>;
    beforeEach(async () => {
      db = await buildV1();
      before = await dump(db);
    });

    it('migrate returns 2 and records version 2', async () => {
      expect(await migrate(db)).toBe(2);
      expect(await maxVersion(db)).toBe(2);
    });

    it('adds a nullable label column to profile_rules', async () => {
      await migrate(db);
      const label = (await columns(db, 'profile_rules')).find((c) => c.name === 'label');
      expect(label).toBeDefined();
      expect(label!.notnull).toBe(0);
    });

    it('keeps every row of every table; existing rules get label NULL', async () => {
      await migrate(db);
      const after = await dump(db);
      for (const t of TABLES) {
        const rows = (after[t] ?? []).map((r) => {
          const { label, ...rest } = r;
          if (t === 'profile_rules') expect(label).toBeNull();
          return rest;
        });
        expect({ table: t, rows }).toEqual({ table: t, rows: before[t] });
      }
    });

    it('existing profiles read back unchanged, with no label keys (absent, not null)', async () => {
      await migrate(db);
      expect(await getProfile(db, 'server-default')).toEqual(SERVER_DEFAULT_PROFILE);
      const custom = await getProfile(db, 'patio');
      expect(custom).toEqual(V1_CUSTOM);
      for (const r of custom!.rules) expect('label' in r).toBe(false);
      for (const p of await listProfiles(db)) {
        for (const r of p.rules) expect(r).not.toHaveProperty('label');
      }
    });

    it('saved shifts, coworkers and settings survive the upgrade', async () => {
      await migrate(db);
      expect(await getShift(db, 'shift-1')).toEqual({
        id: 'shift-1',
        savedAt: '2026-11-18T04:00:00.000Z',
        input: golden.input,
        result: golden.result,
      });
      expect(await listCoworkers(db)).toEqual([
        { id: 'cw-1', name: 'Joseph', usualRole: 'bartender', lastWorked: '2026-11-17' },
        { id: 'cw-2', name: 'Zoë', usualRole: 'host' },
      ]);
      expect(await getSetting(db, 'defaultRoundToDollar', true)).toBe(false);
      expect(await getSetting(db, 'defaultProfileId', 'server-default')).toBe('patio');
    });

    it('is idempotent after the upgrade', async () => {
      await migrate(db);
      const once = await dump(db);
      const cols = await columns(db, 'profile_rules');
      expect(await migrate(db)).toBe(2);
      expect(await migrate(db)).toBe(2);
      expect(await dump(db)).toEqual(once);
      expect(await columns(db, 'profile_rules')).toEqual(cols);
      expect(await maxVersion(db)).toBe(2);
    });

    it('a labelled rule can be saved into an upgraded database', async () => {
      await migrate(db);
      const labelled: TipOutProfile = {
        ...V1_CUSTOM,
        rules: [
          {
            role: 'busser',
            label: 'Busser',
            type: 'percentOfBasis',
            basis: 'netSales',
            percent: 1.5,
          },
          ...V1_CUSTOM.rules.slice(1),
        ],
      };
      await saveProfile(db, labelled);
      expect(await getProfile(db, 'patio')).toEqual(labelled);
    });
  });

  describe('fresh install', () => {
    it('goes straight to v2 with the label column', async () => {
      const db = await createTestDb();
      expect(await migrate(db)).toBe(2);
      expect(await maxVersion(db)).toBe(2);
      expect((await columns(db, 'profile_rules')).map((c) => c.name)).toContain('label');
    });

    it('is idempotent', async () => {
      const db = await createTestDb();
      await migrate(db);
      const cols = await columns(db, 'profile_rules');
      expect(await migrate(db)).toBe(2);
      expect(await columns(db, 'profile_rules')).toEqual(cols);
      const versions = await db.getAllAsync<{ version: number }>(
        'SELECT version FROM schema_version',
      );
      expect(versions.map((v) => v.version)).not.toContain(3);
      expect(await maxVersion(db)).toBe(2);
    });
  });
});

describe('custom role labels round-trip (v2)', () => {
  let db: Db;
  beforeEach(async () => {
    db = await createTestDb();
    await migrate(db);
    await saveProfile(db, SERVER_DEFAULT_PROFILE);
  });

  const labelled: TipOutProfile = {
    id: 'patio',
    name: 'Patio',
    appliesTo: 'server',
    totalTipOutPercentOfTips: 25,
    rules: [
      { role: 'kitchen', type: 'percentOfBasis', basis: 'foodSales', percent: 2 },
      {
        role: 'food-runner',
        label: 'Food Runner',
        type: 'percentOfBasis',
        basis: 'netSales',
        percent: 0.5,
      },
      { role: 'bartender', type: 'shareOfRemainder', weight: 4 },
      { role: 'café-crew', label: 'Café "Crew"', type: 'shareOfRemainder', weight: 1.5 },
    ],
  };

  it('labels are stored and returned exactly; rules without a label have no label key', async () => {
    await saveProfile(db, labelled);
    const got = await getProfile(db, 'patio');
    expect(got).toEqual(labelled);
    expect(got!.rules.map((r) => ('label' in r ? r.label : '<absent>'))).toEqual([
      '<absent>',
      'Food Runner',
      '<absent>',
      'Café "Crew"',
    ]);
  });

  it('a missing label is stored as NULL, not an empty string', async () => {
    await saveProfile(db, labelled);
    const rows = await db.getAllAsync<{ position: number; t: string }>(
      "SELECT position, typeof(label) AS t FROM profile_rules WHERE profile_id = 'patio' ORDER BY position",
    );
    expect(rows.map((r) => r.t)).toEqual(['null', 'text', 'null', 'text']);
  });

  it('re-saving without labels removes them (absent again)', async () => {
    await saveProfile(db, labelled);
    const bare: TipOutProfile = {
      ...labelled,
      rules: labelled.rules.map((r) => {
        const { label: _label, ...rest } = r;
        return rest as typeof r;
      }),
    };
    await saveProfile(db, bare);
    const got = await getProfile(db, 'patio');
    expect(got).toEqual(bare);
    for (const r of got!.rules) expect(r).not.toHaveProperty('label');
  });

  it('listProfiles carries labels too', async () => {
    await saveProfile(db, labelled);
    expect((await listProfiles(db)).find((p) => p.id === 'patio')).toEqual(labelled);
  });
});
