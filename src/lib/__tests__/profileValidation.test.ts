/**
 * Milestone 5 acceptance: checkProfile (docs/m5-contract.md "Validation").
 */
import * as fc from 'fast-check';
import { calculateShift } from '../../engine/calculate';
import { BARTENDER_DEFAULT_PROFILE, SERVER_DEFAULT_PROFILE } from '../../engine/profiles';
import type { ShiftInput, TeamMember, TipOutProfile, TipOutRule } from '../../engine/types';
import { roleIdFromLabel } from '../profiles';
import { checkProfile, type ProfileIssue } from '../profileValidation';
import { at } from '../../test-support/builders';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const DEFAULTS = [SERVER_DEFAULT_PROFILE, BARTENDER_DEFAULT_PROFILE];

/** A valid custom server profile to start each case from. */
function base(): TipOutProfile {
  return {
    id: 'custom-1',
    name: 'Patio',
    appliesTo: 'server',
    totalTipOutPercentOfTips: 25,
    rules: [
      { role: 'kitchen', type: 'percentOfBasis', basis: 'foodSales', percent: 2 },
      { role: 'bartender', type: 'shareOfRemainder', weight: 4 },
      { role: 'busser', label: 'Busser', type: 'shareOfRemainder', weight: 1 },
    ],
  };
}
const check = (p: TipOutProfile, others: TipOutProfile[] = DEFAULTS) => checkProfile(p, others);
const codes = (issues: ProfileIssue[]) => issues.map((i) => i.code);
const find = (issues: ProfileIssue[], code: ProfileIssue['code']) =>
  issues.filter((i) => i.code === code);
const errors = (issues: ProfileIssue[]) => issues.filter((i) => i.severity === 'error');

/** Assert exactly one issue with this code, severity and ruleIndex. */
function expectIssue(
  issues: ProfileIssue[],
  code: ProfileIssue['code'],
  severity: 'error' | 'warning',
  ruleIndex?: number,
) {
  const hits = find(issues, code);
  expect(hits).toHaveLength(1);
  const hit = at(hits, 0);
  expect(hit.severity).toBe(severity);
  if (ruleIndex === undefined) expect(hit.ruleIndex).toBeUndefined();
  else expect(hit.ruleIndex).toBe(ruleIndex);
  expect(typeof hit.message).toBe('string');
  expect(hit.message.trim().length).toBeGreaterThan(0);
}

describe('valid profiles', () => {
  it('both shipped defaults have no issues', () => {
    expect(check(SERVER_DEFAULT_PROFILE)).toEqual([]);
    expect(check(BARTENDER_DEFAULT_PROFILE)).toEqual([]);
    expect(check(SERVER_DEFAULT_PROFILE, [])).toEqual([]);
  });

  it('the custom base profile has no issues', () => {
    expect(check(base())).toEqual([]);
  });

  it('pool percent 0 and 100 are in range', () => {
    // findings #58: a 0% pool is allowed (nothing is tipped out), not an error
    expect(errors(check({ ...base(), totalTipOutPercentOfTips: 0 }))).toEqual([]);
    expect(errors(check({ ...base(), totalTipOutPercentOfTips: 100 }))).toEqual([]);
  });

  it('a bartender rule in a server profile and a server rule in a bartender profile are fine', () => {
    const bar: TipOutProfile = {
      ...clone(BARTENDER_DEFAULT_PROFILE),
      id: 'b1',
      name: 'Bar 2',
      rules: [
        ...clone(BARTENDER_DEFAULT_PROFILE.rules),
        { role: 'server', type: 'shareOfRemainder', weight: 1 },
      ],
    };
    expect(errors(check(bar))).toEqual([]);
  });

  it('does not mutate the profile or the others', () => {
    const p = base();
    const before = JSON.stringify([p, DEFAULTS]);
    check(p);
    expect(JSON.stringify([p, DEFAULTS])).toBe(before);
  });
});

