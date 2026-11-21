import { format, parseISO } from 'date-fns';

import { formatCents } from '@/engine/money';
import { roleNames } from '@/lib/profiles';
import type { Basis, ShiftInput, ShiftResult, TipOutProfile } from '@/engine/types';

/** 'netSales' -> "net sales". Used to label a profile's pool % with its basis (finding #27). */
export function basisLabel(basis: Basis | undefined): string {
  return basis === 'netSales' ? 'net sales' : basis === 'foodSales' ? 'food sales' : 'total tips';
}

/** 29.951 -> "30.0%" */
export function formatPercent(p: number, digits = 1): string {
  return `${p.toFixed(digits)}%`;
}

export function formatShiftDate(iso: string): string {
  try {
    return format(parseISO(iso), 'EEE, MMM d, yyyy');
  } catch {
    return iso;
  }
}

/**
 * The "You keep" / "Bar keeps" amount shown on Results, in the share text and in History.
 * Bartender flow with bartenders listed: the whole dollars actually shared (kept - keptChange).
 * Otherwise (server flow, or no bartenders listed yet): all of `kept`.
 */
export function keptShown(result: ShiftResult): number {
  return result.keptSplit && result.keptSplit.length > 0
    ? result.kept - result.keptChange
    : result.kept;
}

/** Whether to show the leftover-change note: only when kept was actually shared out. */
export function hasChangeNote(result: ShiftResult): boolean {
  return !!result.keptSplit && result.keptSplit.length > 0 && result.keptChange > 0;
}

/**
 * Note for the bar's leftover change, e.g. "$0.55 in change left over — stays with whoever closes
 * out." When the tie rule held dollars back from the bartenders' split (`keptHeldBack`), says so:
 * "$1.55 in change left over ($1.00 from tied hours) — …".
 */
export function changeNote(keptChange: number, keptHeldBack = 0): string {
  const held = keptHeldBack > 0 ? ` (${formatCents(keptHeldBack)} from tied hours)` : '';
  return `${formatCents(keptChange)} in change left over${held} — stays with whoever closes out.`;
}

/**
 * Splits `roundingAdjustment` into its two parts (review round 3, #37): the cents trimmed when the
 * pool was floored to the dollar, and the whole dollars held back from role splits by the tie
 * rule (sum of `RoleResult.heldBack`).
 */
export function roundingParts(result: ShiftResult): { floorTrim: number; heldFromRoles: number } {
  const heldFromRoles = result.roles.reduce((a, r) => a + (r.heldBack ?? 0), 0);
  return { floorTrim: result.roundingAdjustment - heldFromRoles, heldFromRoles };
}

/** Explains dollars held back from a role by the odd-dollar tie rule, e.g. "$1.00 kept back — tied hours". */
export function heldBackNote(heldBack: number): string {
  return `${formatCents(heldBack)} kept back — tied hours`;
}

/** Plain-text summary to paste into a group chat. `profile` (optional) names custom roles. */
export function buildShareText(
  input: ShiftInput,
  result: ShiftResult,
  profile?: TipOutProfile,
): string {
  const roleLabel = (role: string) => roleNames(profile, role).plural;
  const lines: string[] = [];
  lines.push(`TipJar — ${formatShiftDate(input.date)}`);
  lines.push(
    `Tips ${formatCents(input.totalTips)} · Net sales ${formatCents(input.netSales)} · Food ${formatCents(input.foodSales)}`,
  );
  lines.push(
    `Total tip-out: ${formatCents(result.pool)} (${formatPercent(result.poolPercentOfTips)} of tips)`,
  );
  for (const r of result.roles) {
    if (r.missing) {
      if (r.amount > 0)
        lines.push(`${roleLabel(r.role)}: nobody on shift (${formatCents(r.amount)} kept)`);
      else lines.push(`${roleLabel(r.role)}: nobody on shift (share given to other roles)`);
      continue;
    }
    const members = r.members.map((m) => `${m.name} ${formatCents(m.amount)}`).join(', ');
    const held = r.heldBack ? ` (${heldBackNote(r.heldBack)})` : '';
    lines.push(
      `${roleLabel(r.role)}: ${formatCents(r.amount)}${held}${members ? ` — ${members}` : ''}`,
    );
  }
  if (input.userRole === 'bartender') {
    lines.push(`Bar keeps: ${formatCents(keptShown(result))}`);
    for (const k of result.keptSplit ?? []) lines.push(`  ${k.name} ${formatCents(k.amount)}`);
    if (hasChangeNote(result)) {
      lines.push(`(${changeNote(result.keptChange, result.keptHeldBack)})`);
    }
  } else {
    lines.push(`I keep: ${formatCents(result.kept)}`);
  }
  const { floorTrim, heldFromRoles } = roundingParts(result);
  if (floorTrim > 0) {
    lines.push(`(Rounded down to the dollar — ${formatCents(floorTrim)} kept back)`);
  }
  if (heldFromRoles > 0) {
    lines.push(`(${formatCents(heldFromRoles)} kept back from tied whole-dollar shares)`);
  }
  return lines.join('\n');
}
