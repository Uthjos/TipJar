/**
 * TipJar calculation engine (CLAUDE.md §5). Pure TypeScript, integer cents throughout.
 */
import { EngineValidationError, type EngineWarning } from './errors';
import { memberHours } from './hours';
import { floorToDollar, splitLargestRemainder } from './money';
import type {
  Cents,
  KeptSplitEntry,
  MemberResult,
  RoleId,
  RoleResult,
  ShiftInput,
  ShiftResult,
  TeamMember,
  TipOutProfile,
  TipOutRule,
} from './types';

export { EngineValidationError } from './errors';
export type { EngineValidationCode, EngineWarning, EngineWarningCode } from './errors';

export interface CalculateOptions {
  /**
   * When rounding to the dollar is on, split each role's (whole-dollar) amount into whole-dollar
   * member shares, and (bartender flow) share the bar's kept tips in whole dollars with the
   * leftover cents reported as `keptChange` (CLAUDE.md §5.4 steps 4-5, owner Q1/Q2).
   * Default true; pass false for cent-level splits. Has no effect when `roundToDollar` is off.
   */
  roundMemberShares?: boolean;
}

export interface CalculateOutput {
  result: ShiftResult;
  warnings: EngineWarning[];
}

/** Roles that never need named members and are therefore never "missing". */
const NEVER_MISSING_ROLES: ReadonlySet<RoleId> = new Set(['kitchen']);

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function pct(part: number, whole: number): number {
  return whole > 0 ? (part / whole) * 100 : 0;
}

/** Split that tolerates all-zero weights (returns all zeros when total is 0, else equal split). */
function safeSplit(total: Cents, weights: number[]): Cents[] {
  if (weights.length === 0) return [];
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum > 0) return splitLargestRemainder(total, weights);
  if (total === 0) return weights.map(() => 0);
  return splitLargestRemainder(
    total,
    weights.map(() => 1),
  );
}

function validateMoney(label: string, value: number): Cents {
  if (!Number.isFinite(value) || value < 0) {
    throw new EngineValidationError('NEGATIVE_AMOUNT', `${label} must be zero or more.`);
  }
  return Math.round(value);
}

function validateProfile(profile: TipOutProfile): void {
  const seen = new Set<RoleId>();
  for (const rule of profile.rules) {
    if (seen.has(rule.role)) {
      throw new EngineValidationError(
        'DUPLICATE_ROLE',
        `The profile lists ${rule.role} more than once. Each role can only have one rule.`,
      );
    }
    seen.add(rule.role);
  }
  const p = profile.totalTipOutPercentOfTips;
  if (!Number.isFinite(p) || p < 0 || p > 100) {
    throw new EngineValidationError(
      'INVALID_PERCENT',
      `Tip-out percentage must be between 0 and 100 (got ${p}).`,
    );
  }
  for (const rule of profile.rules) {
    if (rule.type === 'percentOfBasis') {
      if (!Number.isFinite(rule.percent) || rule.percent < 0 || rule.percent > 100) {
        throw new EngineValidationError(
          'INVALID_PERCENT',
          `Percentage for ${rule.role} must be between 0 and 100 (got ${rule.percent}).`,
        );
      }
    } else if (!Number.isFinite(rule.weight) || rule.weight <= 0) {
      throw new EngineValidationError(
        'INVALID_WEIGHT',
        `Weight for ${rule.role} must be greater than 0 (got ${rule.weight}).`,
      );
    }
  }
}

interface MemberHours {
  member: TeamMember;
  hours: number | undefined;
}

/**
 * Resolve hours for a group of members. Returns split weights:
 * - nobody has hours -> equal split (weights 1, reported hours 0)
 * - everybody has hours -> by hours (all zero -> equal split)
 * - some but not all -> PARTIAL_HOURS
 */
function resolveGroupHours(
  role: RoleId,
  members: TeamMember[],
): { weights: number[]; hours: number[] } {
  const withHours: MemberHours[] = members.map((m) => ({ member: m, hours: memberHours(m) }));
  const given = withHours.filter((h) => h.hours !== undefined).length;
  if (given === 0) {
    return { weights: members.map(() => 1), hours: members.map(() => 0) };
  }
  if (given !== members.length) {
    const missing = withHours
      .filter((h) => h.hours === undefined)
      .map((h) => h.member.name || 'someone')
      .join(', ');
    throw new EngineValidationError(
      'PARTIAL_HOURS',
      `Some ${role} hours are missing (${missing}). Enter hours for everyone in the role, or leave them all blank for an even split.`,
    );
  }
  const hours = withHours.map((h) => h.hours as number);
  const total = hours.reduce((a, b) => a + b, 0);
  return { weights: total > 0 ? hours : members.map(() => 1), hours };
}

