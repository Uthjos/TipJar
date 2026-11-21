/**
 * Milestone 6 acceptance: checkTeamHours (docs/m6-contract.md "HoursIssue" / checkTeamHours).
 */
import * as fc from 'fast-check';
import { calculateShift, EngineValidationError } from '../../engine/calculate';
import { BARTENDER_DEFAULT_PROFILE, SERVER_DEFAULT_PROFILE } from '../../engine/profiles';
import type { ShiftInput, TipOutProfile } from '../../engine/types';
import { checkTeamHours, type HoursIssue } from '../hoursInput';
import { at } from '../../test-support/builders';
import { commitTeamHours, hhmm, type DraftMember } from '../../test-support/hoursFixtures';

const d = (id: string, role: string, extra: Partial<DraftMember> = {}): DraftMember => ({
  id,
  name: id.charAt(0).toUpperCase() + id.slice(1),
  role,
  ...extra,
});
const codes = (issues: HoursIssue[]) => issues.map((i) => i.code);
const SPLIT = ['bartender', 'barback', 'host'];

/** Exactly one issue with this code (for this member); check its shape. */
function expectOne(
  issues: HoursIssue[],
  code: HoursIssue['code'],
  severity: 'error' | 'warning',
  memberId: string | undefined,
  role: string,
) {
  const hits = issues.filter((i) => i.code === code && i.memberId === memberId);
  expect(hits).toHaveLength(1);
  const hit = at(hits, 0);
  expect(hit.severity).toBe(severity);
  expect(hit.role).toBe(role);
  expect(hit.message.trim().length).toBeGreaterThan(0);
  if (memberId) {
    // messages are plain English and name the member (contract examples: "Allen needs …")
    const name = memberId.charAt(0).toUpperCase() + memberId.slice(1);
    expect(hit.message).toContain(name);
  }
}

describe('no issues', () => {
  it('an empty team, or nobody with hours, has no issues', () => {
    expect(checkTeamHours([], SPLIT)).toEqual([]);
    expect(checkTeamHours([d('joseph', 'bartender'), d('aaron', 'bartender')], SPLIT)).toEqual([]);
  });

  it('everyone in a role with valid committed hours or clock times', () => {
    const team = [
      d('joseph', 'bartender', { hours: 6 }),
      d('aaron', 'bartender', { clockIn: '20:00', clockOut: '02:00' }),
      d('david', 'barback'),
      d('allen', 'barback'),
    ];
    expect(checkTeamHours(team, SPLIT)).toEqual([]);
  });

  it('everyone in a role with valid typed text (not yet committed)', () => {
    const team = [
      d('joseph', 'bartender', { hoursText: '6h30' }),
      d('aaron', 'bartender', { clockInText: '5pm', clockOutText: '1:30am' }),
    ];
    expect(checkTeamHours(team, SPLIT)).toEqual([]);
  });

  it('16h exactly is not a long shift (threshold is > 16)', () => {
    const team = [
      d('joseph', 'bartender', { hours: 16 }),
      d('aaron', 'bartender', { clockInText: '08:00', clockOutText: '00:00' }), // 16h
    ];
    expect(checkTeamHours(team, SPLIT)).toEqual([]);
  });
});

