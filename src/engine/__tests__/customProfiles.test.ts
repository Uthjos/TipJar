/**
 * Milestone 5 acceptance: calculateShift end-to-end with profiles as the editor builds them
 * (docs/m5-contract.md): custom labelled roles, reordered rules, a sales-based pool, no share
 * rule, and the "Whole-dollar shares for each person" setting (key `wholeDollarShares`, passed to
 * the engine as `roundMemberShares`). Hand math in comments; amounts are integer cents.
 */
import { calculateShift } from '../calculate';
import { SERVER_DEFAULT_PROFILE, BARTENDER_DEFAULT_PROFILE } from '../profiles';
import type { Basis, ShiftInput, TipOutProfile, TipOutRule } from '../types';
import { roleIdFromLabel } from '../../lib/profiles';
import {
  golden1Input,
  golden1Team,
  golden2Input,
  keptSplitAmounts,
  member,
  memberAmounts,
  paidRolesTotal,
  roleOf,
  shiftInput,
} from '../../test-support/builders';

/** Mirrors the store: the setting is passed through as the engine option. */
function calcWithSettings(
  input: ShiftInput,
  profile: TipOutProfile,
  settings: { wholeDollarShares: boolean },
) {
  return calculateShift(input, profile, { roundMemberShares: settings.wholeDollarShares });
}

type RuleBody =
  | { type: 'percentOfBasis'; basis: Basis; percent: number }
  | { type: 'shareOfRemainder'; weight: number };

/** A custom rule as the editor creates it: role id derived from the typed label. */
function custom(label: string, rest: RuleBody): TipOutRule {
  return { role: roleIdFromLabel(label), label, ...rest };
}

/** $400 tips, $2,000 net, $800 food; Golden 1 team plus Sam the busser. */
function busserInput(overrides: Partial<ShiftInput> = {}): ShiftInput {
  return shiftInput({
    totalTips: 40000,
    netSales: 200000,
    foodSales: 80000,
    team: [...golden1Team(), member('Sam', 'busser', { id: 'sam' })],
    profileId: 'patio',
    ...overrides,
  });
}

