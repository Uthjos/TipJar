/**
 * Milestone 7 acceptance: History helpers (docs/m7-contract.md "Pure helpers — src/lib/history.ts").
 * Snapshots come from the real engine (src/test-support/historyFixtures.ts).
 */
import * as fc from 'fast-check';
import { calculateShift } from '../../engine/calculate';
import { BARTENDER_DEFAULT_PROFILE, SERVER_DEFAULT_PROFILE } from '../../engine/profiles';
import type { ShiftInput, TeamMember } from '../../engine/types';
import type { SavedShift } from '../../db/repositories';
import { userEarnings } from '../earnings';
import { inRange, periodRange, shiftPeriod, summarize, type PeriodRange } from '../history';
import { at, member, sum } from '../../test-support/builders';
import { pairShift, weekShifts } from '../../test-support/historyFixtures';

const range = (r: PeriodRange) => [r.from, r.to, r.label];

// ---------------------------------------------------------------------------
// periodRange
// ---------------------------------------------------------------------------

describe('periodRange: week', () => {
  it.each([
    // Sunday start (default); Nov 15 2026 is a Sunday, Nov 21 a Saturday
    ['2026-11-18', undefined, '2026-11-15', '2026-11-21', 'Nov 15 – 21, 2026'],
    ['2026-11-15', 0, '2026-11-15', '2026-11-21', 'Nov 15 – 21, 2026'], // anchor = first day
    ['2026-11-21', 0, '2026-11-15', '2026-11-21', 'Nov 15 – 21, 2026'], // anchor = last day
    // Monday start; Nov 16 is a Monday
    ['2026-11-18', 1, '2026-11-16', '2026-11-22', 'Nov 16 – 22, 2026'],
    ['2026-11-16', 1, '2026-11-16', '2026-11-22', 'Nov 16 – 22, 2026'],
    ['2026-11-22', 1, '2026-11-16', '2026-11-22', 'Nov 16 – 22, 2026'], // Sunday is the last day
    ['2026-11-15', 1, '2026-11-09', '2026-11-15', 'Nov 9 – 15, 2026'],
  ] as const)('anchor %s, weekStartsOn %p -> %s..%s %p', (anchor, start, from, to, label) => {
    const r = periodRange('week', anchor, start);
    expect(r.period).toBe('week');
    expect(range(r)).toEqual([from, to, label]);
  });

  it('a week crossing a month', () => {
    expect(range(periodRange('week', '2026-12-01'))).toEqual([
      '2026-11-29',
      '2026-12-05',
      'Nov 29 – Dec 5, 2026',
    ]);
    expect(range(periodRange('week', '2026-11-30', 0))).toEqual(
      range(periodRange('week', '2026-12-05', 0)),
    );
  });

  it('a week crossing a year', () => {
    expect(range(periodRange('week', '2026-12-31'))).toEqual([
      '2026-12-27',
      '2027-01-02',
      'Dec 27, 2026 – Jan 2, 2027',
    ]);
    // Monday start: Thu Jan 1 2026 sits in Mon Dec 29 2025 – Sun Jan 4 2026
    expect(range(periodRange('week', '2026-01-01', 1))).toEqual([
      '2025-12-29',
      '2026-01-04',
      'Dec 29, 2025 – Jan 4, 2026',
    ]);
  });

  it('every week is exactly 7 days and contains its anchor', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 3650 }),
        fc.constantFrom<0 | 1>(0, 1),
        (offset, start) => {
          const anchor = new Date(Date.UTC(2024, 0, 1) + offset * 86_400_000)
            .toISOString()
            .slice(0, 10);
          const r = periodRange('week', anchor, start);
          const days = (Date.parse(r.to) - Date.parse(r.from)) / 86_400_000;
          expect(days).toBe(6);
          expect(new Date(r.from + 'T00:00:00Z').getUTCDay()).toBe(start);
          expect(inRange(anchor, r)).toBe(true);
        },
      ),
      { seed: 20261121, numRuns: 400 },
    );
  });
});

