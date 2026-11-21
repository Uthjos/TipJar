import type { SavedShift } from '@/db/repositories';
import { calculateShift } from '@/engine/calculate';
import { BARTENDER_DEFAULT_PROFILE, SERVER_DEFAULT_PROFILE } from '@/engine/profiles';
import type { ShiftInput } from '@/engine/types';
import { centsToCsv, csvEscape, payoutsCsv, shiftsCsv } from '@/lib/csv';
import { userEarnings } from '@/lib/earnings';
import { inRange, periodRange, shiftPeriod, summarize } from '@/lib/history';

function serverShift(id: string, date: string, savedAt = `${date}T23:00:00.000Z`): SavedShift {
  const input: ShiftInput = {
    date,
    userRole: 'server',
    totalTips: 34056,
    netSales: 156025,
    foodSales: 70012,
    team: [
      { id: `${id}-j`, name: 'Joseph', role: 'bartender', hours: 6 },
      { id: `${id}-a`, name: 'Aaron', role: 'bartender', hours: 2 },
      { id: `${id}-d`, name: 'David', role: 'barback' },
    ],
    missingRoleHandling: 'retain',
    profileId: 'server-default',
    roundToDollar: true,
  };
  return { id, savedAt, input, result: calculateShift(input, SERVER_DEFAULT_PROFILE).result };
}

function bartenderShift(id: string, date: string): SavedShift {
  const input: ShiftInput = {
    date,
    userRole: 'bartender',
    totalTips: 19255,
    netSales: 90543,
    foodSales: 12000,
    team: [
      { id: `${id}-me`, name: 'Me', role: 'bartender', isUser: true },
      { id: `${id}-a`, name: 'aaron ', role: 'bartender' },
      { id: `${id}-d`, name: 'David', role: 'barback' },
    ],
    missingRoleHandling: 'retain',
    profileId: 'bartender-default',
    roundToDollar: true,
  };
  return {
    id,
    savedAt: `${date}T23:00:00.000Z`,
    input,
    result: calculateShift(input, BARTENDER_DEFAULT_PROFILE).result,
  };
}

describe('periods', () => {
  it('builds week / month / year ranges and labels', () => {
    expect(periodRange('week', '2026-11-18')).toEqual({
      period: 'week',
      from: '2026-11-15',
      to: '2026-11-21',
      label: 'Nov 15 – 21, 2026',
    });
    expect(periodRange('week', '2026-11-18', 1).from).toBe('2026-11-16');
    expect(periodRange('week', '2026-12-01').label).toBe('Nov 29 – Dec 5, 2026');
    expect(periodRange('week', '2026-12-30').label).toBe('Dec 27, 2026 – Jan 2, 2027');
    expect(periodRange('month', '2026-02-10')).toEqual({
      period: 'month',
      from: '2026-02-01',
      to: '2026-02-28',
      label: 'February 2026',
    });
    expect(periodRange('year', '2026-06-01').label).toBe('2026');
  });

  it('steps and checks ranges', () => {
    const w = periodRange('week', '2026-11-18');
    expect(shiftPeriod(w, -1).from).toBe('2026-11-08');
    expect(shiftPeriod(w, 1).to).toBe('2026-11-28');
    expect(shiftPeriod(periodRange('month', '2026-01-15'), -1).label).toBe('December 2025');
    expect(inRange('2026-11-21', w)).toBe(true);
    expect(inRange('2026-11-22', w)).toBe(false);
  });
});

