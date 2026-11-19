/**
 * Shift fixtures and DB helpers for the milestone 4 persistence acceptance tests
 * (docs/m4-contract.md). Every fixture's `result` comes from the real engine (calculateShift),
 * so the snapshot tests round-trip exactly what the app would save.
 * Pure TypeScript, not a test file itself.
 */
import { calculateShift } from '../engine/calculate';
import { BARTENDER_DEFAULT_PROFILE, SERVER_DEFAULT_PROFILE } from '../engine/profiles';
import type { ShiftInput, ShiftResult, TeamMember, TipOutProfile } from '../engine/types';
import type { Db } from '../db/types';
import { golden1Input, golden2Input, member, shiftInput } from './builders';

export interface ShiftFixture {
  name: string;
  input: ShiftInput;
  result: ShiftResult;
  profile: TipOutProfile;
}

function fixture(name: string, input: ShiftInput, profile: TipOutProfile): ShiftFixture {
  return { name, input, profile, result: calculateShift(input, profile).result };
}

/** A custom sales-based profile (owner Q4) with a custom role and fractional numbers. */
export const NET_SALES_PROFILE: TipOutProfile = {
  id: 'custom-net',
  name: 'Net sales pool',
  appliesTo: 'server',
  totalTipOutPercentOfTips: 4.5,
  poolBasis: 'netSales',
  rules: [
    { role: 'host', type: 'shareOfRemainder', weight: 1.5 },
    { role: 'busser', type: 'shareOfRemainder', weight: 1 },
    { role: 'kitchen', type: 'percentOfBasis', basis: 'foodSales', percent: 2.5 },
    { role: 'bartender', type: 'shareOfRemainder', weight: 4 },
  ],
};

/** Bartender team with `isUser`, clock times across midnight and explicit hours. */
export function bartenderClockTeam(): TeamMember[] {
  return [
    member('Me', 'bartender', {
      id: 'me',
      isUser: true,
      clockIn: '2026-11-17T20:00:00Z',
      clockOut: '2026-11-18T02:30:00Z',
    }),
    member('Joseph', 'bartender', {
      id: 'joseph',
      clockIn: '2026-11-17T18:00:00Z',
      clockOut: '2026-11-18T01:15:00Z',
    }),
    member('Aaron', 'bartender', { id: 'aaron', clockIn: '22:00', clockOut: '02:00' }),
    member('David', 'barback', { id: 'david', hours: 6.25 }),
    member('Allen', 'barback', { id: 'allen', hours: 5 }),
    member("Hannah O'Brien", 'host', { id: 'hannah' }),
  ];
}

/** Three bartenders sharing $136 -> three-way tie -> keptHeldBack 100 (see calculate.test.ts). */
export function keptHeldBackTeam(): TeamMember[] {
  return [
    member('Joseph', 'bartender', { id: 'joseph', isUser: true }),
    member('Aaron', 'bartender', { id: 'aaron' }),
    member('Maya', 'bartender', { id: 'maya' }),
    member('David', 'barback', { id: 'david' }),
    member('Allen', 'barback', { id: 'allen' }),
  ];
}

/** Every fixture the snapshot tests save. Results come from the engine on this branch. */
export function shiftFixtures(): ShiftFixture[] {
  return [
    fixture(
      'Golden 1 (server, whole dollars, barbacks heldBack)',
      golden1Input(),
      SERVER_DEFAULT_PROFILE,
    ),
    fixture(
      'Golden 1, rounding off (fractional percentages)',
      golden1Input({ roundToDollar: false }),
      SERVER_DEFAULT_PROFILE,
    ),
    fixture(
      'Golden 2 retain (bartender, keptSplit, keptChange)',
      golden2Input(),
      BARTENDER_DEFAULT_PROFILE,
    ),
    fixture(
      'Golden 2 redistribute',
      golden2Input({ missingRoleHandling: 'redistribute' }),
      BARTENDER_DEFAULT_PROFILE,
    ),
    fixture(
      'Bartender, keptHeldBack (three-way tie), isUser',
      golden2Input({
        date: '2026-11-18',
        team: keptHeldBackTeam(),
        missingRoleHandling: 'redistribute',
      }),
      BARTENDER_DEFAULT_PROFILE,
    ),
    fixture(
      'Bartender, clock times past midnight, hours, isUser',
      golden2Input({ date: '2026-11-19', team: bartenderClockTeam() }),
      BARTENDER_DEFAULT_PROFILE,
    ),
    fixture(
      'Custom profile: netSales pool, custom role, unstaffed busser',
      shiftInput({
        date: '2026-11-20',
        totalTips: 1_234_567,
        netSales: 9_876_543,
        foodSales: 3_000_001,
        roundToDollar: true,
        profileId: NET_SALES_PROFILE.id,
        team: [
          member('Joseph', 'bartender', { id: 'joseph', hours: 7.5 }),
          member('Aaron', 'bartender', { id: 'aaron', hours: 2.25 }),
          member('Hannah', 'host', { id: 'hannah' }),
        ],
      }),
      NET_SALES_PROFILE,
    ),
    fixture(
      'Zero tips, no bartenders listed (keptChange = kept)',
      shiftInput({
        date: '2026-11-21',
        userRole: 'bartender',
        profileId: 'bartender-default',
        roundToDollar: true,
        team: [member('David', 'barback', { id: 'david' })],
      }),
      BARTENDER_DEFAULT_PROFILE,
    ),
  ];
}

/** Number of rows in a table. */
export async function rowCount(db: Db, table: string): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`);
  return row?.n ?? 0;
}

/** Deep clone through JSON (the fixtures contain only JSON-safe values). */
export function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}
