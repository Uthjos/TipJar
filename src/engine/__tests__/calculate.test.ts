/**
 * Behavioural tests for calculateShift (CLAUDE.md §5) beyond the two golden examples.
 * Every expected value is derived by hand in a comment. Amounts are integer cents.
 */
import { calculateShift, EngineValidationError } from '../calculate';
import { BARTENDER_DEFAULT_PROFILE, SERVER_DEFAULT_PROFILE } from '../profiles';
import type { TeamMember, TipOutProfile } from '../types';
import {
  at,
  deepFreeze,
  expectValidationError,
  golden1Input,
  golden1Team,
  golden2Input,
  keptSplitAmounts,
  member,
  memberAmounts,
  paidRolesTotal,
  profile,
  roleOf,
  shiftInput,
  sum,
} from '../../test-support/builders';

const withoutRole = (team: TeamMember[], role: string) => team.filter((m) => m.role !== role);

describe('default profiles (CLAUDE.md §4)', () => {
  const ruleFor = (p: TipOutProfile, role: string) => {
    const r = p.rules.find((x) => x.role === role);
    if (!r) throw new Error(`no rule for ${role} in ${p.id}`);
    return r;
  };

  it('Server default: 30% of tips, KTO 2% of food, bartender 4 : barback 3 : host 1', () => {
    const p = SERVER_DEFAULT_PROFILE;
    expect(p.id).toBe('server-default');
    expect(p.appliesTo).toBe('server');
    expect(p.totalTipOutPercentOfTips).toBe(30);
    expect(ruleFor(p, 'kitchen')).toMatchObject({
      type: 'percentOfBasis',
      basis: 'foodSales',
      percent: 2,
    });
    const w = (role: string) => {
      const r = ruleFor(p, role);
      if (r.type !== 'shareOfRemainder') throw new Error(`${role} should be shareOfRemainder`);
      return r.weight;
    };
    // Only the ratio is specified (4:3:1 == 50 / 37.5 / 12.5)
    expect(w('bartender') / w('host')).toBeCloseTo(4, 10);
    expect(w('barback') / w('host')).toBeCloseTo(3, 10);
    expect(p.rules).toHaveLength(4);
  });

  it('Bartender default: 30% of tips, KTO 2% of food, barback 3 : host 1, no bartender rule', () => {
    const p = BARTENDER_DEFAULT_PROFILE;
    expect(p.id).toBe('bartender-default');
    expect(p.appliesTo).toBe('bartender');
    expect(p.totalTipOutPercentOfTips).toBe(30);
    expect(ruleFor(p, 'kitchen')).toMatchObject({
      type: 'percentOfBasis',
      basis: 'foodSales',
      percent: 2,
    });
    const barback = ruleFor(p, 'barback');
    const host = ruleFor(p, 'host');
    if (barback.type !== 'shareOfRemainder' || host.type !== 'shareOfRemainder') {
      throw new Error('barback/host should be shareOfRemainder');
    }
    expect(barback.weight / host.weight).toBeCloseTo(3, 10);
    expect(p.rules.find((r) => r.role === 'bartender')).toBeUndefined();
    expect(p.rules).toHaveLength(3);
  });
});

describe('rounding OFF', () => {
  it('Golden 1 input, to the cent', () => {
    /*
     * pool = 30% x 34056 = 10216.8 -> 10217c
     * KTO = 2% x 70012 = 1400.24; remainder 10217 - 1400.24 = 8816.76 split 4:3:1
     *   -> 4408.38 / 3306.285 / 1102.095
     * cent largest remainder: floors 1400+4408+3306+1102 = 10216, 1 cent -> bartender (.38)
     *   -> 1400 / 4409 / 3306 / 1102
     * bartender members 4409 / 2 -> Joseph 2205, Aaron 2204 (tie -> first)
     * barback 3306 / 2 -> 1653 / 1653
     * kept = 34056 - 10217 = 23839
     */
    const { result } = calculateShift(
      golden1Input({ roundToDollar: false }),
      SERVER_DEFAULT_PROFILE,
    );
    expect(result.pool).toBe(10217);
    expect(result.roundingAdjustment).toBe(0);
    expect(roleOf(result, 'kitchen').amount).toBe(1400);
    expect(roleOf(result, 'bartender').amount).toBe(4409);
    expect(roleOf(result, 'barback').amount).toBe(3306);
    expect(roleOf(result, 'host').amount).toBe(1102);
    expect(memberAmounts(roleOf(result, 'bartender'))).toEqual({ joseph: 2205, aaron: 2204 });
    expect(memberAmounts(roleOf(result, 'barback'))).toEqual({ david: 1653, allen: 1653 });
    expect(memberAmounts(roleOf(result, 'host'))).toEqual({ hannah: 1102 });
    expect(result.kept).toBe(23839);
  });

  it("Golden 2 input, 'retain', to the cent", () => {
    /*
     * pool = 30% x 19255 = 5776.5 -> 5777c (half-cent rounds up)
     * KTO = 2% x 12000 = 240; remainder 5537 split 3:1 -> 4152.75 / 1384.25
     * floors 240+4152+1384 = 5776, 1 cent -> barback (.75) -> 240 / 4153 / 1384
     * host missing + retain: retained 1384; pool paid = 240 + 4153 = 4393
     * barback members 4153 / 2 -> 2077 / 2076
     * kept = 19255 - 4393 = 14862 -> keptSplit 7431 / 7431
     */
    const { result } = calculateShift(
      golden2Input({ roundToDollar: false }),
      BARTENDER_DEFAULT_PROFILE,
    );
    expect(result.pool).toBe(4393);
    expect(result.retained).toBe(1384);
    expect(result.roundingAdjustment).toBe(0);
    expect(roleOf(result, 'kitchen').amount).toBe(240);
    expect(roleOf(result, 'barback').amount).toBe(4153);
    expect(memberAmounts(roleOf(result, 'barback'))).toEqual({ david: 2077, allen: 2076 });
    expect(roleOf(result, 'host')).toMatchObject({ amount: 1384, missing: true, members: [] });
    expect(result.kept).toBe(14862);
    expect(keptSplitAmounts(result)).toEqual({ joseph: 7431, aaron: 7431 });
    // §5.4 step 5: with rounding off, keptSplit is to the cent and keptChange is 0.
    expect(result.keptChange).toBe(0);
  });

  it('roundMemberShares has no effect when roundToDollar is off (default, true or false)', () => {
    // §5.4 steps 4-5: member and keptSplit rounding only apply under whole-dollar rounding.
    const cases = [
      [golden1Input({ roundToDollar: false }), SERVER_DEFAULT_PROFILE],
      [golden2Input({ roundToDollar: false }), BARTENDER_DEFAULT_PROFILE],
    ] as const;
    for (const [input, p] of cases) {
      const dflt = calculateShift(input, p).result;
      const on = calculateShift(input, p, { roundMemberShares: true }).result;
      const off = calculateShift(input, p, { roundMemberShares: false }).result;
      expect(on).toEqual(dflt);
      expect(off).toEqual(dflt);
      expect(dflt.keptChange).toBe(0);
    }
  });
});

