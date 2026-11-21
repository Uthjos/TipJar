import { SERVER_DEFAULT_PROFILE } from '@/engine/profiles';
import type { TipOutProfile } from '@/engine/types';

import { migrate, SCHEMA_VERSION } from '../migrations';
import {
  getProfile,
  listCoworkers,
  listProfiles,
  rememberTeam,
  saveProfile,
} from '../repositories';
import { seedDefaults } from '../seed';
import { createTestDb } from '../testing/sqljsDb';

describe('schema v2 (custom role labels)', () => {
  it('upgrades a real v1 database in place, keeping its data', async () => {
    const db = await createTestDb();
    expect(await migrate(db, 1)).toBe(1);
    // v1 data written with the v1 column list (no label column yet): the server default ...
    await db.runAsync(
      `INSERT INTO profiles (id, name, applies_to, pool_percent, pool_basis, is_default, position)
       VALUES ('server-default', 'Server default', 'server', 30, NULL, 1, 0)`,
    );
    for (const [i, r] of SERVER_DEFAULT_PROFILE.rules.entries()) {
      await db.runAsync(
        `INSERT INTO profile_rules (profile_id, position, role, type, basis, percent, weight)
         VALUES ('server-default', ?, ?, ?, ?, ?, ?)`,
        [
          i,
          r.role,
          r.type,
          r.type === 'percentOfBasis' ? r.basis : null,
          r.type === 'percentOfBasis' ? r.percent : null,
          r.type === 'shareOfRemainder' ? r.weight : null,
        ],
      );
    }
    // ... and a custom rule.
    await db.runAsync(
      `INSERT INTO profiles (id, name, applies_to, pool_percent, pool_basis, is_default, position)
       VALUES ('old', 'Old', 'server', 25, NULL, 0, 0)`,
    );
    await db.runAsync(
      `INSERT INTO profile_rules (profile_id, position, role, type, basis, percent, weight)
       VALUES ('old', 0, 'busser', 'shareOfRemainder', NULL, NULL, 2)`,
    );
    await db.runAsync(`INSERT INTO settings (key, value) VALUES ('onboarded', 'true')`);

    expect(SCHEMA_VERSION).toBe(2);
    expect(await migrate(db)).toBe(2);
    expect(await migrate(db)).toBe(2);
    const cols = await db.getAllAsync<{ name: string }>('PRAGMA table_info(profile_rules)');
    expect(cols.map((c) => c.name)).toContain('label');

    expect(await getProfile(db, 'server-default')).toEqual(SERVER_DEFAULT_PROFILE);
    // Missing label round-trips as absent, not null.
    expect(await getProfile(db, 'old')).toEqual({
      id: 'old',
      name: 'Old',
      appliesTo: 'server',
      totalTipOutPercentOfTips: 25,
      rules: [{ role: 'busser', type: 'shareOfRemainder', weight: 2 }],
    });
    // Seeding after the upgrade doesn't touch existing profiles (table isn't empty).
    await seedDefaults(db);
    expect((await listProfiles(db)).map((p) => p.id)).toEqual(['server-default', 'old']);
    const row = await db.getFirstAsync<{ value: string }>(
      "SELECT value FROM settings WHERE key = 'onboarded'",
    );
    expect(row!.value).toBe('true');
  });

  it('labels round-trip', async () => {
    const db = await createTestDb();
    await migrate(db);
    const p: TipOutProfile = {
      id: 'c',
      name: 'Custom',
      appliesTo: 'server',
      totalTipOutPercentOfTips: 30,
      rules: [
        { role: 'bar-porter', label: 'Bar Porter', type: 'shareOfRemainder', weight: 1 },
        { role: 'host', type: 'shareOfRemainder', weight: 1 },
      ],
    };
    await saveProfile(db, p);
    expect(await getProfile(db, 'c')).toEqual(p);
  });

  it('rememberTeam keeps only the first occurrence of a name in one team (#50)', async () => {
    const db = await createTestDb();
    await migrate(db);
    await rememberTeam(
      db,
      [
        { id: '1', name: 'Sam', role: 'barback' },
        { id: '2', name: ' sam ', role: 'host' },
      ],
      '2026-11-20',
    );
    const list = await listCoworkers(db);
    expect(list.map((c) => [c.name, c.usualRole])).toEqual([['Sam', 'barback']]);
  });
});
