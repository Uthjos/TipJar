/**
 * Milestone 6 acceptance: pure hours-input helpers (docs/m6-contract.md "Pure helpers").
 */
import * as fc from 'fast-check';
import { memberHours } from '../../engine/hours';
import type { TeamMember } from '../../engine/types';
import {
  clockHours,
  copyHoursToRole,
  formatHours,
  parseHoursInput,
  parseTimeInput,
} from '../hoursInput';
import { deepFreeze, member } from '../../test-support/builders';
import { hhmm } from '../../test-support/hoursFixtures';

const HHMM = /^\d{2}:\d{2}$/;

// ---------------------------------------------------------------------------
// parseTimeInput
// ---------------------------------------------------------------------------

describe('parseTimeInput', () => {
  describe('accepted forms', () => {
    it.each([
      // H / HH -> whole hour, 24h
      ['9', '09:00'],
      ['09', '09:00'],
      ['17', '17:00'],
      ['0', '00:00'],
      ['00', '00:00'],
      ['23', '23:00'],
      // H:mm / HH:mm
      ['9:30', '09:30'],
      ['09:30', '09:30'],
      ['17:45', '17:45'],
      ['0:05', '00:05'],
      ['23:59', '23:59'],
      ['00:00', '00:00'],
      // H.mm / HH.mm
      ['5.30', '05:30'],
      ['17.15', '17:15'],
      // Hmm / HHmm (3-4 digits)
      ['930', '09:30'],
      ['1730', '17:30'],
      ['0930', '09:30'],
      ['0000', '00:00'],
      ['2359', '23:59'],
      ['1200', '12:00'],
      // 12h suffixes
      ['5pm', '17:00'],
      ['5 pm', '17:00'],
      ['5p', '17:00'],
      ['5 p.m.', '17:00'],
      ['5:30 PM', '17:30'],
      ['5:30pm', '17:30'],
      ['5.30pm', '17:30'],
      ['530pm', '17:30'],
      ['130pm', '13:30'],
      ['9a', '09:00'],
      ['9am', '09:00'],
      ['9 a.m.', '09:00'],
      ['9 A.M.', '09:00'],
      ['11:59pm', '23:59'],
      ['1am', '01:00'],
      ['12am', '00:00'],
      ['12pm', '12:00'],
      ['12:30a', '00:30'],
      ['12:30p', '12:30'],
      ['12:00pm', '12:00'],
      ['12:00am', '00:00'],
      ['1200am', '00:00'],
      ['1200pm', '12:00'],
      // words
      ['noon', '12:00'],
      ['midnight', '00:00'],
    ])('%p -> %p', (text, expected) => {
      expect(parseTimeInput(text)).toBe(expected);
    });
  });

  describe('case and space insensitivity', () => {
    it.each([
      ['5PM', '17:00'],
      ['5Pm', '17:00'],
      ['  5pm  ', '17:00'],
      ['5   pm', '17:00'],
      [' 17:30 ', '17:30'],
      ['NOON', '12:00'],
      ['  Midnight ', '00:00'],
      ['9 AM', '09:00'],
      ['12:30 A', '00:30'],
    ])('%p -> %p', (text, expected) => {
      expect(parseTimeInput(text)).toBe(expected);
    });
  });

  describe('rejections', () => {
    it.each([
      ['24'],
      ['24:00'],
      ['25'],
      ['99'],
      ['13pm'],
      ['17pm'],
      ['1730pm'],
      ['0pm'],
      ['0am'],
      ['00:00pm'],
      ['5:60'],
      ['5.60'],
      ['560'],
      ['2460'],
      ['12345'],
      ['abc'],
      ['five'],
      ['5x'],
      ['pm'],
      ['noonish'],
      ['-5'],
      ['5:30:00'],
      [''],
      ['   '],
    ])('%p -> null', (text) => {
      expect(parseTimeInput(text)).toBeNull();
    });
  });

  describe('properties', () => {
    // every valid (hour, minute) written in several accepted ways parses to the same HH:mm
    const timeArb = fc.record({
      h: fc.integer({ min: 0, max: 23 }),
      m: fc.integer({ min: 0, max: 59 }),
    });

    it('all written forms of a time normalise to the same zero-padded HH:mm', () => {
      fc.assert(
        fc.property(timeArb, ({ h, m }) => {
          const expected = hhmm(h * 60 + m);
          const mm = String(m).padStart(2, '0');
          const h12 = h % 12 === 0 ? 12 : h % 12;
          const suffix = h < 12 ? 'am' : 'pm';
          const forms = [
            `${h}:${mm}`,
            `${String(h).padStart(2, '0')}:${mm}`,
            `${h}.${mm}`,
            `${h}${mm}`, // Hmm / HHmm
            `${h12}:${mm}${suffix}`,
            `${h12}:${mm} ${suffix.toUpperCase()}`,
            `${h12}${mm}${suffix[0]}`,
          ];
          if (m === 0) forms.push(`${h}`, `${h12}${suffix}`);
          for (const f of forms)
            expect({ f, out: parseTimeInput(f) }).toEqual({ f, out: expected });
        }),
        { seed: 20261121, numRuns: 300 },
      );
    });

    it('any non-null output matches HH:mm and re-parsing it is a fixed point', () => {
      const textArb = fc.oneof(
        fc.string({ maxLength: 8 }),
        fc.stringMatching(/^\s?\d{1,5}([:.]\d{1,3})?\s?(a|am|a\.m\.|p|pm|p\.m\.|A|PM)?\s?$/),
        fc.constantFrom('noon', 'midnight', 'NOON', '12am', '12pm'),
      );
      fc.assert(
        fc.property(textArb, (text) => {
          const out = parseTimeInput(text);
          if (out === null) return;
          expect(out).toMatch(HHMM);
          const [hh, mm] = out.split(':').map(Number);
          expect(hh).toBeLessThanOrEqual(23);
          expect(mm).toBeLessThanOrEqual(59);
          expect(parseTimeInput(out)).toBe(out);
        }),
        { seed: 20261121, numRuns: 1000 },
      );
    });
  });
});

