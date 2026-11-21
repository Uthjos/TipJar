/**
 * CSV export (docs/m7-contract.md). Pure: builds text; the screen writes and shares the file.
 * RFC 4180, CRLF line endings, header row first, shifts oldest first.
 */
import type { SavedShift } from '@/db/repositories';
import { roleLabel as builtInRoleLabel } from '@/engine/profiles';
import type { Cents, RoleId } from '@/engine/types';

import { userEarnings } from './earnings';
import { chronological } from './history';

const EOL = '\r\n';

/**
 * Quote when needed (`,` `"` CR LF, or leading/trailing space); double any `"`; null -> ''.
 * #88 formula injection: a text value starting with `=`, `+`, `-` or `@` gets a leading `'` so
 * spreadsheets don't run it. Numbers are never prefixed, and our own money / hours cells bypass
 * this (see Raw), so negative money stays "-0.05".
 */
export function csvEscape(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  let s = String(value);
  if (typeof value === 'string' && /^[=+\-@]/.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s) || /^\s|\s$/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** 12345 -> "123.45", -5 -> "-0.05", 0 -> "0.00". */
export function centsToCsv(c: Cents): string {
  const abs = Math.abs(Math.round(c));
  const sign = c < 0 && abs > 0 ? '-' : '';
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** A cell written as-is: our own numeric text (money, hours), so "-0.05" is never prefixed. */
class Raw {
  constructor(readonly text: string) {}
}

const money = (c: Cents) => new Raw(centsToCsv(c));

type Cell = Raw | string | number | null | undefined;

function toCsv(header: string[], rows: Cell[][]): string {
  return (
    [header, ...rows]
      .map((r) => r.map((cell) => (cell instanceof Raw ? cell.text : csvEscape(cell))).join(','))
      .join(EOL) + EOL
  );
}

const SHIFT_HEADER = [
  'date',
  'profile',
  'user_role',
  'total_tips',
  'net_sales',
  'food_sales',
  'tipped_out',
  'kept',
  'you_earned',
  'retained',
  'rounding_adjustment',
  'kept_change',
  'rounded_to_dollar',
  'shift_id',
];

/** One row per shift. */
export function shiftsCsv(
  shifts: SavedShift[],
  opts: { profileName?: (id: string) => string | undefined } = {},
): string {
  const rows = chronological(shifts).map(({ id, input, result }) => [
    input.date,
    opts.profileName?.(input.profileId) ?? input.profileId,
    input.userRole,
    money(input.totalTips),
    money(input.netSales),
    money(input.foodSales),
    money(result.pool),
    money(result.kept),
    money(userEarnings(input, result)),
    money(result.retained),
    money(result.roundingAdjustment),
    money(result.keptChange),
    input.roundToDollar ? 'yes' : 'no',
    id,
  ]);
  return toCsv(SHIFT_HEADER, rows);
}

const PAYOUT_HEADER = ['date', 'role', 'name', 'hours', 'amount', 'kind', 'shift_id'];

function hoursCell(h: number): Raw | string {
  return h > 0 ? new Raw(String(Number(h.toFixed(2)))) : '';
}

/**
 * One row per paid member (`paid`), per role with no members such as kitchen (`role`), per
 * missing role's retained amount (`retained`, only when > 0), and per bartender's share of the
 * bar's kept tips (`bar_split`, bartender flow, including the user). For each shift, the `paid`
 * and `role` rows sum to `tipped_out`.
 */
export function payoutsCsv(
  shifts: SavedShift[],
  opts: { roleLabel?: (role: RoleId) => string } = {},
): string {
  const label = opts.roleLabel ?? builtInRoleLabel;
  const rows: Cell[][] = [];
  for (const { id, input, result } of chronological(shifts)) {
    for (const r of result.roles) {
      if (r.missing) {
        if (r.amount > 0)
          rows.push([input.date, label(r.role), '', '', money(r.amount), 'retained', id]);
        continue;
      }
      if (r.members.length === 0) {
        rows.push([input.date, label(r.role), '', '', money(r.amount), 'role', id]);
        continue;
      }
      for (const m of r.members) {
        rows.push([
          input.date,
          label(r.role),
          m.name,
          hoursCell(m.hours),
          money(m.amount),
          'paid',
          id,
        ]);
      }
    }
    for (const k of result.keptSplit ?? []) {
      rows.push([
        input.date,
        label('bartender'),
        k.name,
        hoursCell(k.hours),
        money(k.amount),
        'bar_split',
        id,
      ]);
    }
  }
  return toCsv(PAYOUT_HEADER, rows);
}
