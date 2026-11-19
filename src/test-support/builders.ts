/**
 * Test builders and fixtures for the TipJar calc engine acceptance suite.
 * Pure TypeScript, no React/Expo imports. Not a test file itself.
 */
import type {
  Cents,
  RoleId,
  RoleResult,
  ShiftInput,
  ShiftResult,
  TeamMember,
  TipOutProfile,
} from '../engine/types';
import { EngineValidationError } from '../engine/calculate';

let autoId = 0;

/** Build a team member. Pass `hours` or `clockIn`/`clockOut` via `extra`. */
export function member(
  name: string,
  role: RoleId,
  extra: Partial<Omit<TeamMember, 'name' | 'role'>> = {},
): TeamMember {
  autoId += 1;
  return { id: extra.id ?? `${role}-${name.toLowerCase()}-${autoId}`, name, role, ...extra };
}

/** Build a ShiftInput with sensible defaults (server flow, rounding off, redistribute). */
export function shiftInput(overrides: Partial<ShiftInput> = {}): ShiftInput {
  return {
    date: '2026-11-17',
    userRole: 'server',
    totalTips: 0,
    netSales: 0,
    foodSales: 0,
    team: [],
    missingRoleHandling: 'redistribute',
    profileId: overrides.userRole === 'bartender' ? 'bartender-default' : 'server-default',
    roundToDollar: false,
    ...overrides,
  };
}

/** Golden 1 (CLAUDE.md §5.5) team: Joseph, Aaron (bartenders), David, Allen (barbacks), Hannah (host). */
export function golden1Team(): TeamMember[] {
  return [
    member('Joseph', 'bartender', { id: 'joseph' }),
    member('Aaron', 'bartender', { id: 'aaron' }),
    member('David', 'barback', { id: 'david' }),
    member('Allen', 'barback', { id: 'allen' }),
    member('Hannah', 'host', { id: 'hannah' }),
  ];
}

/** Golden 1 input: $340.56 tips, $1,560.25 net, $700.12 food, rounding ON. */
export function golden1Input(overrides: Partial<ShiftInput> = {}): ShiftInput {
  return shiftInput({
    userRole: 'server',
    profileId: 'server-default',
    totalTips: 34056,
    netSales: 156025,
    foodSales: 70012,
    team: golden1Team(),
    roundToDollar: true,
    missingRoleHandling: 'redistribute',
    ...overrides,
  });
}

/** Golden 2 (CLAUDE.md §5.6) team: bartenders Joseph + Aaron (share kept), barbacks David + Allen, no host. */
export function golden2Team(): TeamMember[] {
  return [
    member('Joseph', 'bartender', { id: 'joseph' }),
    member('Aaron', 'bartender', { id: 'aaron' }),
    member('David', 'barback', { id: 'david' }),
    member('Allen', 'barback', { id: 'allen' }),
  ];
}

/** Golden 2 input: $192.55 tips, $905.43 net, $120.00 food, rounding ON, retain. */
export function golden2Input(overrides: Partial<ShiftInput> = {}): ShiftInput {
  return shiftInput({
    userRole: 'bartender',
    profileId: 'bartender-default',
    totalTips: 19255,
    netSales: 90543,
    foodSales: 12000,
    team: golden2Team(),
    roundToDollar: true,
    missingRoleHandling: 'retain',
    ...overrides,
  });
}

/** Find a role in the result; fails loudly if absent. */
export function roleOf(result: ShiftResult, role: RoleId): RoleResult {
  const found = result.roles.find((r) => r.role === role);
  if (!found) {
    throw new Error(
      `role "${role}" not found in result.roles: [${result.roles.map((r) => r.role).join(', ')}]`,
    );
  }
  return found;
}

/** Member amounts of a role keyed by memberId. */
export function memberAmounts(role: RoleResult): Record<string, Cents> {
  const out: Record<string, Cents> = {};
  for (const m of role.members) out[m.memberId] = m.amount;
  return out;
}

/** keptSplit amounts keyed by memberId. */
export function keptSplitAmounts(result: ShiftResult): Record<string, Cents> {
  const out: Record<string, Cents> = {};
  for (const k of result.keptSplit ?? []) out[k.memberId] = k.amount;
  return out;
}

/** Index into an array, failing loudly instead of yielding undefined (noUncheckedIndexedAccess-safe). */
export function at<T>(xs: readonly T[], i: number): T {
  const v = xs[i];
  if (v === undefined) throw new Error(`index ${i} out of range (length ${xs.length})`);
  return v;
}

export function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

/** Sum of amounts actually paid to roles (excludes missing roles, whose amounts are retained or 0). */
export function paidRolesTotal(result: ShiftResult): Cents {
  return sum(result.roles.filter((r) => !r.missing).map((r) => r.amount));
}

/** Assert that `fn` throws an EngineValidationError with the given code. */
export function expectValidationError(fn: () => unknown, code: EngineValidationError['code']): void {
  let caught: unknown;
  try {
    fn();
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(EngineValidationError);
  expect((caught as EngineValidationError).code).toBe(code);
}

/** Recursively freeze an object so tests can assert the engine never mutates its inputs. */
export function deepFreeze<T>(obj: T): T {
  if (obj && typeof obj === 'object') {
    Object.freeze(obj);
    for (const value of Object.values(obj as Record<string, unknown>)) deepFreeze(value);
  }
  return obj;
}

/** Convenience custom-profile builder. */
export function profile(p: Omit<TipOutProfile, 'id' | 'name'> & Partial<TipOutProfile>): TipOutProfile {
  return { id: p.id ?? 'custom', name: p.name ?? 'Custom', ...p };
}