describe('periodRange: month and year', () => {
  it.each([
    ['2024-02-10', '2024-02-01', '2024-02-29', 'February 2024'], // leap year
    ['2026-02-28', '2026-02-01', '2026-02-28', 'February 2026'],
    ['2000-02-01', '2000-02-01', '2000-02-29', 'February 2000'], // divisible by 400: leap
    ['2100-02-15', '2100-02-01', '2100-02-28', 'February 2100'], // divisible by 100: not leap
    ['2026-04-30', '2026-04-01', '2026-04-30', 'April 2026'], // 30-day month, anchor last day
    ['2026-11-01', '2026-11-01', '2026-11-30', 'November 2026'], // anchor first day
    ['2026-12-31', '2026-12-01', '2026-12-31', 'December 2026'], // 31-day month
    ['2026-01-15', '2026-01-01', '2026-01-31', 'January 2026'],
  ])('month of %s -> %s..%s %p', (anchor, from, to, label) => {
    const r = periodRange('month', anchor);
    expect(r.period).toBe('month');
    expect(range(r)).toEqual([from, to, label]);
  });

  it('weekStartsOn does not change a month', () => {
    expect(periodRange('month', '2026-11-18', 1)).toEqual(periodRange('month', '2026-11-18', 0));
  });

  it.each([
    ['2026-11-18', '2026-01-01', '2026-12-31', '2026'],
    ['2026-01-01', '2026-01-01', '2026-12-31', '2026'],
    ['2024-12-31', '2024-01-01', '2024-12-31', '2024'],
  ])('year of %s -> %s..%s %p', (anchor, from, to, label) => {
    const r = periodRange('year', anchor);
    expect(r.period).toBe('year');
    expect(range(r)).toEqual([from, to, label]);
  });
});

describe('shiftPeriod', () => {
  it('weeks step by 7 days, across months and years', () => {
    const w = periodRange('week', '2026-11-18');
    expect(range(shiftPeriod(w, 1))).toEqual(['2026-11-22', '2026-11-28', 'Nov 22 – 28, 2026']);
    expect(range(shiftPeriod(w, -1))).toEqual(['2026-11-08', '2026-11-14', 'Nov 8 – 14, 2026']);
    const ny = periodRange('week', '2026-12-31');
    expect(range(shiftPeriod(ny, 1))).toEqual(['2027-01-03', '2027-01-09', 'Jan 3 – 9, 2027']);
    expect(range(shiftPeriod(ny, -1))).toEqual(['2026-12-20', '2026-12-26', 'Dec 20 – 26, 2026']);
  });

  it('weeks keep the week start (Monday)', () => {
    const w = periodRange('week', '2026-11-18', 1);
    expect(range(shiftPeriod(w, 1, 1))).toEqual(['2026-11-23', '2026-11-29', 'Nov 23 – 29, 2026']);
    expect(range(shiftPeriod(w, -1, 1))).toEqual(['2026-11-09', '2026-11-15', 'Nov 9 – 15, 2026']);
  });

  it('months step to the neighbouring month, across years, regardless of day counts', () => {
    const dec = periodRange('month', '2026-12-31');
    expect(range(shiftPeriod(dec, 1))).toEqual(['2027-01-01', '2027-01-31', 'January 2027']);
    const jan = periodRange('month', '2026-01-31');
    expect(range(shiftPeriod(jan, -1))).toEqual(['2025-12-01', '2025-12-31', 'December 2025']);
    // Jan 31 -> February, not March
    expect(range(shiftPeriod(jan, 1))).toEqual(['2026-02-01', '2026-02-28', 'February 2026']);
    const feb24 = periodRange('month', '2024-02-29');
    expect(range(shiftPeriod(feb24, 1))).toEqual(['2024-03-01', '2024-03-31', 'March 2024']);
  });

  it('years step by one', () => {
    const y = periodRange('year', '2026-06-15');
    expect(range(shiftPeriod(y, 1))).toEqual(['2027-01-01', '2027-12-31', '2027']);
    expect(range(shiftPeriod(y, -1))).toEqual(['2025-01-01', '2025-12-31', '2025']);
  });

  it('next then previous returns the same range', () => {
    for (const [p, anchor, start] of [
      ['week', '2026-12-31', 0],
      ['week', '2026-01-01', 1],
      ['month', '2024-02-29', 0],
      ['year', '2026-11-18', 0],
    ] as const) {
      const r = periodRange(p, anchor, start);
      expect(shiftPeriod(shiftPeriod(r, 1, start), -1, start)).toEqual(r);
    }
  });

  it('consecutive periods tile the calendar with no gaps or overlaps', () => {
    for (const p of ['week', 'month', 'year'] as const) {
      let r = periodRange(p, '2026-11-18');
      for (let i = 0; i < 30; i++) {
        const next = shiftPeriod(r, 1);
        const gap = (Date.parse(next.from) - Date.parse(r.to)) / 86_400_000;
        expect({ p, from: next.from, gap }).toEqual({ p, from: next.from, gap: 1 });
        r = next;
      }
    }
  });
});

