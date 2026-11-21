/**
 * History periods and summaries (docs/m7-contract.md). Pure: no React / DB imports.
 * Dates are yyyy-MM-dd strings (a shift's `input.date`); no time zones are involved.
 */
import {
  addDays,
  eachDayOfInterval,
  endOfMonth,
  endOfYear,
  format,
  parseISO,
  startOfMonth,
  startOfWeek,
  startOfYear,
} from 'date-fns';

import type { SavedShift } from '@/db/repositories';
import { roleLabel as builtInRoleLabel } from '@/engine/profiles';
import type { Cents, RoleId } from '@/engine/types';

import { userEarnings } from './earnings';

export type Period = 'week' | 'month' | 'year';
export type WeekStart = 0 | 1;

/** Inclusive date range for a period. */
export interface PeriodRange {
  period: Period;
  from: string;
  to: string;
  label: string;
}

const ymd = (d: Date) => format(d, 'yyyy-MM-dd');

function weekLabel(from: Date, to: Date): string {
  if (from.getFullYear() !== to.getFullYear()) {
    return `${format(from, 'MMM d, yyyy')} – ${format(to, 'MMM d, yyyy')}`;
  }
  if (from.getMonth() !== to.getMonth()) {
    return `${format(from, 'MMM d')} – ${format(to, 'MMM d, yyyy')}`;
  }
  return `${format(from, 'MMM d')} – ${format(to, 'd, yyyy')}`;
}

/** The week / month / year containing `anchor` (weeks start on `weekStartsOn`, default Sunday). */
export function periodRange(
  period: Period,
  anchor: string,
  weekStartsOn: WeekStart = 0,
): PeriodRange {
  const d = parseISO(anchor);
  if (period === 'week') {
    const from = startOfWeek(d, { weekStartsOn });
    const to = addDays(from, 6);
    return { period, from: ymd(from), to: ymd(to), label: weekLabel(from, to) };
  }
  if (period === 'month') {
    return {
      period,
      from: ymd(startOfMonth(d)),
      to: ymd(endOfMonth(d)),
      label: format(d, 'MMMM yyyy'),
    };
  }
  return { period, from: ymd(startOfYear(d)), to: ymd(endOfYear(d)), label: format(d, 'yyyy') };
}

/** The previous (-1) or next (+1) period of the same kind. */
export function shiftPeriod(
  range: PeriodRange,
  step: -1 | 1,
  weekStartsOn: WeekStart = 0,
): PeriodRange {
  const anchor = step < 0 ? addDays(parseISO(range.from), -1) : addDays(parseISO(range.to), 1);
  return periodRange(range.period, ymd(anchor), weekStartsOn);
}

export function inRange(date: string, range: PeriodRange): boolean {
  return date >= range.from && date <= range.to;
}

export interface HistorySummary {
  shiftCount: number;
  earned: Cents;
  tippedOut: Cents;
  totalTips: Cents;
  averageEarned: Cents;
  series: { key: string; label: string; earned: Cents }[];
  byRole: { role: RoleId; label: string; amount: Cents; shifts: number }[];
  byCoworker: { key: string; name: string; roles: RoleId[]; amount: Cents; shifts: number }[];
}

/** Coworker key: trim, NFC, locale lower-case (same as the coworkers table). */
function nameKey(name: string): string {
  return name.trim().normalize('NFC').toLocaleLowerCase();
}

function emptySeries(range: PeriodRange): { key: string; label: string; earned: Cents }[] {
  const from = parseISO(range.from);
  const to = parseISO(range.to);
  if (range.period === 'year') {
    return Array.from({ length: 12 }, (_, m) => {
      const d = new Date(from.getFullYear(), m, 1);
      return { key: format(d, 'yyyy-MM'), label: format(d, 'MMM'), earned: 0 };
    });
  }
  return eachDayOfInterval({ start: from, end: to }).map((d) => ({
    key: ymd(d),
    label: range.period === 'week' ? format(d, 'EEE') : String(d.getDate()),
    earned: 0,
  }));
}

/** Oldest first: by date, then savedAt. */
export function chronological(shifts: SavedShift[]): SavedShift[] {
  return [...shifts].sort((a, b) =>
    a.input.date !== b.input.date
      ? a.input.date < b.input.date
        ? -1
        : 1
      : a.savedAt < b.savedAt
        ? -1
        : a.savedAt > b.savedAt
          ? 1
          : 0,
  );
}

/** Totals, chart series and where the tip-outs went for the shifts in `range`. */
export function summarize(
  shifts: SavedShift[],
  range: PeriodRange,
  opts: { weekStartsOn?: WeekStart; roleLabel?: (role: RoleId) => string } = {},
): HistorySummary {
  const label = opts.roleLabel ?? builtInRoleLabel;
  const inPeriod = chronological(shifts.filter((s) => inRange(s.input.date, range)));
  const series = emptySeries(range);
  const bucket = new Map(series.map((b) => [b.key, b]));

  let earned = 0;
  let tippedOut = 0;
  let totalTips = 0;
  const roles = new Map<RoleId, { amount: Cents; shifts: number }>();
  const people = new Map<
    string,
    { name: string; roles: RoleId[]; amount: Cents; shifts: number }
  >();

  for (const s of inPeriod) {
    const e = userEarnings(s.input, s.result);
    earned += e;
    tippedOut += s.result.pool;
    totalTips += s.input.totalTips;
    const key = range.period === 'year' ? s.input.date.slice(0, 7) : s.input.date;
    const b = bucket.get(key);
    if (b) b.earned += e;

    const userIds = new Set(s.input.team.filter((m) => m.isUser).map((m) => m.id));
    const seenPeople = new Set<string>();
    for (const r of s.result.roles) {
      if (r.missing || r.amount <= 0) continue;
      const agg = roles.get(r.role) ?? { amount: 0, shifts: 0 };
      agg.amount += r.amount;
      agg.shifts += 1;
      roles.set(r.role, agg);

      for (const m of r.members) {
        if (userIds.has(m.memberId)) continue;
        const k = nameKey(m.name);
        if (!k) continue;
        const p = people.get(k) ?? { name: m.name.trim(), roles: [], amount: 0, shifts: 0 };
        p.name = m.name.trim(); // most recent spelling (shifts are processed oldest first)
        if (!p.roles.includes(r.role)) p.roles.push(r.role);
        p.amount += m.amount;
        if (!seenPeople.has(k)) {
          p.shifts += 1;
          seenPeople.add(k);
        }
        people.set(k, p);
      }
    }
  }

  const byRole = [...roles.entries()]
    .filter(([, v]) => v.amount > 0)
    .map(([role, v]) => ({ role, label: label(role), amount: v.amount, shifts: v.shifts }))
    .sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label));
  const byCoworker = [...people.entries()]
    .filter(([, v]) => v.amount > 0)
    .map(([key, v]) => ({ key, ...v }))
    .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name));

  const shiftCount = inPeriod.length;
  return {
    shiftCount,
    earned,
    tippedOut,
    totalTips,
    averageEarned: shiftCount > 0 ? Math.floor(earned / shiftCount + 0.5) : 0,
    series,
    byRole,
    byCoworker,
  };
}