describe('rounding ON (§5.4)', () => {
  it('never pays out more than the unrounded pool', () => {
    const on = calculateShift(golden1Input({ roundToDollar: true }), SERVER_DEFAULT_PROFILE).result;
    const off = calculateShift(
      golden1Input({ roundToDollar: false }),
      SERVER_DEFAULT_PROFILE,
    ).result;
    expect(on.pool).toBeLessThanOrEqual(off.pool);
    expect(on.pool + on.roundingAdjustment).toBe(off.pool);
  });

  it('every role amount is a whole dollar', () => {
    const { result } = calculateShift(golden1Input(), SERVER_DEFAULT_PROFILE);
    for (const r of result.roles) expect(r.amount % 100).toBe(0);
  });

  it('member shares are whole dollars by default (owner Q1); false gives cent splits', () => {
    const dflt = calculateShift(golden1Input(), SERVER_DEFAULT_PROFILE).result;
    const explicit = calculateShift(golden1Input(), SERVER_DEFAULT_PROFILE, {
      roundMemberShares: true,
    }).result;
    expect(explicit).toEqual(dflt);
    for (const r of dflt.roles) for (const m of r.members) expect(m.amount % 100).toBe(0);
    const cents = calculateShift(golden1Input(), SERVER_DEFAULT_PROFILE, {
      roundMemberShares: false,
    }).result;
    // barbacks $33: whole dollars 17 / 16, cents 16.50 / 16.50; role amounts identical
    expect(memberAmounts(roleOf(dflt, 'barback'))).toEqual({ david: 1700, allen: 1600 });
    expect(memberAmounts(roleOf(cents, 'barback'))).toEqual({ david: 1650, allen: 1650 });
    expect(cents.roles.map((r) => r.amount)).toEqual(dflt.roles.map((r) => r.amount));
  });

  it('server flow: keptChange is always 0 and keptSplit is absent', () => {
    const { result } = calculateShift(golden1Input(), SERVER_DEFAULT_PROFILE);
    expect(result.keptChange).toBe(0);
    expect(result.keptSplit).toBeUndefined();
  });

  it('a pool already on a whole dollar has roundingAdjustment 0', () => {
    // tips 40000 -> pool 12000 exactly
    const { result } = calculateShift(
      golden1Input({ totalTips: 40000, foodSales: 0 }),
      SERVER_DEFAULT_PROFILE,
    );
    expect(result.pool).toBe(12000);
    expect(result.roundingAdjustment).toBe(0);
  });

  it('a pool under $1 floors to $0 and everything stays with the user', () => {
    // tips 300 -> pool 90c -> floor 0; KTO 2% x 1000 = 20c capped... allocation of $0 -> all 0
    const { result } = calculateShift(
      golden1Input({ totalTips: 300, netSales: 1000, foodSales: 1000 }),
      SERVER_DEFAULT_PROFILE,
    );
    expect(result.pool).toBe(0);
    expect(result.roundingAdjustment).toBe(90);
    expect(result.kept).toBe(300);
    for (const r of result.roles) expect(r.amount).toBe(0);
  });
});

describe('hours: unequal splits (F4)', () => {
  it('splits tip-out role amounts by hours (whole dollars by default)', () => {
    /*
     * Golden 1 role amounts (bartender $44, barback $33) are independent of hours.
     * bartenders 5h / 3h -> $44 x 5/8 = 27.5, 16.5 -> floors 43, $1 left, tie .5/.5 -> Joseph
     *   -> 2800 / 1600
     * barbacks   6h / 3h -> $33 x 2/3 = 22, 11 -> 2200 / 1100
     */
    const team = [
      member('Joseph', 'bartender', { id: 'joseph', hours: 5 }),
      member('Aaron', 'bartender', { id: 'aaron', hours: 3 }),
      member('David', 'barback', { id: 'david', hours: 6 }),
      member('Allen', 'barback', { id: 'allen', hours: 3 }),
      member('Hannah', 'host', { id: 'hannah' }),
    ];
    const { result } = calculateShift(golden1Input({ team }), SERVER_DEFAULT_PROFILE);
    expect(roleOf(result, 'bartender').amount).toBe(4400);
    expect(memberAmounts(roleOf(result, 'bartender'))).toEqual({ joseph: 2800, aaron: 1600 });
    expect(memberAmounts(roleOf(result, 'barback'))).toEqual({ david: 2200, allen: 1100 });
    expect(roleOf(result, 'barback').members.map((m) => m.hours)).toEqual([6, 3]);
  });

  it('splits tip-out role amounts by hours to the cent with roundMemberShares: false', () => {
    // bartenders 5h / 3h -> 4400 x 5/8 = 2750, 1650
    const team = [
      member('Joseph', 'bartender', { id: 'joseph', hours: 5 }),
      member('Aaron', 'bartender', { id: 'aaron', hours: 3 }),
      ...withoutRole(golden1Team(), 'bartender'),
    ];
    const { result } = calculateShift(golden1Input({ team }), SERVER_DEFAULT_PROFILE, {
      roundMemberShares: false,
    });
    expect(memberAmounts(roleOf(result, 'bartender'))).toEqual({ joseph: 2750, aaron: 1650 });
  });

  describe('3 hosts share $11', () => {
    const team = () => [
      ...withoutRole(golden1Team(), 'host'),
      member('Hannah', 'host', { id: 'hannah' }),
      member('Mia', 'host', { id: 'mia' }),
      member('Zoe', 'host', { id: 'zoe' }),
    ];
    const hostSplit = (opts?: { roundMemberShares?: boolean }) => {
      const { result } = calculateShift(
        golden1Input({ team: team() }),
        SERVER_DEFAULT_PROFILE,
        opts,
      );
      expect(roleOf(result, 'host').amount).toBe(1100);
      return roleOf(result, 'host').members.map((m) => [m.memberId, m.amount]);
    };

    it('whole dollars by default: leftover dollars go to earlier members', () => {
      // $11 / 3 = 3.67 -> floors 9, $2 left, ties -> Hannah, Mia -> 400, 400, 300
      expect(hostSplit()).toEqual([
        ['hannah', 400],
        ['mia', 400],
        ['zoe', 300],
      ]);
    });

    it('to the cent with roundMemberShares: false: leftover cents go to earlier members', () => {
      // 1100 / 3 = 366.67 -> 367, 367, 366
      expect(hostSplit({ roundMemberShares: false })).toEqual([
        ['hannah', 367],
        ['mia', 367],
        ['zoe', 366],
      ]);
    });
  });

  it("splits the bar's kept tips by hours in whole dollars (keptSplit + keptChange)", () => {
    /*
     * Golden 2 kept 14955 -> floorToDollar 14900, keptChange 55.
     * Joseph 6h / Aaron 4h: $149 x 0.6 = 89.4, x 0.4 = 59.6 -> floors 148, $1 left -> Aaron (.6)
     *   -> 8900 / 6000
     */
    const team = [
      member('Joseph', 'bartender', { id: 'joseph', hours: 6 }),
      member('Aaron', 'bartender', { id: 'aaron', hours: 4 }),
      member('David', 'barback', { id: 'david' }),
      member('Allen', 'barback', { id: 'allen' }),
    ];
    const { result } = calculateShift(golden2Input({ team }), BARTENDER_DEFAULT_PROFILE);
    expect(result.kept).toBe(14955);
    expect(keptSplitAmounts(result)).toEqual({ joseph: 8900, aaron: 6000 });
    expect(result.keptChange).toBe(55);
    expect(result.keptSplit!.map((k) => k.hours)).toEqual([6, 4]);
  });

  it("splits the bar's kept tips by hours to the cent with roundMemberShares: false", () => {
    // Golden 2 kept 14955; Joseph 6h / Aaron 4h -> 8973 / 5982, keptChange 0
    const team = [
      member('Joseph', 'bartender', { id: 'joseph', hours: 6 }),
      member('Aaron', 'bartender', { id: 'aaron', hours: 4 }),
      member('David', 'barback', { id: 'david' }),
      member('Allen', 'barback', { id: 'allen' }),
    ];
    const { result } = calculateShift(golden2Input({ team }), BARTENDER_DEFAULT_PROFILE, {
      roundMemberShares: false,
    });
    expect(keptSplitAmounts(result)).toEqual({ joseph: 8973, aaron: 5982 });
    expect(result.keptChange).toBe(0);
  });

  it('keptSplit in whole dollars by hours 7:3 (largest remainder, not first-member bias)', () => {
    // $149 x 0.7 = 104.3, x 0.3 = 44.7 -> floors 148, $1 left -> Aaron (.7) -> 10400 / 4500
    const team = [
      member('Joseph', 'bartender', { id: 'joseph', hours: 7 }),
      member('Aaron', 'bartender', { id: 'aaron', hours: 3 }),
      member('David', 'barback', { id: 'david' }),
      member('Allen', 'barback', { id: 'allen' }),
    ];
    const { result } = calculateShift(golden2Input({ team }), BARTENDER_DEFAULT_PROFILE);
    expect(keptSplitAmounts(result)).toEqual({ joseph: 10400, aaron: 4500 });
    expect(result.keptChange).toBe(55);
  });

  it('keptSplit leftover cent tie goes to the first bartender (roundMemberShares: false)', () => {
    // 14955 x 7/10 = 10468.5, x 3/10 = 4486.5 -> tie -> Joseph 10469, Aaron 4486
    const team = [
      member('Joseph', 'bartender', { id: 'joseph', hours: 7 }),
      member('Aaron', 'bartender', { id: 'aaron', hours: 3 }),
      member('David', 'barback', { id: 'david' }),
      member('Allen', 'barback', { id: 'allen' }),
    ];
    const { result } = calculateShift(golden2Input({ team }), BARTENDER_DEFAULT_PROFILE, {
      roundMemberShares: false,
    });
    expect(keptSplitAmounts(result)).toEqual({ joseph: 10469, aaron: 4486 });
  });

  it('three bartenders share kept equally: whole dollars by default, cents when false', () => {
    // whole dollars: $149 / 3 = 49.67 -> floors 147, $2 left -> Joseph, Aaron -> 5000/5000/4900
    // cents: 14955 / 3 = 4985 exactly
    const team = [
      member('Joseph', 'bartender', { id: 'joseph' }),
      member('Aaron', 'bartender', { id: 'aaron' }),
      member('Maya', 'bartender', { id: 'maya' }),
      member('David', 'barback', { id: 'david' }),
      member('Allen', 'barback', { id: 'allen' }),
    ];
    const dollars = calculateShift(golden2Input({ team }), BARTENDER_DEFAULT_PROFILE).result;
    expect(keptSplitAmounts(dollars)).toEqual({ joseph: 5000, aaron: 5000, maya: 4900 });
    expect(dollars.keptChange).toBe(55);
    const cents = calculateShift(golden2Input({ team }), BARTENDER_DEFAULT_PROFILE, {
      roundMemberShares: false,
    }).result;
    expect(keptSplitAmounts(cents)).toEqual({ joseph: 4985, aaron: 4985, maya: 4985 });
    expect(cents.keptChange).toBe(0);
  });

  it('hours are judged per role: one role with hours, another without, is fine', () => {
    const team = [
      member('Joseph', 'bartender', { id: 'joseph', hours: 5 }),
      member('Aaron', 'bartender', { id: 'aaron', hours: 3 }),
      member('David', 'barback', { id: 'david' }),
      member('Allen', 'barback', { id: 'allen' }),
      member('Hannah', 'host', { id: 'hannah' }),
    ];
    const { result } = calculateShift(golden1Input({ team }), SERVER_DEFAULT_PROFILE);
    // barbacks: no hours -> equal split of $33 in whole dollars -> 17 / 16
    expect(memberAmounts(roleOf(result, 'barback'))).toEqual({ david: 1700, allen: 1600 });
  });

  it('a member with hours: 0 alongside others gets nothing', () => {
    // barbacks 0h / 4h -> 0 / 3300
    const team = [
      ...withoutRole(golden1Team(), 'barback'),
      member('David', 'barback', { id: 'david', hours: 0 }),
      member('Allen', 'barback', { id: 'allen', hours: 4 }),
    ];
    const { result } = calculateShift(golden1Input({ team }), SERVER_DEFAULT_PROFILE);
    expect(memberAmounts(roleOf(result, 'barback'))).toEqual({ david: 0, allen: 3300 });
  });
});

