/**
 * Milestone 4 acceptance: the snapshot rule (docs/m4-contract.md "Rules", CLAUDE.md §7).
 * `getShift` returns exactly the `input` and `result` that were saved, including optional
 * fields, and editing or deleting a profile later never changes a saved shift.
 * Every result here comes from the real engine (calculateShift).
 */
import * as fc from 'fast-check';
import { calculateShift } from '../../engine/calculate';
import { BARTENDER_DEFAULT_PROFILE, SERVER_DEFAULT_PROFILE } from '../../engine/profiles';
import type { ShiftInput, TeamMember, TipOutProfile } from '../../engine/types';
import {
  deleteProfile,
  getShift,
  listShifts,
  saveProfile,
  saveShift,
  updateShift,
} from '../repositories';
import { initDb } from '../seed';
import { createTestDb } from '../testing/sqljsDb';
import type { Db } from '../types';
import { at } from '../../test-support/builders';
import { clone, NET_SALES_PROFILE, shiftFixtures } from '../../test-support/shiftFixtures';

/** Edit every field of a profile that could plausibly leak into a stored shift. */
function editedProfile(p: TipOutProfile): TipOutProfile {
  return {
    ...p,
    name: `${p.name} (edited)`,
    totalTipOutPercentOfTips: p.totalTipOutPercentOfTips === 50 ? 40 : 50,
    poolBasis: 'foodSales',
    rules: [...p.rules]
      .reverse()
      .map((r) =>
        r.type === 'percentOfBasis'
          ? { ...r, percent: r.percent + 1 }
          : { ...r, weight: r.weight + 2 },
      ),
  };
}

let db: Db;
beforeEach(async () => {
  db = await createTestDb();
  await initDb(db);
  await saveProfile(db, NET_SALES_PROFILE);
});

describe('fixtures sanity (they exercise the optional fields)', () => {
  const all = shiftFixtures();
  it('include heldBack, keptHeldBack, keptSplit, isUser and clock times', () => {
    expect(all.some((f) => f.result.roles.some((r) => (r.heldBack ?? 0) > 0))).toBe(true);
    expect(all.some((f) => (f.result.keptHeldBack ?? 0) > 0)).toBe(true);
    expect(all.some((f) => (f.result.keptSplit ?? []).length > 0)).toBe(true);
    expect(all.some((f) => f.result.keptSplit === undefined)).toBe(true);
    expect(all.some((f) => f.input.team.some((m) => m.isUser))).toBe(true);
    expect(all.some((f) => f.input.team.some((m) => m.clockIn !== undefined))).toBe(true);
    expect(all.some((f) => f.input.team.some((m) => m.hours !== undefined))).toBe(true);
    expect(all.some((f) => f.result.roles.some((r) => r.missing))).toBe(true);
    expect(all.some((f) => !Number.isInteger(f.result.poolPercentOfTips))).toBe(true);
  });
});

describe('saved shifts are snapshots', () => {
  it.each(shiftFixtures().map((f) => [f.name, f] as const))(
    '%s: getShift deep-equals what was saved',
    async (_name, f) => {
      const id = await saveShift(db, { input: f.input, result: f.result });
      const saved = await getShift(db, id);
      expect(saved?.input).toEqual(f.input);
      expect(saved?.result).toEqual(f.result);
      // no extra keys / nulls added on the way back
      expect(JSON.parse(JSON.stringify(saved!.input))).toEqual(JSON.parse(JSON.stringify(f.input)));
      expect(JSON.parse(JSON.stringify(saved!.result))).toEqual(
        JSON.parse(JSON.stringify(f.result)),
      );
    },
  );

  it.each(shiftFixtures().map((f) => [f.name, f] as const))(
    '%s: editing then deleting its profile does not change the saved shift',
    async (_name, f) => {
      const before = clone({ input: f.input, result: f.result });
      const id = await saveShift(db, { input: f.input, result: f.result });

      await saveProfile(db, editedProfile(f.profile));
      expect(await getShift(db, id)).toMatchObject(before);

      await deleteProfile(db, f.profile.id);
      const saved = await getShift(db, id);
      expect(saved?.input).toEqual(before.input);
      expect(saved?.result).toEqual(before.result);
      expect((await listShifts(db)).find((s) => s.id === id)).toEqual(saved);
    },
  );

  it('deleting every profile leaves every saved shift intact', async () => {
    const all = shiftFixtures();
    const ids: string[] = [];
    for (const f of all) ids.push(await saveShift(db, { input: f.input, result: f.result }));
    for (const p of [SERVER_DEFAULT_PROFILE, BARTENDER_DEFAULT_PROFILE, NET_SALES_PROFILE]) {
      await deleteProfile(db, p.id);
    }
    for (let i = 0; i < all.length; i++) {
      const saved = await getShift(db, at(ids, i));
      expect(saved?.input).toEqual(at(all, i).input);
      expect(saved?.result).toEqual(at(all, i).result);
    }
  });

  it('a saved shift is not affected by mutating the objects after saving', async () => {
    const f = clone(at(shiftFixtures(), 2));
    const expected = clone(f);
    const id = await saveShift(db, { input: f.input, result: f.result });
    f.input.team.pop();
    f.result.kept = -1;
    const saved = await getShift(db, id);
    expect(saved?.input).toEqual(expected.input);
    expect(saved?.result).toEqual(expected.result);
  });

  it('getShift returns a fresh object each time (mutating one read does not affect the next)', async () => {
    const f = at(shiftFixtures(), 0);
    const id = await saveShift(db, { input: f.input, result: f.result });
    const first = await getShift(db, id);
    first!.result.roles.pop();
    first!.input.team[0]!.name = 'changed';
    const second = await getShift(db, id);
    expect(second?.input).toEqual(f.input);
    expect(second?.result).toEqual(f.result);
  });

  it('updateShift stores the new snapshot exactly, and it survives profile edits', async () => {
    const [a, b] = [at(shiftFixtures(), 2), at(shiftFixtures(), 4)];
    const id = await saveShift(db, { input: a.input, result: a.result });
    await updateShift(db, id, { input: b.input, result: b.result });
    await saveProfile(db, editedProfile(BARTENDER_DEFAULT_PROFILE));
    const saved = await getShift(db, id);
    expect(saved?.input).toEqual(b.input);
    expect(saved?.result).toEqual(b.result);
  });
});