describe('summarize', () => {
  const shifts = [
    serverShift('s1', '2026-11-16'),
    serverShift('s2', '2026-11-18'),
    bartenderShift('b1', '2026-11-18'),
    serverShift('old', '2026-10-01'),
  ];

  it('totals, average and a full week series', () => {
    const range = periodRange('week', '2026-11-18');
    const s = summarize(shifts, range);
    const inWeek = shifts.slice(0, 3);
    const earned = inWeek.reduce((a, x) => a + userEarnings(x.input, x.result), 0);
    expect(s.shiftCount).toBe(3);
    expect(s.earned).toBe(earned);
    expect(s.tippedOut).toBe(inWeek.reduce((a, x) => a + x.result.pool, 0));
    expect(s.totalTips).toBe(34056 * 2 + 19255);
    expect(s.averageEarned).toBe(Math.round(earned / 3));
    expect(s.series.map((b) => b.label)).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
    expect(s.series.reduce((a, b) => a + b.earned, 0)).toBe(earned);
    expect(s.series[0]!.earned).toBe(0);
  });

  it('by role and by coworker (not the bar split, not the user)', () => {
    const s = summarize(shifts, periodRange('week', '2026-11-18'));
    expect(s.byRole.map((r) => r.role)).toEqual(['barback', 'bartender', 'kitchen']);
    expect(s.byRole[0]!.amount).toBeGreaterThanOrEqual(s.byRole[1]!.amount);
    expect(s.byRole[0]!.shifts).toBe(3);
    expect(s.byRole[1]!.shifts).toBe(2);
    const names = s.byCoworker.map((c) => c.name);
    expect(names).toContain('Joseph');
    expect(names).toContain('David');
    expect(names).not.toContain('Me');
    // "aaron " in the bar split is not a tip-out; Aaron the server-flow bartender is.
    const aaron = s.byCoworker.find((c) => c.key === 'aaron')!;
    expect(aaron.shifts).toBe(2);
    const david = s.byCoworker.find((c) => c.key === 'david')!;
    expect(david.roles).toEqual(['barback']);
    expect(david.shifts).toBe(3);
  });

  it('month and year series cover every bucket', () => {
    const m = summarize(shifts, periodRange('month', '2026-11-18'));
    expect(m.series).toHaveLength(30);
    expect(m.series[17]!.key).toBe('2026-11-18');
    const y = summarize(shifts, periodRange('year', '2026-11-18'));
    expect(y.series.map((b) => b.key)[10]).toBe('2026-11');
    expect(y.shiftCount).toBe(4);
    expect(y.series.reduce((a, b) => a + b.earned, 0)).toBe(y.earned);
    expect(summarize([], periodRange('week', '2026-11-18')).averageEarned).toBe(0);
  });
});

describe('csv', () => {
  it('escapes and formats money', () => {
    expect(csvEscape('plain')).toBe('plain');
    expect(csvEscape('a,b')).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape(' pad')).toBe('" pad"');
    expect(csvEscape('line\nbreak')).toBe('"line\nbreak"');
    expect(csvEscape(null)).toBe('');
    expect(csvEscape(12)).toBe('12');
    expect(centsToCsv(12345)).toBe('123.45');
    expect(centsToCsv(-5)).toBe('-0.05');
    expect(centsToCsv(0)).toBe('0.00');
  });

  it('#88: text starting with = + - @ is prefixed; numbers and money are not', () => {
    expect(csvEscape('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvEscape('+1')).toBe("'+1");
    expect(csvEscape('-x')).toBe("'-x");
    expect(csvEscape('@me, you')).toBe(`"'@me, you"`);
    expect(csvEscape(-5)).toBe('-5');
    const s = serverShift('neg', '2026-11-16');
    const csv = payoutsCsv([{ ...s, input: { ...s.input, team: [] } }]);
    expect(csv).not.toContain("'-");
    const evil = serverShift('e', '2026-11-16');
    evil.result.roles[1]!.members[0]!.name = '=HYPERLINK("x")';
    expect(payoutsCsv([evil])).toContain(`"'=HYPERLINK(""x"")"`);
  });

  it('shiftsCsv: header, oldest first, CRLF', () => {
    const csv = shiftsCsv([serverShift('b', '2026-11-18'), serverShift('a', '2026-11-16')], {
      profileName: (id) => (id === 'server-default' ? 'Server, default' : undefined),
    });
    const lines = csv.split('\r\n');
    expect(csv.endsWith('\r\n')).toBe(true);
    expect(lines[0]).toBe(
      'date,profile,user_role,total_tips,net_sales,food_sales,tipped_out,kept,you_earned,retained,rounding_adjustment,kept_change,rounded_to_dollar,shift_id',
    );
    expect(lines[1]!.startsWith('2026-11-16,"Server, default",server,340.56,1560.25,700.12,')).toBe(
      true,
    );
    expect(lines[1]!.endsWith(',yes,a')).toBe(true);
    expect(lines).toHaveLength(4); // header + 2 rows + trailing ''
  });

  it('payoutsCsv: paid + role rows sum to tipped_out; bar split listed', () => {
    const shifts = [serverShift('s', '2026-11-16'), bartenderShift('b', '2026-11-18')];
    const rows = payoutsCsv(shifts)
      .split('\r\n')
      .slice(1)
      .filter(Boolean)
      .map((l) => l.split(','));
    for (const s of shifts) {
      const sum = rows
        .filter((r) => r[6] === s.id && (r[5] === 'paid' || r[5] === 'role'))
        .reduce((a, r) => a + Math.round(Number(r[4]) * 100), 0);
      expect(sum).toBe(s.result.pool);
    }
    expect(rows.find((r) => r[2] === 'Joseph')!.slice(1, 4)).toEqual(['Bartenders', 'Joseph', '6']);
    expect(rows.filter((r) => r[5] === 'bar_split').map((r) => r[2])).toEqual(['Me', '"aaron "']);
    expect(rows.find((r) => r[5] === 'retained')![1]).toBe('Hosts');
    expect(rows.find((r) => r[5] === 'role')![1]).toBe('Kitchen (KTO)');
  });
});
