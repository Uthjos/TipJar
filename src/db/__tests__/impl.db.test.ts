import { calculateShift } from '@/engine/calculate';
import { BARTENDER_DEFAULT_PROFILE, SERVER_DEFAULT_PROFILE } from '@/engine/profiles';
import type { ShiftInput, TipOutProfile } from '@/engine/types';

import { migrate, SCHEMA_VERSION } from '../migrations';
import {
  deleteCoworker,
  deleteProfile,
  deleteShift,
  getProfile,
  getSetting,
  getShift,
  listCoworkers,
  listProfiles,
  listShifts,
  rememberTeam,
  saveProfile,
  saveShift,
  setSetting,
  updateShift,
  upsertCoworker,
} from '../repositories';
import { initDb, seedDefaults } from '../seed';
import { createTestDb } from '../testing/sqljsDb';
import type { Db } from '../types';

const bartenderInput: ShiftInput = {
  date: '2026-11-18',
  userRole: 'bartender',
  totalTips: 19255,
  netSales: 90543,
  foodSales: 12000,
  team: [
    { id: 'me', name: 'Me', role: 'bartender', isUser: true, clockIn: '17:00', clockOut: '01:30' },
    { id: 'a', name: 'Aaron', role: 'bartender', clockIn: '18:00', clockOut: '02:00' },
    { id: 'd', name: 'David', role: 'barback', hours: 7.5 },
    { id: 'al', name: 'Allen', role: 'barback', hours: 7.5 },
  ],
  missingRoleHandling: 'retain',
  profileId: 'bartender-default',
  roundToDollar: true,
};

async function freshDb(): Promise<Db> {
  const db = await createTestDb();
  await initDb(db);
  return db;
}

describe('migrations + seed', () => {
  it('migrates to SCHEMA_VERSION idempotently and seeds defaults once', async () => {
    const db = await createTestDb();
    expect(await migrate(db)).toBe(SCHEMA_VERSION);
    expect(await migrate(db)).toBe(SCHEMA_VERSION);
    await seedDefaults(db);
    await seedDefaults(db);
    const profiles = await listProfiles(db);
    expect(profiles).toEqual([SERVER_DEFAULT_PROFILE, BARTENDER_DEFAULT_PROFILE]);
  });

  it('never overwrites an edited default profile', async () => {
    const db = await freshDb();
    await saveProfile(db, { ...SERVER_DEFAULT_PROFILE, totalTipOutPercentOfTips: 25 });
    await initDb(db);
    expect((await getProfile(db, 'server-default'))!.totalTipOutPercentOfTips).toBe(25);
  });
});

describe('profiles', () => {
  it('round-trips rules in order, poolBasis, and deletes with rules', async () => {
    const db = await freshDb();
    const custom: TipOutProfile = {
      id: 'c1',
      name: 'Aardvark custom',
      appliesTo: 'server',
      totalTipOutPercentOfTips: 4.5,
      poolBasis: 'netSales',
      rules: [
        { role: 'busser', type: 'percentOfBasis', basis: 'netSales', percent: 1 },
        { role: 'bartender', type: 'shareOfRemainder', weight: 2.5 },
      ],
    };
    await saveProfile(db, custom);
    expect(await getProfile(db, 'c1')).toEqual(custom);
    expect((await listProfiles(db)).map((p) => p.id)).toEqual([
      'server-default',
      'bartender-default',
      'c1',
    ]);
    await saveProfile(db, { ...custom, rules: [custom.rules[1]!] });
    expect((await getProfile(db, 'c1'))!.rules).toEqual([custom.rules[1]]);
    await deleteProfile(db, 'c1');
    expect(await getProfile(db, 'c1')).toBeNull();
    const orphan = await db.getAllAsync('SELECT * FROM profile_rules WHERE profile_id = ?', ['c1']);
    expect(orphan).toEqual([]);
  });
});

describe('shifts', () => {
  it('snapshots input and result exactly, lists by date, updates and deletes', async () => {
    const db = await freshDb();
    const { result } = calculateShift(bartenderInput, BARTENDER_DEFAULT_PROFILE);
    const id = await saveShift(db, { input: bartenderInput, result });
    const saved = await getShift(db, id);
    expect(saved!.input).toEqual(bartenderInput);
    expect(saved!.result).toEqual(result);

    // Editing the profile later never changes the saved shift.
    await saveProfile(db, { ...BARTENDER_DEFAULT_PROFILE, totalTipOutPercentOfTips: 10 });
    await deleteProfile(db, 'bartender-default');
    expect((await getShift(db, id))!.result).toEqual(result);

    const older = await saveShift(db, {
      input: { ...bartenderInput, date: '2026-11-01' },
      result,
      id: 'older',
      savedAt: '2026-11-02T03:00:00.000Z',
    });
    expect(older).toBe('older');
    expect((await listShifts(db)).map((s) => s.id)).toEqual([id, 'older']);
    expect((await listShifts(db, { to: '2026-11-01' })).map((s) => s.id)).toEqual(['older']);
    expect((await listShifts(db, { from: '2026-11-02' })).map((s) => s.id)).toEqual([id]);

    const server = { ...bartenderInput, userRole: 'server' as const, team: [] };
    const serverResult = calculateShift(server, SERVER_DEFAULT_PROFILE).result;
    await updateShift(db, 'older', { input: server, result: serverResult });
    const updated = await getShift(db, 'older');
    expect(updated!.input).toEqual(server);
    expect(updated!.savedAt).toBe('2026-11-02T03:00:00.000Z');
    await updateShift(db, 'nope', { input: server, result: serverResult });

    await deleteShift(db, id);
    await deleteShift(db, 'nope');
    expect(await getShift(db, id)).toBeNull();
    const members = await db.getAllAsync('SELECT * FROM shift_members WHERE shift_id = ?', [id]);
    expect(members).toEqual([]);
  });
});

describe('coworkers + settings', () => {
  it('rememberTeam upserts by name, skips the user and blanks; list is most recent first', async () => {
    const db = await freshDb();
    await rememberTeam(db, bartenderInput.team, '2026-11-01');
    await rememberTeam(
      db,
      [
        { id: 'x', name: '  aaron ', role: 'barback' },
        { id: 'y', name: '   ', role: 'host' },
        { id: 'z', name: 'Zoe', role: 'host' },
      ],
      '2026-11-10',
    );
    const list = await listCoworkers(db);
    // Review round 4 (#47): a name match keeps the existing spelling ("Aaron", not "aaron").
    expect(list.map((c) => [c.name, c.usualRole, c.lastWorked])).toEqual([
      ['Aaron', 'barback', '2026-11-10'],
      ['Zoe', 'host', '2026-11-10'],
      ['Allen', 'barback', '2026-11-01'],
      ['David', 'barback', '2026-11-01'],
    ]);
    const id = await upsertCoworker(db, { name: 'Kim', usualRole: 'host' });
    expect((await listCoworkers(db)).at(-1)!.id).toBe(id);
    await deleteCoworker(db, id);
    expect((await listCoworkers(db)).some((c) => c.name === 'Kim')).toBe(false);
  });

  it('settings are JSON values with fallbacks', async () => {
    const db = await freshDb();
    expect(await getSetting(db, 'defaultRoundToDollar', true)).toBe(true);
    await setSetting(db, 'defaultRoundToDollar', false);
    await setSetting(db, 'defaultProfileId', 'bartender-default');
    expect(await getSetting(db, 'defaultRoundToDollar', true)).toBe(false);
    expect(await getSetting(db, 'defaultProfileId', 'server-default')).toBe('bartender-default');
  });
});
