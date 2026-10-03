import crypto from 'node:crypto';

/**
 * Enterprise Password Security Module for Sarraf Ops.
 * Uses Node.js crypto.scrypt (N=16384, r=8, p=1, keylen=64) with cryptographically
 * secure per-user random salts.
 * 
 * Supports zero-downtime, transparent password hash migration for existing accounts:
 * - Detects legacy sha256 hashes
 * - Verifies credentials
 * - Signals need for rehash so the caller transparently upgrades the record to scrypt.
 */

export interface VerifyPasswordResult {
  valid: boolean;
  needsRehash: boolean;
}

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 64;
const LEGACY_SALT = 'sarraf_salt_eg_2026';

/**
 * Hashes a plaintext password using scrypt with a unique 16-byte random salt.
 */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(password, salt, KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 64 * 1024 * 1024,
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt}$${derivedKey.toString('hex')}`;
}

/**
 * Verifies a plaintext password against a stored password hash.
 * Handles both modern scrypt hashes and legacy sha256 hashes for transparent migration.
 */
export function verifyPassword(password: string, storedHash: string): VerifyPasswordResult {
  if (!password || !storedHash) {
    return { valid: false, needsRehash: false };
  }

  // Modern scrypt format: scrypt$N$r$p$salt$hash
  if (storedHash.startsWith('scrypt$')) {
    const parts = storedHash.split('$');
    if (parts.length !== 6) {
      return { valid: false, needsRehash: false };
    }

    const n = parseInt(parts[1], 10);
    const r = parseInt(parts[2], 10);
    const p = parseInt(parts[3], 10);
    const salt = parts[4];
    const expectedHex = parts[5];

    try {
      const derivedKey = crypto.scryptSync(password, salt, expectedHex.length / 2, {
        N: n,
        r: r,
        p: p,
        maxmem: 64 * 1024 * 1024,
      });

      const actualBuf = Buffer.from(derivedKey.toString('hex'), 'hex');
      const expectedBuf = Buffer.from(expectedHex, 'hex');

      if (actualBuf.length !== expectedBuf.length) {
        return { valid: false, needsRehash: false };
      }

      const match = crypto.timingSafeEqual(actualBuf, expectedBuf);
      return { valid: match, needsRehash: false };
    } catch {
      return { valid: false, needsRehash: false };
    }
  }

  // Legacy SHA-256 fallback with transparent rehash recommendation
  const legacyHash = crypto.createHash('sha256').update(password + LEGACY_SALT).digest('hex');
  const legacyBuf = Buffer.from(legacyHash, 'hex');
  const storedBuf = Buffer.from(storedHash, 'hex');

  if (legacyBuf.length === storedBuf.length && crypto.timingSafeEqual(legacyBuf, storedBuf)) {
    return { valid: true, needsRehash: true };
  }

  return { valid: false, needsRehash: false };
}
