/**
 * Saved-shift fixtures for the milestone 7 History / CSV acceptance tests (docs/m7-contract.md).
 * Every `result` comes from the real engine. Pure TypeScript, not a test file itself.
 */
import { calculateShift } from '../engine/calculate';
import { BARTENDER_DEFAULT_PROFILE, SERVER_DEFAULT_PROFILE } from '../engine/profiles';
import type { ShiftInput, TeamMember, TipOutProfile } from '../engine/types';
import type { SavedShift } from '../db/repositories';
import {
  golden1Input,
  golden1Team,
  golden2Input,
  golden2Team,
  member,
  shiftInput,
} from './builders';

/** Wrap an input as a SavedShift, computing the result with the engine. */
export function saved(
  id: string,
  input: ShiftInput,
  profile: TipOutProfile,
  savedAt = `${input.date}T23:00:00.000Z`,
): SavedShift {
  return { id, savedAt, input, result: calculateShift(input, profile).result };
}

/** Patio profile: Busser as a fixed 1% of net sales (customProfiles.test.ts). */
export const BUSSER_PROFILE: TipOutProfile = {
  id: 'patio',
  name: 'Patio, late',
  appliesTo: 'server',
  totalTipOutPercentOfTips: 30,
  rules: [
    { role: 'kitchen', type: 'percentOfBasis', basis: 'foodSales', percent: 2 },
    { role: 'busser', label: 'Busser', type: 'percentOfBasis', basis: 'netSales', percent: 1 },
    { role: 'bartender', type: 'shareOfRemainder', weight: 4 },
    { role: 'barback', type: 'shareOfRemainder', weight: 3 },
    { role: 'host', type: 'shareOfRemainder', weight: 1 },
  ],
};

/** Golden 2 team with Joseph as the user. */
export function golden2UserTeam(): TeamMember[] {
  return golden2Team().map((m) => (m.id === 'joseph' ? { ...m, isUser: true } : m));
}

/**
 * The week of Sun Nov 15 – Sat Nov 21, 2026 (Sunday start) plus one shift outside it.
 *
 * | id   | date        | flow      | earned | tipped out | total tips |
 * | ---- | ----------- | --------- | ------ | ---------- | ---------- |
 * | g1   | Mon Nov 16  | server    | 23956  | 10100      | 34056      |  Golden 1
 * | g2   | Wed Nov 18  | bartender |  7555  |  4200      | 19255      |  Golden 2 retain, Joseph isUser: 7500 + change 55
 * | pat  | Sat Nov 21  | server    | 28000  | 12000      | 40000      |  Busser profile, rounding off
 * | out  | Sun Nov 22  | server    | (next week, ignored)             |
 */
export function weekShifts(): SavedShift[] {
  return [
    saved('g1', golden1Input({ date: '2026-11-16' }), SERVER_DEFAULT_PROFILE),
    saved(
      'g2',
      golden2Input({ date: '2026-11-18', team: golden2UserTeam() }),
      BARTENDER_DEFAULT_PROFILE,
    ),
    saved(
      'pat',
      shiftInput({
        date: '2026-11-21',
        totalTips: 40000,
        netSales: 200000,
        foodSales: 80000,
        profileId: 'patio',
        team: [...golden1Team(), member('Sam', 'busser', { id: 'sam' })],
      }),
      BUSSER_PROFILE,
    ),
    saved('out', golden1Input({ date: '2026-11-22' }), SERVER_DEFAULT_PROFILE),
  ];
}

/** A simple two-role server profile: host 1 : barback 1, 30% of tips, no carve-outs. */
export const PAIR_PROFILE: TipOutProfile = {
  id: 'pair',
  name: 'Pair',
  appliesTo: 'server',
  totalTipOutPercentOfTips: 30,
  rules: [
    { role: 'host', type: 'shareOfRemainder', weight: 1 },
    { role: 'barback', type: 'shareOfRemainder', weight: 1 },
  ],
};

/** A server shift on `date` with $100 tips (pool $30: host $15 / barback $15). */
export function pairShift(id: string, date: string, team: TeamMember[]): SavedShift {
  return saved(
    id,
    shiftInput({ date, totalTips: 10000, netSales: 50000, profileId: 'pair', team }),
    PAIR_PROFILE,
  );
}
