import { format, parseISO } from 'date-fns';

import { formatCents } from '@/engine/money';
import { roleLabel } from '@/engine/profiles';
import type { ShiftInput, ShiftResult } from '@/engine/types';

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

/** Note for the bar's leftover change, e.g. "$0.55 in change left over — stays with whoever closes out." */
export function changeNote(keptChange: number): string {
  return `${formatCents(keptChange)} in change left over — stays with whoever closes out.`;
}

/** Plain-text summary to paste into a group chat. */
export function buildShareText(input: ShiftInput, result: ShiftResult): string {
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
    lines.push(`${roleLabel(r.role)}: ${formatCents(r.amount)}${members ? ` — ${members}` : ''}`);
  }
  if (input.userRole === 'bartender') {
    lines.push(`Bar keeps: ${formatCents(result.kept - result.keptChange)}`);
    for (const k of result.keptSplit ?? []) lines.push(`  ${k.name} ${formatCents(k.amount)}`);
    if (result.keptChange > 0) lines.push(`(${changeNote(result.keptChange)})`);
  } else {
    lines.push(`I keep: ${formatCents(result.kept)}`);
  }
  if (result.roundingAdjustment > 0) {
    lines.push(
      `(Rounded down to the dollar — ${formatCents(result.roundingAdjustment)} kept back)`,
    );
  }
  return lines.join('\n');
}
