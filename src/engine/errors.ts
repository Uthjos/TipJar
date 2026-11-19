/**
 * - PARTIAL_HOURS: some members of a group have hours and some don't.
 * - NEGATIVE_AMOUNT: a money input is negative or not a finite number. (Non-integer cents are
 *   rounded to the nearest cent, not rejected.)
 * - INVALID_PERCENT / INVALID_WEIGHT: profile percentages outside 0-100, weights <= 0.
 * - INVALID_CLOCK: negative/non-finite hours, a half-entered or zero-length clock pair, or an
 *   unparseable clock value. Clock-out earlier than clock-in is NOT an error (next-day shift).
 * - DUPLICATE_ROLE: a profile has more than one rule for the same role.
 */
export type EngineValidationCode =
  | 'PARTIAL_HOURS'
  | 'NEGATIVE_AMOUNT'
  | 'INVALID_PERCENT'
  | 'INVALID_WEIGHT'
  | 'INVALID_CLOCK'
  | 'DUPLICATE_ROLE';

/** Thrown for blocking input errors; the UI should surface `message` and let the user fix it. */
export class EngineValidationError extends Error {
  readonly code: EngineValidationCode;

  constructor(code: EngineValidationCode, message: string) {
    super(message);
    this.name = 'EngineValidationError';
    this.code = code;
    Object.setPrototypeOf(this, EngineValidationError.prototype);
  }
}

/**
 * - CARVEOUTS_EXCEED_POOL: fixed carve-outs were more than the pool; scaled down proportionally.
 * - FOOD_EXCEEDS_NET: food sales > net sales.
 * - NO_REDISTRIBUTION_RECIPIENTS: 'redistribute' was chosen but no share role is staffed, so the
 *   missing shares were retained instead.
 * - UNUSED_TEAM_MEMBERS: team members whose role the profile doesn't tip out (they get nothing).
 * - PROFILE_ROLE_MISMATCH: profile.appliesTo differs from input.userRole.
 * - POOL_EXCEEDS_TIPS: a sales-based pool (profile.poolBasis) came to more than total tips; capped.
 * At most one warning per code is returned.
 */
export type EngineWarningCode =
  | 'CARVEOUTS_EXCEED_POOL'
  | 'FOOD_EXCEEDS_NET'
  | 'NO_REDISTRIBUTION_RECIPIENTS'
  | 'UNUSED_TEAM_MEMBERS'
  | 'PROFILE_ROLE_MISMATCH'
  | 'POOL_EXCEEDS_TIPS';

export type EngineWarning = { code: EngineWarningCode; message: string };
