/**
 * Tests added by the main-branch review of docs/test-findings.md.
 * Decision ids (D1, D2, ...) and finding numbers (#n) refer to docs/review-log.md.
 */
import { calculateShift } from '../calculate';
import { memberHours } from '../hours';
import { formatCents, splitLargestRemainder } from '../money';
import { BARTENDER_DEFAULT_PROFILE, SERVER_DEFAULT_PROFILE } from '../profiles';
import type { TipOutProfile } from '../types';
import {
  expectValidationError,
  golden1Input,
  golden1Team,
  member,
  memberAmounts,
  roleOf,
  shiftInput,
} from '../../test-support/builders';

describe('review: clock and hours validation', () => {
  // D2 / #6a: equal clock-in and clock-out is a typo, not a 24h shift.
  it('rejects clockIn === clockOut (ISO and HH:mm) with INVALID_CLOCK', () => {
    expectValidationError(
      () =>
        memberHours({
          id: 'a',
          name: 'A',
          role: 'host',
          clockIn: '2026-11-17T20:00:00Z',
          clockOut: '2026-11-17T20:00:00Z',
        }),
      'INVALID_CLOCK',
    );
    expectValidationError(
      () => memberHours({ id: 'a', name: 'A', role: 'host', clockIn: '20:00', clockOut: '20:00' }),
      'INVALID_CLOCK',
    );
  });

  // #6d: negative or non-finite hours block the calculation.
  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects hours = %p with INVALID_CLOCK',
    (hours) => {
      const team = [
        ...golden1Team().filter((m) => m.role !== 'host'),
        member('Hannah', 'host', { id: 'hannah', hours }),
      ];
      expectValidationError(
        () => calculateShift(golden1Input({ team }), SERVER_DEFAULT_PROFILE),
        'INVALID_CLOCK',
      );
    },
  );

  // #7: everybody in a role at 0 hours falls back to an equal split instead of crashing.
  it('splits equally when every member of a role has 0 hours', () => {
    const team = [
      ...golden1Team().filter((m) => m.role !== 'barback'),
      member('David', 'barback', { id: 'david', hours: 0 }),
      member('Allen', 'barback', { id: 'allen', hours: 0 }),
    ];
    const { result } = calculateShift(golden1Input({ team }), SERVER_DEFAULT_PROFILE);
    // Golden 1 barbacks $33, same as with no hours entered: whole dollars by default
    // (owner Q1) -> $17 / $16; to the cent with roundMemberShares: false -> $16.50 / $16.50.
    expect(memberAmounts(roleOf(result, 'barback'))).toEqual({ david: 1700, allen: 1600 });
    const cents = calculateShift(golden1Input({ team }), SERVER_DEFAULT_PROFILE, {
      roundMemberShares: false,
    }).result;
    expect(memberAmounts(roleOf(cents, 'barback'))).toEqual({ david: 1650, allen: 1650 });
  });

  // #15: members of an equal-split role report hours 0.
  it('reports hours 0 for members when nobody in the role entered hours', () => {
    const { result } = calculateShift(golden1Input(), SERVER_DEFAULT_PROFILE);
    expect(roleOf(result, 'bartender').members.map((m) => m.hours)).toEqual([0, 0]);
  });
});

describe('review: missing fixed (percentOfBasis) roles (D4 / #12)', () => {
  // Pool 30% of $100 = $30. Kitchen 2% of $200 food = $4. Busser 1% of $500 net = $5.
  const profile: TipOutProfile = {
    id: 'busser',
    name: 'Busser profile',
    appliesTo: 'server',
    totalTipOutPercentOfTips: 30,
    rules: [
      { role: 'kitchen', type: 'percentOfBasis', basis: 'foodSales', percent: 2 },
      { role: 'busser', type: 'percentOfBasis', basis: 'netSales', percent: 1 },
      { role: 'bartender', type: 'shareOfRemainder', weight: 1 },
    ],
  };
  const base = shiftInput({
    totalTips: 10000,
    netSales: 50000,
    foodSales: 20000,
    team: [member('Joseph', 'bartender', { id: 'joseph' })],
  });

  it("'retain': an unstaffed busser carve-out is retained, not paid to nobody", () => {
    const { result } = calculateShift({ ...base, missingRoleHandling: 'retain' }, profile);
    expect(roleOf(result, 'busser')).toMatchObject({ amount: 500, missing: true, members: [] });
    expect(roleOf(result, 'kitchen')).toMatchObject({ amount: 400, missing: false });
    expect(roleOf(result, 'bartender').amount).toBe(2100); // 3000 - 400 - 500
    expect(result.retained).toBe(500);
    expect(result.pool).toBe(2500);
    expect(result.kept).toBe(7500);
  });

  it("'redistribute': the busser carve-out flows into the remainder for staffed share roles", () => {
    const { result } = calculateShift({ ...base, missingRoleHandling: 'redistribute' }, profile);
    expect(roleOf(result, 'busser')).toMatchObject({ amount: 0, missing: true });
    expect(roleOf(result, 'bartender').amount).toBe(2600); // 3000 - 400
    expect(result.retained).toBe(0);
    expect(result.pool).toBe(3000);
  });

  it('kitchen is never missing even with no kitchen members', () => {
    const { result } = calculateShift(base, profile);
    expect(roleOf(result, 'kitchen').missing).toBe(false);
  });
});