describe('custom "Busser" role', () => {
  it('as a fixed % of net sales (carved out before the shares), rounding off', () => {
    /*
     * pool 30% x 40000 = 12000
     * carve-outs: kitchen 2% x 80000 = 1600; Busser 1% x 200000 = 2000
     * remainder 12000 - 3600 = 8400 split 4:3:1 -> 4200 / 3150 / 1050
     * members: bartenders 2100 / 2100; barbacks 1575 / 1575; host 1050; Sam 2000
     * kept = 40000 - 12000 = 28000
     */
    const profile: TipOutProfile = {
      id: 'patio',
      name: 'Patio',
      appliesTo: 'server',
      totalTipOutPercentOfTips: 30,
      rules: [
        { role: 'kitchen', type: 'percentOfBasis', basis: 'foodSales', percent: 2 },
        custom('Busser', { type: 'percentOfBasis', basis: 'netSales', percent: 1 }),
        { role: 'bartender', type: 'shareOfRemainder', weight: 4 },
        { role: 'barback', type: 'shareOfRemainder', weight: 3 },
        { role: 'host', type: 'shareOfRemainder', weight: 1 },
      ],
    };
    const { result, warnings } = calculateShift(busserInput(), profile);
    expect(roleOf(result, 'busser').amount).toBe(2000);
    expect(memberAmounts(roleOf(result, 'busser'))).toEqual({ sam: 2000 });
    expect(roleOf(result, 'kitchen').amount).toBe(1600);
    expect(roleOf(result, 'bartender').amount).toBe(4200);
    expect(roleOf(result, 'barback').amount).toBe(3150);
    expect(memberAmounts(roleOf(result, 'barback'))).toEqual({ david: 1575, allen: 1575 });
    expect(roleOf(result, 'host').amount).toBe(1050);
    expect(result.pool).toBe(12000);
    expect(result.kept).toBe(28000);
    expect(warnings).toEqual([]);
  });

  it('as a fixed % of net sales, rounding on (whole dollars)', () => {
    /*
     * pool 12000 (already whole dollars, no trim)
     * dollar weights: kitchen 16, Busser 20, bartenders 42, barbacks 31.5, hosts 10.5 = 120
     * floors 16+20+42+31+10 = 119, $1 left; remainders .5 (barbacks) and .5 (hosts) tie ->
     *   earlier rule (barbacks) -> 16 / 20 / 42 / 32 / 10
     * members: bartenders $42 / 2 = 21 / 21; barbacks $32 / 2 = 16 / 16; host 10; Sam 20
     *   nothing held back -> pool 12000, roundingAdjustment 0
     */
    const profile: TipOutProfile = {
      id: 'patio',
      name: 'Patio',
      appliesTo: 'server',
      totalTipOutPercentOfTips: 30,
      rules: [
        { role: 'kitchen', type: 'percentOfBasis', basis: 'foodSales', percent: 2 },
        custom('Busser', { type: 'percentOfBasis', basis: 'netSales', percent: 1 }),
        { role: 'bartender', type: 'shareOfRemainder', weight: 4 },
        { role: 'barback', type: 'shareOfRemainder', weight: 3 },
        { role: 'host', type: 'shareOfRemainder', weight: 1 },
      ],
    };
    const { result } = calculateShift(busserInput({ roundToDollar: true }), profile);
    expect(result.roles.map((r) => [r.role, r.amount])).toEqual([
      ['kitchen', 1600],
      ['busser', 2000],
      ['bartender', 4200],
      ['barback', 3200],
      ['host', 1000],
    ]);
    expect(memberAmounts(roleOf(result, 'barback'))).toEqual({ david: 1600, allen: 1600 });
    expect(result.pool).toBe(12000);
    expect(result.roundingAdjustment).toBe(0);
  });

  it('as a weighted share of the remainder', () => {
    /*
     * pool 12000; kitchen 1600; remainder 10400 split bartender 4 : barback 3 : Busser 2 : host 1
     *   (sum 10) -> 4160 / 3120 / 2080 / 1040
     * members: bartenders 2080 / 2080; barbacks 1560 / 1560; Sam 2080; host 1040
     */
    const profile: TipOutProfile = {
      id: 'patio',
      name: 'Patio',
      appliesTo: 'server',
      totalTipOutPercentOfTips: 30,
      rules: [
        { role: 'kitchen', type: 'percentOfBasis', basis: 'foodSales', percent: 2 },
        { role: 'bartender', type: 'shareOfRemainder', weight: 4 },
        { role: 'barback', type: 'shareOfRemainder', weight: 3 },
        custom('Busser', { type: 'shareOfRemainder', weight: 2 }),
        { role: 'host', type: 'shareOfRemainder', weight: 1 },
      ],
    };
    const { result } = calculateShift(busserInput(), profile);
    expect(roleOf(result, 'busser').amount).toBe(2080);
    expect(memberAmounts(roleOf(result, 'busser'))).toEqual({ sam: 2080 });
    expect(roleOf(result, 'bartender').amount).toBe(4160);
    expect(roleOf(result, 'barback').amount).toBe(3120);
    expect(roleOf(result, 'host').amount).toBe(1040);
    expect(paidRolesTotal(result)).toBe(12000);
  });

  it('an unstaffed custom fixed role is missing like any other (retain vs redistribute)', () => {
    /*
     * As the fixed-% case but nobody is a busser.
     * retain: Busser's 2000 is retained -> pool 10000, retained 2000, kept 30000
     * redistribute: the busser carve-out carves nothing; remainder 12000 - 1600 = 10400
     *   split 4:3:1 -> 5200 / 3900 / 1300 -> pool 12000
     */
    const profile: TipOutProfile = {
      id: 'patio',
      name: 'Patio',
      appliesTo: 'server',
      totalTipOutPercentOfTips: 30,
      rules: [
        { role: 'kitchen', type: 'percentOfBasis', basis: 'foodSales', percent: 2 },
        custom('Busser', { type: 'percentOfBasis', basis: 'netSales', percent: 1 }),
        { role: 'bartender', type: 'shareOfRemainder', weight: 4 },
        { role: 'barback', type: 'shareOfRemainder', weight: 3 },
        { role: 'host', type: 'shareOfRemainder', weight: 1 },
      ],
    };
    const retain = calculateShift(
      busserInput({ team: golden1Team(), missingRoleHandling: 'retain' }),
      profile,
    ).result;
    expect(roleOf(retain, 'busser')).toMatchObject({ amount: 2000, missing: true, members: [] });
    expect(retain.retained).toBe(2000);
    expect(retain.pool).toBe(10000);
    expect(retain.kept).toBe(30000);

    const redistribute = calculateShift(
      busserInput({ team: golden1Team(), missingRoleHandling: 'redistribute' }),
      profile,
    ).result;
    expect(roleOf(redistribute, 'busser')).toMatchObject({ amount: 0, missing: true });
    expect(roleOf(redistribute, 'bartender').amount).toBe(5200);
    expect(roleOf(redistribute, 'barback').amount).toBe(3900);
    expect(roleOf(redistribute, 'host').amount).toBe(1300);
    expect(redistribute.pool).toBe(12000);
  });

  it('labels are display-only: the engine output is identical with or without them', () => {
    const labelled: TipOutProfile = {
      id: 'patio',
      name: 'Patio',
      appliesTo: 'server',
      totalTipOutPercentOfTips: 30,
      rules: [
        { role: 'kitchen', type: 'percentOfBasis', basis: 'foodSales', percent: 2 },
        custom('Busser', { type: 'shareOfRemainder', weight: 2 }),
        { role: 'bartender', type: 'shareOfRemainder', weight: 4 },
      ],
    };
    const bare: TipOutProfile = {
      ...labelled,
      rules: labelled.rules.map(({ label: _label, ...r }) => r as TipOutRule),
    };
    for (const roundToDollar of [false, true]) {
      expect(calculateShift(busserInput({ roundToDollar }), labelled)).toEqual(
        calculateShift(busserInput({ roundToDollar }), bare),
      );
    }
  });
});