describe('hours: clock-in / clock-out across midnight (F4)', () => {
  it('splits a tip-out role by clock times crossing midnight', () => {
    // David 18:00 -> 00:00 (6h), Allen 21:00 -> 00:00 (3h): 3300 -> 2200 / 1100
    const team = [
      ...withoutRole(golden1Team(), 'barback'),
      member('David', 'barback', {
        id: 'david',
        clockIn: '2026-11-17T18:00:00Z',
        clockOut: '2026-11-18T00:00:00Z',
      }),
      member('Allen', 'barback', {
        id: 'allen',
        clockIn: '2026-11-17T21:00:00Z',
        clockOut: '2026-11-18T00:00:00Z',
      }),
    ];
    const { result } = calculateShift(golden1Input({ team }), SERVER_DEFAULT_PROFILE);
    expect(memberAmounts(roleOf(result, 'barback'))).toEqual({ david: 2200, allen: 1100 });
    expect(roleOf(result, 'barback').members.map((m) => m.hours)).toEqual([6, 3]);
  });

  it('splits keptSplit by overnight clock times (proper next-day dates)', () => {
    // Joseph 20:00 -> 02:00 (6h), Aaron 22:00 -> 02:00 (4h)
    const team = [
      member('Joseph', 'bartender', {
        id: 'joseph',
        clockIn: '2026-11-17T20:00:00Z',
        clockOut: '2026-11-18T02:00:00Z',
      }),
      member('Aaron', 'bartender', {
        id: 'aaron',
        clockIn: '2026-11-17T22:00:00Z',
        clockOut: '2026-11-18T02:00:00Z',
      }),
      member('David', 'barback', { id: 'david' }),
      member('Allen', 'barback', { id: 'allen' }),
    ];
    const { result } = calculateShift(golden2Input({ team }), BARTENDER_DEFAULT_PROFILE);
    // 6h / 4h of $149 -> 8900 / 6000 (see the hours test above); change 55
    expect(keptSplitAmounts(result)).toEqual({ joseph: 8900, aaron: 6000 });
    expect(result.keptChange).toBe(55);
  });

  it('treats a same-date clock-out earlier than clock-in as next day', () => {
    // Joseph 20:00 -> "02:00" same date (=> 6h), Aaron 22:00 -> "02:00" (=> 4h)
    const team = [
      member('Joseph', 'bartender', {
        id: 'joseph',
        clockIn: '2026-11-17T20:00:00Z',
        clockOut: '2026-11-17T02:00:00Z',
      }),
      member('Aaron', 'bartender', {
        id: 'aaron',
        clockIn: '2026-11-17T22:00:00Z',
        clockOut: '2026-11-17T02:00:00Z',
      }),
      member('David', 'barback', { id: 'david' }),
      member('Allen', 'barback', { id: 'allen' }),
    ];
    const { result } = calculateShift(golden2Input({ team }), BARTENDER_DEFAULT_PROFILE);
    // 6h / 4h of $149 -> 8900 / 6000 (see the hours test above); change 55
    expect(keptSplitAmounts(result)).toEqual({ joseph: 8900, aaron: 6000 });
    expect(result.keptChange).toBe(55);
  });

  it('mixes `hours` and clock times within one role', () => {
    const team = [
      member('Joseph', 'bartender', { id: 'joseph', hours: 6 }),
      member('Aaron', 'bartender', {
        id: 'aaron',
        clockIn: '2026-11-17T22:00:00Z',
        clockOut: '2026-11-18T02:00:00Z',
      }),
      member('David', 'barback', { id: 'david' }),
      member('Allen', 'barback', { id: 'allen' }),
    ];
    const { result } = calculateShift(golden2Input({ team }), BARTENDER_DEFAULT_PROFILE);
    // 6h / 4h of $149 -> 8900 / 6000 (see the hours test above); change 55
    expect(keptSplitAmounts(result)).toEqual({ joseph: 8900, aaron: 6000 });
    expect(result.keptChange).toBe(55);
  });
});

describe('hours: partial hours block calculation (§5.1 step 4)', () => {
  it('throws PARTIAL_HOURS when some but not all members of a tip-out role have hours', () => {
    const team = [
      ...withoutRole(golden1Team(), 'barback'),
      member('David', 'barback', { id: 'david', hours: 5 }),
      member('Allen', 'barback', { id: 'allen' }),
    ];
    expectValidationError(
      () => calculateShift(golden1Input({ team }), SERVER_DEFAULT_PROFILE),
      'PARTIAL_HOURS',
    );
  });

  // Review decision D1 (docs/review-log.md): a half-entered clock pair blocks calculation
  // with INVALID_CLOCK (it is a clock-entry error), whether or not others in the role have hours.
  it('throws INVALID_CLOCK when a half-entered clock pair leaves a member without hours', () => {
    const team = [
      ...withoutRole(golden1Team(), 'barback'),
      member('David', 'barback', { id: 'david', hours: 5 }),
      member('Allen', 'barback', { id: 'allen', clockIn: '2026-11-17T18:00:00Z' }),
    ];
    expectValidationError(
      () => calculateShift(golden1Input({ team }), SERVER_DEFAULT_PROFILE),
      'INVALID_CLOCK',
    );
  });

  it('throws INVALID_CLOCK for a half-entered clock pair even when nobody else has hours', () => {
    const team = [
      ...withoutRole(golden1Team(), 'barback'),
      member('David', 'barback', { id: 'david' }),
      member('Allen', 'barback', { id: 'allen', clockIn: '2026-11-17T18:00:00Z' }),
    ];
    expectValidationError(
      () => calculateShift(golden1Input({ team }), SERVER_DEFAULT_PROFILE),
      'INVALID_CLOCK',
    );
  });

  it('throws PARTIAL_HOURS for bartenders sharing kept tips', () => {
    const team = [
      member('Joseph', 'bartender', { id: 'joseph', hours: 6 }),
      member('Aaron', 'bartender', { id: 'aaron' }),
      member('David', 'barback', { id: 'david' }),
      member('Allen', 'barback', { id: 'allen' }),
    ];
    expectValidationError(
      () => calculateShift(golden2Input({ team }), BARTENDER_DEFAULT_PROFILE),
      'PARTIAL_HOURS',
    );
  });
});

