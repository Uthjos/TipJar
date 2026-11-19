/**
 * Property-based tests (fast-check) for the calc engine invariants in CLAUDE.md §5.
 * Runs are seeded so the suite is deterministic; bump NUM_RUNS locally to fuzz harder.
 *
 * Owner decisions (2026-11-18) encoded here: whole-dollar member shares and keptSplit when
 * rounding is on (roundMemberShares defaults to true), keptChange, poolBasis with the
 * POOL_EXCEEDS_TIPS cap, the Q7 odd-dollar rule (largest remainder -> more hours -> held back),
 * ZERO_SHARE_AFTER_ROUNDING (Q8) and TeamMember.isUser being ignored by the engine (Q9).
 */
import * as fc from 'fast-check';
import { calculateShift } from '../calculate';
import { splitLargestRemainder } from '../money';
import { BARTENDER_DEFAULT_PROFILE, SERVER_DEFAULT_PROFILE } from '../profiles';
import type { ShiftInput, ShiftResult, TeamMember, TipOutProfile, TipOutRule } from '../types';
import { at, sum } from '../../test-support/builders';

const SEED = 20261118;
const NUM_RUNS = 400;
const PARAMS = { seed: SEED, numRuns: NUM_RUNS };

const SHARE_ROLE_POOL = ['barback', 'host', 'busser', 'bartender'] as const;
type HoursMode = 'none' | 'hours' | 'clock';

type PoolBasis = 'totalTips' | 'netSales' | 'foodSales';

interface Case {
  input: ShiftInput;
  profile: TipOutProfile;
  /** undefined exercises the engine default (true). */
  roundMemberShares: boolean | undefined;
}

const pct = (max: number) =>
  fc.oneof(fc.integer({ min: 0, max }), fc.double({ min: 0, max, noNaN: true }));

const basisArb = fc.constantFrom('foodSales', 'netSales', 'totalTips') as fc.Arbitrary<
  'foodSales' | 'netSales' | 'totalTips'
>;

const rawCaseArb = fc.record({
  userRole: fc.constantFrom('server', 'bartender') as fc.Arbitrary<'server' | 'bartender'>,
  useDefaultProfile: fc.boolean(),
  totalTips: fc.integer({ min: 0, max: 500_000 }),
  netSales: fc.integer({ min: 0, max: 2_000_000 }),
  foodSales: fc.integer({ min: 0, max: 2_000_000 }),
  poolPercent: pct(100),
  kitchen: fc.option(fc.record({ basis: basisArb, percent: pct(10) }), { nil: undefined }),
  // a non-kitchen carve-out role ("expo") that always has members on shift
  expo: fc.option(fc.record({ basis: basisArb, percent: pct(10) }), { nil: undefined }),
  shareRoles: fc.shuffledSubarray([...SHARE_ROLE_POOL], { minLength: 1 }),
  weights: fc.array(
    fc.oneof(fc.integer({ min: 1, max: 10 }), fc.double({ min: 0.5, max: 10, noNaN: true })),
    { minLength: 4, maxLength: 4 },
  ),
  counts: fc.array(fc.integer({ min: 0, max: 3 }), { minLength: 4, maxLength: 4 }),
  expoCount: fc.integer({ min: 1, max: 3 }),
  bartenderCount: fc.integer({ min: 1, max: 4 }),
  hoursModes: fc.array(fc.constantFrom<HoursMode>('none', 'hours', 'clock'), {
    minLength: 6,
    maxLength: 6,
  }),
  quarterHours: fc.array(fc.integer({ min: 1, max: 56 }), { minLength: 24, maxLength: 24 }),
  clockStarts: fc.array(fc.integer({ min: 0, max: 1439 }), { minLength: 24, maxLength: 24 }),
  missingRoleHandling: fc.constantFrom('redistribute', 'retain') as fc.Arbitrary<
    'redistribute' | 'retain'
  >,
  roundToDollar: fc.boolean(),
  roundMemberShares: fc.constantFrom<boolean | undefined>(undefined, true, false),
  poolBasis: fc.constantFrom<PoolBasis | undefined>(
    undefined,
    'totalTips',
    'netSales',
    'foodSales',
  ),
});

const BASE_MS = Date.UTC(2026, 10, 17, 0, 0, 0);

type RawCase = typeof rawCaseArb extends fc.Arbitrary<infer T> ? T : never;