// ---------------------------------------------------------------------------
// property: random calculated shifts round-trip exactly
// ---------------------------------------------------------------------------

const NAMES = [
  'Joseph',
  'Aaron',
  "Hannah O'Brien",
  'Zoë Núñez',
  'Maya "M"',
  'David',
  'Allen',
  'Sam',
];
type HoursMode = 'none' | 'hours' | 'clock';

const roleGroupArb = fc.record({
  count: fc.integer({ min: 0, max: 3 }),
  mode: fc.constantFrom<HoursMode>('none', 'hours', 'clock'),
  quarterHours: fc.array(fc.integer({ min: 1, max: 48 }), { minLength: 3, maxLength: 3 }),
  startMinutes: fc.array(fc.integer({ min: 0, max: 1439 }), { minLength: 3, maxLength: 3 }),
});

const caseArb = fc.record({
  userRole: fc.constantFrom<'server' | 'bartender'>('server', 'bartender'),
  useNetSalesProfile: fc.boolean(),
  totalTips: fc.integer({ min: 0, max: 2_000_000 }),
  netSales: fc.integer({ min: 0, max: 5_000_000 }),
  foodPct: fc.integer({ min: 0, max: 120 }),
  bartenders: roleGroupArb,
  barbacks: roleGroupArb,
  hosts: roleGroupArb,
  bussers: roleGroupArb,
  userIsFirstBartender: fc.boolean(),
  missingRoleHandling: fc.constantFrom<'redistribute' | 'retain'>('redistribute', 'retain'),
  roundToDollar: fc.boolean(),
  roundMemberShares: fc.constantFrom<boolean | undefined>(undefined, true, false),
  day: fc.integer({ min: 1, max: 28 }),
  nameOffset: fc.nat(),
});

type RawCase = typeof caseArb extends fc.Arbitrary<infer T> ? T : never;
const BASE = Date.UTC(2026, 10, 17);

function build(c: RawCase): { input: ShiftInput; profile: TipOutProfile; options: object } {
  const profile =
    c.userRole === 'bartender'
      ? BARTENDER_DEFAULT_PROFILE
      : c.useNetSalesProfile
        ? NET_SALES_PROFILE
        : SERVER_DEFAULT_PROFILE;
  const team: TeamMember[] = [];
  let n = 0;
  const add = (role: string, g: typeof c.bartenders) => {
    for (let i = 0; i < g.count; i++) {
      const m: TeamMember = {
        id: `${role}-${i}`,
        name: at(NAMES, (c.nameOffset + n++) % NAMES.length),
        role,
      };
      if (g.mode === 'hours') m.hours = at(g.quarterHours, i) / 4;
      if (g.mode === 'clock') {
        const start = BASE + at(g.startMinutes, i) * 60_000;
        m.clockIn = new Date(start).toISOString();
        m.clockOut = new Date(start + at(g.quarterHours, i) * 15 * 60_000).toISOString();
      }
      if (role === 'bartender' && i === 0 && c.userRole === 'bartender' && c.userIsFirstBartender) {
        m.isUser = true;
      }
      team.push(m);
    }
  };
  add('bartender', c.bartenders);
  add('barback', c.barbacks);
  add('host', c.hosts);
  if (profile === NET_SALES_PROFILE) add('busser', c.bussers);
  const input: ShiftInput = {
    date: `2026-11-${String(c.day).padStart(2, '0')}`,
    userRole: c.userRole,
    totalTips: c.totalTips,
    netSales: c.netSales,
    foodSales: Math.floor((c.netSales * c.foodPct) / 100),
    team,
    missingRoleHandling: c.missingRoleHandling,
    profileId: profile.id,
    roundToDollar: c.roundToDollar,
  };
  const options =
    c.roundMemberShares === undefined ? {} : { roundMemberShares: c.roundMemberShares };
  return { input, profile, options };
}

describe('property: any calculated shift round-trips exactly', () => {
  it('save -> edit profile -> delete profile -> getShift deep-equals the saved snapshot', async () => {
    await fc.assert(
      fc.asyncProperty(caseArb, async (raw) => {
        const { input, profile, options } = build(raw);
        const { result } = calculateShift(input, profile, options);
        const expected = clone({ input, result });

        const pdb = await createTestDb();
        await initDb(pdb);
        await saveProfile(pdb, NET_SALES_PROFILE);
        const id = await saveShift(pdb, { input, result });

        const first = await getShift(pdb, id);
        expect(first?.input).toEqual(expected.input);
        expect(first?.result).toEqual(expected.result);

        await saveProfile(pdb, editedProfile(profile));
        await deleteProfile(pdb, profile.id);

        const later = await getShift(pdb, id);
        expect(later?.input).toEqual(expected.input);
        expect(later?.result).toEqual(expected.result);
        // integer cents stay integers
        for (const v of [later!.result.pool, later!.result.kept, later!.result.keptChange]) {
          expect(Number.isInteger(v)).toBe(true);
        }
        expect((await listShifts(pdb)).map((s) => s.id)).toEqual([id]);
      }),
      { seed: 20261118, numRuns: 60 },
    );
  });
});