describe('missing roles (§5.1 step 3)', () => {
  it("server, no host, 'retain': host share kept by the user", () => {
    // Allocation unchanged from Golden 1 (14/44/33/11); host $11 retained.
    // pool paid = 1400 + 4400 + 3300 = 9100; kept = 34056 - 9100 = 24956
    const { result } = calculateShift(
      golden1Input({ team: withoutRole(golden1Team(), 'host'), missingRoleHandling: 'retain' }),
      SERVER_DEFAULT_PROFILE,
    );
    expect(roleOf(result, 'host')).toMatchObject({ amount: 1100, missing: true, members: [] });
    expect(roleOf(result, 'bartender').amount).toBe(4400);
    expect(roleOf(result, 'barback').amount).toBe(3300);
    expect(result.retained).toBe(1100);
    expect(result.pool).toBe(9100);
    expect(result.kept).toBe(24956);
    expect(result.keptSplit).toBeUndefined();
    expect(result.keptChange).toBe(0);
  });

  it("server, no host, 'redistribute' (rounding on): host share goes to bartenders/barbacks 4:3", () => {
    /*
     * remainder $87.9976 split 4:3 -> 50.2843 / 37.7133; KTO 14.0024
     * floors 14+50+37 = 101, 1 dollar -> barback (.7133) -> 14 / 50 / 38 = 102
     * bartenders 5000 -> 2500 / 2500; barbacks 3800 -> 1900 / 1900
     */
    const { result } = calculateShift(
      golden1Input({
        team: withoutRole(golden1Team(), 'host'),
        missingRoleHandling: 'redistribute',
      }),
      SERVER_DEFAULT_PROFILE,
    );
    expect(roleOf(result, 'host')).toMatchObject({ amount: 0, missing: true, members: [] });
    expect(roleOf(result, 'bartender').amount).toBe(5000);
    expect(roleOf(result, 'barback').amount).toBe(3800);
    expect(memberAmounts(roleOf(result, 'bartender'))).toEqual({ joseph: 2500, aaron: 2500 });
    expect(result.pool).toBe(10200);
    expect(result.retained).toBe(0);
    expect(result.kept).toBe(23856);
  });

  it("server, no host, 'redistribute' (rounding off): remainder split over present weights", () => {
    /*
     * pool 10217; KTO 1400.24; remainder 8816.76 split 4:3 -> 5038.1486 / 3778.6114
     * floors 1400+5038+3778 = 10216, 1 cent -> barback (.6114) -> 1400 / 5038 / 3779
     * ASSUMPTION (findings #8): redistribution is computed on unrounded shares, not by
     * re-splitting an already-rounded host amount.
     */
    const { result } = calculateShift(
      golden1Input({
        team: withoutRole(golden1Team(), 'host'),
        missingRoleHandling: 'redistribute',
        roundToDollar: false,
      }),
      SERVER_DEFAULT_PROFILE,
    );
    expect(roleOf(result, 'kitchen').amount).toBe(1400);
    expect(roleOf(result, 'bartender').amount).toBe(5038);
    expect(roleOf(result, 'barback').amount).toBe(3779);
    expect(result.pool).toBe(10217);
  });

  it("server, no host, 'retain' (rounding off)", () => {
    // From the rounding-off allocation 1400 / 4409 / 3306 / 1102: host 1102 retained.
    // pool = 10217 - 1102 = 9115; kept = 34056 - 9115 = 24941
    const { result } = calculateShift(
      golden1Input({
        team: withoutRole(golden1Team(), 'host'),
        missingRoleHandling: 'retain',
        roundToDollar: false,
      }),
      SERVER_DEFAULT_PROFILE,
    );
    expect(result.retained).toBe(1102);
    expect(result.pool).toBe(9115);
    expect(result.kept).toBe(24941);
  });

  it("server, no barbacks and no hosts, 'redistribute': all of the remainder to bartenders", () => {
    // allocation KTO 14.0024 / bartender 87.9976 -> $14 / $88
    const team = golden1Team().filter((m) => m.role === 'bartender');
    const { result } = calculateShift(golden1Input({ team }), SERVER_DEFAULT_PROFILE);
    expect(roleOf(result, 'bartender').amount).toBe(8800);
    expect(roleOf(result, 'barback')).toMatchObject({ amount: 0, missing: true });
    expect(roleOf(result, 'host')).toMatchObject({ amount: 0, missing: true });
    expect(result.pool).toBe(10200);
  });

  it("server, no barbacks and no hosts, 'retain': both shares retained", () => {
    // 3300 + 1100 = 4400 retained; pool = 1400 + 4400 = 5800; kept = 34056 - 5800 = 28256
    const team = golden1Team().filter((m) => m.role === 'bartender');
    const { result } = calculateShift(
      golden1Input({ team, missingRoleHandling: 'retain' }),
      SERVER_DEFAULT_PROFILE,
    );
    expect(result.retained).toBe(4400);
    expect(result.pool).toBe(5800);
    expect(result.kept).toBe(28256);
  });

  it('kitchen is never missing even though nobody on the team has role kitchen', () => {
    const { result } = calculateShift(golden1Input(), SERVER_DEFAULT_PROFILE);
    const k = roleOf(result, 'kitchen');
    expect(k.missing).toBeFalsy();
    expect(k.amount).toBe(1400);
    expect(k.members).toEqual([]);
  });

  it('present roles are not flagged missing', () => {
    const { result } = calculateShift(golden1Input(), SERVER_DEFAULT_PROFILE);
    for (const r of result.roles) expect(r.missing).toBeFalsy();
  });
});

describe('zero food sales', () => {
  it('rounding on: KTO is $0 and the whole pool is split 4:3:1', () => {
    // pool $102 split 4:3:1 -> 51 / 38.25 / 12.75 -> floors 101, 1 dollar -> host (.75) -> 51 / 38 / 13
    const { result, warnings } = calculateShift(
      golden1Input({ foodSales: 0 }),
      SERVER_DEFAULT_PROFILE,
    );
    expect(roleOf(result, 'kitchen').amount).toBe(0);
    expect(roleOf(result, 'bartender').amount).toBe(5100);
    expect(roleOf(result, 'barback').amount).toBe(3800);
    expect(roleOf(result, 'host').amount).toBe(1300);
    // whole-dollar members: $51 / 2 -> 26 / 25; $38 / 2 -> 19 / 19
    expect(memberAmounts(roleOf(result, 'bartender'))).toEqual({ joseph: 2600, aaron: 2500 });
    expect(memberAmounts(roleOf(result, 'barback'))).toEqual({ david: 1900, allen: 1900 });
    expect(result.pool).toBe(10200);
    expect(warnings).toEqual([]);
  });

  it('rounding off: pool 10217 split 4:3:1 to the cent', () => {
    // 5108.5 / 3831.375 / 1277.125 -> floors 10216, 1 cent -> bartender (.5) -> 5109 / 3831 / 1277
    // bartender members 5109 -> 2555 / 2554; barback 3831 -> 1916 / 1915
    const { result } = calculateShift(
      golden1Input({ foodSales: 0, roundToDollar: false }),
      SERVER_DEFAULT_PROFILE,
    );
    expect(roleOf(result, 'kitchen').amount).toBe(0);
    expect(roleOf(result, 'bartender').amount).toBe(5109);
    expect(roleOf(result, 'barback').amount).toBe(3831);
    expect(roleOf(result, 'host').amount).toBe(1277);
    expect(memberAmounts(roleOf(result, 'bartender'))).toEqual({ joseph: 2555, aaron: 2554 });
    expect(memberAmounts(roleOf(result, 'barback'))).toEqual({ david: 1916, allen: 1915 });
  });
});

