import crypto from 'node:crypto';
import { getDatabase } from '../db';

export interface MerchantApiKey {
  id: string;
  organizationId: string;
  name: string;
  keyType: 'public' | 'secret';
  keyPrefix: string;
  keyValue?: string;
  keyPreview: string;
  mode: 'live' | 'test';
  isActive: boolean;
  lastUsedAt?: string | null;
  createdAt: string;
}

export interface GeneratedKeySet {
  publicKey: string;
  secretKey: string;
  keyId: string;
  mode: 'live' | 'test';
  name: string;
}

function hashKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

export class ApiKeyService {
  /**
   * Generates a pair of keys (Public Key & Secret Key) for a merchant
   */
  static generateKeySet(organizationId: string, name: string, mode: 'live' | 'test' = 'live'): GeneratedKeySet {
    const db = getDatabase();
    const id = `key_${crypto.randomBytes(8).toString('hex')}`;
    const pubRandom = crypto.randomBytes(16).toString('hex');
    const secRandom = crypto.randomBytes(24).toString('hex');

    const publicKey = `pk_${mode}_${pubRandom}`;
    const secretKey = `sk_${mode}_${secRandom}`;

    const pubHash = hashKey(publicKey);
    const secHash = hashKey(secretKey);

    const pubPreview = `${publicKey.slice(0, 10)}...${publicKey.slice(-4)}`;
    const secPreview = `${secretKey.slice(0, 10)}...${secretKey.slice(-4)}`;

    db.exec('BEGIN IMMEDIATE;');
    try {
      // Store Public Key
      db.prepare(`
        INSERT INTO merchant_api_keys (id, organization_id, name, key_type, key_prefix, key_value, key_hash, key_preview, mode, is_active)
        VALUES (?, ?, ?, 'public', ?, ?, ?, ?, ?, 1)
      `).run(`${id}_pub`, organizationId, `${name} (Public)`, `pk_${mode}`, publicKey, pubHash, pubPreview, mode);

      // Store Secret Key
      db.prepare(`
        INSERT INTO merchant_api_keys (id, organization_id, name, key_type, key_prefix, key_value, key_hash, key_preview, mode, is_active)
        VALUES (?, ?, ?, 'secret', ?, ?, ?, ?, ?, 1)
      `).run(`${id}_sec`, organizationId, `${name} (Secret)`, `sk_${mode}`, mode === 'test' ? secretKey : null, secHash, secPreview, mode);

      db.exec('COMMIT;');

      return {
        publicKey,
        secretKey,
        keyId: id,
        mode,
        name,
      };
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    }
  }