describe('member-level issue codes', () => {
  it('INVALID_TIME for an unreadable clock-in or clock-out', () => {
    expectOne(
      checkTeamHours([d('allen', 'barback', { clockInText: 'abc', clockOutText: '2am' })], SPLIT),
      'INVALID_TIME',
      'error',
      'allen',
      'barback',
    );
    expectOne(
      checkTeamHours([d('allen', 'barback', { clockInText: '9pm', clockOutText: '25:00' })], SPLIT),
      'INVALID_TIME',
      'error',
      'allen',
      'barback',
    );
  });

  it('MISSING_CLOCK_OUT / MISSING_CLOCK_IN', () => {
    expectOne(
      checkTeamHours([d('allen', 'barback', { clockInText: '5pm' })], SPLIT),
      'MISSING_CLOCK_OUT',
      'error',
      'allen',
      'barback',
    );
    expectOne(
      checkTeamHours([d('allen', 'barback', { clockOut: '02:00' })], SPLIT),
      'MISSING_CLOCK_IN',
      'error',
      'allen',
      'barback',
    );
  });

  it('SAME_TIME when both times normalise to the same value', () => {
    expectOne(
      checkTeamHours([d('allen', 'barback', { clockInText: '5pm', clockOutText: '17:00' })], SPLIT),
      'SAME_TIME',
      'error',
      'allen',
      'barback',
    );
    expectOne(
      checkTeamHours([d('allen', 'barback', { clockIn: '12:00', clockOutText: 'noon' })], SPLIT),
      'SAME_TIME',
      'error',
      'allen',
      'barback',
    );
  });

  it.each([['abc'], ['0'], ['-2'], ['25'], ['6.5.5']])(
    'INVALID_HOURS for hours text %p',
    (hoursText) => {
      expectOne(
        checkTeamHours([d('hannah', 'host', { hoursText })], SPLIT),
        'INVALID_HOURS',
        'error',
        'hannah',
        'host',
      );
    },
  );

  it('LONG_SHIFT is a warning only (hours and clock times)', () => {
    const team = [
      d('joseph', 'bartender', { hours: 17 }),
      d('aaron', 'bartender', { clockInText: '6am', clockOutText: '11:30pm' }), // 17.5h
    ];
    const issues = checkTeamHours(team, SPLIT);
    expectOne(issues, 'LONG_SHIFT', 'warning', 'joseph', 'bartender');
    expectOne(issues, 'LONG_SHIFT', 'warning', 'aaron', 'bartender');
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('a LONG_SHIFT member still counts as having hours (no PARTIAL_HOURS for them)', () => {
    const issues = checkTeamHours(
      [d('joseph', 'bartender', { hoursText: '18' }), d('aaron', 'bartender', { hoursText: '6' })],
      SPLIT,
    );
    expect(codes(issues)).toEqual(['LONG_SHIFT']);
  });
});

describe('typed text takes precedence over committed values', () => {
  it('bad hours text beats a good committed value', () => {
    expectOne(
      checkTeamHours([d('hannah', 'host', { hours: 6, hoursText: 'abc' })], SPLIT),
      'INVALID_HOURS',
      'error',
      'hannah',
      'host',
    );
  });

  it('good hours text beats a committed long shift', () => {
    expect(checkTeamHours([d('hannah', 'host', { hours: 20, hoursText: '6' })], SPLIT)).toEqual([]);
  });

  it('clock text is checked instead of the committed time', () => {
    // committed 09:00-17:00 is fine, but the typed clock-out "9am" equals the clock-in
    expectOne(
      checkTeamHours(
        [d('allen', 'barback', { clockIn: '09:00', clockOut: '17:00', clockOutText: '9am' })],
        SPLIT,
      ),
      'SAME_TIME',
      'error',
      'allen',
      'barback',
    );
    // committed SAME_TIME pair fixed by typed text
    expect(
      checkTeamHours(
        [d('allen', 'barback', { clockIn: '09:00', clockOut: '09:00', clockOutText: '5pm' })],
        SPLIT,
      ),
    ).toEqual([]);
  });

  it('falls back to committed values when no text is present', () => {
    expectOne(
      checkTeamHours([d('allen', 'barback', { clockIn: '09:00', clockOut: '09:00' })], SPLIT),
      'SAME_TIME',
      'error',
      'allen',
      'barback',
    );
  });
});

describe('PARTIAL_HOURS', () => {
  it('one issue per member missing hours, in a role where someone has valid hours', () => {
    const team = [
      d('david', 'barback', { hours: 6 }),
      d('allen', 'barback'),
      d('kim', 'barback'),
      d('joseph', 'bartender'), // other role, nobody has hours -> fine
    ];
    const issues = checkTeamHours(team, SPLIT);
    expect(issues.map((i) => [i.code, i.memberId])).toEqual([
      ['PARTIAL_HOURS', 'allen'],
      ['PARTIAL_HOURS', 'kim'],
    ]);
    expectOne(issues, 'PARTIAL_HOURS', 'error', 'allen', 'barback');
  });

  it('valid typed text counts as having hours', () => {
    const issues = checkTeamHours(
      [d('david', 'barback', { clockInText: '5pm', clockOutText: '11pm' }), d('allen', 'barback')],
      SPLIT,
    );
    expect(issues.map((i) => [i.code, i.memberId])).toEqual([['PARTIAL_HOURS', 'allen']]);
  });

  it('is not emitted for a member with an error of their own', () => {
    const team = [
      d('david', 'barback', { hours: 6 }),
      d('allen', 'barback', { hoursText: 'abc' }),
      d('kim', 'barback', { clockInText: '5pm' }),
      d('lee', 'barback'),
    ];
    const issues = checkTeamHours(team, SPLIT);
    expect(issues.map((i) => [i.code, i.memberId])).toEqual([
      ['INVALID_HOURS', 'allen'],
      ['MISSING_CLOCK_OUT', 'kim'],
      ['PARTIAL_HOURS', 'lee'],
    ]);
  });

  it('is not emitted when nobody in the role has valid hours', () => {
    // ASSUMPTION (findings #71): members with errors are "entered" but not "valid hours", so
    // they do not make the others partial.
    const team = [d('allen', 'barback', { hoursText: 'abc' }), d('kim', 'barback')];
    expect(codes(checkTeamHours(team, SPLIT))).toEqual(['INVALID_HOURS']);
  });

  it('blank text counts as no hours', () => {
    const team = [d('david', 'barback', { hours: 6 }), d('allen', 'barback', { hoursText: '   ' })];
    expect(checkTeamHours(team, SPLIT).map((i) => [i.code, i.memberId])).toEqual([
      ['PARTIAL_HOURS', 'allen'],
    ]);
  });
});

describe('roles outside rolesThatSplit are ignored', () => {
  it('kitchen, server and unknown roles are not checked', () => {
    const team = [
      d('chef', 'kitchen', { hoursText: 'abc' }),
      d('sam', 'server', { clockInText: '5pm' }),
      d('zed', 'busser', { hours: 6 }),
      d('lee', 'busser'),
    ];
    expect(checkTeamHours(team, SPLIT)).toEqual([]);
  });

  it('the same team is checked when the role is listed', () => {
    const team = [d('zed', 'busser', { hours: 6 }), d('lee', 'busser')];
    expect(codes(checkTeamHours(team, ['busser']))).toEqual(['PARTIAL_HOURS']);
  });
});

describe('ordering', () => {
  it('by rolesThatSplit order, then team order (not grouped by severity across members)', () => {
    const team = [
      d('david', 'barback', { hours: 17 }), // LONG_SHIFT (warning)
      d('allen', 'barback'), // PARTIAL_HOURS
      d('hannah', 'host', { hoursText: 'abc' }), // INVALID_HOURS
      d('joseph', 'bartender', { clockInText: 'x', clockOutText: '2am' }), // INVALID_TIME
      d('mia', 'host', { clockInText: '5pm' }), // MISSING_CLOCK_OUT
    ];
    const issues = checkTeamHours(team, ['host', 'barback', 'bartender']);
    expect(issues.map((i) => [i.role, i.memberId, i.code])).toEqual([
      ['host', 'hannah', 'INVALID_HOURS'],
      ['host', 'mia', 'MISSING_CLOCK_OUT'],
      ['barback', 'david', 'LONG_SHIFT'],
      ['barback', 'allen', 'PARTIAL_HOURS'],
      ['bartender', 'joseph', 'INVALID_TIME'],
    ]);
  });

  it('is deterministic and does not mutate the team', () => {
    const team = [d('david', 'barback', { hours: 17 }), d('allen', 'barback', { hoursText: 'x' })];
    const before = JSON.stringify(team);
    expect(checkTeamHours(team, SPLIT)).toEqual(checkTeamHours(team, SPLIT));
    expect(JSON.stringify(team)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// key property: error-free teams never make the engine throw hours errors
// ---------------------------------------------------------------------------

/** What a user might have typed (or committed) for one member. */
const entryArb: fc.Arbitrary<Partial<DraftMember>> = fc.oneof(
  fc.constant({}),
  // committed values (as the store holds them after blur)
  fc.integer({ min: 1, max: 96 }).map((q) => ({ hours: q / 4 })),
  fc
    .tuple(fc.integer({ min: 0, max: 1439 }), fc.integer({ min: 0, max: 1439 }))
    .map(([a, b]) => ({ clockIn: hhmm(a), clockOut: hhmm(b) })),
  // typed hours text, good and bad
  fc
    .constantFrom(
      '6',
      '6.5',
      '6,5',
      '6:30',
      '6h30',
      '45m',
      '.5',
      '0',
      '-1',
      '25',
      'abc',
      '',
      '  ',
      '24',
    )
    .map((hoursText) => ({ hoursText })),
  // typed clock text, good and bad, possibly half-entered or equal
  fc
    .tuple(
      fc.constantFrom(
        '5pm',
        '17:00',
        '1730',
        '9a',
        'noon',
        'midnight',
        '23:59',
        '0',
        '13pm',
        'abc',
        '',
        '24',
      ),
      fc.constantFrom('1am', '01:00', '2:30am', '11pm', '5pm', '0000', '12345', '', 'x', '9'),
    )
    .map(([clockInText, clockOutText]) => ({ clockInText, clockOutText })),
  // text overriding a committed value
  fc.constantFrom('7', 'abc', '').map((hoursText) => ({ hours: 5, hoursText })),
);

const NAMES = ['Joseph', 'Aaron', 'David', 'Allen', 'Hannah', 'Mia', 'Kim', 'Lee'];

const caseArb = fc.record({
  flow: fc.constantFrom('server' as const, 'bartender' as const),
  roles: fc.array(
    fc.record({
      // Review round 6 (#78): kitchen members are included too. Kitchen is never split, so the
      // store leaves it out of rolesThatSplit and the engine must not validate its hours.
      role: fc.constantFrom('bartender', 'barback', 'host', 'kitchen'),
      entry: entryArb,
    }),
    { minLength: 0, maxLength: 7 },
  ),
  roundToDollar: fc.boolean(),
  missingRoleHandling: fc.constantFrom('redistribute' as const, 'retain' as const),
});

describe('property: checkTeamHours error-free => calculateShift never throws PARTIAL_HOURS / INVALID_CLOCK', () => {
  it('holds for both default profiles (server flow and bartender flow)', () => {
    let checked = 0;
    fc.assert(
      fc.property(caseArb, (c) => {
        const profile: TipOutProfile =
          c.flow === 'server' ? SERVER_DEFAULT_PROFILE : BARTENDER_DEFAULT_PROFILE;
        const team: DraftMember[] = c.roles.map((r, i) => ({
          id: `m${i}`,
          name: at(NAMES, i % NAMES.length),
          role: r.role,
          ...r.entry,
        }));
        // the store's list: profile roles with named members (never kitchen), + bartender in the
        // bartender flow
        const rolesThatSplit = profile.rules
          .map((rule) => rule.role)
          .filter((role) => role !== 'kitchen');
        if (c.flow === 'bartender') rolesThatSplit.push('bartender');

        const issues = checkTeamHours(team, rolesThatSplit);
        if (issues.some((i) => i.severity === 'error')) return;
        checked++;

        const input: ShiftInput = {
          date: '2026-11-21',
          userRole: c.flow,
          totalTips: 19255,
          netSales: 90543,
          foodSales: 12000,
          team: commitTeamHours(team),
          missingRoleHandling: c.missingRoleHandling,
          profileId: profile.id,
          roundToDollar: c.roundToDollar,
        };
        try {
          calculateShift(input, profile);
        } catch (e) {
          if (e instanceof EngineValidationError) {
            expect({ code: e.code, team: input.team }).toEqual({
              code: expect.not.stringMatching(/^(PARTIAL_HOURS|INVALID_CLOCK)$/),
              team: input.team,
            });
          } else {
            throw e;
          }
        }
      }),
      { seed: 20261121, numRuns: 1500 },
    );
    // the generator must actually reach the interesting case
    expect(checked).toBeGreaterThan(200);
  });
});
