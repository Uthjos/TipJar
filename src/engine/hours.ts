import { EngineValidationError } from './errors';
import type { TeamMember } from './types';

const MS_PER_HOUR = 3_600_000;
const MINUTES_PER_DAY = 24 * 60;

/** "HH:mm" (24h) wall-clock time, e.g. "22:30". */
const TIME_OF_DAY = /^(\d{1,2}):(\d{2})$/;

/**
 * Parse a clock value. Returns minutes since an arbitrary epoch, or undefined if invalid.
 * Accepts full ISO datetimes or bare "HH:mm" times-of-day (both values must use the same form).
 */
function parseClock(value: string): { kind: 'time' | 'datetime'; minutes: number } | undefined {
  const t = TIME_OF_DAY.exec(value.trim());
  if (t) {
    const h = Number(t[1]);
    const m = Number(t[2]);
    if (h > 23 || m > 59) return undefined;
    return { kind: 'time', minutes: h * 60 + m };
  }
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return undefined;
  return { kind: 'datetime', minutes: ms / 60_000 };
}

/**
 * Hours worked by a team member.
 * - Uses `hours` when set.
 * - Otherwise `clockOut - clockIn`; if clockOut < clockIn the shift is treated as ending
 *   the next day (+24h), so overnight shifts work. Equal times are rejected.
 * - undefined if neither is given.
 *
 * @throws EngineValidationError('INVALID_CLOCK') for negative/non-finite hours, only one of
 *   clockIn/clockOut, clockIn === clockOut, or unparseable clock values.
 */
export function memberHours(m: TeamMember): number | undefined {
  if (m.hours !== undefined && m.hours !== null) {
    if (!Number.isFinite(m.hours) || m.hours < 0) {
      throw new EngineValidationError(
        'INVALID_CLOCK',
        `${m.name || 'A team member'} has invalid hours (${m.hours}).`,
      );
    }
    return m.hours;
  }

  const hasIn = !!m.clockIn;
  const hasOut = !!m.clockOut;
  if (!hasIn && !hasOut) return undefined;
  if (hasIn !== hasOut) {
    throw new EngineValidationError(
      'INVALID_CLOCK',
      `${m.name || 'A team member'} needs both a clock-in and a clock-out time.`,
    );
  }

  const cin = parseClock(m.clockIn!);
  const cout = parseClock(m.clockOut!);
  if (!cin || !cout || cin.kind !== cout.kind) {
    throw new EngineValidationError(
      'INVALID_CLOCK',
      `${m.name || 'A team member'} has an invalid clock-in/clock-out time.`,
    );
  }

  let minutes = cout.minutes - cin.minutes;
  if (minutes === 0) {
    // Same clock-in and clock-out is almost certainly a typo, not a 24h shift (review D2).
    throw new EngineValidationError(
      'INVALID_CLOCK',
      `${m.name || 'A team member'} has the same clock-in and clock-out time.`,
    );
  }
  if (minutes < 0) minutes += MINUTES_PER_DAY; // next-day clock-out
  return (minutes * 60_000) / MS_PER_HOUR;
}