// ---------------------------------------------------------------------------
// parseHoursInput
// ---------------------------------------------------------------------------

describe('parseHoursInput', () => {
  it.each([
    ['6', 6],
    ['6.5', 6.5],
    ['6,5', 6.5],
    ['6:30', 6.5],
    ['6:15', 6.25],
    ['6:45', 6.75],
    ['6h', 6],
    ['6h30', 6.5],
    ['6h 30m', 6.5],
    ['6 hrs', 6],
    ['45m', 0.75],
    ['45 min', 0.75],
    ['.5', 0.5],
    ['0.25', 0.25],
    ['24', 24],
    ['12.75', 12.75],
    [' 6.5 ', 6.5],
  ])('%p -> %p', (text, expected) => {
    expect(parseHoursInput(text)).toBe(expected);
  });

  it.each([
    ['7:20', 7.33], // 7.333...
    ['6h20', 6.33],
    ['10m', 0.17], // 0.1666...
    ['20 min', 0.33],
    ['7.333', 7.33],
    ['7.336', 7.34],
    ['1:01', 1.02], // 1.01666...
  ])('rounds to 2 decimals: %p -> %p', (text, expected) => {
    expect(parseHoursInput(text)).toBe(expected);
  });

  it.each([
    ['0'],
    ['0.0'],
    ['0:00'],
    ['0h'],
    ['0m'],
    ['-1'],
    ['-6.5'],
    ['24.5'],
    ['25'],
    ['24:01'],
    ['abc'],
    ['six'],
    ['6.5.5'],
    ['h'],
    [''],
    ['   '],
  ])('%p -> null (must be > 0 and <= 24)', (text) => {
    expect(parseHoursInput(text)).toBeNull();
  });

  it('results always have at most 2 decimals', () => {
    fc.assert(
      fc.property(fc.double({ min: 0.001, max: 24, noNaN: true }), (x) => {
        const out = parseHoursInput(x.toFixed(5));
        if (out === null) return;
        expect(Math.round(out * 100) / 100).toBe(out);
        expect(out).toBeGreaterThan(0);
        expect(out).toBeLessThanOrEqual(24);
      }),
      { seed: 20261121, numRuns: 300 },
    );
  });
});

// ---------------------------------------------------------------------------
// clockHours
// ---------------------------------------------------------------------------

describe('clockHours', () => {
  it.each([
    ['09:00', '17:30', 8.5, false],
    ['00:00', '23:59', 23.98, false],
    ['09:00', '09:20', 0.33, false],
    ['17:00', '17:01', 0.02, false],
    ['20:00', '02:00', 6, true],
    ['22:30', '01:15', 2.75, true],
    ['23:59', '00:00', 0.02, true],
    ['17:01', '17:00', 23.98, true],
  ])('%p -> %p = %p h (overnight %p)', (cin, cout, hours, overnight) => {
    expect(clockHours(cin, cout)).toEqual({ hours, overnight });
  });

  it('equal times -> null (the engine rejects them as INVALID_CLOCK)', () => {
    expect(clockHours('20:00', '20:00')).toBeNull();
    expect(clockHours('00:00', '00:00')).toBeNull();
  });

  it.each([
    ['25:00', '01:00'],
    ['09:00', '9:60'],
    ['', '17:00'],
    ['09:00', ''],
    ['abc', '17:00'],
  ])('invalid input (%p, %p) -> null', (cin, cout) => {
    expect(clockHours(cin, cout)).toBeNull();
  });

  it('agrees with the engine memberHours for HH:mm pairs', () => {
    const m = (clockIn: string, clockOut: string): TeamMember => ({
      id: 'x',
      name: 'X',
      role: 'barback',
      clockIn,
      clockOut,
    });
    for (const [cin, cout] of [
      ['09:00', '17:30'],
      ['20:00', '02:00'],
      ['22:30', '01:15'],
    ] as const) {
      expect(clockHours(cin, cout)!.hours).toBeCloseTo(memberHours(m(cin, cout))!, 2);
    }
  });

  it('property: every pair of minutes-of-day matches the engine (rounded) and the overnight flag', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1439 }), fc.integer({ min: 0, max: 1439 }), (a, b) => {
        const cin = hhmm(a);
        const cout = hhmm(b);
        const got = clockHours(cin, cout);
        if (a === b) {
          expect(got).toBeNull();
          expect(() =>
            memberHours({ id: 'x', name: 'X', role: 'host', clockIn: cin, clockOut: cout }),
          ).toThrow();
          return;
        }
        const minutes = (b - a + 1440) % 1440;
        expect(got).toEqual({ hours: Math.round((minutes * 100) / 60) / 100, overnight: b < a });
        const engine = memberHours({
          id: 'x',
          name: 'X',
          role: 'host',
          clockIn: cin,
          clockOut: cout,
        })!;
        expect(Math.abs(got!.hours - engine)).toBeLessThanOrEqual(0.005 + 1e-9);
      }),
      { seed: 20261121, numRuns: 2000 },
    );
  });
});