describe('zero tips', () => {
  it('server flow: everything is 0 and percentages are 0 (not NaN)', () => {
    const { result, warnings } = calculateShift(
      golden1Input({ totalTips: 0, netSales: 0, foodSales: 0 }),
      SERVER_DEFAULT_PROFILE,
    );
    expect(result.pool).toBe(0);
    expect(result.kept).toBe(0);
    expect(result.retained).toBe(0);
    expect(result.roundingAdjustment).toBe(0);
    expect(result.poolPercentOfTips).toBe(0);
    expect(result.poolPercentOfNetSales).toBe(0);
    for (const r of result.roles) {
      expect(r.amount).toBe(0);
      expect(r.percentOfTips).toBe(0);
      expect(r.percentOfNetSales).toBe(0);
      for (const m of r.members) {
        expect(m.amount).toBe(0);
        expect(m.percentOfTips).toBe(0);
      }
    }
    expect(warnings).toEqual([]);
  });

  it('bartender flow: keptSplit all zeros', () => {
    const { result } = calculateShift(
      golden2Input({ totalTips: 0, netSales: 0, foodSales: 0 }),
      BARTENDER_DEFAULT_PROFILE,
    );
    expect(result.kept).toBe(0);
    expect(keptSplitAmounts(result)).toEqual({ joseph: 0, aaron: 0 });
    expect(result.keptChange).toBe(0);
  });

  it('with food sales, KTO is capped at the $0 pool and a warning is raised', () => {
    const { result, warnings } = calculateShift(
      golden1Input({ totalTips: 0, netSales: 100000, foodSales: 50000, roundToDollar: false }),
      SERVER_DEFAULT_PROFILE,
    );
    expect(roleOf(result, 'kitchen').amount).toBe(0);
    expect(result.pool).toBe(0);
    expect(warnings.map((w) => w.code)).toContain('CARVEOUTS_EXCEED_POOL');
  });

  it('net sales 0 with tips > 0: percentOfNetSales is 0, not Infinity/NaN', () => {
    const { result } = calculateShift(
      golden1Input({ netSales: 0, foodSales: 0 }),
      SERVER_DEFAULT_PROFILE,
    );
    expect(result.poolPercentOfNetSales).toBe(0);
    for (const r of result.roles) expect(r.percentOfNetSales).toBe(0);
  });
});

describe('custom profiles (F3)', () => {
  it('server profile with a percentOfBasis rule on netSales for bartenders', () => {
    /*
     * pool 25% x 40000 = 10000
     * carve-outs: kitchen 2% x 80000 = 1600; bartender 1% x 200000 = 2000
     * remainder 10000 - 3600 = 6400 split barback 1 : host 1 -> 3200 / 3200
     * bartender members 2000 / 2 = 1000 each; barbacks 3200 / 2 = 1600 each
     * kept = 40000 - 10000 = 30000
     */
    const p = profile({
      appliesTo: 'server',
      totalTipOutPercentOfTips: 25,
      rules: [
        { role: 'kitchen', type: 'percentOfBasis', basis: 'foodSales', percent: 2 },
        { role: 'bartender', type: 'percentOfBasis', basis: 'netSales', percent: 1 },
        { role: 'barback', type: 'shareOfRemainder', weight: 1 },
        { role: 'host', type: 'shareOfRemainder', weight: 1 },
      ],
    });
    const { result, warnings } = calculateShift(
      shiftInput({
        totalTips: 40000,
        netSales: 200000,
        foodSales: 80000,
        team: golden1Team(),
        profileId: 'custom',
      }),
      p,
    );
    expect(result.pool).toBe(10000);
    expect(roleOf(result, 'kitchen').amount).toBe(1600);
    expect(roleOf(result, 'bartender').amount).toBe(2000);
    expect(memberAmounts(roleOf(result, 'bartender'))).toEqual({ joseph: 1000, aaron: 1000 });
    expect(roleOf(result, 'barback').amount).toBe(3200);
    expect(memberAmounts(roleOf(result, 'barback'))).toEqual({ david: 1600, allen: 1600 });
    expect(roleOf(result, 'host').amount).toBe(3200);
    expect(result.kept).toBe(30000);
    expect(warnings).toEqual([]);
  });

  it('bartender profile with a percentOfBasis rule on totalTips', () => {
    /*
     * pool 20% x 30000 = 6000
     * kitchen 5% x 30000 (totalTips) = 1500
     * remainder 4500 split barback 2 : host 1 -> 3000 / 1500
     * kept 24000 split equally over 3 bartenders -> 8000 each
     */
    const p = profile({
      appliesTo: 'bartender',
      totalTipOutPercentOfTips: 20,
      rules: [
        { role: 'kitchen', type: 'percentOfBasis', basis: 'totalTips', percent: 5 },
        { role: 'barback', type: 'shareOfRemainder', weight: 2 },
        { role: 'host', type: 'shareOfRemainder', weight: 1 },
      ],
    });
    const team = [
      member('Me', 'bartender', { id: 'me' }),
      member('Joseph', 'bartender', { id: 'joseph' }),
      member('Aaron', 'bartender', { id: 'aaron' }),
      member('David', 'barback', { id: 'david' }),
      member('Hannah', 'host', { id: 'hannah' }),
    ];
    const { result } = calculateShift(
      shiftInput({
        userRole: 'bartender',
        totalTips: 30000,
        netSales: 100000,
        foodSales: 0,
        team,
        profileId: 'custom',
      }),
      p,
    );
    expect(result.pool).toBe(6000);
    expect(roleOf(result, 'kitchen').amount).toBe(1500);
    expect(roleOf(result, 'barback').amount).toBe(3000);
    expect(roleOf(result, 'host').amount).toBe(1500);
    expect(result.kept).toBe(24000);
    expect(keptSplitAmounts(result)).toEqual({ me: 8000, joseph: 8000, aaron: 8000 });
    expect(result.keptChange).toBe(0); // rounding off
  });

  it('supports custom role ids', () => {
    // pool 10% x 10000 = 1000 split busser 1 : host 3 -> 250 / 750
    const p = profile({
      appliesTo: 'server',
      totalTipOutPercentOfTips: 10,
      rules: [
        { role: 'busser', type: 'shareOfRemainder', weight: 1 },
        { role: 'host', type: 'shareOfRemainder', weight: 3 },
      ],
    });
    const team = [
      member('Sam', 'busser', { id: 'sam' }),
      member('Hannah', 'host', { id: 'hannah' }),
    ];
    const { result } = calculateShift(
      shiftInput({
        totalTips: 10000,
        netSales: 50000,
        foodSales: 20000,
        team,
        profileId: 'custom',
      }),
      p,
    );
    expect(roleOf(result, 'busser').amount).toBe(250);
    expect(memberAmounts(roleOf(result, 'busser'))).toEqual({ sam: 250 });
    expect(roleOf(result, 'host').amount).toBe(750);
    expect(result.kept).toBe(9000);
  });

  it('100% pool: everything is tipped out, bar keeps 0', () => {
    const p = profile({
      appliesTo: 'bartender',
      totalTipOutPercentOfTips: 100,
      rules: [{ role: 'barback', type: 'shareOfRemainder', weight: 1 }],
    });
    const team = [
      member('Joseph', 'bartender', { id: 'joseph' }),
      member('Aaron', 'bartender', { id: 'aaron' }),
      member('David', 'barback', { id: 'david' }),
    ];
    const { result } = calculateShift(
      shiftInput({
        userRole: 'bartender',
        totalTips: 12345,
        netSales: 50000,
        team,
        profileId: 'custom',
      }),
      p,
    );
    expect(result.pool).toBe(12345);
    expect(roleOf(result, 'barback').amount).toBe(12345);
    expect(result.kept).toBe(0);
    expect(keptSplitAmounts(result)).toEqual({ joseph: 0, aaron: 0 });
  });

  it('0% pool: nothing is tipped out, bar keeps everything', () => {
    // kept 10001 split equally -> 5001 / 5000
    const p = profile({
      appliesTo: 'bartender',
      totalTipOutPercentOfTips: 0,
      rules: [{ role: 'barback', type: 'shareOfRemainder', weight: 1 }],
    });
    const team = [
      member('Joseph', 'bartender', { id: 'joseph' }),
      member('Aaron', 'bartender', { id: 'aaron' }),
      member('David', 'barback', { id: 'david' }),
    ];
    const { result, warnings } = calculateShift(
      shiftInput({
        userRole: 'bartender',
        totalTips: 10001,
        netSales: 50000,
        team,
        profileId: 'custom',
      }),
      p,
    );
    expect(result.pool).toBe(0);
    expect(roleOf(result, 'barback').amount).toBe(0);
    expect(result.kept).toBe(10001);
    expect(keptSplitAmounts(result)).toEqual({ joseph: 5001, aaron: 5000 });
    expect(warnings).toEqual([]);
  });

  it('uses the profile passed in, not input.profileId', () => {
    const { result } = calculateShift(
      golden1Input({ profileId: 'something-else' }),
      SERVER_DEFAULT_PROFILE,
    );
    expect(result.pool).toBe(10200);
  });
});