describe('profile-level issues', () => {
  it.each([[''], ['   ']])('NAME_REQUIRED for name %p', (name) => {
    expectIssue(check({ ...base(), name }), 'NAME_REQUIRED', 'error');
  });

  it('NAME_TAKEN when another profile has the same name (trim + case-insensitive)', () => {
    expectIssue(check({ ...base(), name: '  server DEFAULT ' }), 'NAME_TAKEN', 'error');
    const other: TipOutProfile = { ...base(), id: 'custom-2', name: 'Patio' };
    expectIssue(check(base(), [...DEFAULTS, other]), 'NAME_TAKEN', 'error');
  });

  it('NAME_TAKEN ignores the profile itself (same id) — editing keeps its own name', () => {
    expect(codes(check(SERVER_DEFAULT_PROFILE, DEFAULTS))).not.toContain('NAME_TAKEN');
    const self = base();
    expect(codes(check({ ...self, name: 'PATIO ' }, [...DEFAULTS, self]))).not.toContain(
      'NAME_TAKEN',
    );
  });

  it('NAME_TAKEN does not fire for different names that only share a prefix', () => {
    expect(codes(check({ ...base(), name: 'Server default 2' }))).not.toContain('NAME_TAKEN');
  });

  it.each([[-1], [100.01], [Number.NaN], [Number.POSITIVE_INFINITY], [Number.NEGATIVE_INFINITY]])(
    'POOL_PERCENT_RANGE for %p',
    (pct) => {
      expectIssue(
        check({ ...base(), totalTipOutPercentOfTips: pct }),
        'POOL_PERCENT_RANGE',
        'error',
      );
    },
  );

  it('NO_RULES is an error', () => {
    expectIssue(check({ ...base(), rules: [] }), 'NO_RULES', 'error');
  });

  it('NO_SHARE_RULE is a warning (only fixed rules: the remainder is not paid out)', () => {
    const issues = check({
      ...base(),
      rules: [{ role: 'kitchen', type: 'percentOfBasis', basis: 'foodSales', percent: 2 }],
    });
    expectIssue(issues, 'NO_SHARE_RULE', 'warning');
    expect(errors(issues)).toEqual([]);
  });
});

