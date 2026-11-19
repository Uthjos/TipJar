/**
 * Milestone 4 acceptance: repositories (docs/m4-contract.md "Repositories").
 * Fresh in-memory database per test (createTestDb + initDb).
 */
import { BARTENDER_DEFAULT_PROFILE, SERVER_DEFAULT_PROFILE } from '../../engine/profiles';
import type { TipOutProfile } from '../../engine/types';
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
import { initDb } from '../seed';
import { createTestDb } from '../testing/sqljsDb';
import type { Db } from '../types';
import { at, member } from '../../test-support/builders';
import {
  clone,
  NET_SALES_PROFILE,
  rowCount,
  shiftFixtures,
} from '../../test-support/shiftFixtures';

let db: Db;
beforeEach(async () => {
  db = await createTestDb();
  await initDb(db);
});

const fx = (i: number) => clone(at(shiftFixtures(), i));

// ---------------------------------------------------------------------------
// profiles
// ---------------------------------------------------------------------------

describe('profiles', () => {
  it('round-trips a custom profile exactly: rule order, poolBasis, custom roles, fractions', async () => {
    await saveProfile(db, NET_SALES_PROFILE);
    const got = await getProfile(db, NET_SALES_PROFILE.id);
    expect(got).toEqual(NET_SALES_PROFILE);
    // rule order is part of the result (roles follow profile rule order)
    expect(got!.rules.map((r) => r.role)).toEqual(['host', 'busser', 'kitchen', 'bartender']);
  });

  it('each poolBasis value round-trips, and an absent poolBasis stays absent', async () => {
    for (const poolBasis of ['totalTips', 'netSales', 'foodSales'] as const) {
      const p: TipOutProfile = { ...NET_SALES_PROFILE, id: `pb-${poolBasis}`, poolBasis };
      await saveProfile(db, p);
      expect((await getProfile(db, p.id))?.poolBasis).toBe(poolBasis);
    }
    const server = await getProfile(db, 'server-default');
    expect(server?.poolBasis).toBeUndefined(); // not null
    expect(server).not.toHaveProperty('poolBasis', null);
  });

  it('saveProfile upserts: a second save replaces fields and rules', async () => {
    await saveProfile(db, NET_SALES_PROFILE);
    const v2: TipOutProfile = {
      ...NET_SALES_PROFILE,
      name: 'Renamed',
      appliesTo: 'bartender',
      totalTipOutPercentOfTips: 12,
      poolBasis: 'foodSales',
      rules: [
        { role: 'barback', type: 'shareOfRemainder', weight: 3 },
        { role: 'expo', type: 'percentOfBasis', basis: 'totalTips', percent: 1 },
      ],
    };
    await saveProfile(db, v2);
    expect(await getProfile(db, v2.id)).toEqual(v2);
    expect((await listProfiles(db)).filter((p) => p.id === v2.id)).toHaveLength(1);
  });

  it('a profile with no rules round-trips', async () => {
    const empty: TipOutProfile = { ...NET_SALES_PROFILE, id: 'empty', rules: [] };
    await saveProfile(db, empty);
    expect(await getProfile(db, 'empty')).toEqual(empty);
  });

  it('listProfiles: default profiles first, then the rest by name', async () => {
    for (const [id, name] of [
      ['z', 'Zebra split'],
      ['a', 'Apple split'],
      ['m', 'Mango split'],
    ] as const) {
      await saveProfile(db, { ...NET_SALES_PROFILE, id, name });
    }
    const list = await listProfiles(db);
    expect(
      list
        .slice(0, 2)
        .map((p) => p.id)
        .sort(),
    ).toEqual(['bartender-default', 'server-default']);
    expect(list.slice(2).map((p) => p.name)).toEqual(['Apple split', 'Mango split', 'Zebra split']);
    // listed profiles carry their rules in order too
    expect(list.find((p) => p.id === 'server-default')).toEqual(SERVER_DEFAULT_PROFILE);
    expect(list.find((p) => p.id === 'bartender-default')).toEqual(BARTENDER_DEFAULT_PROFILE);
  });

  it('getProfile of an unknown id is null; deleteProfile of an unknown id is a no-op', async () => {
    expect(await getProfile(db, 'nope')).toBeNull();
    await expect(deleteProfile(db, 'nope')).resolves.toBeUndefined();
    expect(await rowCount(db, 'profiles')).toBe(2);
  });

  it('deleteProfile removes the profile and its rules', async () => {
    await saveProfile(db, NET_SALES_PROFILE);
    await deleteProfile(db, NET_SALES_PROFILE.id);
    expect(await getProfile(db, NET_SALES_PROFILE.id)).toBeNull();
    expect(await rowCount(db, 'profile_rules')).toBe(4 + 3);
  });
});