describe('inRange', () => {
  const w = periodRange('week', '2026-11-18');
  it.each([
    ['2026-11-14', false],
    ['2026-11-15', true],
    ['2026-11-18', true],
    ['2026-11-21', true],
    ['2026-11-22', false],
    ['2025-11-18', false],
  ])('%s -> %p', (date, expected) => {
    expect(inRange(date, w)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// summarize
// ---------------------------------------------------------------------------

describe('summarize: the week of Nov 15 – 21, 2026', () => {
  const week = periodRange('week', '2026-11-18');
  const s = summarize(weekShifts(), week);

  it('totals (the Nov 22 shift is outside the week and ignored)', () => {
    // earned 23956 + 7555 + 28000; tipped out 10100 + 4200 + 12000; tips 34056 + 19255 + 40000
    expect(s.shiftCount).toBe(3);
    expect(s.earned).toBe(59511);
    expect(s.tippedOut).toBe(26300);
    expect(s.totalTips).toBe(93311);
    expect(s.averageEarned).toBe(19837); // 59511 / 3 exactly
  });

  it('earned uses userEarnings (bartender: own keptSplit + keptChange)', () => {
    const g2 = at(weekShifts(), 1);
    expect(userEarnings(g2.input, g2.result)).toBe(7555);
  });

  it('series: 7 buckets Sun..Sat with every day present, summing to earned', () => {
    expect(s.series).toEqual([
      { key: '2026-11-15', label: 'Sun', earned: 0 },
      { key: '2026-11-16', label: 'Mon', earned: 23956 },
      { key: '2026-11-17', label: 'Tue', earned: 0 },
      { key: '2026-11-18', label: 'Wed', earned: 7555 },
      { key: '2026-11-19', label: 'Thu', earned: 0 },
      { key: '2026-11-20', label: 'Fri', earned: 0 },
      { key: '2026-11-21', label: 'Sat', earned: 28000 },
    ]);
  });

  it('series labels follow a Monday week start', () => {
    const mon = periodRange('week', '2026-11-18', 1);
    const sm = summarize(weekShifts(), mon, { weekStartsOn: 1 });
    expect(sm.series.map((b) => b.label)).toEqual([
      'Mon',
      'Tue',
      'Wed',
      'Thu',
      'Fri',
      'Sat',
      'Sun',
    ]);
    expect(sm.series.map((b) => b.key)).toEqual([
      '2026-11-16',
      '2026-11-17',
      '2026-11-18',
      '2026-11-19',
      '2026-11-20',
      '2026-11-21',
      '2026-11-22',
    ]);
    // Mon-start week includes Sun Nov 22 (another Golden 1, earned 23956)
    expect(sm.shiftCount).toBe(4);
    expect(sm.earned).toBe(59511 + 23956);
  });

  it('byRole: paid amounts per role, amount desc; the retained (missing) host share is not counted', () => {
    /*
     * g1: kitchen 1400, bartender 4400, barback 3200 (after the held $1), host 1100
     * g2: kitchen 200, barback 4000; host missing (retained 1400) -> not a tip-out
     * pat: kitchen 1600, busser 2000, bartender 4200, barback 3150, host 1050
     */
    expect(s.byRole).toEqual([
      { role: 'barback', label: 'Barbacks', amount: 10350, shifts: 3 },
      { role: 'bartender', label: 'Bartenders', amount: 8600, shifts: 2 },
      { role: 'kitchen', label: 'Kitchen (KTO)', amount: 3200, shifts: 3 },
      { role: 'host', label: 'Hosts', amount: 2150, shifts: 2 },
      { role: 'busser', label: 'Busser', amount: 2000, shifts: 1 },
    ]);
    expect(sum(s.byRole.map((r) => r.amount))).toBe(s.tippedOut);
  });

  it('byRole uses the roleLabel option for labels (custom labels from current profiles)', () => {
    const custom = summarize(weekShifts(), week, {
      roleLabel: (r) => (r === 'busser' ? 'Bussers' : r.toUpperCase()),
    });
    expect(custom.byRole.map((r) => r.label)).toEqual([
      'BARBACK',
      'BARTENDER',
      'KITCHEN',
      'HOST',
      'Bussers',
    ]);
  });

  it('byCoworker: tip-outs per person from role members, amount desc then name', () => {
    /*
     * Joseph 2200 + 2100, Aaron 2200 + 2100 (g2 keptSplit is the bar's own split: excluded)
     * David 1600 + 2000 + 1575, Allen the same; Hannah 1100 + 1050; Sam 2000
     */
    expect(
      s.byCoworker.map(({ name, roles, amount, shifts }) => ({ name, roles, amount, shifts })),
    ).toEqual([
      { name: 'Allen', roles: ['barback'], amount: 5175, shifts: 3 },
      { name: 'David', roles: ['barback'], amount: 5175, shifts: 3 },
      { name: 'Aaron', roles: ['bartender'], amount: 4300, shifts: 2 },
      { name: 'Joseph', roles: ['bartender'], amount: 4300, shifts: 2 },
      { name: 'Hannah', roles: ['host'], amount: 2150, shifts: 2 },
      { name: 'Sam', roles: ['busser'], amount: 2000, shifts: 1 },
    ]);
    expect(s.byCoworker.map((c) => c.key)).toEqual([
      'allen',
      'david',
      'aaron',
      'joseph',
      'hannah',
      'sam',
    ]);
  });

  it('byCoworker + memberless roles (kitchen) = tippedOut when no isUser member is paid', () => {
    const kitchen = s.byRole.find((r) => r.role === 'kitchen')!.amount;
    expect(sum(s.byCoworker.map((c) => c.amount)) + kitchen).toBe(s.tippedOut);
  });

  it('is unaffected by the order shifts are passed in', () => {
    expect(summarize([...weekShifts()].reverse(), week)).toEqual(s);
  });
});

describe('summarize: averages, empty periods and omissions', () => {
  const week = periodRange('week', '2026-11-18');

  it('averageEarned rounds half-up', () => {
    // (23956 + 7555) / 2 = 15755.5 -> 15756
    const two = weekShifts().filter((x) => x.id === 'g1' || x.id === 'g2');
    expect(summarize(two, week).averageEarned).toBe(15756);
    // 3 shifts of 1 cent... use pair shifts: earned 7000 each + one of 7001? -> build directly
    const a = pairShift('a', '2026-11-16', [member('H', 'host'), member('B', 'barback')]); // kept 7000
    const b = pairShift('b', '2026-11-17', [member('H', 'host'), member('B', 'barback')]);
    const c = { ...pairShift('c', '2026-11-18', [member('H', 'host'), member('B', 'barback')]) };
    c.result = { ...c.result, kept: 7001 }; // 21001 / 3 = 7000.33 -> 7000
    expect(summarize([a, b, c], week).averageEarned).toBe(7000);
    c.result = { ...c.result, kept: 7002 }; // 21002 / 3 = 7000.67 -> 7001
    expect(summarize([a, b, c], week).averageEarned).toBe(7001);
  });

  it('no shifts: zeros, every bucket present, empty lists', () => {
    const empty = summarize([], week);
    expect(empty).toMatchObject({
      shiftCount: 0,
      earned: 0,
      tippedOut: 0,
      totalTips: 0,
      averageEarned: 0,
      byRole: [],
      byCoworker: [],
    });
    expect(empty.series).toHaveLength(7);
    expect(empty.series.every((b) => b.earned === 0)).toBe(true);
    // shifts exist but none in range
    expect(summarize(weekShifts(), periodRange('week', '2025-01-01')).shiftCount).toBe(0);
  });

  it('month series: one bucket per day, labels "1".."N"', () => {
    const nov = summarize(weekShifts(), periodRange('month', '2026-11-18'));
    expect(nov.series).toHaveLength(30);
    expect(nov.series[0]).toEqual({ key: '2026-11-01', label: '1', earned: 0 });
    expect(at(nov.series, 29)).toMatchObject({ key: '2026-11-30', label: '30' });
    expect(at(nov.series, 15)).toEqual({ key: '2026-11-16', label: '16', earned: 23956 });
    expect(sum(nov.series.map((b) => b.earned))).toBe(nov.earned);
    expect(nov.shiftCount).toBe(4);
    const feb = summarize([], periodRange('month', '2024-02-01'));
    expect(feb.series.map((b) => b.label)).toEqual(
      Array.from({ length: 29 }, (_, i) => String(i + 1)),
    );
  });

  it('year series: 12 buckets Jan..Dec keyed yyyy-MM', () => {
    const y = summarize(weekShifts(), periodRange('year', '2026-11-18'));
    expect(y.series.map((b) => b.label)).toEqual([
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ]);
    expect(y.series.map((b) => b.key)).toEqual(
      Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, '0')}`),
    );
    expect(at(y.series, 10).earned).toBe(59511 + 23956);
    expect(sum(y.series.map((b) => b.earned))).toBe(y.earned);
  });

  it('byRole omits roles with a 0 total and counts only shifts where the role was paid', () => {
    /*
     * Golden 2 redistribute: host missing with amount 0 -> omitted; kitchen 0 with food 0 ->
     * omitted. Barbacks get the whole remainder.
     */
    const shifts: SavedShift[] = [
      {
        id: 'r',
        savedAt: '2026-11-18T23:00:00.000Z',
        input: g2Input({ missingRoleHandling: 'redistribute', foodSales: 0 }),
        result: calculateShift(
          g2Input({ missingRoleHandling: 'redistribute', foodSales: 0 }),
          BARTENDER_DEFAULT_PROFILE,
        ).result,
      },
    ];
    const r = summarize(shifts, week);
    expect(r.byRole.map((x) => x.role)).toEqual(['barback']);
    expect(at(r.byRole, 0).shifts).toBe(1);
  });
});

function g2Input(overrides: Partial<ShiftInput>): ShiftInput {
  return {
    date: '2026-11-18',
    userRole: 'bartender',
    totalTips: 19255,
    netSales: 90543,
    foodSales: 12000,
    team: [
      member('Joseph', 'bartender', { id: 'joseph', isUser: true }),
      member('Aaron', 'bartender', { id: 'aaron' }),
      member('David', 'barback', { id: 'david' }),
      member('Allen', 'barback', { id: 'allen' }),
    ],
    missingRoleHandling: 'retain',
    profileId: 'bartender-default',
    roundToDollar: true,
    ...overrides,
  };
}

describe('summarize: byCoworker name handling', () => {
  const week = periodRange('week', '2026-11-18');

  it('names match after trim, NFC and case folding; the most recent spelling is shown', () => {
    const shifts = [
      pairShift('s3', '2026-11-20', [member('Joseph', 'host'), member('Zoë', 'barback')]),
      pairShift('s1', '2026-11-16', [member('  joseph ', 'host'), member('ZOË', 'barback')]),
      pairShift('s2', '2026-11-18', [member('JOSEPH', 'host'), member('zoë', 'barback')]),
    ];
    const s = summarize(shifts, week);
    expect(s.byCoworker).toHaveLength(2);
    const joseph = s.byCoworker.find((c) => c.key === 'joseph')!;
    expect(joseph).toMatchObject({ name: 'Joseph', amount: 4500, shifts: 3 });
    const zoe = s.byCoworker.find((c) => c.key === 'zoë')!;
    expect(zoe).toMatchObject({ name: 'Zoë', amount: 4500, shifts: 3 }); // Nov 20 spelling
  });

  it('a person who worked several roles lists them in first-seen (date) order', () => {
    const shifts = [
      pairShift('a', '2026-11-16', [member('Sam', 'barback'), member('Kim', 'host')]),
      pairShift('b', '2026-11-17', [member('Sam', 'host'), member('Kim', 'barback')]),
      pairShift('c', '2026-11-18', [member('Sam', 'barback'), member('Lee', 'host')]),
    ];
    const sam = summarize(shifts, week).byCoworker.find((c) => c.key === 'sam')!;
    expect(sam).toMatchObject({ roles: ['barback', 'host'], amount: 4500, shifts: 3 });
  });

  it('isUser members are skipped, and keptSplit (the bar’s own split) is never counted', () => {
    const shifts = [
      pairShift('a', '2026-11-16', [
        member('Me', 'host', { isUser: true }),
        member('Kim', 'barback'),
      ]),
      {
        id: 'bar',
        savedAt: '2026-11-18T23:00:00.000Z',
        input: g2Input({}),
        result: calculateShift(g2Input({}), BARTENDER_DEFAULT_PROFILE).result,
      },
    ];
    const s = summarize(shifts, week);
    const keys = s.byCoworker.map((c) => c.key);
    expect(keys).not.toContain('me');
    expect(keys).not.toContain('joseph'); // only in keptSplit
    expect(keys).not.toContain('aaron');
    expect(keys.sort()).toEqual(['allen', 'david', 'kim']);
  });

  it('members whose total is 0 are omitted', () => {
    // barbacks 0h / 4h -> David gets 0 (rounding off)
    const s = summarize(
      [
        pairShift('z', '2026-11-16', [
          member('Kim', 'host'),
          member('David', 'barback', { hours: 0 }),
          member('Allen', 'barback', { hours: 4 }),
        ]),
      ],
      week,
    );
    expect(s.byCoworker.map((c) => c.name).sort()).toEqual(['Allen', 'Kim']);
  });
});

// ---------------------------------------------------------------------------
// properties over random calculated shifts
// ---------------------------------------------------------------------------

const NAMES = ['Joseph', 'joseph ', 'Aaron', 'David', 'DAVID', 'Allen', 'Hannah', 'Zoë', 'Zoë'];

const shiftArb = fc.record({
  flow: fc.constantFrom('server' as const, 'bartender' as const),
  day: fc.integer({ min: 0, max: 364 }),
  totalTips: fc.integer({ min: 0, max: 300_000 }),
  netSales: fc.integer({ min: 0, max: 1_500_000 }),
  foodPct: fc.integer({ min: 0, max: 100 }),
  counts: fc.array(fc.integer({ min: 0, max: 3 }), { minLength: 3, maxLength: 3 }),
  nameOffset: fc.nat(),
  roundToDollar: fc.boolean(),
  missingRoleHandling: fc.constantFrom('redistribute' as const, 'retain' as const),
  userIsBartender: fc.boolean(),
});

function buildShift(
  i: number,
  c: typeof shiftArb extends fc.Arbitrary<infer T> ? T : never,
): SavedShift {
  const date = new Date(Date.UTC(2026, 0, 1) + c.day * 86_400_000).toISOString().slice(0, 10);
  const roles =
    c.flow === 'server' ? ['bartender', 'barback', 'host'] : ['bartender', 'barback', 'host'];
  const team: TeamMember[] = [];
  let n = 0;
  roles.forEach((role, ri) => {
    for (let k = 0; k < at(c.counts, ri); k++) {
      const m: TeamMember = {
        id: `${role}-${k}`,
        name: at(NAMES, (c.nameOffset + n++) % NAMES.length),
        role,
      };
      if (c.flow === 'bartender' && role === 'bartender' && k === 0 && c.userIsBartender)
        m.isUser = true;
      team.push(m);
    }
  });
  const input: ShiftInput = {
    date,
    userRole: c.flow,
    totalTips: c.totalTips,
    netSales: c.netSales,
    foodSales: Math.floor((c.netSales * c.foodPct) / 100),
    team,
    missingRoleHandling: c.missingRoleHandling,
    profileId: c.flow === 'server' ? 'server-default' : 'bartender-default',
    roundToDollar: c.roundToDollar,
  };
  const profile = c.flow === 'server' ? SERVER_DEFAULT_PROFILE : BARTENDER_DEFAULT_PROFILE;
  return {
    id: `s${i}`,
    savedAt: `${date}T2${i % 10}:00:00.000Z`,
    input,
    result: calculateShift(input, profile).result,
  };
}

const shiftsArb = fc
  .array(shiftArb, { minLength: 0, maxLength: 25 })
  .map((cs) => cs.map((c, i) => buildShift(i, c)));
const anchorArb = fc
  .integer({ min: 0, max: 364 })
  .map((d) => new Date(Date.UTC(2026, 0, 1) + d * 86_400_000).toISOString().slice(0, 10));
const PARAMS = { seed: 20261121, numRuns: 150 };

describe('summarize properties', () => {
  it('earned = sum of userEarnings over in-range shifts (any period, any week start)', () => {
    fc.assert(
      fc.property(
        shiftsArb,
        anchorArb,
        fc.constantFrom('week' as const, 'month' as const, 'year' as const),
        fc.constantFrom<0 | 1>(0, 1),
        (shifts, anchor, period, start) => {
          const r = periodRange(period, anchor, start);
          const s = summarize(shifts, r, { weekStartsOn: start });
          const inside = shifts.filter((x) => inRange(x.input.date, r));
          expect(s.shiftCount).toBe(inside.length);
          expect(s.earned).toBe(sum(inside.map((x) => userEarnings(x.input, x.result))));
          expect(s.tippedOut).toBe(sum(inside.map((x) => x.result.pool)));
          expect(s.totalTips).toBe(sum(inside.map((x) => x.input.totalTips)));
          expect(sum(s.series.map((b) => b.earned))).toBe(s.earned);
          expect(sum(s.byRole.map((b) => b.amount))).toBe(s.tippedOut);
          const lists: { amount: number }[][] = [s.byRole, s.byCoworker];
          for (const list of lists) {
            for (let i = 1; i < list.length; i++) {
              expect(at(list, i - 1).amount).toBeGreaterThanOrEqual(at(list, i).amount);
            }
            for (const e of list) expect(e.amount).toBeGreaterThan(0);
          }
        },
      ),
      PARAMS,
    );
  });

  it('server flow: sum(byCoworker) + memberless role amounts (kitchen) = tippedOut', () => {
    fc.assert(
      fc.property(shiftsArb, (all) => {
        const shifts = all.filter((x) => x.input.userRole === 'server');
        const r = periodRange('year', '2026-06-01');
        const s = summarize(shifts, r);
        const memberless = sum(
          shifts.flatMap((x) =>
            x.result.roles
              .filter((ro) => !ro.missing && ro.members.length === 0)
              .map((ro) => ro.amount),
          ),
        );
        expect(sum(s.byCoworker.map((c) => c.amount)) + memberless).toBe(s.tippedOut);
      }),
      PARAMS,
    );
  });

  it('the year series equals the 12 month summaries', () => {
    fc.assert(
      fc.property(shiftsArb, (shifts) => {
        const y = summarize(shifts, periodRange('year', '2026-06-01'));
        let month = periodRange('month', '2026-01-15');
        for (let m = 0; m < 12; m++) {
          const ms = summarize(shifts, month);
          expect({ m, earned: at(y.series, m).earned }).toEqual({ m, earned: ms.earned });
          month = shiftPeriod(month, 1);
        }
      }),
      PARAMS,
    );
  });
});