// ---------------------------------------------------------------------------
// formatHours
// ---------------------------------------------------------------------------

describe('formatHours', () => {
  it.each([
    [6, '6 h'],
    [6.5, '6.5 h'],
    [6.25, '6.25 h'],
    [0.75, '0.75 h'],
    [6.1, '6.1 h'],
    [24, '24 h'],
    [6.333333, '6.33 h'],
    [7.336, '7.34 h'],
    [0.5, '0.5 h'],
  ])('%p -> %p', (h, text) => {
    expect(formatHours(h)).toBe(text);
  });

  it('never prints trailing zeros or more than 2 decimals', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 2400 }), (cents) => {
        const text = formatHours(cents / 100);
        expect(text).toMatch(/^\d+(\.\d?[1-9])? h$/);
      }),
      { seed: 20261121, numRuns: 500 },
    );
  });
});

// ---------------------------------------------------------------------------
// copyHoursToRole
// ---------------------------------------------------------------------------

describe('copyHoursToRole', () => {
  function team(): TeamMember[] {
    return deepFreeze([
      member('Joseph', 'bartender', { id: 'joseph', hours: 3 }),
      member('David', 'barback', { id: 'david', hours: 6.5 }),
      member('Allen', 'barback', { id: 'allen', clockIn: '20:00', clockOut: '02:00' }),
      member('Kim', 'barback', { id: 'kim' }),
      member('Hannah', 'host', { id: 'hannah', hours: 4 }),
      member('Me', 'bartender', { id: 'me', isUser: true }),
    ]);
  }
  const byId = (t: TeamMember[], id: string) => t.find((m) => m.id === id)!;

  it('copies total hours to every other member of the same role, clearing clock times', () => {
    const t = team();
    const out = copyHoursToRole(t, 'david');
    for (const id of ['allen', 'kim']) {
      const m = byId(out, id);
      expect(m.hours).toBe(6.5);
      expect(m.clockIn).toBeUndefined();
      expect(m.clockOut).toBeUndefined();
    }
    expect(byId(out, 'david')).toEqual(byId(t, 'david'));
  });

  it('copies clock times, clearing total hours (exactly one source of hours)', () => {
    const t = deepFreeze([
      member('David', 'barback', { id: 'david', hours: 6.5 }),
      member('Allen', 'barback', { id: 'allen', clockIn: '20:00', clockOut: '02:00' }),
      member('Kim', 'barback', { id: 'kim' }),
    ]);
    const out = copyHoursToRole(t, 'allen');
    for (const id of ['david', 'kim']) {
      const m = byId(out, id);
      expect(m.clockIn).toBe('20:00');
      expect(m.clockOut).toBe('02:00');
      expect(m.hours).toBeUndefined();
    }
  });

  it('members of other roles are untouched; ids, names, roles and isUser are kept', () => {
    const t = team();
    const out = copyHoursToRole(t, 'david');
    for (const id of ['joseph', 'hannah', 'me']) expect(byId(out, id)).toEqual(byId(t, id));
    expect(out.map((m) => [m.id, m.name, m.role, m.isUser])).toEqual(
      t.map((m) => [m.id, m.name, m.role, m.isUser]),
    );
  });

  it('never mutates its input (deep-frozen team) and returns a new array', () => {
    const t = team();
    const before = JSON.stringify(t);
    const out = copyHoursToRole(t, 'allen');
    expect(out).not.toBe(t);
    expect(JSON.stringify(t)).toBe(before);
  });

  it('the copied team computes the same hours for every member of the role', () => {
    const out = copyHoursToRole(team(), 'allen');
    const barbacks = out.filter((m) => m.role === 'barback');
    expect(barbacks.map((m) => memberHours(m))).toEqual([6, 6, 6]);
  });

  it('an unknown id returns an unchanged copy', () => {
    const t = team();
    const out = copyHoursToRole(t, 'nobody');
    expect(out).toEqual(t);
    expect(out).not.toBe(t);
  });

  it('a role with one member is unchanged', () => {
    const t = team();
    expect(copyHoursToRole(t, 'hannah')).toEqual(t);
  });
});
