import { memberHours } from '../hours';
import { expectValidationError } from '../../test-support/builders';
import type { TeamMember } from '../types';

// All clock times use an explicit UTC offset ("Z") so results don't depend on the
// test machine's timezone or DST transitions (see docs/test-findings.md).
const m = (extra: Partial<TeamMember>): TeamMember => ({
  id: 'm1',
  name: 'Test',
  role: 'barback',
  ...extra,
});

describe('memberHours', () => {
  it('returns `hours` when set', () => {
    expect(memberHours(m({ hours: 6 }))).toBe(6);
    expect(memberHours(m({ hours: 7.25 }))).toBe(7.25);
  });

  it('prefers `hours` over clock-in/out when both are present', () => {
    expect(
      memberHours(
        m({ hours: 5, clockIn: '2026-11-17T18:00:00Z', clockOut: '2026-11-18T02:00:00Z' }),
      ),
    ).toBe(5);
  });

  it('treats hours: 0 as set (returns 0, not undefined)', () => {
    expect(memberHours(m({ hours: 0 }))).toBe(0);
  });

  it('computes clockOut - clockIn in hours on the same day', () => {
    expect(
      memberHours(m({ clockIn: '2026-11-17T09:00:00Z', clockOut: '2026-11-17T17:30:00Z' })),
    ).toBe(8.5);
  });

  it('handles minute precision', () => {
    expect(
      memberHours(m({ clockIn: '2026-11-17T17:00:00Z', clockOut: '2026-11-17T23:45:00Z' })),
    ).toBeCloseTo(6.75, 10);
  });

  it('handles a shift that crosses midnight with correct dates', () => {
    // 20:00 -> 02:00 next day = 6h
    expect(
      memberHours(m({ clockIn: '2026-11-17T20:00:00Z', clockOut: '2026-11-18T02:00:00Z' })),
    ).toBe(6);
  });

  it('treats clockOut earlier than clockIn (same date) as next day (+24h)', () => {
    // User entered 20:00 and 02:00 on the same date -> 6h overnight shift
    expect(
      memberHours(m({ clockIn: '2026-11-17T20:00:00Z', clockOut: '2026-11-17T02:00:00Z' })),
    ).toBe(6);
    // 22:30 -> 01:15 -> 2.75h
    expect(
      memberHours(m({ clockIn: '2026-11-17T22:30:00Z', clockOut: '2026-11-17T01:15:00Z' })),
    ).toBeCloseTo(2.75, 10);
  });

  it('treats clockOut === clockIn as a full 24h shift (contract: clockOut <= clockIn => next day)', () => {
    // ASSUMPTION (docs/test-findings.md #6): contract says "<=" so equal times => 24h.
    expect(
      memberHours(m({ clockIn: '2026-11-17T20:00:00Z', clockOut: '2026-11-17T20:00:00Z' })),
    ).toBe(24);
  });

  it('returns undefined when neither hours nor a full clock pair is given', () => {
    expect(memberHours(m({}))).toBeUndefined();
  });

  // Review decision D1 (docs/review-log.md): a half-entered clock pair is an input error,
  // not "no hours". Treating it as undefined would silently fall back to an equal split when
  // nobody else in the role has hours, ignoring what the user typed.
  it('throws INVALID_CLOCK when only clockIn or only clockOut is given', () => {
    expectValidationError(
      () => memberHours(m({ clockIn: '2026-11-17T20:00:00Z' })),
      'INVALID_CLOCK',
    );
    expectValidationError(
      () => memberHours(m({ clockOut: '2026-11-17T20:00:00Z' })),
      'INVALID_CLOCK',
    );
  });
});