function buildCase(r: RawCase): Case {
  let slot = 0;
  const nextSlot = () => slot++ % 24;

  const makeMembers = (role: string, count: number, mode: HoursMode): TeamMember[] =>
    Array.from({ length: count }, (_, i) => {
      const s = nextSlot();
      const m: TeamMember = { id: `${role}-${i}`, name: `${role} ${i}`, role };
      if (mode === 'hours') m.hours = at(r.quarterHours, s) / 4;
      if (mode === 'clock') {
        const start = BASE_MS + at(r.clockStarts, s) * 60_000;
        m.clockIn = new Date(start).toISOString();
        m.clockOut = new Date(start + at(r.quarterHours, s) * 15 * 60_000).toISOString();
      }
      return m;
    });

  let profile: TipOutProfile;
  if (r.useDefaultProfile) {
    profile = r.userRole === 'server' ? SERVER_DEFAULT_PROFILE : BARTENDER_DEFAULT_PROFILE;
  } else {
    let shareRoles: string[] = r.shareRoles;
    // In the bartender flow, bartenders share the kept tips; they are not a tip-out role.
    if (r.userRole === 'bartender') shareRoles = shareRoles.filter((x) => x !== 'bartender');
    if (shareRoles.length === 0) shareRoles = ['barback'];
    const rules: TipOutRule[] = [];
    if (r.kitchen) rules.push({ role: 'kitchen', type: 'percentOfBasis', ...r.kitchen });
    if (r.expo) rules.push({ role: 'expo', type: 'percentOfBasis', ...r.expo });
    shareRoles.forEach((role, i) =>
      rules.push({ role, type: 'shareOfRemainder', weight: at(r.weights, i) }),
    );
    profile = {
      id: 'prop-custom',
      name: 'Property custom',
      appliesTo: r.userRole,
      totalTipOutPercentOfTips: r.poolPercent,
      ...(r.poolBasis ? { poolBasis: r.poolBasis } : {}),
      rules,
    };
  }

  const team: TeamMember[] = [];
  if (r.userRole === 'bartender') {
    team.push(...makeMembers('bartender', r.bartenderCount, at(r.hoursModes, 5)));
  }
  const shareRules = profile.rules.filter((x) => x.type === 'shareOfRemainder');
  shareRules.forEach((rule, i) => {
    // The first share role always has someone on shift so 'redistribute' always has a target
    // (all share roles missing + redistribute is undefined by the spec; see findings).
    const count = i === 0 ? Math.max(1, at(r.counts, i)) : at(r.counts, i);
    team.push(...makeMembers(rule.role, count, at(r.hoursModes, i)));
  });
  if (profile.rules.some((x) => x.role === 'expo')) {
    team.push(...makeMembers('expo', r.expoCount, at(r.hoursModes, 4)));
  }

  return {
    profile,
    roundMemberShares: r.roundMemberShares,
    input: {
      date: '2026-11-17',
      userRole: r.userRole,
      totalTips: r.totalTips,
      netSales: r.netSales,
      foodSales: r.foodSales,
      team,
      missingRoleHandling: r.missingRoleHandling,
      profileId: profile.id,
      roundToDollar: r.roundToDollar,
    },
  };
}

const caseArb = rawCaseArb.map(buildCase);

const runFull = (c: Case, overrides: Partial<ShiftInput> = {}) =>
  calculateShift(
    { ...c.input, ...overrides },
    c.profile,
    c.roundMemberShares === undefined ? {} : { roundMemberShares: c.roundMemberShares },
  );

const run = (c: Case, overrides: Partial<ShiftInput> = {}) => runFull(c, overrides).result;

/** Whole-dollar member shares / keptSplit apply: rounding on and roundMemberShares not false. */
const wholeDollarShares = (c: Case, roundToDollar = c.input.roundToDollar) =>
  roundToDollar && c.roundMemberShares !== false;

/** The pool before any cap: poolBasis x percent / 100 (fractional cents). */
const rawPool = (c: Case) => {
  const basis = c.profile.poolBasis ?? 'totalTips';
  return (c.input[basis] * c.profile.totalTipOutPercentOfTips) / 100;
};

/** The exact pool after the POOL_EXCEEDS_TIPS cap. */
const exactPool = (c: Case) => Math.min(c.input.totalTips, rawPool(c));

function allAmounts(res: ShiftResult): number[] {
  return [
    res.pool,
    res.kept,
    res.retained,
    res.roundingAdjustment,
    res.keptChange,
    ...res.roles.map((r) => r.amount),
    ...res.roles.flatMap((r) => r.members.map((m) => m.amount)),
    ...(res.keptSplit ?? []).map((k) => k.amount),
  ];
}

