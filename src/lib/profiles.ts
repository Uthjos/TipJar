/**
 * Pure helpers for tip-out profiles (docs/m5-contract.md). No React / DB imports.
 */
import {
  BARTENDER_DEFAULT_PROFILE,
  DEFAULT_PROFILES,
  roleLabel,
  roleSingular,
  SERVER_DEFAULT_PROFILE,
} from '@/engine/profiles';
import type { Basis, RoleId, TipOutProfile, TipOutRule, UserRole } from '@/engine/types';

/** Role ids with built-in labels; they never carry a `label`. */
export const BUILT_IN_ROLES: readonly RoleId[] = [
  'kitchen',
  'bartender',
  'barback',
  'host',
  'server',
];

function cleanId(text: string): string {
  return text
    .trim()
    .normalize('NFC')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Cleaned spellings that mean a built-in role: "barback", "barbacks", "kitchen-kto", ... */
const BUILT_IN_ALIASES: ReadonlyMap<string, RoleId> = new Map(
  BUILT_IN_ROLES.flatMap((id) =>
    [id, `${id}s`, cleanId(roleLabel(id)), cleanId(roleSingular(id))].map(
      (alias) => [alias, id] as const,
    ),
  ),
);

/**
 * Role id for a custom role name: trim, NFC, lower-case, spaces/punctuation -> '-', repeats
 * collapsed, ends stripped. A name meaning a built-in role returns that id ("Barbacks" ->
 * 'barback', "Host" -> 'host'). Empty after cleaning -> ''.
 */
export function roleIdFromLabel(label: string): RoleId {
  const id = cleanId(label);
  return BUILT_IN_ALIASES.get(id) ?? id;
}

/** Display name for a rule's role: its label if present, else the built-in label. */
export function displayRole(rule: Pick<TipOutRule, 'role' | 'label'>): string {
  const label = rule.label?.trim();
  return label ? label : roleLabel(rule.role);
}

/**
 * Names for a role as used in `profile` (extra helper, not in the contract): the rule's label for
 * custom roles (used for both forms), else the built-in plural / singular labels.
 */
export function roleNames(
  profile: TipOutProfile | undefined,
  role: RoleId,
): { plural: string; singular: string } {
  const label = profile?.rules.find((r) => r.role === role)?.label?.trim();
  if (label) return { plural: label, singular: label };
  return { plural: roleLabel(role), singular: roleSingular(role) };
}

/**
 * The role/label patch for a rule renamed to `text` (extra helper, decisions #61/#62).
 * - #61: a rule's `role` id is fixed once the rule exists (`roleFixed`); renaming then changes
 *   only `label`, so History, coworkers' usualRole and saved shifts keep the same role id. Typing
 *   the role's own built-in name back removes the label.
 * - While a new custom rule is first being named (`roleFixed` false), role = roleIdFromLabel(text).
 * - #62: a name that resolves to a built-in role stores that role with no label.
 */
export function renameRolePatch(
  rule: Pick<TipOutRule, 'role'>,
  text: string,
  roleFixed: boolean,
): { role: RoleId; label: string } {
  const id = roleIdFromLabel(text);
  const builtIn = (BUILT_IN_ROLES as readonly string[]).includes(id);
  if (roleFixed && rule.role) {
    return { role: rule.role, label: id === rule.role && builtIn ? '' : text.trim() };
  }
  return builtIn ? { role: id, label: '' } : { role: id, label: text.trim() };
}

function copyRule(rule: TipOutRule): TipOutRule {
  return { ...rule };
}

function copyProfile(p: TipOutProfile): TipOutProfile {
  return { ...p, rules: p.rules.map(copyRule) };
}

/** Deep copy of `base` with a new id and name; `appliesTo` defaults to the base's. */
export function newProfile(
  base: TipOutProfile,
  opts: { id: string; name: string; appliesTo?: UserRole },
): TipOutProfile {
  return {
    ...copyProfile(base),
    id: opts.id,
    name: opts.name,
    appliesTo: opts.appliesTo ?? base.appliesTo,
  };
}

/** Append a rule. Returns a new profile; the input is never mutated. */
export function addRule(p: TipOutProfile, rule: TipOutRule): TipOutProfile {
  return { ...copyProfile(p), rules: [...p.rules.map(copyRule), copyRule(rule)] };
}

type RulePatch = {
  role?: RoleId;
  label?: string;
  type?: TipOutRule['type'];
  basis?: Basis;
  percent?: number;
  weight?: number;
};

/**
 * Merge `patch` into the rule at `index`. Switching `type` reshapes the rule: a fixed % rule
 * keeps/gets `basis` (default food sales) and `percent` (default 0); a share rule keeps/gets
 * `weight` (default 1). Passing `label: ''` (or undefined explicitly) removes the label.
 * Out-of-range index: an unchanged copy.
 */
export function updateRule(p: TipOutProfile, index: number, patch: RulePatch): TipOutProfile {
  const out = copyProfile(p);
  const current = out.rules[index];
  if (!current) return out;
  const merged = { ...current, ...patch } as RulePatch & { role: RoleId; type: TipOutRule['type'] };
  let next: TipOutRule =
    merged.type === 'percentOfBasis'
      ? {
          role: merged.role,
          type: 'percentOfBasis',
          basis: merged.basis ?? 'foodSales',
          percent: merged.percent ?? 0,
        }
      : { role: merged.role, type: 'shareOfRemainder', weight: merged.weight ?? 1 };
  if (merged.label !== undefined && merged.label !== '') next = { ...next, label: merged.label };
  out.rules[index] = next;
  return out;
}

/** Remove the rule at `index` (out of range: unchanged copy). */
export function removeRule(p: TipOutProfile, index: number): TipOutProfile {
  const out = copyProfile(p);
  if (index >= 0 && index < out.rules.length) out.rules.splice(index, 1);
  return out;
}

/** Move the rule at `from` to position `to` (clamped). Out-of-range `from`: unchanged copy. */
export function moveRule(p: TipOutProfile, from: number, to: number): TipOutProfile {
  const out = copyProfile(p);
  if (from < 0 || from >= out.rules.length) return out;
  const target = Math.max(0, Math.min(out.rules.length - 1, to));
  const [rule] = out.rules.splice(from, 1);
  out.rules.splice(target, 0, rule!);
  return out;
}

/** 2 -> "2", 4.5 -> "4.5", 0.30000000000000004 -> "0.3". */
function num(n: number): string {
  return Number.isFinite(n) ? String(Number(n.toFixed(4))) : String(n);
}

function basisWords(basis: Basis | undefined): string {
  return basis === 'netSales' ? 'net sales' : basis === 'foodSales' ? 'food sales' : 'tips';
}

/** Short name for summaries: the label, else the built-in label without "(KTO)"-style notes. */
function summaryName(rule: TipOutRule): string {
  return rule.label?.trim() || roleLabel(rule.role).replace(/\s*\(.*\)\s*$/, '');
}

/**
 * One line for lists, e.g.
 * "30% of tips · Kitchen 2% of food sales · Bartenders 4 : Barbacks 3 : Hosts 1".
 */
export function profileSummary(p: TipOutProfile): string {
  const parts = [`${num(p.totalTipOutPercentOfTips)}% of ${basisWords(p.poolBasis)}`];
  for (const r of p.rules) {
    if (r.type === 'percentOfBasis') {
      parts.push(`${summaryName(r)} ${num(r.percent)}% of ${basisWords(r.basis)}`);
    }
  }
  const shares = p.rules
    .filter(
      (r): r is Extract<TipOutRule, { type: 'shareOfRemainder' }> => r.type === 'shareOfRemainder',
    )
    .map((r) => `${summaryName(r)} ${num(r.weight)}`);
  if (shares.length > 0) parts.push(shares.join(' : '));
  return parts.join(' · ');
}

const BUILT_IN_PROFILE_IDS: ReadonlySet<string> = new Set(DEFAULT_PROFILES.map((p) => p.id));

/** 'server-default' | 'bartender-default'. */
export function isBuiltInProfile(id: string): boolean {
  return BUILT_IN_PROFILE_IDS.has(id);
}

/** A fresh copy of the shipped default (for Reset), or null for other ids. */
export function builtInProfile(id: string): TipOutProfile | null {
  if (id === SERVER_DEFAULT_PROFILE.id) return copyProfile(SERVER_DEFAULT_PROFILE);
  if (id === BARTENDER_DEFAULT_PROFILE.id) return copyProfile(BARTENDER_DEFAULT_PROFILE);
  return null;
}
