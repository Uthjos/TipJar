import type { Cents, KeptSplitEntry, ShiftInput, ShiftResult } from '@/engine/types';

/** The user's own entry in `keptSplit` (bartender flow), found via `TeamMember.isUser`. */
export function userKeptEntry(input: ShiftInput, result: ShiftResult): KeptSplitEntry | undefined {
  if (input.userRole !== 'bartender' || !result.keptSplit) return undefined;
  const ids = new Set(input.team.filter((m) => m.isUser).map((m) => m.id));
  return result.keptSplit.find((k) => ids.has(k.memberId));
}

/**
 * What the user earned on a shift (owner Q9), used by History and the Results "Your share" line.
 *
 * - Server flow: `kept`.
 * - Bartender flow, user found (a bartender with `isUser`): their `keptSplit` amount +
 *   `keptChange` (the change stays with whoever closes out, which is the user entering the
 *   shift).
 * - Bartender flow, no `isUser` bartender (or no bartenders listed): all of `kept`. We can't
 *   tell which share is the user's, so we credit the bar's whole kept amount rather than guess.
 *   Note `kept = keptShown + keptChange` whenever bartenders are listed, so this is the same as
 *   "headline + change"; with no bartenders it avoids counting `kept` twice (keptChange = kept).
 */
export function userEarnings(input: ShiftInput, result: ShiftResult): Cents {
  if (input.userRole !== 'bartender') return result.kept;
  const mine = userKeptEntry(input, result);
  return mine ? mine.amount + result.keptChange : result.kept;
}
