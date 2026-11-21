/**
 * Milestone 7 decisions from the main-branch review (docs/review-log.md, round 7).
 * Finding numbers (#n) refer to docs/test-findings.md.
 */
import { BARTENDER_DEFAULT_PROFILE, SERVER_DEFAULT_PROFILE } from '@/engine/profiles';
import { payoutsCsv } from '@/lib/csv';
import { displayPeriodLabel, periodRange, summarize } from '@/lib/history';
import { todayIso } from '@/store/shiftStore';
import { golden1Input, golden2Input, member } from '@/test-support/builders';
import { golden2UserTeam, saved } from '@/test-support/historyFixtures';

/** Rows of a CSV without the header (simple split: no quoted fields in these fixtures). */
const rows = (csv: string) =>
  csv
    .split('\r\n')
    .slice(1)
    .filter((l) => l !== '')
    .map((l) => l.split(','));

describe('#81: History headings drop the current year', () => {
  const today = '2026-11-21';
  it.each([
    [periodRange('week', '2026-11-18'), 'Nov 15 – 21'],
    [periodRange('week', '2026-12-01'), 'Nov 29 – Dec 5'],
    [periodRange('month', '2026-11-18'), 'November'],
    [periodRange('year', '2026-11-18'), '2026'],
  ])('current year: %#', (range, label) => {
    expect(displayPeriodLabel(range, today)).toBe(label);
  });

  it('keeps the year for other years and for weeks spanning two years', () => {
    const lastYear = periodRange('month', '2025-11-18');
    expect(displayPeriodLabel(lastYear, today)).toBe(lastYear.label);
    const span = periodRange('week', '2026-12-30');
    expect(displayPeriodLabel(span, today)).toBe(span.label);
    expect(span.label).toContain('2027');
  });
});

describe('#90: "today" is the device-local date', () => {
  afterEach(() => jest.useRealTimers());
  it('late evening local time is still today, whatever the UTC date', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 10, 21, 23, 30)); // local 21 Nov, 23:30
    expect(todayIso()).toBe('2026-11-21');
    jest.setSystemTime(new Date(2026, 10, 22, 0, 15)); // local 22 Nov, 00:15
    expect(todayIso()).toBe('2026-11-22');
  });
});

describe('payoutsCsv row rules (implementer interpretation 1, #85)', () => {
  it('Golden 2 retain with Joseph as the user: kitchen role row, paid rows, retained host, bar_split incl. the user', () => {
    const s = saved(
      'g2',
      golden2Input({ team: golden2UserTeam(), missingRoleHandling: 'retain' }),
      BARTENDER_DEFAULT_PROFILE,
    );
    const r = rows(payoutsCsv([s]));
    expect(r.map((x) => [x[1], x[2], x[4], x[5]])).toEqual([
      ['Kitchen (KTO)', '', '2.00', 'role'],
      ['Barbacks', 'David', '20.00', 'paid'],
      ['Barbacks', 'Allen', '20.00', 'paid'],
      ['Hosts', '', '14.00', 'retained'],
      ['Bartenders', 'Joseph', '75.00', 'bar_split'],
      ['Bartenders', 'Aaron', '75.00', 'bar_split'],
    ]);
  });

  it('a $0 kitchen role and a $0 member still get rows; a $0 retained share does not', () => {
    // No food sales -> kitchen $0. Tips $10 -> pool $3 -> hosts' share rounds to $0 (Hannah $0).
    const s = saved(
      'z',
      golden1Input({ totalTips: 1000, netSales: 1000, foodSales: 0 }),
      SERVER_DEFAULT_PROFILE,
    );
    const r = rows(payoutsCsv([s]));
    expect(r).toContainEqual(['2026-11-17', 'Kitchen (KTO)', '', '', '0.00', 'role', 'z']);
    expect(r).toContainEqual(['2026-11-17', 'Hosts', 'Hannah', '', '0.00', 'paid', 'z']);

    // Redistributed missing host: amount 0, so no retained row.
    const noHost = saved(
      'r',
      golden1Input({
        team: [member('Joseph', 'bartender'), member('David', 'barback')],
        missingRoleHandling: 'redistribute',
      }),
      SERVER_DEFAULT_PROFILE,
    );
    expect(rows(payoutsCsv([noHost])).some((x) => x[5] === 'retained')).toBe(false);
  });
});

describe('#84: byCoworker shift counting (implementer behaviour)', () => {
  it('a person in two roles on one shift counts once, with both roles', () => {
    const team = [member('Joseph', 'bartender'), member('Sam', 'barback'), member('Sam', 'host')];
    const s = saved('one', golden1Input({ team }), SERVER_DEFAULT_PROFILE);
    const range = periodRange('week', '2026-11-17');
    const sam = summarize([s], range).byCoworker.find((c) => c.name === 'Sam')!;
    expect(sam.shifts).toBe(1);
    expect(sam.roles).toEqual(['barback', 'host']);
  });

  it('a $0 share in a paid role still counts as a shift worked', () => {
    // Tips $10 -> pool $3 -> bartenders $2 split 10 h : 0.1 h -> Joseph $2, Aaron $0.
    const tiny = saved(
      'tiny',
      golden1Input({
        totalTips: 1000,
        netSales: 1000,
        foodSales: 0,
        team: [
          member('Joseph', 'bartender', { hours: 10 }),
          member('Aaron', 'bartender', { hours: 0.1 }),
        ],
      }),
      SERVER_DEFAULT_PROFILE,
    );
    const normal = saved('g1', golden1Input({ date: '2026-11-18' }), SERVER_DEFAULT_PROFILE);
    const aaron = summarize([tiny, normal], periodRange('week', '2026-11-17')).byCoworker.find(
      (c) => c.name === 'Aaron',
    )!;
    expect(aaron.amount).toBe(2200);
    expect(aaron.shifts).toBe(2);
  });
});