// ---------------------------------------------------------------------------
// shifts
// ---------------------------------------------------------------------------

describe('shifts', () => {
  it('saveShift generates a unique non-empty id and an ISO savedAt when omitted', async () => {
    const f = fx(0);
    const a = await saveShift(db, { input: f.input, result: f.result });
    const b = await saveShift(db, { input: f.input, result: f.result });
    expect(typeof a).toBe('string');
    expect(a.length).toBeGreaterThan(0);
    expect(b).not.toBe(a);
    const saved = await getShift(db, a);
    expect(saved?.id).toBe(a);
    expect(Number.isNaN(Date.parse(saved!.savedAt))).toBe(false);
  });

  it('saveShift uses a provided id and savedAt verbatim', async () => {
    const f = fx(2);
    const id = await saveShift(db, {
      input: f.input,
      result: f.result,
      id: "shift-'quoted'-1",
      savedAt: '2026-11-18T04:05:06.789Z',
    });
    expect(id).toBe("shift-'quoted'-1");
    expect(await getShift(db, id)).toEqual({
      id: "shift-'quoted'-1",
      savedAt: '2026-11-18T04:05:06.789Z',
      input: f.input,
      result: f.result,
    });
  });

  it('getShift returns exactly what was saved', async () => {
    for (const f of shiftFixtures()) {
      const id = await saveShift(db, { input: f.input, result: f.result });
      const saved = await getShift(db, id);
      expect(saved?.input).toEqual(f.input);
      expect(saved?.result).toEqual(f.result);
    }
  });

  it('getShift of an unknown id is null', async () => {
    expect(await getShift(db, 'missing')).toBeNull();
  });

  it('updateShift replaces input and result, keeping id and savedAt', async () => {
    const [a, b] = [fx(2), fx(3)];
    const id = await saveShift(db, {
      input: a.input,
      result: a.result,
      savedAt: '2026-11-18T05:00:00.000Z',
    });
    // a different team size too, so member rows must be replaced, not appended
    const shorter = clone(b);
    shorter.input.team = shorter.input.team.slice(0, 3);
    await updateShift(db, id, { input: shorter.input, result: b.result });
    const saved = await getShift(db, id);
    expect(saved?.input).toEqual(shorter.input);
    expect(saved?.result).toEqual(b.result);
    expect(saved?.id).toBe(id);
    expect(saved?.savedAt).toBe('2026-11-18T05:00:00.000Z'); // ASSUMPTION: findings #43
    expect(await rowCount(db, 'shifts')).toBe(1);
    expect(await rowCount(db, 'shift_members')).toBe(3);
  });

  it('updateShift of an unknown id is a no-op (does not throw, does not create)', async () => {
    const f = fx(0);
    await expect(updateShift(db, 'missing', { input: f.input, result: f.result })).resolves.toBe(
      undefined,
    );
    expect(await getShift(db, 'missing')).toBeNull();
    expect(await rowCount(db, 'shifts')).toBe(0);
  });

  it('deleteShift removes the shift with its members and result; unknown id is a no-op', async () => {
    const [a, b] = [fx(0), fx(2)];
    const idA = await saveShift(db, { input: a.input, result: a.result });
    const idB = await saveShift(db, { input: b.input, result: b.result });
    await deleteShift(db, idA);
    expect(await getShift(db, idA)).toBeNull();
    expect(await getShift(db, idB)).not.toBeNull();
    expect(await rowCount(db, 'shift_members')).toBe(b.input.team.length);
    await expect(deleteShift(db, 'missing')).resolves.toBeUndefined();
    await deleteShift(db, idA); // twice
    expect(await rowCount(db, 'shifts')).toBe(1);
  });

  describe('listShifts', () => {
    // dates and savedAt chosen so every ordering rule is exercised
    const plan = [
      { id: 's-nov01', date: '2026-11-01', savedAt: '2026-11-02T03:00:00.000Z' },
      { id: 's-nov10-early', date: '2026-11-10', savedAt: '2026-11-11T01:00:00.000Z' },
      { id: 's-nov10-late', date: '2026-11-10', savedAt: '2026-11-11T09:00:00.000Z' },
      { id: 's-nov17', date: '2026-11-17', savedAt: '2026-11-01T00:00:00.000Z' }, // saved "earlier"
      { id: 's-nov30', date: '2026-11-30', savedAt: '2026-12-01T02:00:00.000Z' },
    ];
    beforeEach(async () => {
      const f = fx(0);
      // insert out of order so the result can't just be insertion order
      for (const i of [2, 0, 4, 1, 3]) {
        const p = at(plan, i);
        await saveShift(db, {
          id: p.id,
          savedAt: p.savedAt,
          input: { ...f.input, date: p.date },
          result: f.result,
        });
      }
    });
    const idsOf = async (range?: { from?: string; to?: string }) =>
      (await listShifts(db, range)).map((s) => s.id);

    it('no range: every shift, newest date first, then newest savedAt (not savedAt alone)', async () => {
      expect(await idsOf()).toEqual([
        's-nov30',
        's-nov17',
        's-nov10-late',
        's-nov10-early',
        's-nov01',
      ]);
      expect(await idsOf({})).toEqual(await idsOf());
    });

    it('from and to are inclusive yyyy-MM-dd bounds on input.date', async () => {
      expect(await idsOf({ from: '2026-11-10', to: '2026-11-17' })).toEqual([
        's-nov17',
        's-nov10-late',
        's-nov10-early',
      ]);
      expect(await idsOf({ from: '2026-11-17', to: '2026-11-17' })).toEqual(['s-nov17']);
    });

    it('open-ended ranges', async () => {
      expect(await idsOf({ from: '2026-11-17' })).toEqual(['s-nov30', 's-nov17']);
      expect(await idsOf({ to: '2026-11-01' })).toEqual(['s-nov01']);
    });

    it('a range with no shifts, or from after to, is empty', async () => {
      expect(await idsOf({ from: '2026-12-01', to: '2026-12-31' })).toEqual([]);
      expect(await idsOf({ from: '2026-11-30', to: '2026-11-01' })).toEqual([]);
    });

    it('bounds compare whole dates (yyyy-MM-dd), not times', async () => {
      // 2026-11-30 must be included by to: '2026-11-30' even though stored savedAt is Dec 1
      expect(await idsOf({ from: '2026-11-30', to: '2026-11-30' })).toEqual(['s-nov30']);
    });

    it('listed shifts are full SavedShift snapshots', async () => {
      const f = fx(0);
      const s = (await listShifts(db)).find((x) => x.id === 's-nov17');
      expect(s).toEqual({
        id: 's-nov17',
        savedAt: '2026-11-01T00:00:00.000Z',
        input: { ...f.input, date: '2026-11-17' },
        result: f.result,
      });
    });

    it('an empty database lists nothing', async () => {
      const fresh = await createTestDb();
      await initDb(fresh);
      expect(await listShifts(fresh)).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------------------
// coworkers
// ---------------------------------------------------------------------------

describe('coworkers', () => {
  it('upsertCoworker inserts (generating an id) and updates by id', async () => {
    const id = await upsertCoworker(db, { name: 'Joseph', usualRole: 'bartender' });
    expect(id.length).toBeGreaterThan(0);
    await upsertCoworker(db, {
      id,
      name: 'Joseph B',
      usualRole: 'barback',
      lastWorked: '2026-11-17',
    });
    expect(await listCoworkers(db)).toEqual([
      { id, name: 'Joseph B', usualRole: 'barback', lastWorked: '2026-11-17' },
    ]);
  });

  it('a coworker who never worked has no lastWorked key value (undefined, not null)', async () => {
    await upsertCoworker(db, { id: 'c1', name: 'Mia', usualRole: 'host' });
    const [c] = await listCoworkers(db);
    expect(c?.lastWorked).toBeUndefined();
  });

  it('listCoworkers: most recently worked first, then by name; never-worked last', async () => {
    // ASSUMPTION (findings #42): coworkers without lastWorked sort after those with one.
    await upsertCoworker(db, {
      id: 'c1',
      name: 'Zoe',
      usualRole: 'host',
      lastWorked: '2026-11-10',
    });
    await upsertCoworker(db, {
      id: 'c2',
      name: 'Aaron',
      usualRole: 'bartender',
      lastWorked: '2026-11-17',
    });
    await upsertCoworker(db, {
      id: 'c3',
      name: 'Mia',
      usualRole: 'host',
      lastWorked: '2026-11-10',
    });
    await upsertCoworker(db, { id: 'c4', name: 'Ben', usualRole: 'barback' });
    await upsertCoworker(db, { id: 'c5', name: 'Allen', usualRole: 'barback' });
    expect((await listCoworkers(db)).map((c) => c.name)).toEqual([
      'Aaron',
      'Mia',
      'Zoe',
      'Allen',
      'Ben',
    ]);
  });

  it('deleteCoworker removes one; unknown id is a no-op', async () => {
    await upsertCoworker(db, { id: 'c1', name: 'Mia', usualRole: 'host' });
    await upsertCoworker(db, { id: 'c2', name: 'Zoe', usualRole: 'host' });
    await deleteCoworker(db, 'c1');
    await expect(deleteCoworker(db, 'nope')).resolves.toBeUndefined();
    expect((await listCoworkers(db)).map((c) => c.id)).toEqual(['c2']);
  });

  describe('rememberTeam', () => {
    it('adds every named member with their role and lastWorked = date', async () => {
      await rememberTeam(
        db,
        [member('Joseph', 'bartender'), member('David', 'barback'), member('Hannah', 'host')],
        '2026-11-17',
      );
      const list = await listCoworkers(db);
      expect(
        list.map(({ name, usualRole, lastWorked }) => ({ name, usualRole, lastWorked })),
      ).toEqual([
        { name: 'David', usualRole: 'barback', lastWorked: '2026-11-17' },
        { name: 'Hannah', usualRole: 'host', lastWorked: '2026-11-17' },
        { name: 'Joseph', usualRole: 'bartender', lastWorked: '2026-11-17' },
      ]);
    });

    it('matches existing coworkers by case-insensitive, trimmed name (no duplicates)', async () => {
      const id = await upsertCoworker(db, { name: 'Joseph', usualRole: 'bartender' });
      await rememberTeam(db, [member('  joseph ', 'bartender')], '2026-11-17');
      await rememberTeam(db, [member('JOSEPH', 'bartender')], '2026-11-18');
      const list = await listCoworkers(db);
      expect(list).toHaveLength(1);
      expect(at(list, 0).id).toBe(id);
      expect(at(list, 0).lastWorked).toBe('2026-11-18');
    });

    it('stores a new name trimmed', async () => {
      await rememberTeam(db, [member('  Maya  ', 'bartender')], '2026-11-17');
      expect((await listCoworkers(db)).map((c) => c.name)).toEqual(['Maya']);
    });

    it('updates usualRole to the role just worked (matching ignores role)', async () => {
      await rememberTeam(db, [member('David', 'barback')], '2026-11-10');
      await rememberTeam(db, [member('David', 'bartender')], '2026-11-17');
      const list = await listCoworkers(db);
      expect(list).toHaveLength(1);
      expect(at(list, 0)).toMatchObject({
        name: 'David',
        usualRole: 'bartender',
        lastWorked: '2026-11-17',
      });
    });

    it('skips isUser members and blank or whitespace-only names', async () => {
      await rememberTeam(
        db,
        [
          member('Me', 'bartender', { isUser: true }),
          member('', 'barback'),
          member('   ', 'host'),
          member('Allen', 'barback'),
        ],
        '2026-11-17',
      );
      expect((await listCoworkers(db)).map((c) => c.name)).toEqual(['Allen']);
    });

    it('an isUser member does not update a saved coworker with the same name', async () => {
      await upsertCoworker(db, {
        id: 'c1',
        name: 'Me',
        usualRole: 'host',
        lastWorked: '2026-11-01',
      });
      await rememberTeam(db, [member('Me', 'bartender', { isUser: true })], '2026-11-17');
      expect(await listCoworkers(db)).toEqual([
        { id: 'c1', name: 'Me', usualRole: 'host', lastWorked: '2026-11-01' },
      ]);
    });

    it('an empty team changes nothing', async () => {
      await upsertCoworker(db, {
        id: 'c1',
        name: 'Mia',
        usualRole: 'host',
        lastWorked: '2026-11-01',
      });
      await rememberTeam(db, [], '2026-11-17');
      expect(await listCoworkers(db)).toEqual([
        { id: 'c1', name: 'Mia', usualRole: 'host', lastWorked: '2026-11-01' },
      ]);
    });

    it('feeds listCoworkers ordering: the latest shift’s team comes first', async () => {
      await rememberTeam(db, [member('Zoe', 'host'), member('Aaron', 'bartender')], '2026-11-10');
      await rememberTeam(db, [member('Maya', 'bartender')], '2026-11-17');
      expect((await listCoworkers(db)).map((c) => c.name)).toEqual(['Maya', 'Aaron', 'Zoe']);
    });

    it('names with quotes and non-ASCII characters are stored safely', async () => {
      await rememberTeam(
        db,
        [member("Hannah O'Brien", 'host'), member('Zoë "Z" Núñez', 'barback')],
        '2026-11-17',
      );
      expect((await listCoworkers(db)).map((c) => c.name).sort()).toEqual(
        ["Hannah O'Brien", 'Zoë "Z" Núñez'].sort(),
      );
    });
  });
});

// ---------------------------------------------------------------------------
// settings
// ---------------------------------------------------------------------------

describe('settings', () => {
  it('returns the fallback for a missing key', async () => {
    expect(await getSetting(db, 'defaultRoundToDollar', true)).toBe(true);
    expect(await getSetting(db, 'defaultProfileId', 'server-default')).toBe('server-default');
    expect(await getSetting(db, 'nope', { a: 1 })).toEqual({ a: 1 });
  });

  it('a stored false is returned as false, not the fallback', async () => {
    await setSetting(db, 'defaultRoundToDollar', false);
    expect(await getSetting(db, 'defaultRoundToDollar', true)).toBe(false);
  });

  it('round-trips booleans, strings, numbers, objects and arrays through JSON', async () => {
    const values: [string, unknown][] = [
      ['bool', true],
      ['str', 'bartender-default'],
      ['emptyStr', ''],
      ['quoted', 'it\'s "quoted"'],
      ['num', 0],
      ['float', 12.5],
      ['obj', { theme: 'dark', nested: { list: [1, 'two', null, false] } }],
      ['arr', ['a', 'b']],
    ];
    for (const [k, v] of values) await setSetting(db, k, v);
    for (const [k, v] of values) expect(await getSetting(db, k, 'FALLBACK')).toEqual(v);
  });

  it('a string that looks like JSON stays a string', async () => {
    await setSetting(db, 'looksLikeJson', '{"a":1}');
    expect(await getSetting(db, 'looksLikeJson', '')).toBe('{"a":1}');
    await setSetting(db, 'looksLikeBool', 'true');
    expect(await getSetting(db, 'looksLikeBool', '')).toBe('true');
  });

  it('setSetting overwrites (one row per key)', async () => {
    await setSetting(db, 'defaultProfileId', 'server-default');
    const rows = await rowCount(db, 'settings');
    await setSetting(db, 'defaultProfileId', 'bartender-default');
    expect(await getSetting(db, 'defaultProfileId', 'x')).toBe('bartender-default');
    expect(await rowCount(db, 'settings')).toBe(rows);
  });
});