describe('rule-level issues (ruleIndex set)', () => {
  it('RULE_ROLE_REQUIRED for an empty role, or a label that cleans to nothing', () => {
    const p = base();
    p.rules[1] = { role: '', type: 'shareOfRemainder', weight: 4 };
    expectIssue(check(p), 'RULE_ROLE_REQUIRED', 'error', 1);
    const q = base();
    q.rules[2] = {
      role: roleIdFromLabel('!!!'),
      label: '!!!',
      type: 'shareOfRemainder',
      weight: 1,
    };
    expectIssue(check(q), 'RULE_ROLE_REQUIRED', 'error', 2);
  });

  it('DUPLICATE_ROLE is reported on the later rule', () => {
    const p = base();
    p.rules.push({ role: 'bartender', type: 'shareOfRemainder', weight: 1 });
    expectIssue(check(p), 'DUPLICATE_ROLE', 'error', 3);
  });

  it('DUPLICATE_ROLE via label collision: "Busser" + " busser "', () => {
    const p = base();
    const label = ' busser ';
    p.rules.push({ role: roleIdFromLabel(label), label, type: 'shareOfRemainder', weight: 2 });
    expectIssue(check(p), 'DUPLICATE_ROLE', 'error', 3);
  });

  it('DUPLICATE_ROLE when a custom label maps onto a built-in role ("Bartenders")', () => {
    const p = base();
    p.rules.push({
      role: roleIdFromLabel('Bartenders'),
      label: 'Bartenders',
      type: 'percentOfBasis',
      basis: 'netSales',
      percent: 1,
    });
    expectIssue(check(p), 'DUPLICATE_ROLE', 'error', 3);
  });

  it('DUPLICATE_ROLE across rule types (fixed + share for the same role)', () => {
    const p = base();
    p.rules.unshift({
      role: 'busser',
      label: 'Busser',
      type: 'percentOfBasis',
      basis: 'netSales',
      percent: 1,
    });
    // busser is now at 0 (fixed) and 3 (share): the later one is flagged
    expectIssue(check(p), 'DUPLICATE_ROLE', 'error', 3);
  });

  it('three of the same role: every later copy is flagged', () => {
    const p = base();
    p.rules.push({ role: 'busser', type: 'shareOfRemainder', weight: 1 });
    p.rules.push({ role: 'busser', type: 'shareOfRemainder', weight: 1 });
    const dup = find(check(p), 'DUPLICATE_ROLE');
    expect(dup.map((i) => i.ruleIndex)).toEqual([3, 4]);
  });

  it.each([[-0.5], [100.5], [Number.NaN], [Number.POSITIVE_INFINITY]])(
    'RULE_PERCENT_RANGE for percent %p',
    (percent) => {
      const p = base();
      p.rules[0] = { role: 'kitchen', type: 'percentOfBasis', basis: 'foodSales', percent };
      expectIssue(check(p), 'RULE_PERCENT_RANGE', 'error', 0);
    },
  );

  it('rule percent 0 and 100 are in range', () => {
    for (const percent of [0, 100]) {
      const p = base();
      p.rules[0] = { role: 'kitchen', type: 'percentOfBasis', basis: 'foodSales', percent };
      expect(codes(check(p))).not.toContain('RULE_PERCENT_RANGE');
    }
  });

  it.each([[0], [-2], [Number.NaN]])('RULE_WEIGHT_POSITIVE for weight %p', (weight) => {
    const p = base();
    p.rules[2] = { role: 'busser', label: 'Busser', type: 'shareOfRemainder', weight };
    expectIssue(check(p), 'RULE_WEIGHT_POSITIVE', 'error', 2);
  });

  it('a tiny positive weight is fine', () => {
    const p = base();
    p.rules[2] = { role: 'busser', label: 'Busser', type: 'shareOfRemainder', weight: 0.01 };
    expect(check(p)).toEqual([]);
  });

  it.each(['shareOfRemainder', 'percentOfBasis'] as const)(
    'BARTENDER_RULE_IN_BARTENDER_PROFILE (#13d) for a %s bartender rule',
    (type) => {
      const rule: TipOutRule =
        type === 'shareOfRemainder'
          ? { role: 'bartender', type, weight: 1 }
          : { role: 'bartender', type, basis: 'netSales', percent: 1 };
      const p: TipOutProfile = {
        ...clone(BARTENDER_DEFAULT_PROFILE),
        id: 'b2',
        name: 'Bar 2',
        rules: [...clone(BARTENDER_DEFAULT_PROFILE.rules), rule],
      };
      expectIssue(check(p), 'BARTENDER_RULE_IN_BARTENDER_PROFILE', 'error', 3);
    },
  );

  it('BARTENDER_RULE_IN_BARTENDER_PROFILE via a "Bartenders" label', () => {
    const p: TipOutProfile = {
      ...clone(BARTENDER_DEFAULT_PROFILE),
      id: 'b3',
      name: 'Bar 3',
      rules: [
        {
          role: roleIdFromLabel('Bartenders'),
          label: 'Bartenders',
          type: 'shareOfRemainder',
          weight: 1,
        },
        ...clone(BARTENDER_DEFAULT_PROFILE.rules),
      ],
    };
    expectIssue(check(p), 'BARTENDER_RULE_IN_BARTENDER_PROFILE', 'error', 0);
  });

  it('SELF_TIP_OUT for a server rule in a server profile', () => {
    const p = base();
    p.rules.splice(1, 0, { role: 'server', type: 'shareOfRemainder', weight: 1 });
    expectIssue(check(p), 'SELF_TIP_OUT', 'error', 1);
  });

  it('SELF_TIP_OUT via a "Servers" label', () => {
    const p = base();
    p.rules.push({
      role: roleIdFromLabel('Servers'),
      label: 'Servers',
      type: 'percentOfBasis',
      basis: 'netSales',
      percent: 1,
    });
    expectIssue(check(p), 'SELF_TIP_OUT', 'error', 3);
  });

  it('switching appliesTo changes which self-tip-out code applies', () => {
    const p = base();
    p.rules.push({ role: 'server', type: 'shareOfRemainder', weight: 1 });
    expect(codes(check(p))).toContain('SELF_TIP_OUT');
    const asBar = { ...p, appliesTo: 'bartender' as const };
    // now the bartender rule (index 1) is the problem and the server rule is fine
    const issues = check(asBar);
    expect(codes(issues)).not.toContain('SELF_TIP_OUT');
    expectIssue(issues, 'BARTENDER_RULE_IN_BARTENDER_PROFILE', 'error', 1);
  });
});

