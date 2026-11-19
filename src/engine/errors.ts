export type EngineValidationCode =
  'PARTIAL_HOURS' | 'NEGATIVE_AMOUNT' | 'INVALID_PERCENT' | 'INVALID_WEIGHT' | 'INVALID_CLOCK';

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

export type EngineWarningCode = 'CARVEOUTS_EXCEED_POOL' | 'FOOD_EXCEEDS_NET';

export type EngineWarning = { code: EngineWarningCode; message: string };