describe('carve-outs exceeding the pool (§5.1 step 2)', () => {
  it('caps KTO at the pool, zeroes the share roles and warns (rounding off)', () => {
    // pool 30% x 10000 = 3000; KTO 2% x 200000 = 4000 > 3000 -> capped 3000; remainder 0
    const { result, warnings } = calculateShift(
      golden1Input({ totalTips: 10000, netSales: 300000, foodSales: 200000, roundToDollar: false }),
      SERVER_DEFAULT_PROFILE,
    );
    expect(roleOf(result, 'kitchen').amount).toBe(3000);
    for (const role of ['bartender', 'barback', 'host']) {
      const r = roleOf(result, role);
      expect(r.amount).toBe(0);
      for (const m of r.members) expect(m.amount).toBe(0);
    }
    expect(result.pool).toBe(3000);
    expect(result.kept).toBe(7000);
    expect(warnings.map((w) => w.code)).toEqual(['CARVEOUTS_EXCEED_POOL']);
    expect(typeof at(warnings, 0).message).toBe('string');
    expect(at(warnings, 0).message.length).toBeGreaterThan(0);
  });

  it('caps KTO at the floored pool when rounding is on', () => {
    // pool 30% x 10050 = 3015 -> floor 3000 (adj 15); KTO 4000 capped -> 3000
    const { result, warnings } = calculateShift(
      golden1Input({ totalTips: 10050, netSales: 300000, foodSales: 200000 }),
      SERVER_DEFAULT_PROFILE,
    );
    expect(roleOf(result, 'kitchen').amount).toBe(3000);
    expect(result.pool).toBe(3000);
    expect(result.roundingAdjustment).toBe(15);
    expect(result.kept).toBe(7050);
    expect(warnings.map((w) => w.code)).toContain('CARVEOUTS_EXCEED_POOL');
  });

  it('carve-outs exactly equal to the pool do not warn', () => {
    // pool 30% x 10000 = 3000; KTO 2% x 150000 = 3000
    const { result, warnings } = calculateShift(
      golden1Input({ totalTips: 10000, netSales: 300000, foodSales: 150000, roundToDollar: false }),
      SERVER_DEFAULT_PROFILE,
    );
    expect(roleOf(result, 'kitchen').amount).toBe(3000);
    expect(warnings).toEqual([]);
  });
});

describe('food > net sales (§5.3)', () => {
  it('warns but still calculates', () => {
    // pool 30% x 20000 = 6000; KTO 2% x 50000 = 1000
    const { result, warnings } = calculateShift(
      golden1Input({ totalTips: 20000, netSales: 40000, foodSales: 50000, roundToDollar: false }),
      SERVER_DEFAULT_PROFILE,
    );
    expect(warnings.map((w) => w.code)).toEqual(['FOOD_EXCEEDS_NET']);
    expect(result.pool).toBe(6000);
    expect(roleOf(result, 'kitchen').amount).toBe(1000);
  });

  it('food == net does not warn', () => {
    const { warnings } = calculateShift(
      golden1Input({ totalTips: 20000, netSales: 40000, foodSales: 40000, roundToDollar: false }),
      SERVER_DEFAULT_PROFILE,
    );
    expect(warnings).toEqual([]);
  });
});

describe('validation errors (§5.3)', () => {
  it('thrown EngineValidationError is an Error subclass with a code and message', () => {
    let caught: unknown;
    try {
      calculateShift(golden1Input({ totalTips: -1 }), SERVER_DEFAULT_PROFILE);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught).toBeInstanceOf(EngineValidationError);
    expect((caught as EngineValidationError).code).toBe('NEGATIVE_AMOUNT');
    expect(typeof (caught as Error).message).toBe('string');
  });

  it.each([
    ['totalTips', { totalTips: -1 }],
    ['netSales', { netSales: -1 }],
    ['foodSales', { foodSales: -1 }],
  ])('negative %s -> NEGATIVE_AMOUNT', (_label, overrides) => {
    expectValidationError(
      () => calculateShift(golden1Input(overrides), SERVER_DEFAULT_PROFILE),
      'NEGATIVE_AMOUNT',
    );
  });

  it.each([
    ['pool percent > 100', { totalTipOutPercentOfTips: 101 }],
    ['pool percent < 0', { totalTipOutPercentOfTips: -5 }],
  ])('%s -> INVALID_PERCENT', (_label, overrides) => {
    expectValidationError(
      () => calculateShift(golden1Input(), { ...SERVER_DEFAULT_PROFILE, ...overrides }),
      'INVALID_PERCENT',
    );
  });

  it.each([
    ['rule percent > 100', 150],
    ['rule percent < 0', -2],
  ])('%s -> INVALID_PERCENT', (_label, percent) => {
    const p = profile({
      appliesTo: 'server',
      totalTipOutPercentOfTips: 30,
      rules: [
        { role: 'kitchen', type: 'percentOfBasis', basis: 'foodSales', percent },
        { role: 'bartender', type: 'shareOfRemainder', weight: 1 },
      ],
    });
    expectValidationError(() => calculateShift(golden1Input(), p), 'INVALID_PERCENT');
  });

  it.each([
    ['weight 0', 0],
    ['negative weight', -1],
  ])('%s -> INVALID_WEIGHT', (_label, weight) => {
    const p = profile({
      appliesTo: 'server',
      totalTipOutPercentOfTips: 30,
      rules: [
        { role: 'bartender', type: 'shareOfRemainder', weight: 4 },
        { role: 'barback', type: 'shareOfRemainder', weight },
      ],
    });
    expectValidationError(() => calculateShift(golden1Input(), p), 'INVALID_WEIGHT');
  });

  it('unparseable clock time -> INVALID_CLOCK', () => {
    // ASSUMPTION (findings #6): INVALID_CLOCK is for clock strings that do not parse.
    const team = [
      ...withoutRole(golden1Team(), 'barback'),
      member('David', 'barback', {
        id: 'david',
        clockIn: 'not a time',
        clockOut: '2026-11-18T02:00:00Z',
      }),
      member('Allen', 'barback', {
        id: 'allen',
        clockIn: '2026-11-17T20:00:00Z',
        clockOut: '2026-11-18T02:00:00Z',
      }),
    ];
    expectValidationError(
      () => calculateShift(golden1Input({ team }), SERVER_DEFAULT_PROFILE),
      'INVALID_CLOCK',
    );
  });
});