describe('reordered rules', () => {
  it('Server default with rules reversed: same amounts per role; roles follow rule order', () => {
    /*
     * Golden 1 allocation has no remainder ties (fractions .0024/.9988/.9991/.9997), so the
     * whole-dollar allocation does not depend on rule order: 14 / 44 / 33 / 11, barbacks
     * $33 -> 16 / 16 with $1 held -> pool 10100 either way.
     */
    const reversed: TipOutProfile = {
      ...SERVER_DEFAULT_PROFILE,
      id: 'reversed',
      name: 'Reversed',
      rules: [...SERVER_DEFAULT_PROFILE.rules].reverse(),
    };
    const a = calculateShift(golden1Input(), SERVER_DEFAULT_PROFILE).result;
    const b = calculateShift(golden1Input(), reversed).result;
    expect(b.roles.map((r) => r.role)).toEqual(['host', 'barback', 'bartender', 'kitchen']);
    for (const role of ['kitchen', 'bartender', 'barback', 'host']) {
      expect(roleOf(b, role)).toEqual(roleOf(a, role));
    }
    expect(b.pool).toBe(10100);
    expect(b.kept).toBe(a.kept);
    expect(b.roundingAdjustment).toBe(a.roundingAdjustment);
  });

  it('rule order breaks whole-dollar ties between roles', () => {
    /*
     * Pool $10, no carve-outs, two share roles weight 1 : 1 with one member each:
     *   5 / 5 exactly -> no tie. Use $11 at 1 : 1 instead -> 5.5 / 5.5: floors 10, $1 left, the
     *   remainders tie -> the earlier rule gets it (role-level allocation is largest remainder,
     *   ties to the lower index).
     * tips 3667 -> 30% = 1100.1 -> 1100c -> floor $11
     */
    const hostFirst: TipOutProfile = {
      id: 'hf',
      name: 'Host first',
      appliesTo: 'server',
      totalTipOutPercentOfTips: 30,
      rules: [
        { role: 'host', type: 'shareOfRemainder', weight: 1 },
        { role: 'barback', type: 'shareOfRemainder', weight: 1 },
      ],
    };
    const barbackFirst: TipOutProfile = {
      ...hostFirst,
      id: 'bf',
      rules: [...hostFirst.rules].reverse(),
    };
    const input = shiftInput({
      totalTips: 3667,
      roundToDollar: true,
      team: [
        member('Hannah', 'host', { id: 'hannah' }),
        member('David', 'barback', { id: 'david' }),
      ],
    });
    const h = calculateShift(input, hostFirst).result;
    const b = calculateShift(input, barbackFirst).result;
    expect([roleOf(h, 'host').amount, roleOf(h, 'barback').amount]).toEqual([600, 500]);
    expect([roleOf(b, 'host').amount, roleOf(b, 'barback').amount]).toEqual([500, 600]);
  });
});