function splitAmongMembers(
  amount: Cents,
  members: TeamMember[],
  group: { weights: number[]; hours: number[] },
  wholeDollars: boolean,
  totalTips: Cents,
): MemberResult[] {
  if (members.length === 0) return [];
  let parts: Cents[];
  if (wholeDollars && amount % 100 === 0) {
    parts = safeSplit(amount / 100, group.weights).map((d) => d * 100);
  } else {
    parts = safeSplit(amount, group.weights);
  }
  return members.map((m, i) => ({
    memberId: m.id,
    name: m.name,
    hours: group.hours[i]!,
    amount: parts[i]!,
    percentOfTips: pct(parts[i]!, totalTips),
  }));
}

function basisValue(
  rule: Extract<TipOutRule, { type: 'percentOfBasis' }>,
  amounts: { totalTips: Cents; netSales: Cents; foodSales: Cents },
): Cents {
  switch (rule.basis) {
    case 'foodSales':
      return amounts.foodSales;
    case 'netSales':
      return amounts.netSales;
    case 'totalTips':
      return amounts.totalTips;
  }
}

// ---------------------------------------------------------------------------
// main entry point
// ---------------------------------------------------------------------------

/**
 * Calculate tip-outs for a shift.
 *
 * Semantics (see CLAUDE.md §5):
 * - `pool` = amount actually paid out to roles (excludes any retained share).
 * - `kept = totalTips - pool` (includes `retained` and `roundingAdjustment`).
 * - `roundingAdjustment` = unrounded (capped) pool (to the cent) - floored pool; 0 when rounding
 *   is off.
 * - `keptChange` = kept - sum(keptSplit) in the bartender flow with whole-dollar rounding; else 0.
 * - Missing roles ('retain'): listed with their computed amount, `missing: true`, no members;
 *   the amount is in `retained`, not `pool`.
 * - Missing roles ('redistribute'): listed with amount 0, `missing: true`; their share goes to
 *   the present shareOfRemainder roles by weight. If *every* shareOfRemainder role is missing,
 *   there is nobody to redistribute to and the share is retained instead.
 *
 * @throws EngineValidationError for blocking input problems.
 */
