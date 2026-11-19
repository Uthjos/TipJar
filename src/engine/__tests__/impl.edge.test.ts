import { calculateShift, EngineValidationError } from '../calculate';
import { memberHours } from '../hours';
import { floorToDollar, formatCents, parseMoneyToCents, splitLargestRemainder } from '../money';
import { BARTENDER_DEFAULT_PROFILE, SERVER_DEFAULT_PROFILE } from '../profiles';
import type { ShiftInput, TipOutProfile } from '../types';

const base: ShiftInput = {
  date: '2026-01-01',
  userRole: 'server',
  totalTips: 34056,
  netSales: 156025,
  foodSales: 70012,
  team: [
    { id: 'j', name: 'Joseph', role: 'bartender' },
    { id: 'a', name: 'Aaron', role: 'bartender' },
    { id: 'd', name: 'David', role: 'barback' },
    { id: 'al', name: 'Allen', role: 'barback' },
    { id: 'h', name: 'Hannah', role: 'host' },
  ],
  missingRoleHandling: 'redistribute',
  profileId: 'server-default',
  roundToDollar: false,
};

const sumRoles = (r: { roles: { amount: number }[] }) => r.roles.reduce((a, x) => a + x.amount, 0);

describe('money helpers', () => {
  it('splitLargestRemainder sums exactly and breaks ties by index', () => {
    expect(splitLargestRemainder(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(splitLargestRemainder(14955, [1, 1])).toEqual([7478, 7477]);
    expect(splitLargestRemainder(0, [1, 2])).toEqual([0, 0]);
    expect(() => splitLargestRemainder(5, [0, 0])).toThrow();
  });
  it('floorToDollar / formatCents / parseMoneyToCents', () => {
    expect(floorToDollar(10217)).toBe(10200);
    expect(formatCents(123456)).toBe('$1,234.56');
    expect(formatCents(5)).toBe('$0.05');
    expect(parseMoneyToCents('1,234.5')).toBe(123450);
    expect(parseMoneyToCents('$.75')).toBe(75);
    expect(parseMoneyToCents('abc')).toBeUndefined();
  });
});

describe('hours', () => {
  it('uses hours, clock diffs, and overnight shifts', () => {
    expect(memberHours({ id: '1', name: 'a', role: 'host', hours: 6.5 })).toBe(6.5);
    expect(
      memberHours({
        id: '1',
        name: 'a',
        role: 'host',
        clockIn: '2026-01-01T17:00:00',
        clockOut: '2026-01-01T23:30:00',
      }),
    ).toBe(6.5);
    expect(
      memberHours({ id: '1', name: 'a', role: 'host', clockIn: '20:00', clockOut: '02:00' }),
    ).toBe(6);
    expect(
      memberHours({
        id: '1',
        name: 'a',
        role: 'host',
        clockIn: '2026-01-01T20:00:00',
        clockOut: '2026-01-01T02:00:00',
      }),
    ).toBe(6);
    expect(memberHours({ id: '1', name: 'a', role: 'host' })).toBeUndefined();
  });
});

describe('calculateShift edge cases', () => {
  it('rounding off: splits to the cent, kitchen = 2% of food', () => {
    const { result } = calculateShift(base, SERVER_DEFAULT_PROFILE);
    expect(result.roundingAdjustment).toBe(0);
    expect(result.pool).toBe(10217);
    expect(result.roles[0]!.amount).toBe(1400);
    expect(sumRoles(result)).toBe(10217);
    expect(result.kept).toBe(34056 - 10217);
  });

  it('unequal hours split by hours', () => {
    const input: ShiftInput = {
      ...base,
      roundToDollar: true,
      team: [
        { id: 'j', name: 'Joseph', role: 'bartender', hours: 6 },
        { id: 'a', name: 'Aaron', role: 'bartender', hours: 2 },
        { id: 'd', name: 'David', role: 'barback' },
        { id: 'h', name: 'Hannah', role: 'host' },
      ],
    };
    const { result } = calculateShift(input, SERVER_DEFAULT_PROFILE);
    const bar = result.roles.find((r) => r.role === 'bartender')!;
    expect(bar.members.map((m) => m.amount)).toEqual([3300, 1100]);
    expect(bar.members.map((m) => m.hours)).toEqual([6, 2]);
  });

  it('partial hours block calculation', () => {
    const input: ShiftInput = {
      ...base,
      team: [
        { id: 'j', name: 'Joseph', role: 'bartender', hours: 6 },
        { id: 'a', name: 'Aaron', role: 'bartender' },
      ],
    };
    expect(() => calculateShift(input, SERVER_DEFAULT_PROFILE)).toThrow(EngineValidationError);
    try {
      calculateShift(input, SERVER_DEFAULT_PROFILE);
    } catch (e) {
      expect((e as EngineValidationError).code).toBe('PARTIAL_HOURS');
    }
  });

  it('bartenders split kept tips by hours (overnight clocks)', () => {
    const input: ShiftInput = {
      date: '2026-01-01',
      userRole: 'bartender',
      totalTips: 20000,
      netSales: 100000,
      foodSales: 0,
      team: [
        { id: 'me', name: 'Me', role: 'bartender', clockIn: '18:00', clockOut: '02:00' },
        { id: 'x', name: 'X', role: 'bartender', clockIn: '22:00', clockOut: '02:00' },
        { id: 'b', name: 'B', role: 'barback' },
        { id: 'h', name: 'H', role: 'host' },
      ],
      missingRoleHandling: 'redistribute',
      profileId: 'bartender-default',
      roundToDollar: false,
    };
    const { result } = calculateShift(input, BARTENDER_DEFAULT_PROFILE);
    expect(result.pool).toBe(6000);
    expect(result.roles.find((r) => r.role === 'kitchen')!.amount).toBe(0);
    expect(result.kept).toBe(14000);
    expect(result.keptSplit!.map((k) => k.amount)).toEqual([9333, 4667]);
  });

  it('carve-outs exceeding the pool are capped with a warning', () => {
    const { result, warnings } = calculateShift(
      { ...base, totalTips: 1000, roundToDollar: false },
      SERVER_DEFAULT_PROFILE,
    );
    expect(warnings.map((w) => w.code)).toContain('CARVEOUTS_EXCEED_POOL');
    expect(result.pool).toBe(300);
    expect(result.roles[0]!.amount).toBe(300);
  });

  it('food > net warns', () => {
    const { warnings } = calculateShift({ ...base, foodSales: 200000 }, SERVER_DEFAULT_PROFILE);
    expect(warnings.map((w) => w.code)).toContain('FOOD_EXCEEDS_NET');
  });

  it('validation errors', () => {
    expect(() => calculateShift({ ...base, totalTips: -1 }, SERVER_DEFAULT_PROFILE)).toThrow(
      expect.objectContaining({ code: 'NEGATIVE_AMOUNT' }),
    );
    const bad: TipOutProfile = { ...SERVER_DEFAULT_PROFILE, totalTipOutPercentOfTips: 120 };
    expect(() => calculateShift(base, bad)).toThrow(
      expect.objectContaining({ code: 'INVALID_PERCENT' }),
    );
    const badW: TipOutProfile = {
      ...SERVER_DEFAULT_PROFILE,
      rules: [{ role: 'host', type: 'shareOfRemainder', weight: 0 }],
    };
    expect(() => calculateShift(base, badW)).toThrow(
      expect.objectContaining({ code: 'INVALID_WEIGHT' }),
    );
  });

  it('custom profile with a net-sales basis and custom role', () => {
    const custom: TipOutProfile = {
      id: 'c',
      name: 'Custom',
      appliesTo: 'server',
      totalTipOutPercentOfTips: 25,
      rules: [
        { role: 'busser', type: 'percentOfBasis', basis: 'netSales', percent: 1 },
        { role: 'bartender', type: 'shareOfRemainder', weight: 1 },
      ],
    };
    const { result } = calculateShift(
      { ...base, team: [...base.team, { id: 'bu', name: 'Bo', role: 'busser' }] },
      custom,
    );
    expect(result.roles[0]!.amount).toBe(1560);
    expect(result.roles[0]!.members.map((m) => m.amount)).toEqual([1560]);
    expect(result.pool).toBe(8514);
    expect(sumRoles(result)).toBe(8514);
  });

  it('sum(roles paid) <= pool <= totalTips for many inputs', () => {
    for (let tips = 0; tips < 50000; tips += 1237) {
      for (const roundToDollar of [true, false]) {
        for (const handling of ['retain', 'redistribute'] as const) {
          const { result } = calculateShift(
            {
              ...base,
              totalTips: tips,
              foodSales: tips * 2,
              netSales: tips * 4,
              roundToDollar,
              missingRoleHandling: handling,
              team: base.team.filter((m) => m.role !== 'host'),
            },
            SERVER_DEFAULT_PROFILE,
          );
          const paid = result.roles.filter((r) => !r.missing).reduce((a, r) => a + r.amount, 0);
          expect(paid).toBe(result.pool);
          expect(result.pool).toBeLessThanOrEqual(tips);
          expect(result.kept).toBe(tips - result.pool);
          for (const r of result.roles) {
            if (r.members.length) {
              expect(r.members.reduce((a, m) => a + m.amount, 0)).toBe(r.amount);
            }
          }
        }
      }
    }
  });
});