describe('review: redistribute with no staffed share role (#9)', () => {
  it('retains the missing shares and warns NO_REDISTRIBUTION_RECIPIENTS', () => {
    // Bartender default, only bartenders on shift. Pool 30% of $100 = $30, no food -> KTO $0.
    // Barbacks 3 : hosts 1 of $30 -> $22.50 / $7.50, both retained.
    const input = shiftInput({
      userRole: 'bartender',
      totalTips: 10000,
      netSales: 50000,
      foodSales: 0,
      missingRoleHandling: 'redistribute',
      team: [
        member('Joseph', 'bartender', { id: 'joseph' }),
        member('Aaron', 'bartender', { id: 'aaron' }),
      ],
    });
    const { result, warnings } = calculateShift(input, BARTENDER_DEFAULT_PROFILE);
    expect(warnings.map((w) => w.code)).toContain('NO_REDISTRIBUTION_RECIPIENTS');
    expect(roleOf(result, 'barback')).toMatchObject({ amount: 2250, missing: true });
    expect(roleOf(result, 'host')).toMatchObject({ amount: 750, missing: true });
    expect(result.retained).toBe(3000);
    expect(result.pool).toBe(0);
    expect(result.kept).toBe(10000);
    expect(result.keptSplit?.map((k) => k.amount)).toEqual([5000, 5000]);
  });

  it('does not warn when nothing is missing', () => {
    const { warnings } = calculateShift(golden1Input(), SERVER_DEFAULT_PROFILE);
    expect(warnings).toEqual([]);
  });
});

describe('review: team / profile mismatches (#13)', () => {
  it('warns UNUSED_TEAM_MEMBERS for members whose role the profile does not tip out', () => {
    const plain = calculateShift(golden1Input(), SERVER_DEFAULT_PROFILE).result;
    const team = [...golden1Team(), member('Sam', 'server', { id: 'sam' })];
    const { result, warnings } = calculateShift(golden1Input({ team }), SERVER_DEFAULT_PROFILE);
    const w = warnings.find((x) => x.code === 'UNUSED_TEAM_MEMBERS');
    expect(w?.message).toContain('Sam');
    expect(result).toEqual(plain); // the extra member changes nothing
  });

  it('does not count bartenders sharing the kept tips as unused in the bartender flow', () => {
    const input = shiftInput({
      userRole: 'bartender',
      totalTips: 10000,
      team: [member('Joseph', 'bartender'), member('David', 'barback'), member('Hannah', 'host')],
    });
    const { warnings } = calculateShift(input, BARTENDER_DEFAULT_PROFILE);
    expect(warnings).toEqual([]);
  });

  it('warns PROFILE_ROLE_MISMATCH when the profile is for the other role', () => {
    const { warnings } = calculateShift(golden1Input(), BARTENDER_DEFAULT_PROFILE);
    expect(warnings.map((w) => w.code)).toContain('PROFILE_ROLE_MISMATCH');
  });
});

describe('review: validation gaps (#14)', () => {
  it('rejects a profile with two rules for the same role (DUPLICATE_ROLE)', () => {
    const dup: TipOutProfile = {
      ...SERVER_DEFAULT_PROFILE,
      rules: [
        ...SERVER_DEFAULT_PROFILE.rules,
        { role: 'host', type: 'shareOfRemainder', weight: 2 },
      ],
    };
    expectValidationError(() => calculateShift(golden1Input(), dup), 'DUPLICATE_ROLE');
  });

  it('rejects non-finite money with NEGATIVE_AMOUNT and rounds non-integer cents', () => {
    expectValidationError(
      () => calculateShift(golden1Input({ totalTips: Number.NaN }), SERVER_DEFAULT_PROFILE),
      'NEGATIVE_AMOUNT',
    );
    const a = calculateShift(golden1Input({ totalTips: 34056.4 }), SERVER_DEFAULT_PROFILE).result;
    const b = calculateShift(golden1Input(), SERVER_DEFAULT_PROFILE).result;
    expect(a).toEqual(b);
  });

  it('splitLargestRemainder throws on empty or all-zero weights', () => {
    expect(() => splitLargestRemainder(100, [])).toThrow();
    expect(() => splitLargestRemainder(100, [0, 0])).toThrow();
  });

  it('formats negative cents as -$12.34', () => {
    expect(formatCents(-1234)).toBe('-$12.34');
  });
});
