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
    // (owner Q7: remainders and hours tie -> odd dollar held back) -> $16 / $16;
    // to the cent with roundMemberShares: false -> $16.50 / $16.50.
    expect(memberAmounts(roleOf(result, 'barback'))).toEqual({ david: 1600, allen: 1600 });
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

describe('review round 2: keptChange with no bartenders listed (#20)', () => {
  // Bartender default, no bartenders on the team, barbacks + host staffed.
  // Tips $192.55 -> pool 5777 -> floor $57: KTO $2 / barbacks $41 / host $14.
  // Rounding on (owner Q7): barbacks $41 / 2 ties -> $20 / $20, $1 held back -> pool 5600,
  // kept = 19255 - 5600 = 13655. Rounding off: pool 5777, kept 13478.
  const team = [
    member('David', 'barback', { id: 'david' }),
    member('Allen', 'barback', { id: 'allen' }),
    member('Hannah', 'host', { id: 'hannah' }),
  ];
  it.each([true, false])(
    'keptSplit is [] and keptChange = kept, so sum(keptSplit) + keptChange == kept (rounding %p)',
    (roundToDollar) => {
      const input = shiftInput({
        userRole: 'bartender',
        totalTips: 19255,
        netSales: 90543,
        foodSales: 12000,
        roundToDollar,
        team,
      });
      const { result } = calculateShift(input, BARTENDER_DEFAULT_PROFILE);
      expect(result.keptSplit).toEqual([]);
      expect(result.keptChange).toBe(result.kept);
      expect(result.kept + result.pool).toBe(19255);
      expect(result.kept).toBe(roundToDollar ? 13655 : 13478);
    },
  );
});

describe('review round 2: POOL_EXCEEDS_TIPS compares the exact pool (#24)', () => {
  it('warns when basis x % is over total tips by less than half a cent', () => {
    // 5% x 400001c net = 20000.05c > 20000c tips -> warns, pool capped at 20000.
    const profile: TipOutProfile = {
      id: 'sales',
      name: 'Sales pool',
      appliesTo: 'server',
      totalTipOutPercentOfTips: 5,
      poolBasis: 'netSales',
      rules: [{ role: 'bartender', type: 'shareOfRemainder', weight: 1 }],
    };
    const input = shiftInput({
      totalTips: 20000,
      netSales: 400001,
      team: [member('Joseph', 'bartender')],
    });
    const { result, warnings } = calculateShift(input, profile);
    expect(warnings.map((w) => w.code)).toContain('POOL_EXCEEDS_TIPS');
    expect(result.pool).toBe(20000);
  });
});

describe('review round 3: ZERO_SHARE_AFTER_ROUNDING only when there was $1 to split (#34)', () => {
  it('no warning on an empty shift (tips 50c: pool and floored kept are both $0)', () => {
    const input = shiftInput({
      userRole: 'bartender',
      totalTips: 50,
      roundToDollar: true,
      team: [
        member('Joseph', 'bartender'),
        member('Aaron', 'bartender'),
        member('David', 'barback'),
        member('Hannah', 'host'),
      ],
    });
    const { result, warnings } = calculateShift(input, BARTENDER_DEFAULT_PROFILE);
    expect(result.keptSplit?.map((k) => k.amount)).toEqual([0, 0]);
    expect(warnings.map((w) => w.code)).not.toContain('ZERO_SHARE_AFTER_ROUNDING');
  });

  it('still warns for a member whose role rounded to $0 out of a non-empty pool', () => {
    // Tips $10 -> pool $3, no food: 4:3:1 of $3 = 1.5 / 1.125 / 0.375 -> $2 / $1 / $0.
    const { warnings } = calculateShift(
      golden1Input({ totalTips: 1000, netSales: 1000, foodSales: 0 }),
      SERVER_DEFAULT_PROFILE,
    );
    const w = warnings.find((x) => x.code === 'ZERO_SHARE_AFTER_ROUNDING');
    expect(w?.message).toContain('Hannah');
  });
});

describe('review round 5: REMAINDER_UNALLOCATED (#60)', () => {
  const kitchenOnly: TipOutProfile = {
    id: 'k',
    name: 'Kitchen only',
    appliesTo: 'server',
    totalTipOutPercentOfTips: 30,
    rules: [{ role: 'kitchen', type: 'percentOfBasis', basis: 'foodSales', percent: 2 }],
  };
  // Tips $400 -> pool $120; KTO 2% of $800 food = $16 -> $104 goes to nobody.
  const input = shiftInput({ totalTips: 40000, netSales: 100000, foodSales: 80000 });

  it.each([false, true])('warns with the unallocated amount (rounding %p)', (roundToDollar) => {
    const { result, warnings } = calculateShift({ ...input, roundToDollar }, kitchenOnly);
    expect(result.pool).toBe(1600);
    const w = warnings.find((x) => x.code === 'REMAINDER_UNALLOCATED');
    expect(w?.message).toContain('$104.00');
    expect(w?.message).toContain('stays with you');
  });

  it('no warning when the carve-outs use the whole pool or a share rule exists', () => {
    const full = { ...kitchenOnly, totalTipOutPercentOfTips: 4 }; // pool $16 = KTO $16
    expect(calculateShift(input, full).warnings.map((w) => w.code)).not.toContain(
      'REMAINDER_UNALLOCATED',
    );
    expect(calculateShift(input, SERVER_DEFAULT_PROFILE).warnings.map((w) => w.code)).not.toContain(
      'REMAINDER_UNALLOCATED',
    );
  });
});