  /**
   * Returns all API keys for an organization
   */
  static listKeys(organizationId: string): MerchantApiKey[] {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT id, organization_id, name, key_type, key_prefix, key_value, key_preview, mode, is_active, last_used_at, created_at
      FROM merchant_api_keys
      WHERE organization_id = ?
      ORDER BY created_at DESC
    `).all(organizationId) as any[];

    return rows.map((r) => ({
      id: r.id,
      organizationId: r.organization_id,
      name: r.name,
      keyType: r.key_type,
      keyPrefix: r.key_prefix,
      keyValue: r.key_value,
      keyPreview: r.key_preview,
      mode: r.mode,
      isActive: Boolean(r.is_active),
      lastUsedAt: r.last_used_at,
      createdAt: r.created_at,
    }));
  }

  /**
   * Ensures the organization has at least one active live and test key pair.
   * Auto-provisions on first visit so merchants can get started immediately!
   */
  static getOrCreateDefaultKeys(organizationId: string): {
    live: { publicKey: string; secretPreview: string };
    test: { publicKey: string; secretPreview: string; testSecretKey?: string };
  } {
    const keys = this.listKeys(organizationId);
    let livePub = keys.find((k) => k.mode === 'live' && k.keyType === 'public' && k.isActive);
    let liveSec = keys.find((k) => k.mode === 'live' && k.keyType === 'secret' && k.isActive);
    let testPub = keys.find((k) => k.mode === 'test' && k.keyType === 'public' && k.isActive);
    let testSec = keys.find((k) => k.mode === 'test' && k.keyType === 'secret' && k.isActive);

    if (!livePub || !liveSec) {
      const liveSet = this.generateKeySet(organizationId, 'المفتاح الرئيسي (Live)', 'live');
      livePub = {
        id: `${liveSet.keyId}_pub`,
        organizationId,
        name: 'المفتاح الرئيسي (Live) (Public)',
        keyType: 'public',
        keyPrefix: 'pk_live',
        keyValue: liveSet.publicKey,
        keyPreview: `${liveSet.publicKey.slice(0, 10)}...${liveSet.publicKey.slice(-4)}`,
        mode: 'live',
        isActive: true,
        createdAt: new Date().toISOString(),
      };
      liveSec = {
        id: `${liveSet.keyId}_sec`,
        organizationId,
        name: 'المفتاح الرئيسي (Live) (Secret)',
        keyType: 'secret',
        keyPrefix: 'sk_live',
        keyPreview: `${liveSet.secretKey.slice(0, 10)}...${liveSet.secretKey.slice(-4)}`,
        mode: 'live',
        isActive: true,
        createdAt: new Date().toISOString(),
      };
    }

    if (!testPub || !testSec) {
      const testSet = this.generateKeySet(organizationId, 'المفتاح التجريبي (Sandbox)', 'test');
      testPub = {
        id: `${testSet.keyId}_pub`,
        organizationId,
        name: 'المفتاح التجريبي (Sandbox) (Public)',
        keyType: 'public',
        keyPrefix: 'pk_test',
        keyValue: testSet.publicKey,
        keyPreview: `${testSet.publicKey.slice(0, 10)}...${testSet.publicKey.slice(-4)}`,
        mode: 'test',
        isActive: true,
        createdAt: new Date().toISOString(),
      };
      testSec = {
        id: `${testSet.keyId}_sec`,
        organizationId,
        name: 'المفتاح التجريبي (Sandbox) (Secret)',
        keyType: 'secret',
        keyPrefix: 'sk_test',
        keyValue: testSet.secretKey,
        keyPreview: `${testSet.secretKey.slice(0, 10)}...${testSet.secretKey.slice(-4)}`,
        mode: 'test',
        isActive: true,
        createdAt: new Date().toISOString(),
      };
    }

    return {
      live: {
        publicKey: livePub.keyValue || livePub.keyPreview,
        secretPreview: liveSec.keyPreview,
      },
      test: {
        publicKey: testPub.keyValue || testPub.keyPreview,
        secretPreview: testSec.keyPreview,
        testSecretKey: testSec.keyValue || undefined,
      },
    };
  }

  /**
   * Authenticates a Bearer or API Secret Key for server-to-server endpoints
   */
  static authenticateSecretKey(keyString: string): { organizationId: string; mode: 'live' | 'test'; keyId: string } | null {
    if (!keyString || typeof keyString !== 'string') return null;
    const cleanKey = keyString.replace(/^Bearer\s+/i, '').trim();
    if (!cleanKey.startsWith('sk_live_') && !cleanKey.startsWith('sk_test_')) {
      return null;
    }

    const hash = hashKey(cleanKey);
    const db = getDatabase();
    const row = db.prepare(`
      SELECT id, organization_id, mode, is_active
      FROM merchant_api_keys
      WHERE key_hash = ? AND key_type = 'secret' AND is_active = 1
    `).get(hash) as any;

    if (!row) return null;

    db.prepare("UPDATE merchant_api_keys SET last_used_at = datetime('now') WHERE id = ?").run(row.id);

    return {
      organizationId: row.organization_id,
      mode: row.mode,
      keyId: row.id,
    };
  }

  /**
   * Authenticates a Public Key for client-side Drop-in SDK
   */
  static authenticatePublicKey(publicKey: string): { organizationId: string; mode: 'live' | 'test'; keyId: string } | null {
    if (!publicKey || typeof publicKey !== 'string') return null;
    const cleanKey = publicKey.trim();
    if (!cleanKey.startsWith('pk_live_') && !cleanKey.startsWith('pk_test_')) {
      return null;
    }

    const hash = hashKey(cleanKey);
    const db = getDatabase();
    const row = db.prepare(`
      SELECT id, organization_id, mode, is_active
      FROM merchant_api_keys
      WHERE key_hash = ? AND key_type = 'public' AND is_active = 1
    `).get(hash) as any;

    if (!row) return null;

    db.prepare("UPDATE merchant_api_keys SET last_used_at = datetime('now') WHERE id = ?").run(row.id);

    return {
      organizationId: row.organization_id,
      mode: row.mode,
      keyId: row.id,
    };
  }

  /**
   * Revoke key
   */
  static revokeKey(organizationId: string, keyId: string): boolean {
    const db = getDatabase();
    const res = db.prepare(`
      UPDATE merchant_api_keys
      SET is_active = 0
      WHERE (id = ? OR id = ? OR id = ?) AND organization_id = ?
    `).run(keyId, `${keyId}_pub`, `${keyId}_sec`, organizationId);

    return res.changes > 0;
  }

  /**
   * Flexible authenticator that accepts either a Secret Key (sk_...) or Public Key (pk_...)
   * Useful for third-party webhook receivers (e.g. Easy Orders, Shopify)
   */
  static authenticateAnyKey(keyString: string): { organizationId: string; mode: 'live' | 'test'; keyId: string } | null {
    if (!keyString || typeof keyString !== 'string') return null;
    const cleanKey = keyString.replace(/^Bearer\s+/i, '').trim();
    if (cleanKey.startsWith('sk_live_') || cleanKey.startsWith('sk_test_')) {
      return this.authenticateSecretKey(cleanKey);
    }
    if (cleanKey.startsWith('pk_live_') || cleanKey.startsWith('pk_test_')) {
      return this.authenticatePublicKey(cleanKey);
    }
    return null;
  }
}
