import { Request, Response, NextFunction } from 'express';
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

export function requireAuth(req: AuthenticatedUserRequest, res: Response, next: NextFunction): void {
  let token = req.header('X-Session-Token');

  if (!token) {
    const authHeader = req.header('Authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    }
  }

  // Cookie parsing: support both sarraf_session_token and session_token
  if (!token && req.headers.cookie) {
    const match = req.headers.cookie.match(/(?:sarraf_session_token|session_token)=([^;]+)/);
    if (match) {
      token = match[1];
    }
  }

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
  `).get(token) as any;

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
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    res.status(401).json({
      error: 'EXPIRED_SESSION',
      message: 'Session has expired. Please sign in again.',
    });
    return;
  }

  const isPlatformAdmin = Boolean(
    session.is_platform_admin === 1 ||
    session.email === 'aabdo6043@gmail.com' ||
    session.organization_id === 'org_platform_ops'
  );

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

  const isOwner = Boolean(
    req.user.isPlatformAdmin ||
    req.user.email === 'aabdo6043@gmail.com' ||
    req.user.organizationId === 'org_platform_ops'
  );

  if (!isOwner) {
    res.status(403).json({
      error: 'FORBIDDEN_PLATFORM_OWNER_ONLY',
      message: 'Access restricted to the platform owner.',
    });
    return;
  }

  next();
}
