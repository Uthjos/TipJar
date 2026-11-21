/**
 * Helpers for the milestone 6 hours acceptance tests (docs/m6-contract.md).
 * Pure TypeScript, not a test file itself.
 */
import type { TeamMember } from '../engine/types';
import { parseHoursInput, parseTimeInput } from '../lib/hoursInput';

/** A team member as Who worked holds it: committed values plus what the user typed. */
export type DraftMember = TeamMember & {
  hoursText?: string;
  clockInText?: string;
  clockOutText?: string;
};

/**
 * Commit typed text the way the store would before calling the engine: a present `*Text`
 * field replaces the committed value (blank text clears it; unparseable text is left out —
 * callers only commit teams that checkTeamHours reported as error-free). Text fields are
 * stripped from the result.
 */
export function commitTeamHours(team: DraftMember[]): TeamMember[] {
  return team.map((d) => {
    const { hoursText, clockInText, clockOutText, ...m } = d;
    const out: TeamMember = { ...m };
    if (hoursText !== undefined) {
      const h = hoursText.trim() === '' ? null : parseHoursInput(hoursText);
      if (h === null) delete out.hours;
      else out.hours = h;
    }
    if (clockInText !== undefined) {
      const t = clockInText.trim() === '' ? null : parseTimeInput(clockInText);
      if (t === null) delete out.clockIn;
      else out.clockIn = t;
    }
    if (clockOutText !== undefined) {
      const t = clockOutText.trim() === '' ? null : parseTimeInput(clockOutText);
      if (t === null) delete out.clockOut;
      else out.clockOut = t;
    }
    return out;
  });
}

/** "HH:mm" for minutes since midnight. */
export function hhmm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Round to 2 decimals the way the contract does (half away from zero for positives). */
export function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