describe('ordering and stability', () => {
  /** Several issues at once: two profile-level, then rule issues at indexes 0, 1, 3. */
  function messy(): TipOutProfile {
    return {
      id: 'm',
      name: ' ',
      appliesTo: 'server',
      totalTipOutPercentOfTips: 150,
      rules: [
        { role: 'kitchen', type: 'percentOfBasis', basis: 'foodSales', percent: 200 },
        { role: 'bartender', type: 'shareOfRemainder', weight: 0 },
        { role: 'host', type: 'shareOfRemainder', weight: 1 },
        { role: 'bartender', type: 'shareOfRemainder', weight: 2 },
      ],
    };
  }

  it('profile-level issues come first, then rule issues by ruleIndex', () => {
    const issues = check(messy());
    expect(codes(issues).sort()).toEqual(
      [
        'NAME_REQUIRED',
        'POOL_PERCENT_RANGE',
        'RULE_PERCENT_RANGE',
        'RULE_WEIGHT_POSITIVE',
        'DUPLICATE_ROLE',
      ].sort(),
    );
    const firstRuleLevel = issues.findIndex((i) => i.ruleIndex !== undefined);
    expect(firstRuleLevel).toBe(2);
    expect(issues.slice(0, 2).every((i) => i.ruleIndex === undefined)).toBe(true);
    expect(issues.slice(2).map((i) => i.ruleIndex)).toEqual([0, 1, 3]);
  });

  it('the same input always gives the same list (deep-equal, same order)', () => {
    expect(check(messy())).toEqual(check(messy()));
    const others = [...DEFAULTS].reverse();
    expect(check(messy(), others)).toEqual(check(messy(), DEFAULTS));
  });

  it('several problems on one rule are all reported, in a stable order', () => {
    // ASSUMPTION (findings #59): no "first issue wins" per rule.
    const p = base();
    p.rules.push({ role: 'bartender', type: 'shareOfRemainder', weight: -1 }); // dup + weight
    const onRule3 = check(p).filter((i) => i.ruleIndex === 3);
    expect(codes(onRule3).sort()).toEqual(['DUPLICATE_ROLE', 'RULE_WEIGHT_POSITIVE']);
    expect(check(p).filter((i) => i.ruleIndex === 3)).toEqual(onRule3);
  });

  it('every issue has severity error except NO_SHARE_RULE', () => {
    const all = [
      ...check(messy()),
      ...check({ ...base(), rules: [] }),
      ...check({ ...base(), name: 'Server default' }),
    ];
    for (const i of all) expect(i.severity).toBe(i.code === 'NO_SHARE_RULE' ? 'warning' : 'error');
  });
});

// ---------------------------------------------------------------------------
// property: error-free profiles never make calculateShift throw on a valid shift
// ---------------------------------------------------------------------------

const ROLE_POOL = ['kitchen', 'bartender', 'barback', 'host', 'server', 'busser', 'food-runner'];

