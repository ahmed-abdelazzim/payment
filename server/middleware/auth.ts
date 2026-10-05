import { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import { getDatabase } from '../db';

export interface AuthenticatedUserRequest extends Request {
  user?: {
    id: string;
    email: string;
    fullName: string;
    role: 'owner' | 'admin' | 'manager' | 'viewer';
    organizationId: string;
    emailVerified?: boolean;
    isPlatformAdmin?: boolean;
  };
}

/**
 * Session values are bearer credentials.  Persist only their SHA-256 digest so a
 * database or log export cannot be replayed as a browser session.
 */
export function hashOpaqueToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export const hashSessionToken = hashOpaqueToken;

function getCookieValue(req: Request, name: string): string | undefined {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return undefined;

  const cookie = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));

  if (!cookie) return undefined;

  try {
    return decodeURIComponent(cookie.slice(name.length + 1));
  } catch {
    return undefined;
  }
}

/**
 * Browser sessions intentionally use only the HttpOnly cookie.  Do not accept
 * Authorization or X-Session-Token fallbacks: those invite accidental token
 * storage in JavaScript and make cross-site token exfiltration harder to spot.
 */
export function getSessionTokenFromRequest(req: Request): string | undefined {
  return getCookieValue(req, 'sarraf_session_token');
}

/**
 * Lightweight same-origin CSRF guard for browser state-changing API calls.
 * Device APIs use HMAC credentials instead and are deliberately excluded at the
 * router level.  APP_URL may be supplied for a canonical production origin;
 * the request host is retained for ordinary local and reverse-proxy deployments.
 */
export function requireTrustedOrigin(req: Request, res: Response, next: NextFunction): void {
  const origin = req.header('Origin');

  // The in-process test harness exercises middleware without a browser origin.
  if (process.env.NODE_ENV === 'test' && req.header('X-Test-Org-Id')) {
    next();
    return;
  }

  if (!origin) {
    res.status(403).json({
      error: 'CSRF_ORIGIN_REQUIRED',
      message: 'A same-origin browser request is required for this action.',
    });
    return;
  }

  let normalizedOrigin: string;
  try {
    normalizedOrigin = new URL(origin).origin;
  } catch {
    res.status(403).json({ error: 'CSRF_INVALID_ORIGIN', message: 'Request origin is invalid.' });
    return;
  }

  const configuredOrigins = (process.env.APP_URL || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => {
      try {
        return new URL(value).origin;
      } catch {
        return value.replace(/\/$/, '');
      }
    });

  const forwardedProto = req.header('X-Forwarded-Proto')?.split(',')[0]?.trim();
  const protocol = forwardedProto || req.protocol;
  const host = req.get('host');
  const requestOrigin = host ? `${protocol}://${host}` : '';
  const trustedOrigins = new Set([...configuredOrigins, requestOrigin].filter(Boolean));

  if (!trustedOrigins.has(normalizedOrigin)) {
    res.status(403).json({
      error: 'CSRF_ORIGIN_MISMATCH',
      message: 'Cross-origin requests are not allowed for this action.',
    });
    return;
  }

  next();
}

export function requireAuth(req: AuthenticatedUserRequest, res: Response, next: NextFunction): void {
  const token = getSessionTokenFromRequest(req);

  const db = getDatabase();

  // Test suite / bypass header strictly for automated unit tests
  const testOrgId = req.header('X-Test-Org-Id');
  if (testOrgId && process.env.NODE_ENV === 'test') {
    req.user = {
      id: 'usr_test',
      email: 'test@example.com',
      fullName: 'Test Suite Operator',
      role: 'owner',
      organizationId: testOrgId,
    };
    return next();
  }

  if (!token) {
    res.status(401).json({
      error: 'UNAUTHENTICATED',
      message: 'Active session required. Please sign in.',
    });
    return;
  }

  // Look up session in database
  const session = db.prepare(`
    SELECT s.token, s.organization_id, s.expires_at,
           u.id as user_id, u.email, u.full_name, COALESCE(u.email_verified, 0) as email_verified,
           COALESCE(u.is_platform_admin, 0) as is_platform_admin,
           m.role
    FROM sessions s
    JOIN users u ON s.user_id = u.id
    JOIN organization_members m ON (s.organization_id = m.organization_id AND u.id = m.user_id)
    WHERE s.token = ? AND u.is_active = 1
  `).get(hashSessionToken(token)) as any;

  if (!session) {
    res.status(401).json({
      error: 'INVALID_SESSION',
      message: 'Session has expired or does not exist. Please sign in again.',
    });
    return;
  }

  // Check expiration (24h or stored timestamp)
  const now = new Date();
  const expiresAt = new Date(session.expires_at);
  if (now > expiresAt) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(hashSessionToken(token));
    res.status(401).json({
      error: 'EXPIRED_SESSION',
      message: 'Session has expired. Please sign in again.',
    });
    return;
  }

  const isPlatformAdmin = Boolean(session.is_platform_admin === 1);

  req.user = {
    id: session.user_id,
    email: session.email,
    fullName: session.full_name,
    role: session.role,
    organizationId: session.organization_id,
    emailVerified: Boolean(session.email_verified),
    isPlatformAdmin,
  };

  next();
}

export function requireRole(allowedRoles: string[]) {
  return (req: AuthenticatedUserRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'UNAUTHENTICATED', message: 'User not authenticated' });
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({
        error: 'FORBIDDEN_INSUFFICIENT_ROLE',
        message: `Action requires one of: ${allowedRoles.join(', ')}. Current role: ${req.user.role}`,
      });
      return;
    }

    next();
  };
}

export function requirePlatformOwner(req: AuthenticatedUserRequest, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'UNAUTHENTICATED', message: 'User not authenticated' });
    return;
  }

  const isOwner = Boolean(req.user.isPlatformAdmin);

  if (!isOwner) {
    res.status(403).json({
      error: 'FORBIDDEN_PLATFORM_OWNER_ONLY',
      message: 'Access restricted to the platform owner.',
    });
    return;
  }

  next();
}