describe('net-sales pool basis from the editor', () => {
  it('server: 5% of net sales, Busser label, rounding off', () => {
    /*
     * pool = 5% x 150000 = 7500 (<= tips 20000)
     * kitchen 2% x 50000 = 1000; remainder 6500 split bartender 1 : Busser 1 -> 3250 / 3250
     * bartenders 1625 / 1625; Sam 3250; kept 20000 - 7500 = 12500
     */
    const profile: TipOutProfile = {
      id: 'net',
      name: 'Net pool',
      appliesTo: 'server',
      totalTipOutPercentOfTips: 5,
      poolBasis: 'netSales',
      rules: [
        { role: 'kitchen', type: 'percentOfBasis', basis: 'foodSales', percent: 2 },
        { role: 'bartender', type: 'shareOfRemainder', weight: 1 },
        custom('Busser', { type: 'shareOfRemainder', weight: 1 }),
      ],
    };
    const { result, warnings } = calculateShift(
      shiftInput({
        totalTips: 20000,
        netSales: 150000,
        foodSales: 50000,
        team: [
          member('Joseph', 'bartender', { id: 'joseph' }),
          member('Aaron', 'bartender', { id: 'aaron' }),
          member('Sam', 'busser', { id: 'sam' }),
        ],
      }),
      profile,
    );
    expect(result.pool).toBe(7500);
    expect(memberAmounts(roleOf(result, 'bartender'))).toEqual({ joseph: 1625, aaron: 1625 });
    expect(memberAmounts(roleOf(result, 'busser'))).toEqual({ sam: 3250 });
    expect(result.kept).toBe(12500);
    expect(warnings).toEqual([]);
  });
});

describe('no share rule (NO_SHARE_RULE warning in the editor)', () => {
  const kitchenOnly: TipOutProfile = {
    id: 'ko',
    name: 'Kitchen only',
    appliesTo: 'server',
    totalTipOutPercentOfTips: 30,
    rules: [{ role: 'kitchen', type: 'percentOfBasis', basis: 'foodSales', percent: 2 }],
  };

  it.each([false, true])(
    'only the carve-out is paid; the remainder stays with the user (rounding %p)',
    (roundToDollar) => {
      /*
       * pool 30% x 40000 = 12000; kitchen 2% x 80000 = 1600; remainder 10400 has no recipient
       * pool paid 1600; kept 40000 - 1600 = 38400 (findings #60: the unpaid remainder is not
       * reported in retained or roundingAdjustment)
       */
      const { result } = calculateShift(
        shiftInput({
          totalTips: 40000,
          netSales: 200000,
          foodSales: 80000,
          roundToDollar,
          team: golden1Team(),
        }),
        kitchenOnly,
      );
      expect(result.roles.map((r) => [r.role, r.amount])).toEqual([['kitchen', 1600]]);
      expect(result.pool).toBe(1600);
      expect(result.kept).toBe(38400);
      expect(result.kept + result.pool).toBe(40000);
    },
  );

  it('bartender flow: the unpaid remainder is shared by the bartenders', () => {
    /*
     * Bartender kitchen-only profile; tips 40000 -> pool 12000; kitchen 1600 paid
     * kept 38400 -> rounding off -> 19200 / 19200
     */
    const { result } = calculateShift(
      shiftInput({
        userRole: 'bartender',
        totalTips: 40000,
        netSales: 200000,
        foodSales: 80000,
        team: [
          member('Joseph', 'bartender', { id: 'joseph' }),
          member('Aaron', 'bartender', { id: 'aaron' }),
        ],
      }),
      { ...kitchenOnly, appliesTo: 'bartender' },
    );
    expect(result.kept).toBe(38400);
    expect(keptSplitAmounts(result)).toEqual({ joseph: 19200, aaron: 19200 });
  });
});