const ruleArb: fc.Arbitrary<TipOutRule> = fc.oneof(
  fc.record({
    role: fc.constantFrom(...ROLE_POOL),
    type: fc.constant('percentOfBasis' as const),
    basis: fc.constantFrom('foodSales' as const, 'netSales' as const, 'totalTips' as const),
    percent: fc.oneof(
      fc.integer({ min: 0, max: 10 }),
      fc.double({ min: -5, max: 105, noNaN: true }),
    ),
  }),
  fc.record({
    role: fc.constantFrom(...ROLE_POOL),
    type: fc.constant('shareOfRemainder' as const),
    weight: fc.oneof(fc.integer({ min: 1, max: 10 }), fc.double({ min: -1, max: 10, noNaN: true })),
  }),
);

const profileArb = fc.record({
  id: fc.constant('gen'),
  name: fc.constantFrom('Gen', 'Server default', ''),
  appliesTo: fc.constantFrom('server' as const, 'bartender' as const),
  totalTipOutPercentOfTips: fc.oneof(
    fc.integer({ min: 0, max: 100 }),
    fc.double({ min: -5, max: 105, noNaN: true }),
  ),
  poolBasis: fc.constantFrom(
    undefined,
    'totalTips' as const,
    'netSales' as const,
    'foodSales' as const,
  ),
  rules: fc.array(ruleArb, { minLength: 0, maxLength: 5 }),
});

const shiftArb = fc.record({
  totalTips: fc.integer({ min: 0, max: 1_000_000 }),
  netSales: fc.integer({ min: 0, max: 5_000_000 }),
  foodSales: fc.integer({ min: 0, max: 5_000_000 }),
  counts: fc.array(fc.integer({ min: 0, max: 3 }), {
    minLength: ROLE_POOL.length,
    maxLength: ROLE_POOL.length,
  }),
  bartenders: fc.integer({ min: 0, max: 3 }),
  withHours: fc.boolean(),
  hours: fc.array(fc.integer({ min: 1, max: 48 }), { minLength: 30, maxLength: 30 }),
  missingRoleHandling: fc.constantFrom('redistribute' as const, 'retain' as const),
  roundToDollar: fc.boolean(),
  roundMemberShares: fc.constantFrom(undefined, true, false),
});

describe('property: no errors from checkProfile => calculateShift does not throw', () => {
  it('holds for generated profiles and valid shifts', () => {
    fc.assert(
      fc.property(profileArb, shiftArb, (raw, s) => {
        const profile: TipOutProfile = { ...raw, rules: raw.rules };
        if (raw.poolBasis === undefined) delete profile.poolBasis;
        fc.pre(errors(checkProfile(profile, DEFAULTS)).length === 0);

        let h = 0;
        const team: TeamMember[] = [];
        ROLE_POOL.forEach((role, ri) => {
          // bartender flow: bartenders are the kept-sharers, generated separately below
          if (role === 'bartender' && profile.appliesTo === 'bartender') return;
          for (let i = 0; i < at(s.counts, ri); i++) {
            const m: TeamMember = { id: `${role}-${i}`, name: `${role} ${i}`, role };
            if (s.withHours) m.hours = at(s.hours, h++ % 30) / 4;
            team.push(m);
          }
        });
        if (profile.appliesTo === 'bartender') {
          for (let i = 0; i < s.bartenders; i++) {
            const m: TeamMember = { id: `bt-${i}`, name: `Bartender ${i}`, role: 'bartender' };
            if (s.withHours) m.hours = at(s.hours, h++ % 30) / 4;
            team.push(m);
          }
        }
        const input: ShiftInput = {
          date: '2026-11-21',
          userRole: profile.appliesTo,
          totalTips: s.totalTips,
          netSales: s.netSales,
          foodSales: s.foodSales,
          team,
          missingRoleHandling: s.missingRoleHandling,
          profileId: profile.id,
          roundToDollar: s.roundToDollar,
        };
        const options =
          s.roundMemberShares === undefined ? {} : { roundMemberShares: s.roundMemberShares };
        expect(() => calculateShift(input, profile, options)).not.toThrow();
      }),
      { seed: 20261121, numRuns: 400 },
    );
  });
});