describe('calculateShift properties', () => {
  it('kept + pool == totalTips', () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const res = run(c);
        expect(res.kept + res.pool).toBe(c.input.totalTips);
      }),
      PARAMS,
    );
  });

  it('sum(roles paid) + retained <= unrounded pool <= totalTips', () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const res = run(c);
        const paid = sum(res.roles.filter((r) => !r.missing).map((r) => r.amount));
        const unrounded = res.pool + res.retained + res.roundingAdjustment;
        expect(paid).toBe(res.pool);
        expect(paid + res.retained).toBeLessThanOrEqual(unrounded);
        expect(unrounded).toBeLessThanOrEqual(c.input.totalTips);
        // the unrounded cent pool is the exact (capped) percentage rounded to the nearest cent
        expect(Math.abs(unrounded - exactPool(c))).toBeLessThanOrEqual(0.5 + 1e-6);
      }),
      PARAMS,
    );
  });

  it('every amount is an integer number of cents >= 0', () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        for (const a of allAmounts(run(c))) {
          expect(Number.isInteger(a)).toBe(true);
          expect(a).toBeGreaterThanOrEqual(0);
        }
      }),
      PARAMS,
    );
  });

  it('member amounts sum exactly to their role amount', () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const res = run(c);
        for (const r of res.roles) {
          if (r.members.length > 0) expect(sum(r.members.map((m) => m.amount))).toBe(r.amount);
        }
      }),
      PARAMS,
    );
  });

  it('sum(keptSplit) + keptChange == kept (bartender flow); server flow has no keptSplit', () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const res = run(c);
        if (c.input.userRole === 'bartender') {
          const bartenders = c.input.team.filter((m) => m.role === 'bartender');
          expect(res.keptSplit).toBeDefined();
          expect(res.keptSplit!.map((k) => k.memberId)).toEqual(bartenders.map((m) => m.id));
          expect(sum(res.keptSplit!.map((k) => k.amount)) + res.keptChange).toBe(res.kept);
        } else {
          expect(res.keptSplit).toBeUndefined();
          expect(res.keptChange).toBe(0);
        }
      }),
      PARAMS,
    );
  });

  // Precondition: the generator always lists >= 1 bartender in the bartender flow. With none,
  // keptChange = kept (review round 2, #20); covered in review.test.ts.
  it('keptChange = (kept - floorToDollar(kept)) + dollars held back from keptSplit', () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const res = run(c);
        expect(Number.isInteger(res.keptChange)).toBe(true);
        expect(res.keptChange).toBeGreaterThanOrEqual(0);
        if (c.input.userRole === 'bartender' && wholeDollarShares(c)) {
          const held = res.keptChange - (res.kept % 100);
          // the held part is whole dollars, fewer than the number of bartenders sharing
          expect(held).toBeGreaterThanOrEqual(0);
          expect(held % 100).toBe(0);
          expect(held / 100).toBeLessThan(res.keptSplit!.length);
          expect(res.keptHeldBack ?? 0).toBe(held);
        } else {
          expect(res.keptChange).toBe(0);
          expect(res.keptHeldBack ?? 0).toBe(0);
        }
      }),
      PARAMS,
    );
  });

  it('held-back dollars per role are whole dollars, fewer than the members, and move pool -> kept', () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const whole = calculateShift(c.input, c.profile, { roundMemberShares: true }).result;
        const cents = calculateShift(c.input, c.profile, { roundMemberShares: false }).result;
        let heldTotal = 0;
        whole.roles.forEach((r, i) => {
          const centsRole = at(cents.roles, i);
          expect(r.role).toBe(centsRole.role);
          const held = centsRole.amount - r.amount;
          expect(r.heldBack ?? 0).toBe(held);
          if (!c.input.roundToDollar || r.members.length === 0) {
            expect(held).toBe(0);
          } else {
            expect(held).toBeGreaterThanOrEqual(0);
            expect(held % 100).toBe(0);
            expect(held / 100).toBeLessThan(r.members.length);
          }
          heldTotal += held;
        });
        expect(whole.pool).toBe(cents.pool - heldTotal);
        expect(whole.kept).toBe(cents.kept + heldTotal);
        expect(whole.roundingAdjustment).toBe(cents.roundingAdjustment + heldTotal);
        expect(whole.retained).toBe(cents.retained);
      }),
      PARAMS,
    );
  });

  it('roles mirror the profile rules; retained == sum of missing role amounts', () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const res = run(c);
        expect(res.roles.map((r) => r.role).sort()).toEqual(
          c.profile.rules.map((r) => r.role).sort(),
        );
        const missing = res.roles.filter((r) => r.missing);
        expect(sum(missing.map((r) => r.amount))).toBe(res.retained);
        for (const r of missing) expect(r.members).toEqual([]);
        if (c.input.missingRoleHandling === 'redistribute') expect(res.retained).toBe(0);
        // kitchen is never missing
        const kitchen = res.roles.find((r) => r.role === 'kitchen');
        if (kitchen) expect(kitchen.missing).toBeFalsy();
      }),
      PARAMS,
    );
  });

  it('roundingAdjustment = floor trim (0-99c) + dollars held back from roles; 0 when off', () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const res = run(c);
        if (!c.input.roundToDollar) {
          expect(res.roundingAdjustment).toBe(0);
          return;
        }
        const held = sum(res.roles.map((r) => r.heldBack ?? 0));
        const trim = res.roundingAdjustment - held;
        expect(trim).toBeGreaterThanOrEqual(0);
        expect(trim).toBeLessThan(100);
        if (!wholeDollarShares(c)) expect(held).toBe(0);
      }),
      PARAMS,
    );
  });

  it('with rounding on, role, member and keptSplit amounts are whole dollars (unless roundMemberShares: false)', () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const res = run(c, { roundToDollar: true });
        expect((res.pool + res.retained) % 100).toBe(0);
        const whole = wholeDollarShares(c, true);
        for (const r of res.roles) {
          expect(r.amount % 100).toBe(0);
          if (whole) for (const m of r.members) expect(m.amount % 100).toBe(0);
        }
        if (whole) for (const k of res.keptSplit ?? []) expect(k.amount % 100).toBe(0);
      }),
      PARAMS,
    );
  });

  it('a pool over total tips is capped and warns POOL_EXCEEDS_TIPS; otherwise no such warning', () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const { result, warnings } = runFull(c);
        const codes = warnings.map((w) => w.code);
        const raw = rawPool(c);
        expect(result.pool + result.retained + result.roundingAdjustment).toBeLessThanOrEqual(
          c.input.totalTips,
        );
        // Strictly above tips by more than the half-cent rounding band -> must warn.
        // At or below tips -> must not warn. (The band in between is finding #24.)
        if (raw > c.input.totalTips + 0.5) expect(codes).toContain('POOL_EXCEEDS_TIPS');
        if (raw <= c.input.totalTips) expect(codes).not.toContain('POOL_EXCEEDS_TIPS');
      }),
      PARAMS,
    );
  });

  it('rounding never increases the total tipped out', () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const on = run(c, { roundToDollar: true });
        const off = run(c, { roundToDollar: false });
        expect(on.pool + on.retained).toBeLessThanOrEqual(off.pool + off.retained);
        expect(on.pool + on.retained + on.roundingAdjustment).toBe(off.pool + off.retained);
      }),
      PARAMS,
    );
  });

  it("'redistribute' pays out exactly what 'retain' pays plus what it retains (cent members)", () => {
    // With whole-dollar members the odd-dollar holds differ between the two allocations, so the
    // identity is checked with cent-level member splits (findings #35).
    fc.assert(
      fc.property(caseArb, (c) => {
        const cents = { ...c, roundMemberShares: false };
        const retain = run(cents, { missingRoleHandling: 'retain' });
        const redistribute = run(cents, { missingRoleHandling: 'redistribute' });
        expect(redistribute.pool).toBe(retain.pool + retain.retained);
        expect(redistribute.retained).toBe(0);
        expect(retain.kept).toBeGreaterThanOrEqual(redistribute.kept);
      }),
      PARAMS,
    );
  });

  it('members with no hours entered get equal shares (identical in whole dollars, within 1c)', () => {
    // Whole dollars: equal members tie on remainder and hours, so they always get the same
    // amount (any odd dollars are held back, owner Q7). Cents: within one cent.
    fc.assert(
      fc.property(caseArb, (c) => {
        const res = run(c);
        const tol = wholeDollarShares(c) ? 0 : 1;
        for (const r of res.roles) {
          const ids = new Set(r.members.map((m) => m.memberId));
          const anyHours = c.input.team.some(
            (m) => ids.has(m.id) && (m.hours !== undefined || m.clockIn !== undefined),
          );
          if (anyHours || r.members.length < 2) continue;
          const amounts = r.members.map((m) => m.amount);
          expect(Math.max(...amounts) - Math.min(...amounts)).toBeLessThanOrEqual(tol);
        }
      }),
      PARAMS,
    );
  });

  it('percentages are finite and consistent with amounts', () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const res = run(c);
        const tips = c.input.totalTips;
        const net = c.input.netSales;
        const pctOf = (a: number, b: number) => (b === 0 ? 0 : (a / b) * 100);
        expect(Number.isFinite(res.poolPercentOfTips)).toBe(true);
        expect(Number.isFinite(res.poolPercentOfNetSales)).toBe(true);
        expect(res.poolPercentOfTips).toBeCloseTo(pctOf(res.pool, tips), 6);
        expect(res.poolPercentOfNetSales).toBeCloseTo(pctOf(res.pool, net), 6);
        for (const r of res.roles) {
          expect(Number.isFinite(r.percentOfTips)).toBe(true);
          expect(Number.isFinite(r.percentOfNetSales)).toBe(true);
          expect(r.percentOfTips).toBeGreaterThanOrEqual(0);
          expect(r.percentOfTips).toBeLessThanOrEqual(100 + 1e-9);
          if (!r.missing) expect(r.percentOfTips).toBeCloseTo(pctOf(r.amount, tips), 6);
          for (const m of r.members) {
            expect(m.percentOfTips).toBeCloseTo(pctOf(m.amount, tips), 6);
          }
        }
      }),
      PARAMS,
    );
  });

  it('ZERO_SHARE_AFTER_ROUNDING: never with rounding off; always when a member got $0 of a non-empty split', () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const { result, warnings } = runFull(c);
        const zero = warnings.filter((w) => w.code === 'ZERO_SHARE_AFTER_ROUNDING');
        expect(zero.length).toBeLessThanOrEqual(1);
        if (!c.input.roundToDollar) {
          expect(zero).toHaveLength(0);
          return;
        }
        if (!wholeDollarShares(c)) return; // cent splits under rounding: findings #36
        const zeroMembers = result.roles.flatMap((r) =>
          r.members.filter((m) => m.amount === 0).map((m) => ({ m, role: r })),
        );
        const zeroBartenders = (result.keptSplit ?? []).filter((k) => k.amount === 0);
        if (zeroMembers.length === 0 && zeroBartenders.length === 0) {
          expect(zero).toHaveLength(0);
        }
        // a role that had at least $1 to split but left someone at $0 must warn and name them
        for (const { m, role } of zeroMembers) {
          if (role.amount + (role.heldBack ?? 0) >= 100) {
            expect(zero).toHaveLength(1);
            expect(at(zero, 0).message).toContain(m.name);
          }
        }
      }),
      PARAMS,
    );
  });

  it('TeamMember.isUser never changes the output', () => {
    fc.assert(
      fc.property(caseArb, fc.nat(), (c, pick) => {
        const team = c.input.team.map((m, i) => ({
          ...m,
          isUser: c.input.team.length > 0 && i === pick % c.input.team.length,
        }));
        const flagged = runFull({ ...c, input: { ...c.input, team } });
        expect(flagged).toEqual(runFull(c));
      }),
      { seed: SEED, numRuns: 150 },
    );
  });

  it('is deterministic', () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        expect(run(c)).toEqual(run(c));
      }),
      { seed: SEED, numRuns: 100 },
    );
  });
});

