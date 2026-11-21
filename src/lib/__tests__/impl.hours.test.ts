import { calculateShift } from '@/engine/calculate';
import { BARTENDER_DEFAULT_PROFILE } from '@/engine/profiles';
import type { ShiftInput, TeamMember } from '@/engine/types';
import { buildShareText } from '@/lib/format';
import {
  checkTeamHours,
  clockHours,
  copyHoursToRole,
  formatHours,
  parseHoursInput,
  parseTimeInput,
  type TypedMember,
} from '@/lib/hoursInput';

describe('parseTimeInput', () => {
  it.each([
    ['9', '09:00'],
    ['17', '17:00'],
    ['0', '00:00'],
    ['5:30', '05:30'],
    ['5.30', '05:30'],
    ['930', '09:30'],
    ['1730', '17:30'],
    ['5pm', '17:00'],
    ['5:30 PM', '17:30'],
    ['9a', '09:00'],
    ['12am', '00:00'],
    ['12pm', '12:00'],
    ['12:30a', '00:30'],
    ['11 p.m.', '23:00'],
    ['Noon', '12:00'],
    ['midnight', '00:00'],
  ])('%s -> %s', (text, out) => expect(parseTimeInput(text)).toBe(out));

  it.each(['', '  ', '24', '13pm', '0am', '5:60', '12345', 'abc', '5:3'])('%s -> null', (text) =>
    expect(parseTimeInput(text)).toBeNull(),
  );
});

describe('parseHoursInput', () => {
  it.each([
    ['6', 6],
    ['6.5', 6.5],
    ['6,5', 6.5],
    ['6:30', 6.5],
    ['6h', 6],
    ['6h30', 6.5],
    ['6h 30m', 6.5],
    ['6 hrs', 6],
    ['45m', 0.75],
    ['45 min', 0.75],
    ['.5', 0.5],
    ['7:20', 7.33],
    ['24', 24],
  ])('%s -> %s', (text, out) => expect(parseHoursInput(text)).toBe(out));

  it.each(['', '0', '-1', '25', 'abc', '6:75'])('%s -> null', (text) =>
    expect(parseHoursInput(text)).toBeNull(),
  );
});

describe('clockHours / formatHours', () => {
  it('computes spans, overnight and rejects equal times', () => {
    expect(clockHours('17:00', '23:30')).toEqual({ hours: 6.5, overnight: false });
    expect(clockHours('20:00', '02:00')).toEqual({ hours: 6, overnight: true });
    expect(clockHours('17:00', '17:00')).toBeNull();
    expect(clockHours('5pm', '23:00')).toBeNull();
  });
  it('formats without trailing zeros', () => {
    expect(formatHours(6)).toBe('6 h');
    expect(formatHours(6.5)).toBe('6.5 h');
    expect(formatHours(6.25)).toBe('6.25 h');
    expect(formatHours(0.75)).toBe('0.75 h');
    expect(formatHours(6.333)).toBe('6.33 h');
  });
});

const member = (id: string, role: string, extra: Partial<TypedMember> = {}): TypedMember => ({
  id,
  name: id,
  role,
  ...extra,
});

describe('checkTeamHours', () => {
  it('reports member problems from typed text, then PARTIAL_HOURS, in role/team order', () => {
    const team: TypedMember[] = [
      member('Hannah', 'host'),
      member('Joseph', 'bartender', { clockInText: '5pm' }),
      member('Aaron', 'bartender', { clockInText: '5pm', clockOutText: 'later' }),
      member('Mo', 'bartender', { hoursText: '6' }),
      member('Lee', 'bartender'),
      member('David', 'barback', { clockInText: '9pm', clockOutText: '21:00' }),
      member('Allen', 'barback', { hoursText: '17' }),
      member('Zed', 'kitchen', { hoursText: 'nonsense' }),
    ];
    const issues = checkTeamHours(team, ['bartender', 'barback', 'host']);
    expect(issues.map((i) => [i.code, i.memberId, i.severity])).toEqual([
      ['MISSING_CLOCK_OUT', 'Joseph', 'error'],
      ['INVALID_TIME', 'Aaron', 'error'],
      ['PARTIAL_HOURS', 'Lee', 'error'],
      ['SAME_TIME', 'David', 'error'],
      ['LONG_SHIFT', 'Allen', 'warning'],
    ]);
    expect(issues[0]!.message).toBe('Joseph needs a clock-out time.');
    expect(issues[2]!.message).toBe(
      'Enter hours for Lee too, or clear them all for an even split.',
    );
  });

  it('falls back to committed values and flags bad ones', () => {
    const issues = checkTeamHours(
      [
        member('A', 'host', { hours: 0 }),
        member('B', 'host', { clockIn: '17:00', clockOut: '22:00' }),
      ],
      ['host'],
    );
    expect(issues.map((i) => i.code)).toEqual(['INVALID_HOURS']);
  });

  it('error-free typed hours, once committed, calculate without throwing', () => {
    const typed: TypedMember[] = [
      member('me', 'bartender', { clockInText: '5pm', clockOutText: '1:30am' }),
      member('x', 'bartender', { hoursText: '6h30' }),
      member('d', 'barback'),
    ];
    expect(
      checkTeamHours(typed, ['bartender', 'barback', 'host']).filter((i) => i.severity === 'error'),
    ).toEqual([]);
    const committed: TeamMember[] = typed.map(({ hoursText, clockInText, clockOutText, ...m }) => ({
      ...m,
      ...(hoursText ? { hours: parseHoursInput(hoursText)! } : {}),
      ...(clockInText ? { clockIn: parseTimeInput(clockInText)! } : {}),
      ...(clockOutText ? { clockOut: parseTimeInput(clockOutText)! } : {}),
    }));
    const input: ShiftInput = {
      date: '2026-11-20',
      userRole: 'bartender',
      totalTips: 20000,
      netSales: 100000,
      foodSales: 0,
      team: committed,
      missingRoleHandling: 'retain',
      profileId: 'bartender-default',
      roundToDollar: false,
    };
    const { result } = calculateShift(input, BARTENDER_DEFAULT_PROFILE);
    expect(result.keptSplit!.map((k) => k.hours)).toEqual([8.5, 6.5]);
    const text = buildShareText(input, result, BARTENDER_DEFAULT_PROFILE);
    expect(text).toContain('  me (8.5 h) $');
    expect(text).toContain('  x (6.5 h) $');
    expect(text).toContain('Barbacks: $');
    expect(text).toMatch(/— d \$/);
  });
});

describe('copyHoursToRole', () => {
  it('copies one source of hours to the same role only, without mutating', () => {
    const team: TeamMember[] = [
      { id: 'a', name: 'A', role: 'barback', clockIn: '17:00', clockOut: '23:00' },
      { id: 'b', name: 'B', role: 'barback', hours: 4 },
      { id: 'c', name: 'C', role: 'host', hours: 2 },
    ];
    const frozen = JSON.stringify(team);
    const out = copyHoursToRole(team, 'a');
    expect(out[1]).toEqual({
      id: 'b',
      name: 'B',
      role: 'barback',
      clockIn: '17:00',
      clockOut: '23:00',
    });
    expect(out[2]).toEqual(team[2]);
    expect(out[2]).not.toBe(team[2]);
    expect(JSON.stringify(team)).toBe(frozen);
    expect(copyHoursToRole(team, 'nope')).toEqual(team);
  });
});
