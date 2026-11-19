/**
 * Milestone 4 decisions from the main-branch review (docs/review-log.md, round 4).
 * Finding numbers (#n) refer to docs/test-findings.md.
 */
import {
  getSetting,
  listCoworkers,
  listShifts,
  rememberTeam,
  saveShift,
  setSetting,
  upsertCoworker,
} from '../repositories';
import { initDb } from '../seed';
import { createTestDb } from '../testing/sqljsDb';
import type { Db } from '../types';
import { at, member } from '../../test-support/builders';
import { clone, shiftFixtures } from '../../test-support/shiftFixtures';

let db: Db;
beforeEach(async () => {
  db = await createTestDb();
  await initDb(db);
});

describe('rememberTeam: lastWorked never moves backwards (#48)', () => {
  it('an older shift keeps the later lastWorked and the usual role', async () => {
    await rememberTeam(db, [member('Sam', 'host')], '2026-11-10');
    await rememberTeam(db, [member('Sam', 'barback')], '2026-11-01');
    expect((await listCoworkers(db)).map((c) => [c.name, c.usualRole, c.lastWorked])).toEqual([
      ['Sam', 'host', '2026-11-10'],
    ]);
  });

  it('a newer (or same-day) shift moves lastWorked forward and updates the role', async () => {
    await rememberTeam(db, [member('Sam', 'host')], '2026-11-10');
    await rememberTeam(db, [member('Sam', 'barback')], '2026-11-10');
    await rememberTeam(db, [member('Sam', 'bartender')], '2026-11-12');
    expect((await listCoworkers(db)).map((c) => [c.usualRole, c.lastWorked])).toEqual([
      ['bartender', '2026-11-12'],
    ]);
  });

  it('an older shift still adds coworkers that were not saved before', async () => {
    await rememberTeam(db, [member('Sam', 'host')], '2026-11-10');
    await rememberTeam(db, [member('Kim', 'barback')], '2026-11-01');
    expect((await listCoworkers(db)).map((c) => c.name)).toEqual(['Sam', 'Kim']);
  });
});

describe('coworker names (#47, #49, #42)', () => {
  it('a name match keeps the existing spelling; new names are stored trimmed', async () => {
    await rememberTeam(db, [member('  Joseph  ', 'bartender')], '2026-11-01');
    await rememberTeam(db, [member('joseph', 'bartender')], '2026-11-02');
    const id = await upsertCoworker(db, { name: 'JOSEPH ', usualRole: 'bartender' });
    const list = await listCoworkers(db);
    expect(list.map((c) => c.name)).toEqual(['Joseph']);
    expect(at(list, 0).id).toBe(id);
  });

  it('upsertCoworker with an explicit id renames', async () => {
    const id = await upsertCoworker(db, { name: 'Jo', usualRole: 'host' });
    await upsertCoworker(db, { id, name: ' Joanne ', usualRole: 'host' });
    expect((await listCoworkers(db)).map((c) => c.name)).toEqual(['Joanne']);
  });

  it('matches non-ASCII names case-insensitively (Zoë / ZOË) and across Unicode forms', async () => {
    await rememberTeam(db, [member('Zoë', 'host')], '2026-11-01');
    await rememberTeam(db, [member('ZOË', 'host')], '2026-11-02');
    await rememberTeam(db, [member('Zoë', 'host')], '2026-11-03'); // decomposed ë
    const list = await listCoworkers(db);
    expect(list.map((c) => [c.name, c.lastWorked])).toEqual([['Zoë', '2026-11-03']]);
  });

  it('sorts names case-insensitively, never-worked last', async () => {
    await upsertCoworker(db, { name: 'bob', usualRole: 'host', lastWorked: '2026-11-01' });
    await upsertCoworker(db, { name: 'Alice', usualRole: 'host', lastWorked: '2026-11-01' });
    await upsertCoworker(db, { name: 'carl', usualRole: 'host' });
    await upsertCoworker(db, { name: 'Abe', usualRole: 'host' });
    expect((await listCoworkers(db)).map((c) => c.name)).toEqual(['Alice', 'bob', 'Abe', 'carl']);
  });
});

describe('listShifts ordering and savedAt (#41)', () => {
  it('stores savedAt via toISOString()', async () => {
    const f = clone(at(shiftFixtures(), 0));
    await saveShift(db, { ...f, id: 'a', savedAt: '2026-11-17T10:00:00+00:00' });
    expect(at(await listShifts(db), 0).savedAt).toBe('2026-11-17T10:00:00.000Z');
  });

  it('orders mixed savedAt formats by time, not text', async () => {
    const f = clone(at(shiftFixtures(), 0));
    await saveShift(db, { ...f, id: 'early', savedAt: '2026-11-17T10:00:00+00:00' });
    await saveShift(db, { ...f, id: 'late', savedAt: '2026-11-17T10:00:00.500Z' });
    expect((await listShifts(db)).map((s) => s.id)).toEqual(['late', 'early']);
  });

  it('same date and savedAt: newest insert first', async () => {
    const f = clone(at(shiftFixtures(), 0));
    const savedAt = '2026-11-17T10:00:00.000Z';
    for (const id of ['m', 'z', 'a']) await saveShift(db, { ...f, id, savedAt });
    expect((await listShifts(db)).map((s) => s.id)).toEqual(['a', 'z', 'm']);
  });
});

describe('settings edge cases (#52)', () => {
  it('setting a key to undefined deletes it, so reads return the fallback', async () => {
    await setSetting(db, 'defaultProfileId', 'bartender-default');
    await setSetting(db, 'defaultProfileId', undefined);
    expect(await getSetting(db, 'defaultProfileId', 'server-default')).toBe('server-default');
    const rows = await db.getAllAsync('SELECT * FROM settings WHERE key = ?', ['defaultProfileId']);
    expect(rows).toEqual([]);
  });

  it('a stored value that fails to parse returns the fallback', async () => {
    await db.runAsync('INSERT INTO settings (key, value) VALUES (?, ?)', ['broken', '{not json']);
    expect(await getSetting(db, 'broken', 42)).toBe(42);
  });
});