describe('keptChange: whole-dollar keptSplit in the bartender flow (owner Q2, §5.4 step 5)', () => {
  it('splits floorToDollar(kept) and reports the cents as keptChange', () => {
    /*
     * tips $3.55, food 0, Bartender default, rounding on, retain (no host)
     * pool exact 30% x 355 = 106.5 -> 107c -> floor 100 (roundingAdjustment 7)
     * $1 allocated over KTO 0 / barback 79.875c / host 26.625c (scaled: .75 / .25)
     *   -> barback $1, host $0 (missing, retained 0)
     * pool paid 100, retained 0, kept 355 - 100 = 255
     * keptSplit: floorToDollar(255) = 200 -> $1 / $1; keptChange 55
     * barback members: $1 / 2 in whole dollars -> David 100, Allen 0
     */
    const { result } = calculateShift(
      golden2Input({ totalTips: 355, netSales: 1000, foodSales: 0 }),
      BARTENDER_DEFAULT_PROFILE,
    );
    expect(result.pool).toBe(100);
    expect(result.roundingAdjustment).toBe(7);
    expect(result.kept).toBe(255);
    expect(keptSplitAmounts(result)).toEqual({ joseph: 100, aaron: 100 });
    expect(result.keptChange).toBe(55);
    expect(memberAmounts(roleOf(result, 'barback'))).toEqual({ david: 100, allen: 0 });
  });

  it('kept under $1: keptSplit is all zeros and everything is change', () => {
    // tips 50c -> pool 15c -> floor 0; kept 50; floorToDollar(50) = 0; keptChange 50
    const { result } = calculateShift(
      golden2Input({ totalTips: 50, netSales: 1000, foodSales: 0 }),
      BARTENDER_DEFAULT_PROFILE,
    );
    expect(result.pool).toBe(0);
    expect(result.kept).toBe(50);
    expect(keptSplitAmounts(result)).toEqual({ joseph: 0, aaron: 0 });
    expect(result.keptChange).toBe(50);
  });

  it('kept already a whole dollar: keptChange 0', () => {
    // 0% pool: kept = tips = 10000 -> 5000 / 5000, change 0
    const p = profile({
      appliesTo: 'bartender',
      totalTipOutPercentOfTips: 0,
      rules: [{ role: 'barback', type: 'shareOfRemainder', weight: 1 }],
    });
    const { result } = calculateShift(golden2Input({ totalTips: 10000, profileId: 'custom' }), p);
    expect(result.kept).toBe(10000);
    expect(keptSplitAmounts(result)).toEqual({ joseph: 5000, aaron: 5000 });
    expect(result.keptChange).toBe(0);
  });

  it('kept is never reduced by keptChange (kept + pool == totalTips)', () => {
    const { result } = calculateShift(golden2Input(), BARTENDER_DEFAULT_PROFILE);
    expect(result.kept + result.pool).toBe(19255);
    expect(sum(result.keptSplit!.map((k) => k.amount)) + result.keptChange).toBe(result.kept);
  });
});

describe('pool basis (owner Q4, §5.1 step 1)', () => {
  // Server profile: pool = 5% of the chosen basis; KTO 2% of food; bartender 1 : host 1.
  const salesProfile = (
    poolBasis: 'totalTips' | 'netSales' | 'foodSales' | undefined,
    pct: number,
  ): TipOutProfile =>
    profile({
      appliesTo: 'server',
      totalTipOutPercentOfTips: pct,
      ...(poolBasis ? { poolBasis } : {}),
      rules: [
        { role: 'kitchen', type: 'percentOfBasis', basis: 'foodSales', percent: 2 },
        { role: 'bartender', type: 'shareOfRemainder', weight: 1 },
        { role: 'host', type: 'shareOfRemainder', weight: 1 },
      ],
    });
  const team = () => [
    member('Joseph', 'bartender', { id: 'joseph' }),
    member('Aaron', 'bartender', { id: 'aaron' }),
    member('Hannah', 'host', { id: 'hannah' }),
  ];
  const input = (overrides: Partial<Parameters<typeof shiftInput>[0]> = {}) =>
    shiftInput({
      totalTips: 20000,
      netSales: 150000,
      foodSales: 50000,
      team: team(),
      profileId: 'custom',
      missingRoleHandling: 'retain',
      ...overrides,
    });

  it('both default profiles use total tips as the pool basis', () => {
    expect(SERVER_DEFAULT_PROFILE.poolBasis ?? 'totalTips').toBe('totalTips');
    expect(BARTENDER_DEFAULT_PROFILE.poolBasis ?? 'totalTips').toBe('totalTips');
  });

  it("poolBasis 'totalTips' (explicit) gives exactly the same output as omitting it", () => {
    const implicit = calculateShift(golden1Input(), SERVER_DEFAULT_PROFILE);
    const explicit = calculateShift(golden1Input(), {
      ...SERVER_DEFAULT_PROFILE,
      poolBasis: 'totalTips',
    });
    expect(explicit).toEqual(implicit);
    expect(explicit.result.pool).toBe(10200);
  });

  it('netSales basis, rounding off', () => {
    /*
     * pool = 5% x 150000 = 7500 (<= tips 20000, no cap)
     * KTO 2% x 50000 = 1000; remainder 6500 split 1:1 -> 3250 / 3250
     * bartender members 3250 / 2 -> 1625 / 1625
     * kept = 20000 - 7500 = 12500; pool is 37.5% of tips and 5% of net sales
     */
    const { result, warnings } = calculateShift(input(), salesProfile('netSales', 5));
    expect(result.pool).toBe(7500);
    expect(result.roundingAdjustment).toBe(0);
    expect(roleOf(result, 'kitchen').amount).toBe(1000);
    expect(roleOf(result, 'bartender').amount).toBe(3250);
    expect(memberAmounts(roleOf(result, 'bartender'))).toEqual({ joseph: 1625, aaron: 1625 });
    expect(roleOf(result, 'host').amount).toBe(3250);
    expect(result.kept).toBe(12500);
    expect(result.poolPercentOfTips).toBeCloseTo(37.5, 10);
    expect(result.poolPercentOfNetSales).toBeCloseTo(5, 10);
    expect(warnings).toEqual([]);
  });

  it('netSales basis, rounding on', () => {
    /*
     * pool exact = 5% x 150025 = 7501.25 -> 7501c -> floor 7500, roundingAdjustment 1
     * KTO exact 1000 ($10.00); remainder 7501.25 - 1000 = 6501.25 -> 3250.625 each
     * whole dollars: weights [10, 32.50625, 32.50625] scaled to $75 -> 9.998 / 32.501 / 32.501
     *   floors 73, $2 left -> KTO (.998), then the tie -> bartender (earlier rule)
     *   -> $10 / $33 / $32
     * bartender members $33 / 2 -> 1700 / 1600; kept = 20000 - 7500 = 12500
     */
    const { result } = calculateShift(
      input({ netSales: 150025, roundToDollar: true }),
      salesProfile('netSales', 5),
    );
    expect(result.pool).toBe(7500);
    expect(result.roundingAdjustment).toBe(1);
    expect(roleOf(result, 'kitchen').amount).toBe(1000);
    expect(roleOf(result, 'bartender').amount).toBe(3300);
    expect(roleOf(result, 'host').amount).toBe(3200);
    expect(memberAmounts(roleOf(result, 'bartender'))).toEqual({ joseph: 1700, aaron: 1600 });
    expect(result.kept).toBe(12500);
    expect(result.keptChange).toBe(0); // server flow
  });

  it('a sales-based pool above total tips is capped at total tips and warns POOL_EXCEEDS_TIPS', () => {
    /*
     * pool = 30% x 150000 = 45000 > tips 20000 -> capped 20000
     * KTO 1000; remainder 19000 -> 9500 / 9500; bartender members 4750 / 4750; kept 0
     */
    const { result, warnings } = calculateShift(input(), salesProfile('netSales', 30));
    expect(result.pool).toBe(20000);
    expect(roleOf(result, 'kitchen').amount).toBe(1000);
    expect(roleOf(result, 'bartender').amount).toBe(9500);
    expect(memberAmounts(roleOf(result, 'bartender'))).toEqual({ joseph: 4750, aaron: 4750 });
    expect(roleOf(result, 'host').amount).toBe(9500);
    expect(result.kept).toBe(0);
    expect(warnings.map((w) => w.code)).toEqual(['POOL_EXCEEDS_TIPS']);
    expect(at(warnings, 0).message.length).toBeGreaterThan(0);
  });

  it('capped pool with rounding on: floor of the capped pool, change stays with the user', () => {
    /*
     * pool = 30% x 150000 = 45000 > tips 20050 -> capped 20050 -> floor 20000, adjustment 50
     * KTO exact 1000; remainder exact 20050 - 1000 = 19050 -> 9525 each
     * whole dollars: weights [10, 95.25, 95.25] scaled to $200 -> 9.975 / 95.012 / 95.012
     *   floors 199, $1 left -> KTO (.975) -> $10 / $95 / $95
     * kept = 20050 - 20000 = 50
     */
    const { result, warnings } = calculateShift(
      input({ totalTips: 20050, roundToDollar: true }),
      salesProfile('netSales', 30),
    );
    expect(result.pool).toBe(20000);
    expect(result.roundingAdjustment).toBe(50);
    expect(roleOf(result, 'bartender').amount).toBe(9500);
    expect(roleOf(result, 'host').amount).toBe(9500);
    expect(result.kept).toBe(50);
    expect(warnings.map((w) => w.code)).toContain('POOL_EXCEEDS_TIPS');
  });

  it('a sales-based pool exactly equal to total tips does not warn', () => {
    // 20% x 100000 = 20000 = tips
    const { result, warnings } = calculateShift(
      input({ netSales: 100000 }),
      salesProfile('netSales', 20),
    );
    expect(result.pool).toBe(20000);
    expect(warnings).toEqual([]);
  });

  it('a sales-based pool with zero tips is capped at $0 and warns', () => {
    // 5% x 150000 = 7500 > tips 0 -> pool 0 (KTO 1000 also exceeds the $0 pool)
    const { result, warnings } = calculateShift(
      input({ totalTips: 0 }),
      salesProfile('netSales', 5),
    );
    expect(result.pool).toBe(0);
    expect(result.kept).toBe(0);
    for (const r of result.roles) expect(r.amount).toBe(0);
    expect(warnings.map((w) => w.code)).toContain('POOL_EXCEEDS_TIPS');
  });

  it('foodSales basis', () => {
    /*
     * pool = 10% x food 80000 = 8000 (<= tips 30000)
     * KTO 2% x 80000 = 1600; remainder 6400 -> bartender 3200 / host 3200
     * bartender members 1600 / 1600; kept = 30000 - 8000 = 22000
     */
    const { result, warnings } = calculateShift(
      input({ totalTips: 30000, netSales: 200000, foodSales: 80000 }),
      salesProfile('foodSales', 10),
    );
    expect(result.pool).toBe(8000);
    expect(roleOf(result, 'kitchen').amount).toBe(1600);
    expect(roleOf(result, 'bartender').amount).toBe(3200);
    expect(memberAmounts(roleOf(result, 'bartender'))).toEqual({ joseph: 1600, aaron: 1600 });
    expect(roleOf(result, 'host').amount).toBe(3200);
    expect(result.kept).toBe(22000);
    expect(result.poolPercentOfTips).toBeCloseTo((8000 / 30000) * 100, 10);
    expect(warnings).toEqual([]);
  });

  it('bartender flow with a netSales pool: keptSplit and keptChange follow the same rules', () => {
    /*
     * Bartender profile, pool 3% of net 90543 = 2716.29 -> 2716c -> floor 2700 (adj 16)
     * KTO 2% x 12000 = 240 ($2.40); remainder 2716.29 - 240 = 2476.29 -> barback 3/4 = 1857.2175,
     *   host 619.0725 (missing, retained)
     * whole dollars: weights [2.40, 18.572175, 6.190725] scaled to $27 -> 2.386 / 18.460 / 6.154
     *   floors 26, $1 left -> barback (.460) -> $2 / $19 / $6
     * pool paid = 200 + 1900 = 2100; retained 600; kept = 19255 - 2100 = 17155
     * keptSplit floorToDollar(17155) = 17100 -> $171 / 2 = 85.5 -> tie -> Joseph 8600 / Aaron 8500
     * keptChange 55
     */
    const p: TipOutProfile = {
      ...BARTENDER_DEFAULT_PROFILE,
      id: 'bar-net',
      totalTipOutPercentOfTips: 3,
      poolBasis: 'netSales',
    };
    const { result, warnings } = calculateShift(golden2Input({ profileId: 'bar-net' }), p);
    expect(result.roundingAdjustment).toBe(16);
    expect(roleOf(result, 'kitchen').amount).toBe(200);
    expect(roleOf(result, 'barback').amount).toBe(1900);
    expect(roleOf(result, 'host')).toMatchObject({ amount: 600, missing: true });
    expect(result.pool).toBe(2100);
    expect(result.retained).toBe(600);
    expect(result.kept).toBe(17155);
    expect(keptSplitAmounts(result)).toEqual({ joseph: 8600, aaron: 8500 });
    expect(result.keptChange).toBe(55);
    expect(warnings).toEqual([]);
  });
});

