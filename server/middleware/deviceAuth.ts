import { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import { getDatabase } from '../db';

export interface AuthenticatedDeviceRequest extends Request {
  deviceContext?: {
    deviceId: string;
    organizationId: string;
    adapterType: string;
    status: string;
  };
}

export function verifyDeviceSignature(req: AuthenticatedDeviceRequest, res: Response, next: NextFunction): void {
  const deviceId = req.header('X-Device-ID');
  const timestampStr = req.header('X-Timestamp');
  const nonce = req.header('X-Nonce');
  const signature = req.header('X-Signature');

  if (!deviceId || !timestampStr || !nonce || !signature) {
    res.status(401).json({
      error: 'UNAUTHORIZED_DEVICE',
      message: 'Missing mandatory cryptographic headers: X-Device-ID, X-Timestamp, X-Nonce, X-Signature',
    });
    return;
  }

  // 1. Verify Timestamp Freshness Window (±300 seconds)
  const timestamp = parseInt(timestampStr, 10);
  const now = Math.floor(Date.now() / 1000);
  if (isNaN(timestamp) || Math.abs(now - timestamp) > 300) {
    res.status(401).json({
      error: 'EXPIRED_OR_CLOCK_SKEW',
      message: `Request timestamp outside acceptable window (±300s). Server time: ${now}`,
    });
    return;
  }

  const db = getDatabase();

  // 2. Fetch Device & HMAC Secret
  const deviceRow = db.prepare(`
    SELECT d.id, d.organization_id, d.adapter_type, d.status, c.hmac_secret, c.revoked_at
    FROM devices d
    JOIN device_credentials c ON d.id = c.device_id
    WHERE d.id = ?
  `).get(deviceId) as any;

  if (!deviceRow) {
    res.status(401).json({
      error: 'UNKNOWN_DEVICE',
      message: 'Device not registered in system',
    });
    return;
  }

  if (deviceRow.status === 'revoked' || deviceRow.revoked_at) {
    res.status(403).json({
      error: 'REVOKED_DEVICE',
      message: 'Device credentials have been revoked by organization administrator',
    });
    return;
  }

  // 3. Prevent Replay Attacks: Check Nonce Uniqueness in Organization
  const existingNonce = db.prepare(`
    SELECT id FROM raw_events WHERE organization_id = ? AND nonce = ?
  `).get(deviceRow.organization_id, nonce);

  if (existingNonce) {
    res.status(409).json({
      error: 'REPLAYED_NONCE',
      message: 'Cryptographic nonce has already been processed for this tenant',
    });
    return;
  }

  // 4. Compute Expected Canonical Signature
  const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
  const bodySha256 = crypto.createHash('sha256').update(rawBody).digest('hex');
  const canonicalString = `${req.method}\n${req.originalUrl || req.path}\n${timestampStr}\n${nonce}\n${bodySha256}`;

  const expectedSignature = crypto
    .createHmac('sha256', deviceRow.hmac_secret)
    .update(canonicalString)
    .digest('hex');

  // Constant-time buffer comparison to prevent timing attacks
  const signatureBuffer = Buffer.from(signature, 'hex');
  const expectedBuffer = Buffer.from(expectedSignature, 'hex');

  if (signatureBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) {
    res.status(401).json({
      error: 'INVALID_SIGNATURE',
      message: 'HMAC-SHA256 signature verification failed',
    });
    return;
  }

  // Update device battery & last seen ping if present in payload
  if (req.body && req.body.battery_level !== undefined) {
    db.prepare(`
      UPDATE devices SET battery_level = ?, last_seen_at = datetime('now'), status = 'online'
      WHERE id = ?
    `).run(Number(req.body.battery_level), deviceId);
  } else {
    db.prepare(`
      UPDATE devices SET last_seen_at = datetime('now'), status = 'online'
      WHERE id = ?
    `).run(deviceId);
  }

  // Attach verified context derived strictly from device record
  req.deviceContext = {
    deviceId: deviceRow.id,
    organizationId: deviceRow.organization_id,
    adapterType: deviceRow.adapter_type,
    status: deviceRow.status,
  };

  next();
}