describe('splitLargestRemainder properties', () => {
  const weightsArb = fc
    .array(
      fc.oneof(fc.integer({ min: 0, max: 1000 }), fc.double({ min: 0, max: 1000, noNaN: true })),
      { minLength: 1, maxLength: 12 },
    )
    .filter((ws) => ws.some((w) => w > 0));

  it('parts are non-negative integers summing exactly to the total', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100_000_000 }), weightsArb, (total, weights) => {
        const parts = splitLargestRemainder(total, weights);
        expect(parts).toHaveLength(weights.length);
        expect(sum(parts)).toBe(total);
        for (const p of parts) {
          expect(Number.isInteger(p)).toBe(true);
          expect(p).toBeGreaterThanOrEqual(0);
        }
      }),
      PARAMS,
    );
  });

  it('each part is within 1 of its exact proportional share', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100_000_000 }), weightsArb, (total, weights) => {
        const parts = splitLargestRemainder(total, weights);
        const w = sum(weights);
        parts.forEach((p, i) => {
          const exact = (total * at(weights, i)) / w;
          expect(Math.abs(p - exact)).toBeLessThan(1 + 1e-6);
        });
      }),
      PARAMS,
    );
  });

  it('zero-weight parts get 0', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100_000_000 }), weightsArb, (total, weights) => {
        const parts = splitLargestRemainder(total, weights);
        weights.forEach((wt, i) => {
          if (wt === 0) expect(parts[i]).toBe(0);
        });
      }),
      PARAMS,
    );
  });
});
