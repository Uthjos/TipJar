/**
 * Forgiving hours / clock-time input and Who-worked checks (docs/m6-contract.md).
 * Pure: no React / DB imports. Clock values are stored as 24h "HH:mm" only (never ISO), so DST
 * and time zones can't matter (review #6c).
 */
import type { RoleId, TeamMember } from '@/engine/types';

const pad = (n: number) => String(n).padStart(2, '0');

/** "5pm" -> "17:00", "1730" -> "17:30", "9" -> "09:00", "noon" -> "12:00"; null if not a time. */
export function parseTimeInput(text: string): string | null {
  const t = text.trim().toLowerCase().replace(/\s+/g, '');
  if (t === '') return null;
  if (t === 'noon') return '12:00';
  if (t === 'midnight') return '00:00';

  const m = /^(\d{1,2}(?:[:.]\d{2})?|\d{3,4})(a|am|a\.m\.?|p|pm|p\.m\.?)?$/.exec(t);
  if (!m) return null;
  const core = m[1]!;
  const suffix = m[2];

  let hour: number;
  let minute: number;
  const sep = /^(\d{1,2})[:.](\d{2})$/.exec(core);
  if (sep) {
    hour = Number(sep[1]);
    minute = Number(sep[2]);
  } else if (core.length >= 3) {
    hour = Number(core.slice(0, -2));
    minute = Number(core.slice(-2));
  } else {
    hour = Number(core);
    minute = 0;
  }
  if (minute > 59) return null;

  if (suffix) {
    if (hour < 1 || hour > 12) return null;
    const pm = suffix.startsWith('p');
    hour = (hour % 12) + (pm ? 12 : 0);
  } else if (hour > 23) {
    return null;
  }
  return `${pad(hour)}:${pad(minute)}`;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

const NUM = String.raw`(\d+(?:\.\d+)?|\.\d+)`;
const HOUR_WORD = String.raw`(?:h|hr|hrs|hour|hours)`;
const MIN_WORD = String.raw`(?:m|min|mins|minute|minutes)`;
const PLAIN = new RegExp(`^${NUM}$`);
const H_COLON_MM = /^(\d+):(\d{2})$/;
const H_WORD = new RegExp(`^${NUM}${HOUR_WORD}(?:(\\d{1,2})${MIN_WORD}?)?$`);
const M_WORD = new RegExp(`^${NUM}${MIN_WORD}$`);

/** "6.5", "6,5", "6:30", "6h30", "6 hrs", "45 min", ".5" -> hours (2 dp), or null. 0 < h <= 24. */
export function parseHoursInput(text: string): number | null {
  const t = text.trim().toLowerCase().replace(/,/g, '.').replace(/\s+/g, '');
  if (t === '') return null;
  let hours: number | null = null;
  let m: RegExpExecArray | null;
  if ((m = PLAIN.exec(t))) {
    hours = Number(m[1]);
  } else if ((m = H_COLON_MM.exec(t))) {
    const minutes = Number(m[2]);
    if (minutes > 59) return null;
    hours = Number(m[1]) + minutes / 60;
  } else if ((m = H_WORD.exec(t))) {
    const minutes = m[2] === undefined ? 0 : Number(m[2]);
    if (minutes > 59) return null;
    hours = Number(m[1]) + minutes / 60;
  } else if ((m = M_WORD.exec(t))) {
    hours = Number(m[1]) / 60;
  }
  if (hours === null || !Number.isFinite(hours)) return null;
  hours = round2(hours);
  return hours > 0 && hours <= 24 ? hours : null;
}

const HHMM = /^(\d{1,2}):(\d{2})$/;

function minutesOf(value: string): number | null {
  const m = HHMM.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** Hours between two "HH:mm" times; +24h (overnight) when clockOut < clockIn; equal -> null. */
export function clockHours(
  clockIn: string,
  clockOut: string,
): { hours: number; overnight: boolean } | null {
  const a = minutesOf(clockIn);
  const b = minutesOf(clockOut);
  if (a === null || b === null || a === b) return null;
  const overnight = b < a;
  const minutes = overnight ? b + 24 * 60 - a : b - a;
  return { hours: round2(minutes / 60), overnight };
}

/** 6 -> "6 h", 6.5 -> "6.5 h", 0.75 -> "0.75 h" (max 2 decimals, no trailing zeros). */
export function formatHours(h: number): string {
  return `${Number(h.toFixed(2))} h`;
}

export type HoursIssue = {
  code:
    | 'INVALID_TIME'
    | 'MISSING_CLOCK_OUT'
    | 'MISSING_CLOCK_IN'
    | 'SAME_TIME'
    | 'INVALID_HOURS'
    | 'PARTIAL_HOURS'
    | 'LONG_SHIFT';
  severity: 'error' | 'warning';
  /** Set for member-level issues (PARTIAL_HOURS: the member missing hours). */
  memberId?: string;
  role: RoleId;
  message: string;
};

/** A team member plus what the user typed (not yet committed). */
export type TypedMember = TeamMember & {
  hoursText?: string;
  clockInText?: string;
  clockOutText?: string;
};

/** Shifts longer than this get a LONG_SHIFT warning. */
export const LONG_SHIFT_HOURS = 16;

type MemberState =
  { kind: 'none' } | { kind: 'error'; issues: HoursIssue[] } | { kind: 'ok'; hours: number };

function memberState(m: TypedMember): MemberState {
  const name = m.name.trim() || 'Someone';
  const issue = (code: HoursIssue['code'], message: string): HoursIssue => ({
    code,
    severity: 'error',
    memberId: m.id,
    role: m.role,
    message,
  });

  const hoursText = m.hoursText ?? (m.hours !== undefined ? String(m.hours) : '');
  if (hoursText.trim() !== '') {
    const h = parseHoursInput(hoursText);
    return h === null
      ? {
          kind: 'error',
          issues: [
            issue(
              'INVALID_HOURS',
              `${name}'s hours should be a number like 6.5 (more than 0, up to 24).`,
            ),
          ],
        }
      : { kind: 'ok', hours: h };
  }

  const inText = (m.clockInText ?? m.clockIn ?? '').trim();
  const outText = (m.clockOutText ?? m.clockOut ?? '').trim();
  if (inText === '' && outText === '') return { kind: 'none' };

  const issues: HoursIssue[] = [];
  const clockIn = inText ? parseTimeInput(inText) : null;
  const clockOut = outText ? parseTimeInput(outText) : null;
  if (!inText) issues.push(issue('MISSING_CLOCK_IN', `${name} needs a clock-in time.`));
  else if (!clockIn) {
    issues.push(
      issue(
        'INVALID_TIME',
        `${name}'s clock-in "${inText}" isn't a time we recognise (try 5pm or 17:00).`,
      ),
    );
  }
  if (!outText) issues.push(issue('MISSING_CLOCK_OUT', `${name} needs a clock-out time.`));
  else if (!clockOut) {
    issues.push(
      issue(
        'INVALID_TIME',
        `${name}'s clock-out "${outText}" isn't a time we recognise (try 5pm or 17:00).`,
      ),
    );
  }
  if (issues.length > 0) return { kind: 'error', issues };
  const span = clockHours(clockIn!, clockOut!);
  if (!span) {
    return {
      kind: 'error',
      issues: [issue('SAME_TIME', `${name}'s clock-in and clock-out are the same time.`)],
    };
  }
  return { kind: 'ok', hours: span.hours };
}

/**
 * Problems with hours on Who worked, from what was typed. Roles not in `rolesThatSplit` are
 * ignored. Ordered by `rolesThatSplit`, then team order; a member's errors come before warnings.
 */
export function checkTeamHours(team: TypedMember[], rolesThatSplit: RoleId[]): HoursIssue[] {
  const out: HoursIssue[] = [];
  for (const role of rolesThatSplit) {
    const members = team.filter((m) => m.role === role);
    const states = members.map(memberState);
    const anyValid = states.some((s) => s.kind === 'ok');
    members.forEach((m, i) => {
      const s = states[i]!;
      if (s.kind === 'error') out.push(...s.issues);
      else if (s.kind === 'none' && anyValid) {
        out.push({
          code: 'PARTIAL_HOURS',
          severity: 'error',
          memberId: m.id,
          role,
          message: `Enter hours for ${m.name.trim() || 'everyone'} too, or clear them all for an even split.`,
        });
      } else if (s.kind === 'ok' && s.hours > LONG_SHIFT_HOURS) {
        out.push({
          code: 'LONG_SHIFT',
          severity: 'warning',
          memberId: m.id,
          role,
          message: `${m.name.trim() || 'Someone'} worked ${formatHours(s.hours)} — double-check that.`,
        });
      }
    });
  }
  return out;
}

/**
 * Copy `fromMemberId`'s hours / clock times to everyone else in the same role (one source of
 * hours each: the other fields are cleared). New array; inputs never mutated.
 */
export function copyHoursToRole(team: TeamMember[], fromMemberId: string): TeamMember[] {
  const source = team.find((m) => m.id === fromMemberId);
  return team.map((m) => {
    const copy: TeamMember = { ...m };
    if (!source || m.id === source.id || m.role !== source.role) return copy;
    delete copy.hours;
    delete copy.clockIn;
    delete copy.clockOut;
    if (source.hours !== undefined) copy.hours = source.hours;
    if (source.clockIn !== undefined) copy.clockIn = source.clockIn;
    if (source.clockOut !== undefined) copy.clockOut = source.clockOut;
    return copy;
  });
}