export function calculateShift(
  input: ShiftInput,
  profile: TipOutProfile,
  options: CalculateOptions = {},
): CalculateOutput {
  const warnings: EngineWarning[] = [];

  // --- validation -----------------------------------------------------------
  const totalTips = validateMoney('Total tips', input.totalTips);
  const netSales = validateMoney('Net sales', input.netSales);
  const foodSales = validateMoney('Food sales', input.foodSales);
  validateProfile(profile);

  if (foodSales > netSales) {
    warnings.push({
      code: 'FOOD_EXCEEDS_NET',
      message: 'Food sales are higher than net sales — double-check the numbers.',
    });
  }

  if (profile.appliesTo !== input.userRole) {
    warnings.push({
      code: 'PROFILE_ROLE_MISMATCH',
      message: `The "${profile.name}" profile is meant for a ${profile.appliesTo}, but this shift is for a ${input.userRole}.`,
    });
  }

  const rounding = input.roundToDollar;
  const roundMembers = rounding && options.roundMemberShares !== false;
  const team = input.team ?? [];

  const membersByRole = new Map<RoleId, TeamMember[]>();
  for (const m of team) {
    const list = membersByRole.get(m.role);
    if (list) list.push(m);
    else membersByRole.set(m.role, [m]);
  }
  const membersOf = (role: RoleId): TeamMember[] => membersByRole.get(role) ?? [];

  // Team members whose role gets nothing from this profile (and who don't share the bar's
  // kept tips) are left out of the calculation; tell the user rather than dropping them silently.
  const ruleRoles = new Set<RoleId>(profile.rules.map((r) => r.role));
  const unused = team.filter(
    (m) =>
      !ruleRoles.has(m.role) &&
      !(input.userRole === 'bartender' && m.role === 'bartender') &&
      !NEVER_MISSING_ROLES.has(m.role),
  );
  if (unused.length > 0) {
    const one = unused.length === 1;
    warnings.push({
      code: 'UNUSED_TEAM_MEMBERS',
      message: `${unused.map((m) => m.name || 'Someone').join(', ')} ${one ? 'is' : 'are'} not in a role this profile tips out, so ${one ? 'gets' : 'get'} nothing.`,
    });
  }

  // Resolve hours for every role we will split (validates PARTIAL_HOURS / INVALID_CLOCK up front).
  const groupHours = new Map<RoleId, { weights: number[]; hours: number[] }>();
  const rolesNeedingHours = new Set<RoleId>(profile.rules.map((r) => r.role));
  if (input.userRole === 'bartender') rolesNeedingHours.add('bartender');
  for (const role of rolesNeedingHours) {
    const members = membersOf(role);
    if (members.length > 0) groupHours.set(role, resolveGroupHours(role, members));
  }

  // --- 1. pool --------------------------------------------------------------
  // pool = poolBasis x % (owner Q4); a sales-based pool can never exceed total tips.
  const poolBasisValue =
    profile.poolBasis === 'netSales'
      ? netSales
      : profile.poolBasis === 'foodSales'
        ? foodSales
        : totalTips;
  let poolExact = (poolBasisValue * profile.totalTipOutPercentOfTips) / 100; // fractional cents
  if (poolExact > totalTips) {
    warnings.push({
      code: 'POOL_EXCEEDS_TIPS',
      message:
        'The tip-out (a percentage of sales) came to more than your total tips, so it was capped at your total tips.',
    });
    poolExact = totalTips;
  }
  const poolCents = Math.min(totalTips, Math.round(poolExact));

  // --- missing roles --------------------------------------------------------
  // A role is missing when nobody in it is on shift. Kitchen never needs named members. This
  // applies to fixed (percentOfBasis) roles too, so a custom carve-out like "busser 1% of net
  // sales" is never paid out to nobody (review D4).
  const amounts = { totalTips, netSales, foodSales };
  const carveIdx: number[] = [];
  const shareIdx: number[] = [];
  profile.rules.forEach((r, i) => (r.type === 'percentOfBasis' ? carveIdx : shareIdx).push(i));
  const isMissing = (role: RoleId) =>
    !NEVER_MISSING_ROLES.has(role) && membersOf(role).length === 0;
  const carveRules = carveIdx.map(
    (i) => profile.rules[i] as Extract<TipOutRule, { type: 'percentOfBasis' }>,
  );
  const shareRules = shareIdx.map(
    (i) => profile.rules[i] as Extract<TipOutRule, { type: 'shareOfRemainder' }>,
  );
  const carveMissing = carveRules.map((r) => isMissing(r.role));
  const missingFlags = shareRules.map((r) => isMissing(r.role));
  const anyPresent = missingFlags.some((m) => !m);
  const anyMissing = missingFlags.some((m) => m) || carveMissing.some((m) => m);
  // 'redistribute' with no staffed share role to receive it falls back to retaining (warned).
  const redistribute = input.missingRoleHandling === 'redistribute' && anyPresent;
  if (input.missingRoleHandling === 'redistribute' && anyMissing && !anyPresent) {
    warnings.push({
      code: 'NO_REDISTRIBUTION_RECIPIENTS',
      message:
        'Nobody is on shift in the roles that could take the missing share, so it stays with you.',
    });
  }

  // --- 2. carve-outs (exact) ------------------------------------------------
  // A missing carve-out that is being redistributed carves nothing: its money stays in the
  // remainder and is split over the staffed share roles by weight.
  let carveExact = carveRules.map((rule, j) =>
    redistribute && carveMissing[j] ? 0 : (basisValue(rule, amounts) * rule.percent) / 100,
  );
  const carveExactSum = carveExact.reduce((a, b) => a + b, 0);
  const carveCapped = carveExactSum > poolExact;
  if (carveCapped) {
    warnings.push({
      code: 'CARVEOUTS_EXCEED_POOL',
      message:
        'Fixed tip-outs (like kitchen) are more than the whole tip-out pool, so they were capped to the pool.',
    });
    carveExact =
      carveExactSum > 0 ? carveExact.map((c) => (c * poolExact) / carveExactSum) : carveExact;
  }

  // --- 3. remainder shares (exact) ------------------------------------------
  // Which share rules receive a slice of the remainder.
  const shareParticipates = missingFlags.map((missing) => !(redistribute && missing));
  const shareWeights = shareRules.map((r, k) => (shareParticipates[k] ? r.weight : 0));
  const shareWeightSum = shareWeights.reduce((a, b) => a + b, 0);

  // --- 4. allocate cents to every component --------------------------------
  // Components: [...carve-outs, ...share rules, unassigned]
  let carveAmounts: Cents[];
  let shareAmounts: Cents[];
  let flooredPool = poolCents;

  if (!rounding) {
    // Carve-outs rounded to the cent individually; remainder split by largest remainder.
    carveAmounts = carveExact.map((c) => Math.round(c));
    if (carveAmounts.reduce((a, b) => a + b, 0) > poolCents) {
      carveAmounts = safeSplit(poolCents, carveExact);
    }
    const remainder = poolCents - carveAmounts.reduce((a, b) => a + b, 0);
    shareAmounts =
      shareWeightSum > 0 ? splitLargestRemainder(remainder, shareWeights) : shareRules.map(() => 0);
  } else {
    // §5.4: floor the pool to the dollar, then allocate whole dollars across the unrounded
    // carve-outs and role shares with the largest-remainder method.
    flooredPool = floorToDollar(poolCents);
    const remainderExact = Math.max(0, poolExact - carveExact.reduce((a, b) => a + b, 0));
    const shareExact = shareWeights.map((w) =>
      shareWeightSum > 0 ? (remainderExact * w) / shareWeightSum : 0,
    );
    const unassignedExact = shareWeightSum > 0 ? 0 : remainderExact;
    const weights = [...carveExact, ...shareExact, unassignedExact];
    const dollars = safeSplitOrZero(flooredPool / 100, weights);
    carveAmounts = dollars.slice(0, carveExact.length).map((d) => d * 100);
    shareAmounts = dollars
      .slice(carveExact.length, carveExact.length + shareExact.length)
      .map((d) => d * 100);
  }

  // --- 5. assemble roles ----------------------------------------------------
  let pool = 0;
  let retained = 0;
  const roles: RoleResult[] = [];
  let carveK = 0;
  let shareK = 0;

  for (const rule of profile.rules) {
    let amount: Cents;
    let missing = false;
    if (rule.type === 'percentOfBasis') {
      const j = carveK++;
      amount = carveAmounts[j]!;
      missing = carveMissing[j]!;
    } else {
      const k = shareK++;
      amount = shareAmounts[k]!;
      missing = missingFlags[k]!;
    }

    if (missing) {
      // Retained (or 0 when redistributed).
      retained += amount;
      roles.push({
        role: rule.role,
        amount,
        percentOfTips: pct(amount, totalTips),
        percentOfNetSales: pct(amount, netSales),
        members: [],
        missing: true,
      });
      continue;
    }

    pool += amount;
    const members = NEVER_MISSING_ROLES.has(rule.role) ? [] : membersOf(rule.role);
    const group = groupHours.get(rule.role);
    roles.push({
      role: rule.role,
      amount,
      percentOfTips: pct(amount, totalTips),
      percentOfNetSales: pct(amount, netSales),
      members:
        group && members.length > 0
          ? splitAmongMembers(amount, members, group, roundMembers, totalTips)
          : [],
      missing: false,
    });
  }

  const kept = totalTips - pool;
  const roundingAdjustment = rounding ? poolCents - flooredPool : 0;

  // --- 6. bartender flow: split what the bar keeps --------------------------
  // With whole-dollar rounding the bar shares floorToDollar(kept) in whole dollars and the
  // leftover cents are reported as keptChange (owner Q2); otherwise kept is split to the cent.
  let keptSplit: KeptSplitEntry[] | undefined;
  let keptChange: Cents = 0;
  if (input.userRole === 'bartender') {
    const bartenders = membersOf('bartender');
    const group = groupHours.get('bartender');
    if (bartenders.length > 0 && group) {
      let parts: Cents[];
      if (roundMembers) {
        const shared = floorToDollar(kept);
        keptChange = kept - shared;
        parts = safeSplit(shared / 100, group.weights).map((d) => d * 100);
      } else {
        parts = safeSplit(kept, group.weights);
      }
      keptSplit = bartenders.map((m, i) => ({
        memberId: m.id,
        name: m.name,
        hours: group.hours[i]!,
        amount: parts[i]!,
      }));
    } else {
      keptSplit = [];
    }
  }

  const result: ShiftResult = {
    pool,
    poolPercentOfTips: pct(pool, totalTips),
    poolPercentOfNetSales: pct(pool, netSales),
    kept,
    keptChange,
    retained,
    roles,
    roundingAdjustment,
  };
  if (keptSplit !== undefined) result.keptSplit = keptSplit;

  return { result, warnings };
}

function safeSplitOrZero(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0 || total === 0) return weights.map(() => 0);
  return splitLargestRemainder(total, weights);
}
