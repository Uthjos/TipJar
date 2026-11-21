/**
 * Milestone 7 acceptance: CSV export (docs/m7-contract.md "CSV — src/lib/csv.ts").
 * Includes a small RFC 4180 parser so quoting is checked by round-trip, not by string matching.
 */
import * as fc from 'fast-check';
import { calculateShift } from '../../engine/calculate';
import { BARTENDER_DEFAULT_PROFILE, SERVER_DEFAULT_PROFILE } from '../../engine/profiles';
import type { ShiftInput, TeamMember } from '../../engine/types';
import type { SavedShift } from '../../db/repositories';
import { centsToCsv, csvEscape, payoutsCsv, shiftsCsv } from '../csv';
import { userEarnings } from '../earnings';
import { at, golden1Input, member, shiftInput, sum } from '../../test-support/builders';
import { saved, weekShifts } from '../../test-support/historyFixtures';

// ---------------------------------------------------------------------------
// a minimal RFC 4180 parser (test-only)
// ---------------------------------------------------------------------------

/** Parse CSV text into rows of fields. Requires CRLF record separators. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let i = 0;
  let quoted = false;
  while (i < text.length) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      if (field !== '') throw new Error(`quote inside unquoted field at ${i}`);
      quoted = true;
      i++;
    } else if (ch === ',') {
      row.push(field);
      field = '';
      i++;
    } else if (ch === '\r' && text[i + 1] === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += 2;
    } else if (ch === '\n' || ch === '\r') {
      throw new Error(`bare line break outside quotes at ${i}`);
    } else {
      field += ch;
      i++;
    }
  }
  if (quoted) throw new Error('unterminated quoted field');
  if (field !== '' || row.length > 0) throw new Error('file does not end with CRLF');
  return rows;
}

const SHIFTS_HEADER = [
  'date',
  'profile',
  'user_role',
  'total_tips',
  'net_sales',
  'food_sales',
  'tipped_out',
  'kept',
  'you_earned',
  'retained',
  'rounding_adjustment',
  'kept_change',
  'rounded_to_dollar',
  'shift_id',
];
const PAYOUTS_HEADER = ['date', 'role', 'name', 'hours', 'amount', 'kind', 'shift_id'];
const NAMES: Record<string, string> = {
  'server-default': 'Server default',
  'bartender-default': 'Bartender default',
  patio: 'Patio, late',
};
const profileName = (id: string) => NAMES[id];
const identity = (r: string) => r;
const toCents = (s: string) => Math.round(Number(s) * 100);

// ---------------------------------------------------------------------------
// csvEscape / centsToCsv
// ---------------------------------------------------------------------------

describe('csvEscape', () => {
  it.each([
    ['plain', 'plain'],
    ['', ''],
    ['Joseph', 'Joseph'],
    ['a,b', '"a,b"'],
    ['say "hi"', '"say ""hi"""'],
    ['"', '""""'],
    ['a\nb', '"a\nb"'],
    ['a\rb', '"a\rb"'],
    ['a\r\nb', '"a\r\nb"'],
    [' lead', '" lead"'],
    ['trail ', '"trail "'],
    ['in side', 'in side'],
    ["O'Brien", "O'Brien"],
    ['Zoë', 'Zoë'],
  ])('%p -> %p', (input, expected) => {
    expect(csvEscape(input)).toBe(expected);
  });

  it('null and undefined -> empty', () => {
    expect(csvEscape(null)).toBe('');
    expect(csvEscape(undefined)).toBe('');
  });

  it('numbers are written plainly', () => {
    expect(csvEscape(123)).toBe('123');
    expect(csvEscape(12.5)).toBe('12.5');
    expect(csvEscape(0)).toBe('0');
    expect(csvEscape(-5)).toBe('-5');
  });

  it('any string round-trips through the parser as a single field', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 20 }), fc.string({ maxLength: 20 }), (a, b) => {
        const line = `${csvEscape(a)},${csvEscape(b)}\r\n`;
        expect(parseCsv(line)).toEqual([[a, b]]);
      }),
      { seed: 20261121, numRuns: 500 },
    );
  });
});

describe('centsToCsv', () => {
  it.each([
    [12345, '123.45'],
    [-5, '-0.05'],
    [0, '0.00'],
    [5, '0.05'],
    [50, '0.50'],
    [100, '1.00'],
    [-12345, '-123.45'],
    [123456789, '1234567.89'], // no thousands separators
  ])('%p -> %p', (c, s) => {
    expect(centsToCsv(c)).toBe(s);
  });

  it('round-trips any integer cents', () => {
    fc.assert(
      fc.property(fc.integer({ min: -10_000_000, max: 10_000_000 }), (c) => {
        const s = centsToCsv(c);
        expect(s).toMatch(/^-?\d+\.\d{2}$/);
        expect(toCents(s)).toBe(c);
      }),
      { seed: 20261121, numRuns: 500 },
    );
  });
});

// ---------------------------------------------------------------------------
// shiftsCsv
// ---------------------------------------------------------------------------

describe('shiftsCsv', () => {
  const text = shiftsCsv(weekShifts().slice(0, 3), { profileName });

  it('uses CRLF line endings, a trailing CRLF and the exact header', () => {
    expect(text.endsWith('\r\n')).toBe(true);
    expect(text.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    expect(text.split('\r\n')[0]).toBe(SHIFTS_HEADER.join(','));
  });

  it('writes one row per shift with money in dollars and yes/no', () => {
    expect(parseCsv(text)).toEqual([
      SHIFTS_HEADER,
      // Golden 1: pool 10100, kept 23956, rounding 17 + 100 held
      [
        '2026-11-16',
        'Server default',
        'server',
        '340.56',
        '1560.25',
        '700.12',
        '101.00',
        '239.56',
        '239.56',
        '0.00',
        '1.17',
        '0.00',
        'yes',
        'g1',
      ],
      // Golden 2 retain (Joseph isUser): you_earned = 7500 + change 55
      [
        '2026-11-18',
        'Bartender default',
        'bartender',
        '192.55',
        '905.43',
        '120.00',
        '42.00',
        '150.55',
        '75.55',
        '14.00',
        '1.77',
        '0.55',
        'yes',
        'g2',
      ],
      // Busser profile, rounding off; the profile name contains a comma
      [
        '2026-11-21',
        'Patio, late',
        'server',
        '400.00',
        '2000.00',
        '800.00',
        '120.00',
        '280.00',
        '280.00',
        '0.00',
        '0.00',
        '0.00',
        'no',
        'pat',
      ],
    ]);
  });

  it('a profile name containing a comma is quoted', () => {
    expect(text).toContain(',"Patio, late",');
  });

  it('falls back to the profile id when the name is unknown (or no lookup is given)', () => {
    const rows = parseCsv(shiftsCsv(weekShifts().slice(0, 3), { profileName: () => undefined }));
    expect(rows.slice(1).map((r) => r[1])).toEqual([
      'server-default',
      'bartender-default',
      'patio',
    ]);
    const bare = parseCsv(shiftsCsv(weekShifts().slice(0, 3)));
    expect(bare.slice(1).map((r) => r[1])).toEqual([
      'server-default',
      'bartender-default',
      'patio',
    ]);
  });

  it('orders shifts by date (oldest first), then savedAt', () => {
    const base = weekShifts();
    const shifts: SavedShift[] = [
      { ...at(base, 2), id: 'late' },
      { ...at(base, 0), id: 'same-day-2', savedAt: '2026-11-16T22:00:00.000Z' },
      { ...at(base, 1), id: 'mid' },
      { ...at(base, 0), id: 'same-day-1', savedAt: '2026-11-16T08:00:00.000Z' },
    ];
    const ids = parseCsv(shiftsCsv(shifts))
      .slice(1)
      .map((r) => r[13]);
    expect(ids).toEqual(['same-day-1', 'same-day-2', 'mid', 'late']);
  });

  it('no shifts: just the header line', () => {
    expect(shiftsCsv([])).toBe(`${SHIFTS_HEADER.join(',')}\r\n`);
  });
});

// ---------------------------------------------------------------------------
// payoutsCsv
// ---------------------------------------------------------------------------

describe('payoutsCsv', () => {
  const sorted = (rows: string[][]) =>
    [...rows].sort((a, b) => a.join('|').localeCompare(b.join('|')));

  it('exact header, CRLF and trailing CRLF', () => {
    const text = payoutsCsv(weekShifts().slice(0, 2), { roleLabel: identity });
    expect(text.split('\r\n')[0]).toBe(PAYOUTS_HEADER.join(','));
    expect(text.endsWith('\r\n')).toBe(true);
    expect(payoutsCsv([])).toBe(`${PAYOUTS_HEADER.join(',')}\r\n`);
  });

  it('Golden 1 (server): a role row for kitchen and a paid row per member; hours blank', () => {
    const rows = parseCsv(payoutsCsv([at(weekShifts(), 0)], { roleLabel: identity })).slice(1);
    expect(sorted(rows)).toEqual(
      sorted([
        ['2026-11-16', 'kitchen', '', '', '14.00', 'role', 'g1'],
        ['2026-11-16', 'bartender', 'Joseph', '', '22.00', 'paid', 'g1'],
        ['2026-11-16', 'bartender', 'Aaron', '', '22.00', 'paid', 'g1'],
        ['2026-11-16', 'barback', 'David', '', '16.00', 'paid', 'g1'],
        ['2026-11-16', 'barback', 'Allen', '', '16.00', 'paid', 'g1'],
        ['2026-11-16', 'host', 'Hannah', '', '11.00', 'paid', 'g1'],
      ]),
    );
  });

  it('Golden 2 (bartender): role, paid, retained and bar_split rows', () => {
    const rows = parseCsv(payoutsCsv([at(weekShifts(), 1)], { roleLabel: identity })).slice(1);
    expect(sorted(rows)).toEqual(
      sorted([
        ['2026-11-18', 'kitchen', '', '', '2.00', 'role', 'g2'],
        ['2026-11-18', 'barback', 'David', '', '20.00', 'paid', 'g2'],
        ['2026-11-18', 'barback', 'Allen', '', '20.00', 'paid', 'g2'],
        ['2026-11-18', 'host', '', '', '14.00', 'retained', 'g2'],
        ['2026-11-18', 'bartender', 'Joseph', '', '75.00', 'bar_split', 'g2'], // the user too
        ['2026-11-18', 'bartender', 'Aaron', '', '75.00', 'bar_split', 'g2'],
      ]),
    );
  });

  it('hours: blank when not entered, otherwise up to 2 decimals without trailing zeros', () => {
    const team: TeamMember[] = [
      member('Joseph', 'bartender', { id: 'joseph', hours: 6.5 }),
      member('Aaron', 'bartender', { id: 'aaron', hours: 3.25 }),
      member('David', 'barback', { id: 'david', hours: 7.333 }),
      member('Allen', 'barback', { id: 'allen', hours: 2 }),
      member('Hannah', 'host', { id: 'hannah', clockIn: '20:00', clockOut: '02:00' }), // 6h
    ];
    const s = saved(
      'h',
      golden1Input({ date: '2026-11-16', team, roundToDollar: false }),
      SERVER_DEFAULT_PROFILE,
    );
    const rows = parseCsv(payoutsCsv([s], { roleLabel: identity })).slice(1);
    const hoursOf = (name: string) => rows.find((r) => r[2] === name)![3];
    expect(hoursOf('Joseph')).toBe('6.5');
    expect(hoursOf('Aaron')).toBe('3.25');
    expect(hoursOf('David')).toBe('7.33');
    expect(hoursOf('Allen')).toBe('2');
    expect(hoursOf('Hannah')).toBe('6');
    expect(rows.find((r) => r[5] === 'role')![3]).toBe('');
  });

  it('the role column uses the roleLabel option; the default is the app’s role label', () => {
    const custom = parseCsv(
      payoutsCsv([at(weekShifts(), 2)], { roleLabel: (r) => `<${r}>` }),
    ).slice(1);
    expect(custom.map((r) => r[1])).toContain('<busser>');
    const dflt = parseCsv(payoutsCsv([at(weekShifts(), 0)])).slice(1);
    // ASSUMPTION (findings #85): default = roleLabel() from engine/profiles.ts
    expect(dflt.find((r) => r[5] === 'role')![1]).toBe('Kitchen (KTO)');
    expect(dflt.find((r) => r[2] === 'David')![1]).toBe('Barbacks');
  });

  it('rows come in shift date order (oldest first)', () => {
    const shifts = [...weekShifts()].reverse();
    const ids = parseCsv(payoutsCsv(shifts, { roleLabel: identity }))
      .slice(1)
      .map((r) => r[6]!);
    const firstIndex = (id: string) => ids.indexOf(id);
    expect(firstIndex('g1')).toBeLessThan(firstIndex('g2'));
    expect(firstIndex('g2')).toBeLessThan(firstIndex('pat'));
    expect(firstIndex('pat')).toBeLessThan(firstIndex('out'));
    // each shift's rows are contiguous
    const runs = ids.filter((id, i) => i === 0 || ids[i - 1] !== id);
    expect(runs).toEqual(['g1', 'g2', 'pat', 'out']);
  });

  it('for every shift, paid + role rows = tipped_out (fixtures)', () => {
    const shifts = weekShifts();
    const payouts = parseCsv(payoutsCsv(shifts, { roleLabel: identity })).slice(1);
    const summary = parseCsv(shiftsCsv(shifts)).slice(1);
    for (const row of summary) {
      const id = row[13]!;
      const paid = sum(
        payouts
          .filter((p) => p[6] === id && (p[5] === 'paid' || p[5] === 'role'))
          .map((p) => toCents(p[4]!)),
      );
      expect({ id, paid }).toEqual({ id, paid: toCents(row[6]!) });
    }
  });
});

describe('names with commas, quotes and newlines round-trip', () => {
  const awkward = ['O"Brien, Jr.', 'Line\nBreak', '  Padded  ', 'Comma, Only', 'Zoë "Z"'];

  it('payoutsCsv', () => {
    const team: TeamMember[] = [
      member(at(awkward, 0), 'bartender', { id: 'a' }),
      member(at(awkward, 1), 'bartender', { id: 'b' }),
      member(at(awkward, 2), 'barback', { id: 'c' }),
      member(at(awkward, 3), 'barback', { id: 'd' }),
      member(at(awkward, 4), 'host', { id: 'e' }),
    ];
    const s = saved(
      'weird,"id"',
      golden1Input({ date: '2026-11-16', team }),
      SERVER_DEFAULT_PROFILE,
    );
    const rows = parseCsv(payoutsCsv([s], { roleLabel: identity })).slice(1);
    expect(
      rows
        .filter((r) => r[5] === 'paid')
        .map((r) => r[2])
        .sort(),
    ).toEqual([...awkward].sort());
    expect(new Set(rows.map((r) => r[6]))).toEqual(new Set(['weird,"id"']));
  });

  it('shiftsCsv profile names', () => {
    const s = saved('x', golden1Input({ date: '2026-11-16' }), SERVER_DEFAULT_PROFILE);
    const rows = parseCsv(shiftsCsv([s], { profileName: () => 'Bar "A", upstairs\nnights' }));
    expect(at(rows, 1)[1]).toBe('Bar "A", upstairs\nnights');
    expect(at(rows, 1)).toHaveLength(SHIFTS_HEADER.length);
  });
});

// ---------------------------------------------------------------------------
// property: per-shift sums over random calculated shifts
// ---------------------------------------------------------------------------

const caseArb = fc.record({
  flow: fc.constantFrom('server' as const, 'bartender' as const),
  day: fc.integer({ min: 1, max: 28 }),
  totalTips: fc.integer({ min: 0, max: 300_000 }),
  netSales: fc.integer({ min: 0, max: 1_500_000 }),
  foodPct: fc.integer({ min: 0, max: 100 }),
  counts: fc.array(fc.integer({ min: 0, max: 3 }), { minLength: 3, maxLength: 3 }),
  withHours: fc.boolean(),
  quarterHours: fc.array(fc.integer({ min: 1, max: 48 }), { minLength: 9, maxLength: 9 }),
  roundToDollar: fc.boolean(),
  missingRoleHandling: fc.constantFrom('redistribute' as const, 'retain' as const),
  userIsBartender: fc.boolean(),
});

function build(i: number, c: typeof caseArb extends fc.Arbitrary<infer T> ? T : never): SavedShift {
  const team: TeamMember[] = [];
  let n = 0;
  ['bartender', 'barback', 'host'].forEach((role, ri) => {
    for (let k = 0; k < at(c.counts, ri); k++) {
      const m: TeamMember = { id: `${role}-${k}`, name: `${role} ${k}, "x"`, role };
      if (c.withHours) m.hours = at(c.quarterHours, n % 9) / 4;
      if (c.flow === 'bartender' && role === 'bartender' && k === 0 && c.userIsBartender)
        m.isUser = true;
      team.push(m);
      n++;
    }
  });
  const input: ShiftInput = shiftInput({
    date: `2026-11-${String(c.day).padStart(2, '0')}`,
    userRole: c.flow,
    totalTips: c.totalTips,
    netSales: c.netSales,
    foodSales: Math.floor((c.netSales * c.foodPct) / 100),
    team,
    missingRoleHandling: c.missingRoleHandling,
    roundToDollar: c.roundToDollar,
  });
  const profile = c.flow === 'server' ? SERVER_DEFAULT_PROFILE : BARTENDER_DEFAULT_PROFILE;
  return {
    id: `s${i}`,
    savedAt: `2026-11-${String(c.day).padStart(2, '0')}T1${i % 10}:00:00.000Z`,
    input,
    result: calculateShift(input, profile).result,
  };
}

describe('property: CSV sums match each shift', () => {
  it('paid + role = tipped_out; retained rows = retained; bar_split + kept_change = kept; you_earned', () => {
    fc.assert(
      fc.property(fc.array(caseArb, { minLength: 1, maxLength: 8 }), (cases) => {
        const shifts = cases.map((c, i) => build(i, c));
        const summary = parseCsv(shiftsCsv(shifts)).slice(1);
        const payouts = parseCsv(payoutsCsv(shifts, { roleLabel: identity })).slice(1);
        expect(summary).toHaveLength(shifts.length);
        for (const p of payouts) {
          expect(p).toHaveLength(PAYOUTS_HEADER.length);
          expect(['paid', 'role', 'retained', 'bar_split']).toContain(p[5]);
          expect(p[3]).toMatch(/^(|\d+(\.\d?[1-9])?)$/);
        }
        for (const row of summary) {
          expect(row).toHaveLength(SHIFTS_HEADER.length);
          const id = row[13]!;
          const shift = shifts.find((x) => x.id === id)!;
          const mine = payouts.filter((p) => p[6] === id);
          const total = (kinds: string[]) =>
            sum(mine.filter((p) => kinds.includes(p[5]!)).map((p) => toCents(p[4]!)));
          expect(total(['paid', 'role'])).toBe(toCents(row[6]!));
          expect(total(['retained'])).toBe(toCents(row[9]!));
          if (shift.input.userRole === 'bartender') {
            expect(total(['bar_split']) + toCents(row[11]!)).toBe(toCents(row[7]!));
          } else {
            expect(total(['bar_split'])).toBe(0);
          }
          expect(row[8]).toBe(centsToCsv(userEarnings(shift.input, shift.result)));
          expect(row[12]).toBe(shift.input.roundToDollar ? 'yes' : 'no');
        }
      }),
      { seed: 20261121, numRuns: 200 },
    );
  });
});