describe('"Whole-dollar shares for each person" setting (wholeDollarShares -> roundMemberShares)', () => {
  it('Golden 1: on -> barbacks $16 / $16 ($1 held, pool $101); off -> $16.50 / $16.50 (pool $102)', () => {
    const on = calcWithSettings(golden1Input(), SERVER_DEFAULT_PROFILE, {
      wholeDollarShares: true,
    }).result;
    const off = calcWithSettings(golden1Input(), SERVER_DEFAULT_PROFILE, {
      wholeDollarShares: false,
    }).result;
    expect(memberAmounts(roleOf(on, 'barback'))).toEqual({ david: 1600, allen: 1600 });
    expect(on.pool).toBe(10100);
    expect(on.roundingAdjustment).toBe(117);
    expect(memberAmounts(roleOf(off, 'barback'))).toEqual({ david: 1650, allen: 1650 });
    expect(off.pool).toBe(10200);
    expect(off.roundingAdjustment).toBe(17);
  });

  it('Golden 2: on -> keptSplit $75 / $75 + $0.55 change; off -> $74.78 / $74.77, no change', () => {
    const on = calcWithSettings(golden2Input(), BARTENDER_DEFAULT_PROFILE, {
      wholeDollarShares: true,
    }).result;
    const off = calcWithSettings(golden2Input(), BARTENDER_DEFAULT_PROFILE, {
      wholeDollarShares: false,
    }).result;
    expect(keptSplitAmounts(on)).toEqual({ joseph: 7500, aaron: 7500 });
    expect(on.keptChange).toBe(55);
    expect(memberAmounts(roleOf(on, 'barback'))).toEqual({ david: 2000, allen: 2000 });
    expect(keptSplitAmounts(off)).toEqual({ joseph: 7478, aaron: 7477 });
    expect(off.keptChange).toBe(0);
    expect(memberAmounts(roleOf(off, 'barback'))).toEqual({ david: 2050, allen: 2050 });
  });

  it('the setting default (true) matches the engine default (option omitted)', () => {
    expect(
      calcWithSettings(golden1Input(), SERVER_DEFAULT_PROFILE, { wholeDollarShares: true }),
    ).toEqual(calculateShift(golden1Input(), SERVER_DEFAULT_PROFILE));
    expect(
      calcWithSettings(golden2Input(), BARTENDER_DEFAULT_PROFILE, { wholeDollarShares: true }),
    ).toEqual(calculateShift(golden2Input(), BARTENDER_DEFAULT_PROFILE));
  });

  it('has no effect when rounding is off (the toggle is disabled)', () => {
    for (const [input, profile] of [
      [golden1Input({ roundToDollar: false }), SERVER_DEFAULT_PROFILE],
      [golden2Input({ roundToDollar: false }), BARTENDER_DEFAULT_PROFILE],
    ] as const) {
      expect(calcWithSettings(input, profile, { wholeDollarShares: true })).toEqual(
        calcWithSettings(input, profile, { wholeDollarShares: false }),
      );
    }
  });

  it('applies to custom roles too', () => {
    // Busser share $21 between two bussers: 10.5 / 10.5 -> on: 10 / 10 ($1 held); off: 1050 / 1050
    const profile: TipOutProfile = {
      id: 'b',
      name: 'Bussers',
      appliesTo: 'server',
      totalTipOutPercentOfTips: 30,
      rules: [custom('Busser', { type: 'shareOfRemainder', weight: 1 })],
    };
    const input = shiftInput({
      totalTips: 7000, // 30% = 2100 -> $21
      roundToDollar: true,
      team: [member('Sam', 'busser', { id: 'sam' }), member('Lee', 'busser', { id: 'lee' })],
    });
    const on = calcWithSettings(input, profile, { wholeDollarShares: true }).result;
    const off = calcWithSettings(input, profile, { wholeDollarShares: false }).result;
    expect(memberAmounts(roleOf(on, 'busser'))).toEqual({ sam: 1000, lee: 1000 });
    expect(on.pool).toBe(2000);
    expect(memberAmounts(roleOf(off, 'busser'))).toEqual({ sam: 1050, lee: 1050 });
    expect(off.pool).toBe(2100);
  });
});