describe('equal clock-in and clock-out (owner Q5 / review D2)', () => {
  it('blocks calculateShift with INVALID_CLOCK for a tip-out role member', () => {
    const team = [
      ...withoutRole(golden1Team(), 'host'),
      member('Hannah', 'host', {
        id: 'hannah',
        clockIn: '2026-11-17T20:00:00Z',
        clockOut: '2026-11-17T20:00:00Z',
      }),
    ];
    expectValidationError(
      () => calculateShift(golden1Input({ team }), SERVER_DEFAULT_PROFILE),
      'INVALID_CLOCK',
    );
  });

  it('blocks calculateShift with INVALID_CLOCK for a bartender sharing kept tips', () => {
    const team = [
      member('Joseph', 'bartender', {
        id: 'joseph',
        clockIn: '2026-11-17T18:00:00Z',
        clockOut: '2026-11-17T18:00:00Z',
      }),
      member('Aaron', 'bartender', {
        id: 'aaron',
        clockIn: '2026-11-17T18:00:00Z',
        clockOut: '2026-11-18T02:00:00Z',
      }),
      member('David', 'barback', { id: 'david' }),
      member('Allen', 'barback', { id: 'allen' }),
    ];
    expectValidationError(
      () => calculateShift(golden2Input({ team }), BARTENDER_DEFAULT_PROFILE),
      'INVALID_CLOCK',
    );
  });

  it('blocks even when rounding is off and the role would otherwise split equally', () => {
    const team = [
      ...withoutRole(golden1Team(), 'host'),
      member('Hannah', 'host', { id: 'hannah', clockIn: '20:00', clockOut: '20:00' }),
    ];
    expectValidationError(
      () => calculateShift(golden1Input({ team, roundToDollar: false }), SERVER_DEFAULT_PROFILE),
      'INVALID_CLOCK',
    );
  });

  it('a one-minute shift is still valid (only exactly equal times are rejected)', () => {
    /*
     * Joseph 18:00 -> 18:01 = 1/60 h; Aaron 18:00 -> 02:00 = 8 h
     * $149 x (1/60) / (8 + 1/60) = 0.31 -> 0; Aaron 148.69 -> 148; $1 left -> Aaron (.69)
     *   -> 0 / 14900, keptChange 55
     */
    const team = [
      member('Joseph', 'bartender', {
        id: 'joseph',
        clockIn: '2026-11-17T18:00:00Z',
        clockOut: '2026-11-17T18:01:00Z',
      }),
      member('Aaron', 'bartender', {
        id: 'aaron',
        clockIn: '2026-11-17T18:00:00Z',
        clockOut: '2026-11-18T02:00:00Z',
      }),
      member('David', 'barback', { id: 'david' }),
      member('Allen', 'barback', { id: 'allen' }),
    ];
    const { result } = calculateShift(golden2Input({ team }), BARTENDER_DEFAULT_PROFILE);
    expect(keptSplitAmounts(result)).toEqual({ joseph: 0, aaron: 14900 });
    expect(result.keptChange).toBe(55);
  });
});

describe('purity and determinism', () => {
  it('does not mutate its inputs (deep-frozen input and profile)', () => {
    const input = deepFreeze(golden1Input());
    const p = deepFreeze(structuredCloneSafe(SERVER_DEFAULT_PROFILE));
    expect(() => calculateShift(input, p)).not.toThrow();
    expect(calculateShift(input, p).result.pool).toBe(10200);
  });

  it('returns identical results for identical inputs', () => {
    const a = calculateShift(golden2Input(), BARTENDER_DEFAULT_PROFILE);
    const b = calculateShift(golden2Input(), BARTENDER_DEFAULT_PROFILE);
    expect(b).toEqual(a);
  });

  it('member results follow team order', () => {
    const team = [
      member('Aaron', 'bartender', { id: 'aaron' }),
      member('Joseph', 'bartender', { id: 'joseph' }),
      ...withoutRole(golden1Team(), 'bartender'),
    ];
    const { result } = calculateShift(
      golden1Input({ team, roundToDollar: false }),
      SERVER_DEFAULT_PROFILE,
    );
    // 4409 -> first listed member (Aaron) gets the extra cent
    expect(roleOf(result, 'bartender').members.map((m) => [m.memberId, m.amount])).toEqual([
      ['aaron', 2205],
      ['joseph', 2204],
    ]);
    expect(sum(roleOf(result, 'bartender').members.map((m) => m.amount))).toBe(4409);
    expect(paidRolesTotal(result)).toBe(result.pool);
  });
});

function structuredCloneSafe<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}
