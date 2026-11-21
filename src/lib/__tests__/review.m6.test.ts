/**
 * Milestone 6 decisions from the main-branch review (docs/review-log.md, round 6).
 * Finding numbers (#n) refer to docs/test-findings.md.
 */
import { calculateShift } from '@/engine/calculate';
import { SERVER_DEFAULT_PROFILE } from '@/engine/profiles';
import type { TeamMember } from '@/engine/types';
import {
  checkTeamHours,
  parseHoursInput,
  parseTimeInput,
  type TypedMember,
} from '@/lib/hoursInput';
import { golden1Input, golden1Team } from '@/test-support/builders';

const SERVER_SPLIT = ['bartender', 'barback', 'host'];

describe('#78: the engine never validates hours for roles it does not split', () => {
  it('kitchen members with bad, half-entered or equal clock values do not throw', () => {
    const kitchen: TeamMember[] = [
      { id: 'k1', name: 'Cook A', role: 'kitchen', clockIn: 'abc', clockOut: '01:00' },
      { id: 'k2', name: 'Cook B', role: 'kitchen', clockIn: '17:00' },
      { id: 'k3', name: 'Cook C', role: 'kitchen', clockIn: '17:00', clockOut: '17:00' },
      { id: 'k4', name: 'Cook D', role: 'kitchen', hours: -3 },
    ];
    const plain = calculateShift(golden1Input(), SERVER_DEFAULT_PROFILE).result;
    const { result } = calculateShift(
      golden1Input({ team: [...golden1Team(), ...kitchen] }),
      SERVER_DEFAULT_PROFILE,
    );
    expect(result).toEqual(plain);
    expect(checkTeamHours(kitchen, SERVER_SPLIT)).toEqual([]);
  });

  it('members of a role not in the profile are not validated either', () => {
    const extra: TeamMember = { id: 'x', name: 'Sam', role: 'busser', clockIn: 'nope' };
    expect(() =>
      calculateShift(golden1Input({ team: [...golden1Team(), extra] }), SERVER_DEFAULT_PROFILE),
    ).not.toThrow();
  });
});

describe('#69: whitespace inside time and hours input is ignored', () => {
  it.each([
    ['5 : 30', '05:30'],
    ['17 30', '17:30'],
    [' 1 2 : 3 0 p m ', '12:30'],
  ])('parseTimeInput(%p) -> %p', (text, out) => {
    expect(parseTimeInput(text)).toBe(out);
  });

  it.each([
    ['6 . 5', 6.5],
    ['6 h 30 m', 6.5],
    ['4 5 min', 0.75],
  ])('parseHoursInput(%p) -> %p', (text, out) => {
    expect(parseHoursInput(text)).toBe(out);
  });
});

describe('#70: one-digit minutes are not times', () => {
  it.each(['5:3', '5.3', '5.5'])('parseTimeInput(%p) -> null', (text) => {
    expect(parseTimeInput(text)).toBeNull();
  });
});

describe('#72 / #74: messages', () => {
  const m = (extra: Partial<TypedMember>): TypedMember => ({
    id: 'a',
    name: 'Allen',
    role: 'barback',
    ...extra,
  });

  it('0 hours is INVALID_HOURS and says to enter hours above 0 or remove the member', () => {
    const [issue] = checkTeamHours([m({ hoursText: '0' })], SERVER_SPLIT);
    expect(issue?.code).toBe('INVALID_HOURS');
    expect(issue?.message).toContain('Enter hours above 0, or remove them from the team');
  });

  it('LONG_SHIFT above 16 h is a gentle warning', () => {
    const [issue] = checkTeamHours([m({ clockInText: '10am', clockOutText: '3am' })], SERVER_SPLIT);
    expect(issue).toMatchObject({ code: 'LONG_SHIFT', severity: 'warning' });
    expect(issue?.message).toBe("That's a long shift for Allen (17 h) — double-check the times.");
  });
});

describe('#76: total hours text wins over clock text', () => {
  it('valid hours text with bad clock text: no issue (clock ignored)', () => {
    const t: TypedMember = {
      id: 'a',
      name: 'Allen',
      role: 'barback',
      hoursText: '6',
      clockInText: 'abc',
      clockOutText: '',
    };
    expect(checkTeamHours([t], SERVER_SPLIT)).toEqual([]);
  });

  it('bad hours text with good clock text: INVALID_HOURS only', () => {
    const t: TypedMember = {
      id: 'a',
      name: 'Allen',
      role: 'barback',
      hoursText: 'abc',
      clockInText: '5pm',
      clockOutText: '11pm',
    };
    expect(checkTeamHours([t], SERVER_SPLIT).map((i) => i.code)).toEqual(['INVALID_HOURS']);
  });
});

describe('#77: one INVALID_TIME per unreadable field', () => {
  it('two bad fields give two INVALID_TIME issues, clock-in first', () => {
    const t: TypedMember = {
      id: 'a',
      name: 'Allen',
      role: 'barback',
      clockInText: 'abc',
      clockOutText: 'xyz',
    };
    const issues = checkTeamHours([t], SERVER_SPLIT);
    expect(issues.map((i) => i.code)).toEqual(['INVALID_TIME', 'INVALID_TIME']);
    expect(issues[0]!.message).toContain('clock-in');
    expect(issues[1]!.message).toContain('clock-out');
  });
});
