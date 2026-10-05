/**
 * Exact EGP money handling.
 *
 * Every persisted monetary value is an integer number of piastres (1 EGP =
 * 100 piastres). Floating-point EGP values may only exist at the edges: parsed
 * SMS text, JSON request bodies, and JSON responses rendered for the UI.
 */
export const EGP_MINOR_UNITS = 100;

/** Largest piastre value that stays exact in a JS number and in SQLite INTEGER. */
const MAX_MINOR = Number.MAX_SAFE_INTEGER;

export class MoneyError extends Error {
  constructor(code: string) {
    super(code);
    this.name = 'MoneyError';
  }
}

/**
 * Converts an EGP amount (number or decimal string) to integer piastres.
 * Rejects values with more than two decimal places instead of rounding them
 * silently.
 */
export function toMinor(value: number | string, options: { allowNegative?: boolean; allowZero?: boolean } = {}): number {
  let minor: number;

  if (typeof value === 'string') {
    const trimmed = value.trim().replace(/,/g, '');
    const match = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(trimmed);
    if (!match) {
      throw new MoneyError('INVALID_MONEY_AMOUNT');
    }
    const whole = Number(match[2]);
    const fraction = Number((match[3] || '').padEnd(2, '0'));
    minor = whole * EGP_MINOR_UNITS + fraction;
    if (match[1]) minor = -minor;
  } else {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new MoneyError('INVALID_MONEY_AMOUNT');
    }
    const scaled = value * EGP_MINOR_UNITS;
    minor = Math.round(scaled);
    // Anything further than a float artefact away from a whole piastre is a
    // sub-piastre amount and must not be rounded away silently.
    if (Math.abs(scaled - minor) > 1e-6 * Math.max(1, Math.abs(scaled))) {
      throw new MoneyError('SUB_PIASTRE_AMOUNT');
    }
  }

  if (!Number.isSafeInteger(minor) || Math.abs(minor) > MAX_MINOR) {
    throw new MoneyError('MONEY_AMOUNT_OUT_OF_RANGE');
  }
  if (minor < 0 && !options.allowNegative) {
    throw new MoneyError('NEGATIVE_MONEY_AMOUNT');
  }
  if (minor === 0 && options.allowZero === false) {
    throw new MoneyError('ZERO_MONEY_AMOUNT');
  }
  return minor === 0 ? 0 : minor;
}

/** Converts persisted piastres back to an EGP number for JSON responses. */
export function fromMinor(minor: number | bigint | null | undefined): number {
  if (minor === null || minor === undefined) return 0;
  const n = typeof minor === 'bigint' ? Number(minor) : Number(minor);
  if (!Number.isSafeInteger(n)) {
    throw new MoneyError('INVALID_STORED_MINOR_AMOUNT');
  }
  return n / EGP_MINOR_UNITS;
}

/** Nullable variant for optional columns such as a stated post-balance. */
export function fromMinorOrNull(minor: number | bigint | null | undefined): number | null {
  return minor === null || minor === undefined ? null : fromMinor(minor);
}
