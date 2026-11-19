/**
 * Milestone 4 acceptance: seeding the default profiles (docs/m4-contract.md "Seeding").
 */
import { BARTENDER_DEFAULT_PROFILE, SERVER_DEFAULT_PROFILE } from '../../engine/profiles';
import type { TipOutProfile } from '../../engine/types';
import { migrate } from '../migrations';
import { deleteProfile, getProfile, listProfiles, saveProfile } from '../repositories';
import { initDb, seedDefaults } from '../seed';
import { createTestDb } from '../testing/sqljsDb';
import type { Db } from '../types';
import { rowCount } from '../../test-support/shiftFixtures';

const ids = (ps: TipOutProfile[]) => ps.map((p) => p.id).sort();

let db: Db;
beforeEach(async () => {
  db = await createTestDb();
  await migrate(db);
});

describe('seedDefaults', () => {
  it('seeds both default profiles into an empty database', async () => {
    await seedDefaults(db);
    expect(ids(await listProfiles(db))).toEqual(['bartender-default', 'server-default']);
  });

  it('seeded profiles deep-equal the engine constants (rules in order)', async () => {
    await seedDefaults(db);
    expect(await getProfile(db, 'server-default')).toEqual(SERVER_DEFAULT_PROFILE);
    expect(await getProfile(db, 'bartender-default')).toEqual(BARTENDER_DEFAULT_PROFILE);
  });

  it('is idempotent: seeding twice does not duplicate profiles or rules', async () => {
    await seedDefaults(db);
    const rules = await rowCount(db, 'profile_rules');
    await seedDefaults(db);
    await seedDefaults(db);
    expect(await rowCount(db, 'profiles')).toBe(2);
    expect(await rowCount(db, 'profile_rules')).toBe(rules);
    expect(await getProfile(db, 'server-default')).toEqual(SERVER_DEFAULT_PROFILE);
  });

  it('never overwrites a profile the user edited', async () => {
    await seedDefaults(db);
    const edited: TipOutProfile = {
      ...SERVER_DEFAULT_PROFILE,
      name: 'My server split',
      totalTipOutPercentOfTips: 25,
      rules: [
        { role: 'kitchen', type: 'percentOfBasis', basis: 'foodSales', percent: 1.5 },
        { role: 'bartender', type: 'shareOfRemainder', weight: 1 },
      ],
    };
    await saveProfile(db, edited);
    await seedDefaults(db);
    await initDb(db);
    expect(await getProfile(db, 'server-default')).toEqual(edited);
  });

  it('does not reseed a default the user deleted while other profiles exist', async () => {
    await seedDefaults(db);
    await deleteProfile(db, 'bartender-default');
    await seedDefaults(db);
    expect(await getProfile(db, 'bartender-default')).toBeNull();
    expect(ids(await listProfiles(db))).toEqual(['server-default']);
  });

  it('does not seed when only a custom profile exists', async () => {
    await saveProfile(db, {
      id: 'mine',
      name: 'Mine',
      appliesTo: 'server',
      totalTipOutPercentOfTips: 20,
      rules: [{ role: 'host', type: 'shareOfRemainder', weight: 1 }],
    });
    await seedDefaults(db);
    expect(ids(await listProfiles(db))).toEqual(['mine']);
  });

  it('reseeds both defaults once every profile has been deleted (table empty)', async () => {
    // Contract: "only if the profiles table is empty". See findings #44.
    await seedDefaults(db);
    await deleteProfile(db, 'server-default');
    await deleteProfile(db, 'bartender-default');
    await seedDefaults(db);
    expect(ids(await listProfiles(db))).toEqual(['bartender-default', 'server-default']);
  });

  it('does not mutate the engine constants', async () => {
    const before = JSON.stringify([SERVER_DEFAULT_PROFILE, BARTENDER_DEFAULT_PROFILE]);
    await seedDefaults(db);
    const p = await getProfile(db, 'server-default');
    p!.rules.pop();
    expect(JSON.stringify([SERVER_DEFAULT_PROFILE, BARTENDER_DEFAULT_PROFILE])).toBe(before);
  });
});

describe('initDb', () => {
  it('= migrate + seedDefaults on a brand-new database', async () => {
    const fresh = await createTestDb();
    await initDb(fresh);
    expect(await getProfile(fresh, 'server-default')).toEqual(SERVER_DEFAULT_PROFILE);
    expect(await getProfile(fresh, 'bartender-default')).toEqual(BARTENDER_DEFAULT_PROFILE);
  });

  it('is idempotent', async () => {
    const fresh = await createTestDb();
    await initDb(fresh);
    await initDb(fresh);
    expect(await rowCount(fresh, 'profiles')).toBe(2);
  });
});
