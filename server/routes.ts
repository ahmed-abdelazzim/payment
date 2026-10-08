import path from 'node:path';
import fs from 'node:fs';
import { Router, Request, Response } from 'express';
import crypto from 'node:crypto';
import { getDatabase } from './db';
import { toMinor, fromMinor } from './money';
import { verifyDeviceSignature, AuthenticatedDeviceRequest } from './middleware/deviceAuth';
import {
  getSessionTokenFromRequest,
  hashOpaqueToken,
  hashSessionToken,
  requireAuth,
  requirePlatformOwner,
  requireRole,
  requireTrustedOrigin,
  AuthenticatedUserRequest,
} from './middleware/auth';
import { parseEgyptianPaymentMessage } from './parser/engine';
import { ReconciliationService } from './services/reconciliationService';
import { getCairoPeriodKeys, LimitEngine } from './services/limitEngine';
import { AuditService } from './services/auditService';
import { SubscriptionService } from './services/subscriptionService';
import { hashPassword, verifyPassword } from './security/passwords';
import { EmailService } from './services/emailService';
import { GoogleSheetsService } from './services/googleSheetsService';
import { ApiKeyService } from './services/apiKeyService';
import { CheckoutService } from './services/checkoutService';
import { PaymentLinkService } from './services/paymentLinkService';
import { FraudProtectionService } from './services/fraudProtectionService';

export const apiRouter = Router();

/**
 * State changes made through browser cookies must be same-origin. Capture
 * adapters authenticate with device HMAC, and external store integrations
 * authenticate via merchant API Keys or public checkout sessions.
 */
apiRouter.use((req, res, next) => {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    next();
    return;
  }

  // Exempt device telemetry & ingestion
  if (req.path === '/devices/ingest' || /^\/devices\/[^/]+\/telemetry$/.test(req.path)) {
    next();
    return;
  }

  // Exempt checkout sessions, payment links, and store integrations
  if (
    req.path === '/checkout/sessions' ||
    /^\/checkout\/sessions\/[^/]+\/(claim|simulate)$/.test(req.path) ||
    /^\/payment-links\/[^/]+\/checkout$/.test(req.path) ||
    req.path.startsWith('/integrations/easyorders') ||
    req.path.startsWith('/integrations/shopify') ||
    Boolean(
      req.headers.authorization?.startsWith('Bearer sk_') ||
      req.headers['x-api-key'] ||
      req.headers['x-public-key']
    )
  ) {
    next();
    return;
  }

  requireTrustedOrigin(req, res, next);
});

function generateSessionToken(): string {
  return `sess_${crypto.randomBytes(32).toString('hex')}`;
}

function setSessionCookie(res: Response, token: string): void {
  res.cookie('sarraf_session_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

function clearSessionCookie(res: Response): void {
  res.clearCookie('sarraf_session_token', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  });
}

function getCurrentSourceUsage(db: ReturnType<typeof getDatabase>, paymentSourceId: string) {
  const periodKeys = getCairoPeriodKeys();
  const usageRows = db.prepare(`
    SELECT period_type, accumulated_intake_minor, regulatory_cap_minor
    FROM financial_limit_usage
    WHERE payment_source_id = ?
      AND ((period_type = 'daily' AND period_key = ?) OR (period_type = 'monthly' AND period_key = ?))
  `).all(paymentSourceId, periodKeys.daily, periodKeys.monthly) as any[];
  const daily = usageRows.find((row) => row.period_type === 'daily');
  const monthly = usageRows.find((row) => row.period_type === 'monthly');
  const toUsage = (row: any, fallbackCapMinor: number) => {
    const intakeMinor = Number(row?.accumulated_intake_minor || 0);
    const capMinor = Number(row?.regulatory_cap_minor || fallbackCapMinor);
    return {
      intake: fromMinor(intakeMinor),
      percentage: capMinor > 0 ? Math.round((intakeMinor * 100) / capMinor) : 0,
    };
  };

  return {
    daily: toUsage(daily, 0),
    monthly: toUsage(monthly, 0),
    periodKeys,
  };
}

// ==========================================
// 1. AUTHENTICATION & ACCOUNT MANAGEMENT
// ==========================================

// Sign Up: Creates fresh user, new organization, and owner membership with email verification token
apiRouter.post('/auth/signup', (req: Request, res: Response) => {
  const { email, password, fullName, organizationName, organizationNameAr } = req.body;
  if (!email || !password || !fullName || !organizationName) {
    res.status(400).json({ error: 'VALIDATION_FAILED', message: 'Missing required signup fields' });
    return;
  }

  if (password.length < 8) {
    res.status(400).json({ error: 'WEAK_PASSWORD', message: 'Password must be at least 8 characters long' });
    return;
  }

  const db = getDatabase();
  const userId = `usr_${Date.now()}`;
  const orgId = `org_${Date.now()}`;
  const normalizedEmail = email.toLowerCase().trim();
  const slug = organizationName.toLowerCase().replace(/[^a-z0-9]/g, '-') + '-' + Math.floor(Math.random() * 1000);

  try {
    db.exec('BEGIN IMMEDIATE;');

    // 1. Create Organization
    db.prepare(`
      INSERT INTO organizations (id, name, name_ar, slug, default_timezone)
      VALUES (?, ?, ?, ?, 'Africa/Cairo')
    `).run(orgId, organizationName, organizationNameAr || organizationName, slug);

    // 2. Create User with Argon2id/scrypt password hash
    const scryptHash = hashPassword(password);
    const isDesignatedPlatformAdmin =
      normalizedEmail === 'aabdo6043@gmail.com' ||
      Boolean(process.env.PLATFORM_ADMIN_EMAIL && normalizedEmail === process.env.PLATFORM_ADMIN_EMAIL.trim().toLowerCase());
    const initialPlatformAdmin = isDesignatedPlatformAdmin ? 1 : 0;
    const initialEmailVerified = isDesignatedPlatformAdmin ? 1 : 0;

    db.prepare(`
      INSERT INTO users (id, email, password_hash, full_name, email_verified, is_active, is_platform_admin)
      VALUES (?, ?, ?, ?, ?, 1, ?)
    `).run(userId, normalizedEmail, scryptHash, fullName.trim(), initialEmailVerified, initialPlatformAdmin);

    // 3. Bind Owner Role
    db.prepare(`
      INSERT INTO organization_members (id, organization_id, user_id, role)
      VALUES (?, ?, ?, 'owner')
    `).run(`mem_${Date.now()}`, orgId, userId);

    // 4. Create Clean Initial Balance Account (Zero Balance)
    db.prepare(`
      INSERT INTO balance_accounts (id, organization_id, account_name, currency, current_balance_minor)
      VALUES (?, ?, 'Main Operational Account (EGP)', 'EGP', 0)
    `).run(`acc_${orgId}`, orgId);

    // 5. Generate Session Token (7 Days)
    const token = generateSessionToken();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare(`
      INSERT INTO sessions (token, user_id, organization_id, expires_at)
      VALUES (?, ?, ?, ?)
    `).run(hashSessionToken(token), userId, orgId, expiresAt);

    // 6. Generate Email Verification Token (24 Hours Expiry)
    const verifyToken = `verify_${crypto.randomBytes(24).toString('hex')}`;
    const verifyExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    db.prepare(`
      INSERT INTO email_verifications (token, user_id, email, expires_at)
      VALUES (?, ?, ?, ?)
    `).run(hashOpaqueToken(verifyToken), userId, normalizedEmail, verifyExpiresAt);

    AuditService.record({
      organizationId: orgId,
      actorIdentity: normalizedEmail,
      action: 'USER_REGISTERED_AND_WORKSPACE_CREATED',
      resourceType: 'organization',
      resourceId: orgId,
      originIp: req.ip,
      details: { email: normalizedEmail, organizationName },
    });

    // 7. Provision 14-Day Free Trial (336 Hours UTC, 1 Capture Phone Limit)
    SubscriptionService.startFreeTrial(orgId);

    db.exec('COMMIT;');

    // Set secure HTTP-only session cookie
    setSessionCookie(res, token);

    // 8. Dispatch verification email
    EmailService.sendVerificationEmail({
      to: normalizedEmail,
      fullName: fullName.trim(),
      token: verifyToken,
      organizationName: organizationNameAr || organizationName,
    }).catch(() => console.error('[Signup] Email dispatch failed.'));

    res.status(201).json({
      user: { id: userId, email: normalizedEmail, fullName, role: 'owner', emailVerified: false },
      organization: { id: orgId, name: organizationName, nameAr: organizationNameAr || organizationName, slug },
      emailVerification: {
        pending: true,
        expiresAt: verifyExpiresAt,
      },
    });
  } catch (err: any) {
    db.exec('ROLLBACK;');
    if (err.message && err.message.includes('UNIQUE constraint failed: users.email')) {
      res.status(409).json({ error: 'EMAIL_ALREADY_EXISTS', message: 'An account with this email already exists' });
      return;
    }
    res.status(500).json({ error: 'SIGNUP_FAILED', message: 'Unable to create the account at this time.' });
  }
});

// Login with Brute Force Lockout Defense & Transparent Password Hash Migration
apiRouter.post('/auth/login', (req: Request, res: Response) => {
  const { email, password } = req.body;
  if (!email || !password) {
    res.status(400).json({ error: 'MISSING_CREDENTIALS', message: 'Email and password required' });
    return;
  }

  const db = getDatabase();
  const normalizedEmail = email.toLowerCase().trim();
  const clientIp = req.ip || 'unknown_ip';
  const lockoutKey = `${normalizedEmail}_${clientIp}`;

  // 1. Check for Active Rate-Limit / Brute Force Lockout
  const attemptRow = db.prepare(`
    SELECT failed_count, locked_until FROM login_attempts WHERE identifier = ?
  `).get(lockoutKey) as any;

  if (attemptRow && attemptRow.locked_until) {
    const lockExpiry = new Date(attemptRow.locked_until);
    if (new Date() < lockExpiry) {
      const waitMinutes = Math.ceil((lockExpiry.getTime() - Date.now()) / 60000);
      res.status(429).json({
        error: 'ACCOUNT_TEMPORARILY_LOCKED',
        message: `Too many failed login attempts. Locked for security. Please try again in ${waitMinutes} minute(s).`,
      });
      return;
    }
  }

  const user = db.prepare(`
    SELECT id, email, password_hash, full_name, email_verified, is_active, COALESCE(is_platform_admin, 0) AS is_platform_admin
    FROM users WHERE email = ?
  `).get(normalizedEmail) as any;

  // Verify password with timing-safe scrypt and transparent legacy rehash detection
  const verification = user ? verifyPassword(password, user.password_hash) : { valid: false, needsRehash: false };

  if (!user || !verification.valid) {
    // Record failed attempt
    const newCount = (attemptRow?.failed_count || 0) + 1;
    const shouldLock = newCount >= 5;
    const lockedUntil = shouldLock ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : null;

    db.prepare(`
      INSERT INTO login_attempts (identifier, failed_count, locked_until, last_attempt_at)
      VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(identifier) DO UPDATE SET
        failed_count = excluded.failed_count,
        locked_until = excluded.locked_until,
        last_attempt_at = datetime('now')
    `).run(lockoutKey, newCount, lockedUntil);

    res.status(401).json({ error: 'INVALID_CREDENTIALS', message: 'Invalid email or password' });
    return;
  }

  if (!user.is_active) {
    res.status(403).json({ error: 'ACCOUNT_SUSPENDED', message: 'Account is deactivated' });
    return;
  }

  // Clear failed login attempts upon successful credential verification
  db.prepare('DELETE FROM login_attempts WHERE identifier = ?').run(lockoutKey);

  // Transparently rehash legacy password to modern scrypt
  if (verification.needsRehash) {
    try {
      const newHash = hashPassword(password);
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newHash, user.id);
    } catch {}
  }

  // Find user's primary organization membership
  const member = db.prepare(`
    SELECT m.organization_id, m.role, o.name, o.name_ar, o.slug
    FROM organization_members m
    JOIN organizations o ON m.organization_id = o.id
    WHERE m.user_id = ?
    LIMIT 1
  `).get(user.id) as any;

  if (!member) {
    res.status(403).json({ error: 'NO_WORKSPACE', message: 'User does not belong to any workspace' });
    return;
  }

  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare(`
    INSERT INTO sessions (token, user_id, organization_id, expires_at)
    VALUES (?, ?, ?, ?)
  `).run(hashSessionToken(token), user.id, member.organization_id, expiresAt);

  AuditService.record({
    organizationId: member.organization_id,
    actorIdentity: user.email,
    action: 'USER_LOGGED_IN',
    resourceType: 'user',
    resourceId: user.id,
    originIp: req.ip,
  });

  // Set secure HTTP-only session cookie
  setSessionCookie(res, token);

  res.json({
    user: {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      role: member.role,
      emailVerified: Boolean(user.email_verified),
      isPlatformAdmin: Boolean(user.is_platform_admin === 1),
    },
    organization: { id: member.organization_id, name: member.name, nameAr: member.name_ar, slug: member.slug },
  });
});

// Verify Email Address (Single-use, 24-Hour Expiry)
apiRouter.post('/auth/verify-email', (req: Request, res: Response) => {
  const { token } = req.body;
  if (!token) {
    res.status(400).json({ error: 'TOKEN_REQUIRED', message: 'Verification token is required' });
    return;
  }

  const db = getDatabase();
  const row = db.prepare(`
    SELECT user_id, email, expires_at, used_at FROM email_verifications WHERE token = ?
  `).get(hashOpaqueToken(token)) as any;

  if (!row || row.used_at || new Date() > new Date(row.expires_at)) {
    res.status(400).json({ error: 'INVALID_OR_EXPIRED_TOKEN', message: 'Email verification token is invalid or expired.' });
    return;
  }

  db.exec('BEGIN IMMEDIATE;');
  try {
    db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(row.user_id);
    db.prepare('UPDATE email_verifications SET used_at = datetime("now") WHERE token = ?').run(hashOpaqueToken(token));
    db.exec('COMMIT;');

    res.json({ message: 'Email verified successfully', email: row.email });
  } catch (err: any) {
    db.exec('ROLLBACK;');
    res.status(500).json({ error: 'VERIFICATION_FAILED', message: 'Unable to verify this email at this time.' });
  }
});

// Resend Email Verification Token
apiRouter.post('/auth/resend-verification', (req: Request, res: Response) => {
  const { email } = req.body;
  if (!email) {
    res.status(400).json({ error: 'EMAIL_REQUIRED' });
    return;
  }

  const db = getDatabase();
  const user = db.prepare('SELECT id, email, full_name, email_verified FROM users WHERE email = ?').get(email.toLowerCase().trim()) as any;

  if (user && !user.email_verified) {
    const newToken = `verify_${crypto.randomBytes(24).toString('hex')}`;
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    db.prepare("UPDATE email_verifications SET used_at = datetime('now') WHERE user_id = ? AND used_at IS NULL").run(user.id);
    db.prepare(`
      INSERT INTO email_verifications (token, user_id, email, expires_at)
      VALUES (?, ?, ?, ?)
    `).run(hashOpaqueToken(newToken), user.id, user.email, expiresAt);

    EmailService.sendVerificationEmail({
      to: user.email,
      fullName: user.full_name || user.email,
      token: newToken,
      organizationName: 'Sarraf Ops',
    }).catch(() => console.error('[ResendVerification] Email dispatch failed.'));

    res.json({ message: 'If this unverified email exists, a verification link has been dispatched.' });
    return;
  }

  res.json({ message: 'If this unverified email exists, a verification link has been dispatched.' });
});

// Logout: Revokes Session and Clears HTTP Cookie
apiRouter.post('/auth/logout', (req: Request, res: Response) => {
  const token = getSessionTokenFromRequest(req);

  if (token) {
    const db = getDatabase();
    db.prepare('DELETE FROM sessions WHERE token = ?').run(hashSessionToken(token));
  }

  clearSessionCookie(res);
  res.json({ message: 'Logged out successfully' });
});

// Forgot Password Flow (15-Minute Expiry Token)
apiRouter.post('/auth/forgot-password', (req: Request, res: Response) => {
  const { email } = req.body;
  if (!email) {
    res.status(400).json({ error: 'EMAIL_REQUIRED', message: 'Email is required' });
    return;
  }

  const db = getDatabase();
  const normalized = email.toLowerCase().trim();
  const user = db.prepare('SELECT id, full_name FROM users WHERE email = ?').get(normalized) as any;

  if (user) {
    const resetToken = `reset_${crypto.randomBytes(24).toString('hex')}`;
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 minutes
    db.prepare(`
      INSERT INTO password_resets (token, user_id, expires_at)
      VALUES (?, ?, ?)
    `).run(hashOpaqueToken(resetToken), user.id, expiresAt);

    EmailService.sendPasswordResetEmail({
      to: normalized,
      fullName: user.full_name || '',
      token: resetToken,
    }).catch(() => console.error('[ForgotPassword] Email dispatch failed.'));

    res.json({ message: 'If this email exists, a password reset link has been dispatched.' });
    return;
  }

  // Prevent email enumeration
  res.json({ message: 'If this email exists, a password reset link has been dispatched.' });
});

// Reset Password with Scrypt & Invalidate All Existing Sessions
apiRouter.post('/auth/reset-password', (req: Request, res: Response) => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword || newPassword.length < 8) {
    res.status(400).json({ error: 'INVALID_INPUT', message: 'Token and minimum 8-character password required' });
    return;
  }

  const db = getDatabase();
  const resetRow = db.prepare(`
    SELECT user_id, expires_at, used_at FROM password_resets WHERE token = ?
  `).get(hashOpaqueToken(token)) as any;

  if (!resetRow || resetRow.used_at || new Date() > new Date(resetRow.expires_at)) {
    res.status(400).json({ error: 'INVALID_OR_EXPIRED_TOKEN', message: 'Reset token is invalid or expired' });
    return;
  }

  db.exec('BEGIN IMMEDIATE;');
  try {
    const scryptHash = hashPassword(newPassword);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(scryptHash, resetRow.user_id);
    db.prepare('UPDATE password_resets SET used_at = datetime("now") WHERE token = ?').run(hashOpaqueToken(token));
    // Invalidate ALL existing sessions for this user across all devices
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(resetRow.user_id);
    db.exec('COMMIT;');

    clearSessionCookie(res);
    res.json({ message: 'Password updated successfully. Please sign in with your new password.' });
  } catch (err: any) {
    db.exec('ROLLBACK;');
    res.status(500).json({ error: 'RESET_FAILED', message: 'Unable to reset the password at this time.' });
  }
});

// Current User Session Context
apiRouter.get('/auth/me', requireAuth, (req: AuthenticatedUserRequest, res: Response) => {
  const db = getDatabase();
  const org = db.prepare('SELECT id, name, name_ar, slug, default_timezone FROM organizations WHERE id = ?').get(req.user!.organizationId);
  const workspaces = db.prepare(`
    SELECT o.id, o.name, o.name_ar, o.slug, m.role
    FROM organization_members m
    JOIN organizations o ON m.organization_id = o.id
    WHERE m.user_id = ?
  `).all(req.user!.id);

  res.json({
    user: req.user,
    organization: org,
    workspaces,
  });
});

// Switch Active Workspace
apiRouter.post('/auth/switch-workspace', requireAuth, (req: AuthenticatedUserRequest, res: Response) => {
  const { organizationId } = req.body;
  if (!organizationId) {
    res.status(400).json({ error: 'ORGANIZATION_ID_REQUIRED' });
    return;
  }

  const db = getDatabase();
  const membership = db.prepare(`
    SELECT m.role, o.name, o.name_ar, o.slug
    FROM organization_members m
    JOIN organizations o ON m.organization_id = o.id
    WHERE m.user_id = ? AND m.organization_id = ?
  `).get(req.user!.id, organizationId) as any;

  if (!membership) {
    res.status(403).json({ error: 'ACCESS_DENIED', message: 'You are not a member of this workspace' });
    return;
  }

  // Update session token's active organization
  const token = getSessionTokenFromRequest(req);
  if (token) {
    db.prepare('UPDATE sessions SET organization_id = ? WHERE token = ?').run(organizationId, hashSessionToken(token));
  }

  res.json({
    message: 'Switched workspace successfully',
    organization: { id: organizationId, name: membership.name, nameAr: membership.name_ar, slug: membership.slug },
    role: membership.role,
  });
});

// ==========================================
// 2. WORKSPACE SETTINGS & TEAM MANAGEMENT
// ==========================================

apiRouter.get('/organizations/members', requireAuth, (req: AuthenticatedUserRequest, res: Response) => {
  const db = getDatabase();
  const members = db.prepare(`
    SELECT u.id, u.email, u.full_name as fullName, m.role, m.created_at as joinedAt
    FROM organization_members m
    JOIN users u ON m.user_id = u.id
    WHERE m.organization_id = ?
    ORDER BY m.created_at ASC
  `).all(req.user!.organizationId);

  res.json(members);
});

// List pending team invitations
apiRouter.get('/organizations/members/invitations', requireAuth, requireRole(['owner', 'admin']), (req: AuthenticatedUserRequest, res: Response) => {
  const db = getDatabase();
  const invitations = db.prepare(`
    SELECT email, role, expires_at as expiresAt, created_at as createdAt
    FROM team_invitations
    WHERE organization_id = ? AND accepted_at IS NULL AND expires_at > datetime('now')
    ORDER BY created_at DESC
  `).all(req.user!.organizationId);

  res.json(invitations);
});

// Issue single-use team invitation with cryptographic token (Valid for 7 days)
apiRouter.post('/organizations/members/invite', requireAuth, requireRole(['owner', 'admin']), (req: AuthenticatedUserRequest, res: Response) => {
  const { email, role, fullName } = req.body;
  if (!email || !role || !['admin', 'manager', 'viewer'].includes(role)) {
    res.status(400).json({ error: 'INVALID_INVITE_INPUT', message: 'Email and valid role (admin, manager, viewer) required' });
    return;
  }

  const db = getDatabase();
  const normalizedEmail = email.toLowerCase().trim();

  // Check if already a member in this organization
  const existingMember = db.prepare(`
    SELECT m.id FROM organization_members m
    JOIN users u ON m.user_id = u.id
    WHERE m.organization_id = ? AND u.email = ?
  `).get(req.user!.organizationId, normalizedEmail);

  if (existingMember) {
    res.status(409).json({ error: 'MEMBER_EXISTS', message: 'This user is already a member of this workspace' });
    return;
  }

  const inviteToken = `inv_${crypto.randomBytes(24).toString('hex')}`;
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days

  try {
    db.prepare(`
      INSERT INTO team_invitations (token, organization_id, email, role, inviter_user_id, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(hashOpaqueToken(inviteToken), req.user!.organizationId, normalizedEmail, role, req.user!.id, expiresAt);

    AuditService.record({
      organizationId: req.user!.organizationId,
      actorIdentity: req.user!.email,
      action: 'TEAM_MEMBER_INVITATION_ISSUED',
      resourceType: 'team_invitation',
      resourceId: normalizedEmail,
      originIp: req.ip,
      details: { invitedEmail: normalizedEmail, assignedRole: role },
    });

    const inviterOrg = db.prepare('SELECT name, name_ar FROM organizations WHERE id = ?').get(req.user!.organizationId) as any;
    const orgDisplayName = inviterOrg ? (inviterOrg.name_ar || inviterOrg.name) : 'Sarraf Ops';

    EmailService.sendTeamInviteEmail({
      to: normalizedEmail,
      inviterName: req.user!.fullName || req.user!.email,
      organizationName: orgDisplayName,
      role,
      token: inviteToken,
    }).catch(() => console.error('[TeamInvite] Email dispatch failed.'));

    res.status(201).json({
      message: 'Invitation request accepted. The recipient will receive a link if email delivery is configured.',
      email: normalizedEmail,
      role,
      expiresAt,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'INVITE_FAILED', message: 'Unable to create the invitation at this time.' });
  }
});

// Accept Team Invitation
apiRouter.post('/organizations/members/invitations/accept', requireAuth, (req: AuthenticatedUserRequest, res: Response) => {
  const { token } = req.body;
  if (!token) {
    res.status(400).json({ error: 'TOKEN_REQUIRED', message: 'Invitation token is required' });
    return;
  }

  const db = getDatabase();
  const invite = db.prepare(`
    SELECT token, organization_id, email, role, expires_at, accepted_at
    FROM team_invitations WHERE token = ?
  `).get(hashOpaqueToken(token)) as any;

  if (!invite || invite.accepted_at || new Date() > new Date(invite.expires_at)) {
    res.status(400).json({ error: 'INVALID_OR_EXPIRED_INVITATION', message: 'Invitation token is invalid or has expired' });
    return;
  }

  db.exec('BEGIN IMMEDIATE;');
  try {
    db.prepare(`
      INSERT INTO organization_members (id, organization_id, user_id, role)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(organization_id, user_id) DO UPDATE SET role = excluded.role
    `).run(`mem_${Date.now()}`, invite.organization_id, req.user!.id, invite.role);

    db.prepare(`UPDATE team_invitations SET accepted_at = datetime('now') WHERE token = ?`).run(hashOpaqueToken(token));

    AuditService.record({
      organizationId: invite.organization_id,
      actorIdentity: req.user!.email,
      action: 'TEAM_MEMBER_INVITATION_ACCEPTED',
      resourceType: 'organization_member',
      resourceId: req.user!.id,
      originIp: req.ip,
      details: { acceptedRole: invite.role },
    });

    db.exec('COMMIT;');
    res.json({ message: 'Successfully joined organization', organizationId: invite.organization_id, role: invite.role });
  } catch (err: any) {
    db.exec('ROLLBACK;');
    res.status(500).json({ error: 'ACCEPT_INVITATION_FAILED', message: 'Unable to accept the invitation at this time.' });
  }
});

// View Invitation Details (Public endpoint for invite page)
apiRouter.get('/organizations/members/invitations/:token', (req: Request, res: Response) => {
  const { token } = req.params;
  const db = getDatabase();

  const invite = db.prepare(`
    SELECT i.token, i.organization_id, i.email, i.role, i.expires_at, i.accepted_at,
           o.name as organization_name, o.name_ar as organization_name_ar
    FROM team_invitations i
    JOIN organizations o ON o.id = i.organization_id
    WHERE i.token = ?
  `).get(hashOpaqueToken(token)) as any;

  if (!invite) {
    res.status(404).json({ error: 'INVITATION_NOT_FOUND', message: 'Invitation not found' });
    return;
  }

  const isExpired = new Date() > new Date(invite.expires_at);
  const isAccepted = Boolean(invite.accepted_at);

  res.json({
    organizationId: invite.organization_id,
    organizationName: invite.organization_name,
    organizationNameAr: invite.organization_name_ar || invite.organization_name,
    email: invite.email,
    role: invite.role,
    expiresAt: invite.expires_at,
    isExpired,
    isAccepted,
    isValid: !isExpired && !isAccepted,
  });
});

// Register and Accept Invitation in one step (For newly invited teammates who don't have an account yet)
apiRouter.post('/organizations/members/invitations/register-and-accept', (req: Request, res: Response) => {
  const { token, fullName, password } = req.body;
  if (!token || !fullName || !password) {
    res.status(400).json({ error: 'MISSING_FIELDS', message: 'Token, full name, and password are required' });
    return;
  }

  if (password.length < 8) {
    res.status(400).json({ error: 'WEAK_PASSWORD', message: 'Password must be at least 8 characters long' });
    return;
  }

  const db = getDatabase();
  const invite = db.prepare(`
    SELECT i.token, i.organization_id, i.email, i.role, i.expires_at, i.accepted_at,
           o.name as organization_name, o.name_ar as organization_name_ar, o.slug
    FROM team_invitations i
    JOIN organizations o ON o.id = i.organization_id
    WHERE i.token = ?
  `).get(hashOpaqueToken(token)) as any;

  if (!invite || invite.accepted_at || new Date() > new Date(invite.expires_at)) {
    res.status(400).json({ error: 'INVALID_OR_EXPIRED_INVITATION', message: 'Invitation is invalid or has expired' });
    return;
  }

  db.exec('BEGIN IMMEDIATE;');
  try {
    const normalizedEmail = invite.email.toLowerCase().trim();
    let user = db.prepare('SELECT id, email, full_name FROM users WHERE email = ?').get(normalizedEmail) as any;
    let userId = user?.id;

    if (!user) {
      userId = `usr_${Date.now()}`;
      const scryptHash = hashPassword(password);
      db.prepare(`
        INSERT INTO users (id, email, password_hash, full_name, email_verified, is_active)
        VALUES (?, ?, ?, ?, 1, 1)
      `).run(userId, normalizedEmail, scryptHash, fullName.trim());
    }

    db.prepare(`
      INSERT INTO organization_members (id, organization_id, user_id, role)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(organization_id, user_id) DO UPDATE SET role = excluded.role
    `).run(`mem_${Date.now()}`, invite.organization_id, userId, invite.role);

    db.prepare(`UPDATE team_invitations SET accepted_at = datetime('now') WHERE token = ?`).run(hashOpaqueToken(token));

    // Create session
    const sessionToken = generateSessionToken();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare(`
      INSERT INTO sessions (token, user_id, organization_id, expires_at)
      VALUES (?, ?, ?, ?)
    `).run(hashSessionToken(sessionToken), userId, invite.organization_id, expiresAt);

    AuditService.record({
      organizationId: invite.organization_id,
      actorIdentity: normalizedEmail,
      action: 'TEAM_MEMBER_REGISTERED_AND_ACCEPTED',
      resourceType: 'organization_member',
      resourceId: userId,
      originIp: req.ip,
      details: { role: invite.role },
    });

    db.exec('COMMIT;');

    setSessionCookie(res, sessionToken);

    res.json({
      user: { id: userId, email: normalizedEmail, fullName: fullName.trim(), role: invite.role },
      organization: {
        id: invite.organization_id,
        name: invite.organization_name,
        nameAr: invite.organization_name_ar,
        slug: invite.slug,
      },
    });
  } catch (err: any) {
    db.exec('ROLLBACK;');
    res.status(500).json({ error: 'JOIN_FAILED', message: 'Unable to complete account setup at this time.' });
  }
});

// Get Organization Settings
apiRouter.get('/organizations/settings', requireAuth, (req: AuthenticatedUserRequest, res: Response) => {
  const db = getDatabase();
  const org = db.prepare(`
    SELECT id, name, name_ar, slug, default_timezone, telegram_bot_token, telegram_chat_id, webhook_url, webhook_secret
    FROM organizations
    WHERE id = ?
  `).get(req.user!.organizationId) as any;

  res.json({
    id: org?.id,
    name: org?.name,
    nameAr: org?.name_ar,
    defaultTimezone: org?.default_timezone,
    // Credentials are write-only.  Do not return them to any browser role.
    telegramBotTokenConfigured: Boolean(org?.telegram_bot_token),
    telegramChatId: org?.telegram_chat_id || '',
    webhookUrl: org?.webhook_url || '',
    webhookSecretConfigured: Boolean(org?.webhook_secret),
  });
});

// Update Organization Settings (Telegram, Webhooks, Timezone)
apiRouter.post('/organizations/settings', requireAuth, requireRole(['owner', 'admin']), (req: AuthenticatedUserRequest, res: Response) => {
  const { name, nameAr, defaultTimezone, telegramBotToken, telegramChatId, webhookUrl, webhookSecret } = req.body;
  const db = getDatabase();
  const replacementTelegramToken = typeof telegramBotToken === 'string' && telegramBotToken.trim()
    ? telegramBotToken.trim()
    : null;
  const replacementWebhookSecret = typeof webhookSecret === 'string' && webhookSecret.trim()
    ? webhookSecret.trim()
    : null;

  db.prepare(`
    UPDATE organizations
    SET name = COALESCE(?, name),
        name_ar = COALESCE(?, name_ar),
        default_timezone = COALESCE(?, default_timezone),
        telegram_bot_token = COALESCE(?, telegram_bot_token),
        telegram_chat_id = COALESCE(?, telegram_chat_id),
        webhook_url = COALESCE(?, webhook_url),
        webhook_secret = COALESCE(?, webhook_secret),
        updated_at = datetime('now')
    WHERE id = ?
  `).run(
    name || null,
    nameAr || null,
    defaultTimezone || null,
    replacementTelegramToken,
    telegramChatId !== undefined ? telegramChatId : null,
    replacementWebhookSecret,
    req.user!.organizationId
  );

  // Synchronize webhook endpoint table for the outbox worker
  if (webhookUrl !== undefined) {
    const trimmedUrl = typeof webhookUrl === 'string' ? webhookUrl.trim() : '';
    if (trimmedUrl) {
      const existingEp = db.prepare('SELECT id FROM webhook_endpoints WHERE organization_id = ? LIMIT 1').get(req.user!.organizationId) as any;
      if (existingEp) {
        db.prepare('UPDATE webhook_endpoints SET url = ?, signing_secret = COALESCE(?, signing_secret), is_active = 1, updated_at = datetime("now") WHERE id = ?')
          .run(trimmedUrl, replacementWebhookSecret, existingEp.id);
      } else {
        db.prepare('INSERT INTO webhook_endpoints (id, organization_id, url, signing_secret, subscribed_events, is_active) VALUES (?, ?, ?, ?, ?, 1)')
          .run(`ep_${crypto.randomBytes(8).toString('hex')}`, req.user!.organizationId, trimmedUrl, replacementWebhookSecret || 'sec_live_default', 'payment.confirmed,checkout.session.completed');
      }
    }
  }

  AuditService.record({
    organizationId: req.user!.organizationId,
    actorIdentity: req.user!.email,
    action: 'WORKSPACE_SETTINGS_UPDATED',
    resourceType: 'organization',
    resourceId: req.user!.organizationId,
    originIp: req.ip,
  });

  res.json({ message: 'Workspace settings saved successfully' });
});

// ==========================================
// 3. RECEIVING SOURCES & SAFE SWITCHING (Section 4A)
// ==========================================

apiRouter.get('/sources', requireAuth, (req: AuthenticatedUserRequest, res: Response) => {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT s.id, s.provider, s.friendly_name as name, s.wallet_number as walletNumber,
           s.daily_turnover_limit_minor / 100.0 as dailyLimit, s.monthly_turnover_limit_minor / 100.0 as monthlyLimit,
           s.is_paused_for_new_instructions as isPaused,
           a.address_value as primaryAddress, a.address_type as addressType, a.is_default_for_invoices as isDefault,
           COALESCE((SELECT SUM(amount_minor) FROM transactions WHERE payment_source_id = s.id AND status = 'confirmed'), 0) / 100.0 as volume,
           COALESCE((SELECT COUNT(*) FROM transactions WHERE payment_source_id = s.id AND status = 'confirmed'), 0) as txnsCount
    FROM payment_sources s
    LEFT JOIN payment_addresses a ON (s.id = a.payment_source_id AND a.is_default_for_invoices = 1)
    WHERE s.organization_id = ? AND s.retired_at IS NULL
    ORDER BY s.created_at ASC
  `).all(req.user!.organizationId) as any[];

  const totalVol = rows.reduce((acc, r) => acc + (r.volume || 0), 0) || 1;

  const result = rows.map((r) => {
    const usage = getCurrentSourceUsage(db, r.id);
    return {
      ...r,
      sharePercentage: Math.round(((r.volume || 0) / totalVol) * 100),
      dailyIntake: usage.daily.intake,
      monthlyIntake: usage.monthly.intake,
      dailyPercentage: usage.daily.percentage,
      monthlyPercentage: usage.monthly.percentage,
      usagePeriodKeys: usage.periodKeys,
      isPaused: Boolean(r.isPaused),
      isDefault: Boolean(r.isDefault),
      color: r.provider === 'vodafone_cash' ? '#1e3a8a' : r.provider === 'instapay' ? '#00285e' : r.provider === 'orange_cash' ? '#565e74' : '#00236f',
    };
  });

  res.json(result);
});

// Add New Payment Source (Wallet, Bank Account, InstaPay)
apiRouter.post('/sources', requireAuth, requireRole(['owner', 'admin']), (req: AuthenticatedUserRequest, res: Response) => {
  const { provider, friendlyName, walletNumber, dailyLimit, monthlyLimit, addressType, setAsDefault, balanceAccountId: requestedBalanceAccountId } = req.body;
  if (!provider || !friendlyName || !walletNumber) {
    res.status(400).json({ error: 'MISSING_SOURCE_FIELDS', message: 'Provider, friendly name, and wallet number required' });
    return;
  }

  const normalizedProvider = String(provider);
  if (!['vodafone_cash', 'instapay', 'orange_cash', 'etisalat_cash'].includes(normalizedProvider)) {
    res.status(400).json({ error: 'INVALID_PROVIDER', message: 'Choose a supported payment provider.' });
    return;
  }

  const normalizedFriendlyName = String(friendlyName).trim();
  const normalizedAddress = String(walletNumber)
    .trim()
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[\s-]/g, '');
  const suppliedDailyLimit = dailyLimit !== undefined && dailyLimit !== null && dailyLimit !== '';
  const suppliedMonthlyLimit = monthlyLimit !== undefined && monthlyLimit !== null && monthlyLimit !== '';
  if (!normalizedFriendlyName || !normalizedAddress || normalizedFriendlyName.length > 150 || normalizedAddress.length > 150) {
    res.status(400).json({ error: 'INVALID_SOURCE_DETAILS', message: 'Source name and receiving address must be valid.' });
    return;
  }
  const isEgyptMobile = /^01[0125]\d{8}$/.test(normalizedAddress);
  const isInstapayHandle = /^[A-Za-z0-9._-]{3,64}@[A-Za-z]{2,32}$/.test(normalizedAddress);
  if (normalizedProvider === 'instapay' ? !(isEgyptMobile || isInstapayHandle) : !isEgyptMobile) {
    res.status(400).json({
      error: 'INVALID_WALLET_ADDRESS',
      message: normalizedProvider === 'instapay'
        ? 'Enter a valid InstaPay address (name@bank) or an 11-digit Egyptian mobile number.'
        : 'Enter a valid 11-digit Egyptian mobile number (e.g. 01012345678).',
    });
    return;
  }
  if (normalizedProvider === 'instapay' && (!suppliedDailyLimit || !suppliedMonthlyLimit)) {
    res.status(422).json({
      error: 'COMMERCIAL_LIMITS_REQUIRED',
      message: 'Enter the bank-approved daily and monthly receiving limits for this InstaPay source.',
    });
    return;
  }

  const db = getDatabase();
  const sourceId = `src_${Date.now()}`;

  // Wallet limits must be verified against the merchant's provider/account. These defaults
  // are used only for mobile wallets; InstaPay requires the merchant's own approved values.
  const defaultDailyMinor = 6_000_000; // 60,000.00 EGP
  const defaultMonthlyMinor = 20_000_000; // 200,000.00 EGP
  let resolvedDailyMinor: number;
  let resolvedMonthlyMinor: number;
  try {
    resolvedDailyMinor = suppliedDailyLimit ? toMinor(typeof dailyLimit === 'string' ? dailyLimit : Number(dailyLimit), { allowZero: false }) : defaultDailyMinor;
    resolvedMonthlyMinor = suppliedMonthlyLimit ? toMinor(typeof monthlyLimit === 'string' ? monthlyLimit : Number(monthlyLimit), { allowZero: false }) : defaultMonthlyMinor;
  } catch {
    res.status(400).json({ error: 'INVALID_SOURCE_LIMITS', message: 'Daily and monthly limits must be positive EGP amounts with at most two decimals.' });
    return;
  }
  const resolvedDailyLimit = fromMinor(resolvedDailyMinor);
  const resolvedMonthlyLimit = fromMinor(resolvedMonthlyMinor);

  const normalizedAddressType = addressType || (normalizedProvider === 'instapay' ? 'instapay_vpa' : 'msisdn');
  if (!['msisdn', 'instapay_vpa', 'iban'].includes(normalizedAddressType)) {
    res.status(400).json({ error: 'INVALID_ADDRESS_TYPE', message: 'Choose a supported receiving address type.' });
    return;
  }

  db.exec('BEGIN IMMEDIATE;');
  try {
    let balanceAccountId: string;
    if (requestedBalanceAccountId) {
      const existingAccount = db.prepare(`
        SELECT id FROM balance_accounts WHERE id = ? AND organization_id = ?
      `).get(String(requestedBalanceAccountId), req.user!.organizationId) as any;
      if (!existingAccount) {
        db.exec('ROLLBACK;');
        res.status(422).json({ error: 'INVALID_BALANCE_ACCOUNT', message: 'Select a balance account owned by this workspace.' });
        return;
      }
      balanceAccountId = existingAccount.id;
    } else {
      // A new receiving wallet gets an independent ledger by default. Add further
      // aliases to the existing source when they share the same bank balance.
      balanceAccountId = `acc_${sourceId}`;
      db.prepare(`
        INSERT INTO balance_accounts (id, organization_id, account_name, currency, current_balance_minor)
        VALUES (?, ?, ?, 'EGP', 0)
      `).run(balanceAccountId, req.user!.organizationId, `${normalizedFriendlyName} (EGP)`);
    }

    db.prepare(`
      INSERT INTO payment_sources (id, organization_id, balance_account_id, provider, friendly_name, wallet_number, daily_turnover_limit_minor, monthly_turnover_limit_minor)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(sourceId, req.user!.organizationId, balanceAccountId, normalizedProvider, normalizedFriendlyName, normalizedAddress, resolvedDailyMinor, resolvedMonthlyMinor);

    const addrId = `addr_${Date.now()}`;
    const existingDefault = db.prepare(`
      SELECT id FROM payment_addresses
      WHERE is_default_for_invoices = 1
        AND payment_source_id IN (SELECT id FROM payment_sources WHERE organization_id = ?)
      LIMIT 1
    `).get(req.user!.organizationId);
    const setDefaultRequested = setAsDefault === true || setAsDefault === 1 || setAsDefault === 'true';
    const isDef = setDefaultRequested || !existingDefault ? 1 : 0;

    if (isDef) {
      // Clear other defaults in organization
      db.prepare(`
        UPDATE payment_addresses SET is_default_for_invoices = 0
        WHERE payment_source_id IN (SELECT id FROM payment_sources WHERE organization_id = ?)
      `).run(req.user!.organizationId);
    }

    db.prepare(`
      INSERT INTO payment_addresses (id, payment_source_id, address_type, address_value, is_default_for_invoices)
      VALUES (?, ?, ?, ?, ?)
    `).run(addrId, sourceId, normalizedAddressType, normalizedAddress, isDef);

    AuditService.record({
      organizationId: req.user!.organizationId,
      actorIdentity: req.user!.email,
      action: 'PAYMENT_SOURCE_ADDED',
      resourceType: 'payment_source',
      resourceId: sourceId,
      originIp: req.ip,
      details: { provider: normalizedProvider, sourceName: normalizedFriendlyName, paymentSourceId: sourceId },
    });

    db.exec('COMMIT;');
    res.status(201).json({
      id: sourceId,
      balanceAccountId,
      friendlyName: normalizedFriendlyName,
      walletNumber: normalizedAddress,
      provider: normalizedProvider,
      dailyLimit: resolvedDailyLimit,
      monthlyLimit: resolvedMonthlyLimit,
      isDefault: Boolean(isDef),
    });
  } catch (err: any) {
    db.exec('ROLLBACK;');
    res.status(500).json({ error: 'CREATE_SOURCE_FAILED', message: 'Unable to create the receiving source at this time.' });
  }
});

apiRouter.get('/sources/:id/addresses', requireAuth, (req: AuthenticatedUserRequest, res: Response) => {
  const db = getDatabase();
  const source = db.prepare(`
    SELECT id FROM payment_sources WHERE id = ? AND organization_id = ?
  `).get(req.params.id, req.user!.organizationId) as any;
  if (!source) {
    res.status(404).json({ error: 'SOURCE_NOT_FOUND', message: 'Receiving source was not found.' });
    return;
  }
  const addresses = db.prepare(`
    SELECT id, address_type as addressType, address_value as addressValue,
           is_default_for_invoices as isDefault, activated_at as activatedAt, retired_at as retiredAt
    FROM payment_addresses
    WHERE payment_source_id = ?
    ORDER BY is_default_for_invoices DESC, activated_at ASC
  `).all(source.id).map((address: any) => ({ ...address, isDefault: Boolean(address.isDefault) }));
  res.json(addresses);
});

// Add another receiving alias to an existing source. This is the safe path for
// multiple InstaPay aliases that settle into the same underlying account.
apiRouter.post('/sources/:id/addresses', requireAuth, requireRole(['owner', 'admin']), (req: AuthenticatedUserRequest, res: Response) => {
  const { addressValue, addressType, setAsDefault } = req.body;
  const normalizedAddress = typeof addressValue === 'string' ? addressValue.trim() : '';
  const normalizedAddressType = typeof addressType === 'string' ? addressType : '';
  if (!normalizedAddress || normalizedAddress.length > 150 || !['msisdn', 'instapay_vpa', 'iban'].includes(normalizedAddressType)) {
    res.status(400).json({ error: 'INVALID_RECEIVING_ADDRESS', message: 'Enter a valid receiving address and type.' });
    return;
  }

  const db = getDatabase();
  const source = db.prepare(`
    SELECT id FROM payment_sources
    WHERE id = ? AND organization_id = ? AND retired_at IS NULL
  `).get(req.params.id, req.user!.organizationId) as any;
  if (!source) {
    res.status(404).json({ error: 'SOURCE_NOT_FOUND', message: 'Receiving source was not found.' });
    return;
  }

  const addressId = `addr_${Date.now()}_${Math.floor(Math.random() * 1_000)}`;
  const setDefaultRequested = setAsDefault === true || setAsDefault === 1 || setAsDefault === 'true';
  db.exec('BEGIN IMMEDIATE;');
  try {
    if (setDefaultRequested) {
      db.prepare(`
        UPDATE payment_addresses SET is_default_for_invoices = 0
        WHERE payment_source_id IN (SELECT id FROM payment_sources WHERE organization_id = ?)
      `).run(req.user!.organizationId);
    }
    db.prepare(`
      INSERT INTO payment_addresses (id, payment_source_id, address_type, address_value, is_default_for_invoices)
      VALUES (?, ?, ?, ?, ?)
    `).run(addressId, source.id, normalizedAddressType, normalizedAddress, setDefaultRequested ? 1 : 0);
    AuditService.record({
      organizationId: req.user!.organizationId,
      actorIdentity: req.user!.email,
      action: 'PAYMENT_ADDRESS_ADDED',
      resourceType: 'payment_address',
      resourceId: addressId,
      originIp: req.ip,
      details: { paymentSourceId: source.id, addressType: normalizedAddressType },
    });
    db.exec('COMMIT;');
    res.status(201).json({ id: addressId, paymentSourceId: source.id, addressType: normalizedAddressType, isDefault: setDefaultRequested });
  } catch (error: any) {
    db.exec('ROLLBACK;');
    const isDuplicate = String(error?.message || '').includes('UNIQUE constraint failed');
    res.status(isDuplicate ? 409 : 500).json({
      error: isDuplicate ? 'RECEIVING_ADDRESS_ALREADY_EXISTS' : 'CREATE_RECEIVING_ADDRESS_FAILED',
      message: isDuplicate ? 'This address is already registered for the source.' : 'Unable to add the receiving address at this time.',
    });
  }
});

// Retiring a source stops it from new payment instructions while capture devices
// stay bound so delayed payments can still be reconciled and audited.
apiRouter.post('/sources/:id/retire', requireAuth, requireRole(['owner', 'admin']), (req: AuthenticatedUserRequest, res: Response) => {
  const db = getDatabase();
  const source = db.prepare(`
    SELECT s.id,
           EXISTS(SELECT 1 FROM payment_addresses a WHERE a.payment_source_id = s.id AND a.is_default_for_invoices = 1) AS is_default
    FROM payment_sources s
    WHERE s.id = ? AND s.organization_id = ? AND s.retired_at IS NULL
  `).get(req.params.id, req.user!.organizationId) as any;
  if (!source) {
    res.status(404).json({ error: 'SOURCE_NOT_FOUND', message: 'Receiving source was not found.' });
    return;
  }
  if (Boolean(source.is_default)) {
    res.status(409).json({
      error: 'SET_REPLACEMENT_SOURCE_FIRST',
      message: 'Choose another active source as the default before retiring this one.',
    });
    return;
  }

  db.prepare(`
    UPDATE payment_sources
    SET retired_at = datetime('now'), is_paused_for_new_instructions = 1, updated_at = datetime('now')
    WHERE id = ? AND organization_id = ?
  `).run(source.id, req.user!.organizationId);
  AuditService.record({
    organizationId: req.user!.organizationId,
    actorIdentity: req.user!.email,
    action: 'PAYMENT_SOURCE_RETIRED',
    resourceType: 'payment_source',
    resourceId: source.id,
    originIp: req.ip,
  });
  res.json({ id: source.id, retired: true, captureRemainsAvailableForDelayedPayments: true });
});

// Safe Switch: Set as Default for Invoices (Preserves historical capture on others)
apiRouter.post('/sources/:id/set-default', requireAuth, requireRole(['owner', 'admin']), (req: AuthenticatedUserRequest, res: Response) => {
  const db = getDatabase();
  const { id } = req.params;

  db.exec('BEGIN IMMEDIATE;');
  try {
    const targetSource = db.prepare(`
      SELECT id FROM payment_sources
      WHERE id = ? AND organization_id = ? AND retired_at IS NULL
    `).get(id, req.user!.organizationId);
    if (!targetSource) {
      db.exec('ROLLBACK;');
      res.status(404).json({ error: 'SOURCE_NOT_FOUND' });
      return;
    }

    // 1. Reset current defaults
    db.prepare(`
      UPDATE payment_addresses SET is_default_for_invoices = 0
      WHERE payment_source_id IN (SELECT id FROM payment_sources WHERE organization_id = ?)
    `).run(req.user!.organizationId);

    // 2. Set this source's address as default
    db.prepare(`
      UPDATE payment_addresses SET is_default_for_invoices = 1
      WHERE payment_source_id = ?
        AND payment_source_id IN (SELECT id FROM payment_sources WHERE organization_id = ?)
    `).run(id, req.user!.organizationId);

    AuditService.record({
      organizationId: req.user!.organizationId,
      actorIdentity: req.user!.email,
      action: 'DEFAULT_PAYMENT_SOURCE_SWITCHED',
      resourceType: 'payment_source',
      resourceId: id,
      originIp: req.ip,
    });

    db.exec('COMMIT;');
    res.json({ message: 'Default payment receiving source safely updated' });
  } catch (err: any) {
    db.exec('ROLLBACK;');
    res.status(500).json({ error: 'SWITCH_FAILED', message: 'Unable to switch the default receiving source at this time.' });
  }
});

// Toggle Pause for New Invoices (Section 4A)
apiRouter.post('/sources/:id/toggle-pause', requireAuth, requireRole(['owner', 'admin', 'manager']), (req: AuthenticatedUserRequest, res: Response) => {
  const db = getDatabase();
  const current = db.prepare('SELECT is_paused_for_new_instructions FROM payment_sources WHERE id = ? AND organization_id = ?').get(req.params.id, req.user!.organizationId) as any;
  if (!current) {
    res.status(404).json({ error: 'SOURCE_NOT_FOUND' });
    return;
  }
  const nextState = current.is_paused_for_new_instructions ? 0 : 1;
  db.prepare('UPDATE payment_sources SET is_paused_for_new_instructions = ? WHERE id = ? AND organization_id = ?').run(nextState, req.params.id, req.user!.organizationId);

  AuditService.record({
    organizationId: req.user!.organizationId,
    actorIdentity: req.user!.email,
    action: nextState ? 'PAYMENT_SOURCE_PAUSED' : 'PAYMENT_SOURCE_RESUMED',
    resourceType: 'payment_source',
    resourceId: req.params.id,
    originIp: req.ip,
  });

  res.json({ id: req.params.id, isPaused: Boolean(nextState) });
});

// Backward compatibility alias for /api/v1/rails
apiRouter.get('/rails', requireAuth, (req: AuthenticatedUserRequest, res: Response) => {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT s.id, s.provider, s.friendly_name as name, s.wallet_number as walletNumber,
           s.daily_turnover_limit_minor / 100.0 as dailyLimit, s.monthly_turnover_limit_minor / 100.0 as monthlyLimit,
           s.is_paused_for_new_instructions as isPaused,
           COALESCE((SELECT SUM(amount_minor) FROM transactions WHERE payment_source_id = s.id AND status = 'confirmed'), 0) / 100.0 as volume,
           COALESCE((SELECT COUNT(*) FROM transactions WHERE payment_source_id = s.id AND status = 'confirmed'), 0) as txnsCount
    FROM payment_sources s
    WHERE s.organization_id = ? AND s.retired_at IS NULL
  `).all(req.user!.organizationId) as any[];

  const totalVol = rows.reduce((acc, r) => acc + (r.volume || 0), 0) || 1;

  const result = rows.map((r) => {
    const usage = getCurrentSourceUsage(db, r.id);
    return {
      ...r,
      sharePercentage: Math.round(((r.volume || 0) / totalVol) * 100),
      dailyIntake: usage.daily.intake,
      monthlyIntake: usage.monthly.intake,
      dailyPercentage: usage.daily.percentage,
      monthlyPercentage: usage.monthly.percentage,
      usagePeriodKeys: usage.periodKeys,
      isPaused: Boolean(r.isPaused),
      color: r.provider === 'vodafone_cash' ? '#1e3a8a' : r.provider === 'instapay' ? '#00285e' : r.provider === 'orange_cash' ? '#565e74' : '#00236f',
    };
  });

  res.json(result);
});

apiRouter.post('/rails/:id/toggle-pause', requireAuth, requireRole(['owner', 'admin', 'manager']), (req: AuthenticatedUserRequest, res: Response) => {
  const db = getDatabase();
  const current = db.prepare('SELECT is_paused_for_new_instructions FROM payment_sources WHERE id = ? AND organization_id = ?').get(req.params.id, req.user!.organizationId) as any;
  if (!current) {
    res.status(404).json({ error: 'NOT_FOUND' });
    return;
  }
  const nextState = current.is_paused_for_new_instructions ? 0 : 1;
  db.prepare('UPDATE payment_sources SET is_paused_for_new_instructions = ? WHERE id = ? AND organization_id = ?').run(nextState, req.params.id, req.user!.organizationId);
  res.json({ id: req.params.id, isPaused: Boolean(nextState) });
});

// ==========================================
// 4. DEVICE REGISTRATION, PAIRING & INGESTION (Section 4B)
// ==========================================

apiRouter.get('/devices', requireAuth, (req: AuthenticatedUserRequest, res: Response) => {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT d.id, d.payment_source_id, d.device_number, d.friendly_name, d.location, d.adapter_type, d.status,
           d.battery_level, d.last_seen_at, d.agent_version, d.config_version,
           d.verified_at, d.notification_listener_granted, d.battery_optimization_exempt,
           (SELECT COUNT(*) FROM transactions t WHERE t.organization_id = d.organization_id) as txns_count
    FROM devices d
    WHERE d.organization_id = ?
    ORDER BY d.created_at ASC
  `).all(req.user!.organizationId);
  res.json(rows);
});

// Device Telemetry Heartbeat & Permissions Verification (signed by the paired device)
apiRouter.post('/devices/:id/telemetry', verifyDeviceSignature, (req: AuthenticatedDeviceRequest, res: Response) => {
  const { id } = req.params;
  const {
    battery_level,
    notification_listener_granted,
    battery_optimization_exempt,
    agent_version,
  } = req.body;

  const deviceCtx = req.deviceContext!;
  if (deviceCtx.deviceId !== id) {
    res.status(403).json({ error: 'DEVICE_ID_MISMATCH', message: 'A device may update only its own telemetry.' });
    return;
  }

  const db = getDatabase();

  const listenerGranted = notification_listener_granted === true || notification_listener_granted === 1 ? 1 : 0;
  const batteryExempt = battery_optimization_exempt === true || battery_optimization_exempt === 1 ? 1 : 0;
  const battery = typeof battery_level === 'number' ? battery_level : 100;

  if (!Number.isFinite(battery) || battery < 0 || battery > 100) {
    res.status(400).json({ error: 'INVALID_BATTERY_LEVEL', message: 'Battery level must be between 0 and 100.' });
    return;
  }

  // Persist the signed nonce for telemetry too, so a captured heartbeat cannot
  // be replayed to overwrite the latest device state.
  const telemetryNonce = req.header('X-Nonce')!;
  try {
    db.prepare(`
      INSERT INTO raw_events (id, organization_id, device_id, adapter_type, nonce, client_timestamp, raw_payload, processing_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'telemetry')
    `).run(
      `raw_telemetry_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      deviceCtx.organizationId,
      deviceCtx.deviceId,
      deviceCtx.adapterType,
      telemetryNonce,
      new Date().toISOString(),
      typeof (req as any).rawBody === 'string' ? (req as any).rawBody : JSON.stringify(req.body || {})
    );
  } catch (err: any) {
    if (String(err?.message || '').includes('UNIQUE constraint failed')) {
      res.status(409).json({ error: 'REPLAYED_NONCE', message: 'This signed telemetry event was already received.' });
      return;
    }
    res.status(500).json({ error: 'TELEMETRY_PERSIST_FAILED', message: 'Unable to record signed telemetry.' });
    return;
  }

  db.prepare(`
    UPDATE devices
    SET status = 'online',
        battery_level = ?,
        notification_listener_granted = ?,
        battery_optimization_exempt = ?,
        verified_at = datetime('now'),
        last_seen_at = datetime('now'),
        agent_version = COALESCE(?, agent_version)
    WHERE id = ? AND organization_id = ?
  `).run(battery, listenerGranted, batteryExempt, agent_version || null, id, deviceCtx.organizationId);

  AuditService.record({
    organizationId: deviceCtx.organizationId,
    actorIdentity: `Device:${id}`,
    action: 'DEVICE_TELEMETRY_AND_PERMISSIONS_VERIFIED',
    resourceType: 'device',
    resourceId: id,
    originIp: req.ip,
    details: { listenerGranted, batteryExempt, battery },
  });

  res.json({
    status: 'telemetry_acknowledged',
    device_id: id,
    verified: Boolean(listenerGranted && batteryExempt),
    verified_at: new Date().toISOString(),
  });
});

// Register New Device & Generate 15-Minute One-Time Pairing Token
apiRouter.post('/devices', requireAuth, requireRole(['owner', 'admin']), (req: AuthenticatedUserRequest, res: Response) => {
  const { deviceIdentifier, friendlyName, location, adapterType, paymentSourceId } = req.body;
  if (!deviceIdentifier || !friendlyName || !paymentSourceId) {
    res.status(400).json({ error: 'MISSING_FIELDS', message: 'Device identifier, friendly name, and receiving source are required' });
    return;
  }

  const db = getDatabase();
  const deviceId = `dev_${Date.now()}`;
  const pairingCode = 'SARRAF-' + crypto.randomBytes(3).toString('hex').toUpperCase();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  db.exec('BEGIN IMMEDIATE;');
  try {
    const source = db.prepare(`
      SELECT id FROM payment_sources
      WHERE id = ? AND organization_id = ? AND retired_at IS NULL
    `).get(paymentSourceId, req.user!.organizationId) as any;
    if (!source) {
      db.exec('ROLLBACK;');
      res.status(422).json({ error: 'INVALID_PAYMENT_SOURCE', message: 'Select an active receiving source owned by this workspace.' });
      return;
    }

    const limitCheck = SubscriptionService.checkDeviceLimit(req.user!.organizationId);
    if (!limitCheck.allowed) {
      db.exec('ROLLBACK;');
      const isExpired = limitCheck.subscriptionStatus === 'trial_expired' || limitCheck.subscriptionStatus === 'expired';
      res.status(403).json({
        error: isExpired ? 'TRIAL_EXPIRED' : 'PLAN_DEVICE_LIMIT_EXCEEDED',
        message: isExpired
          ? 'انتهت فترة التجربة المجانية لمساحة العمل. يرجى الاشتراك في إحدى الباقات للاستمرار في ربط هواتف الالتقاط.'
          : `لقد وصلت إلى الحد الأقصى للأجهزة المسموح بها في باقتك (${limitCheck.maxLimit} أجهزة). يرجى الترقية لإضافة هواتف إضافية.`,
        currentCount: limitCheck.currentCount,
        maxLimit: limitCheck.maxLimit,
        subscriptionStatus: limitCheck.subscriptionStatus,
      });
      return;
    }

    db.prepare(`
      INSERT INTO devices (id, organization_id, payment_source_id, device_number, friendly_name, location, adapter_type, status, battery_level, agent_version)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'offline', 100, 'unpaired')
    `).run(deviceId, req.user!.organizationId, paymentSourceId, deviceIdentifier.trim(), friendlyName.trim(), location || 'Mobile Terminal', adapterType || 'macrodroid');

    // Create temporary pairing token
    db.prepare(`
      INSERT INTO pairing_tokens (token, organization_id, device_identifier, allowed_source_id, expires_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(hashOpaqueToken(pairingCode), req.user!.organizationId, deviceId, paymentSourceId, expiresAt);

    AuditService.record({
      organizationId: req.user!.organizationId,
      actorIdentity: req.user!.email,
      action: 'DEVICE_REGISTERED_PAIRING_ISSUED',
      resourceType: 'device',
      resourceId: deviceId,
      originIp: req.ip,
      details: { expiresAt, paymentSourceId },
    });

    db.exec('COMMIT;');
    res.status(201).json({
      deviceId,
      pairingCode,
      expiresAt,
      setupInstructions: {
        androidMacroDroid: 'Open MacroDroid -> Import Sarraf Ingestion Profile -> Enter Pairing Code',
        iosShortcuts: 'Open Shortcuts -> Add Sarraf Webhook Action -> Enter Scoped Ingestion Token',
        huaweiEMUI: 'Configure Battery Optimization -> Uncheck PowerGenie -> Enter Pairing Code',
      },
    });
  } catch (err: any) {
    db.exec('ROLLBACK;');
    res.status(500).json({ error: 'DEVICE_REGISTRATION_FAILED', message: 'Unable to register the device at this time.' });
  }
});

// Device Pairing Handshake (Executed by mobile adapter)
apiRouter.post('/devices/pair', (req: Request, res: Response) => {
  const { pairing_token } = req.body;
  if (!pairing_token) {
    res.status(400).json({ error: 'PAIRING_TOKEN_REQUIRED' });
    return;
  }

  const db = getDatabase();
  db.exec('BEGIN IMMEDIATE;');
  try {
    const tokenHash = hashOpaqueToken(pairing_token);
    const tokenRow = db.prepare(`
      SELECT organization_id, device_identifier, allowed_source_id, expires_at, used_at
      FROM pairing_tokens WHERE token = ?
    `).get(tokenHash) as any;

    if (!tokenRow || tokenRow.used_at || new Date() > new Date(tokenRow.expires_at) || !tokenRow.allowed_source_id) {
      db.exec('ROLLBACK;');
      res.status(400).json({ error: 'INVALID_OR_EXPIRED_PAIRING_TOKEN', message: 'Token has expired or has already been used. Generate a new pairing code in dashboard.' });
      return;
    }

    const device = db.prepare(`
      SELECT id, organization_id, payment_source_id, status
      FROM devices WHERE id = ? AND organization_id = ?
    `).get(tokenRow.device_identifier, tokenRow.organization_id) as any;
    const source = db.prepare(`
      SELECT id FROM payment_sources
      WHERE id = ? AND organization_id = ? AND retired_at IS NULL
    `).get(tokenRow.allowed_source_id, tokenRow.organization_id) as any;

    if (!device || device.status === 'revoked' || device.payment_source_id !== tokenRow.allowed_source_id || !source) {
      db.exec('ROLLBACK;');
      res.status(409).json({ error: 'PAIRING_BINDING_INVALID', message: 'The device or its bound receiving source is no longer eligible for pairing.' });
      return;
    }

    const consumed = db.prepare(`
      UPDATE pairing_tokens SET used_at = datetime('now')
      WHERE token = ? AND used_at IS NULL
    `).run(tokenHash);
    if (consumed.changes !== 1) {
      db.exec('ROLLBACK;');
      res.status(409).json({ error: 'PAIRING_TOKEN_ALREADY_USED', message: 'This pairing code was already consumed.' });
      return;
    }

    const hmacSecret = `sec_${crypto.randomBytes(32).toString('hex')}`;

    // Provision or update device credentials
    db.prepare(`
      INSERT INTO device_credentials (device_id, hmac_secret)
      VALUES (?, ?)
      ON CONFLICT(device_id) DO UPDATE SET hmac_secret = excluded.hmac_secret, revoked_at = NULL
    `).run(device.id, hmacSecret);

    db.prepare(`UPDATE devices SET status = 'online', last_seen_at = datetime('now') WHERE id = ?`).run(device.id);

    db.exec('COMMIT;');

    res.status(201).json({
      status: 'paired',
      device_id: device.id,
      hmac_secret: hmacSecret,
      ingestion_endpoint: '/api/v1/devices/ingest',
    });
  } catch (err: any) {
    db.exec('ROLLBACK;');
    res.status(500).json({ error: 'PAIRING_FAILED', message: 'Unable to pair the device at this time.' });
  }
});

// Real Cryptographic Ingestion Endpoint (HMAC-SHA256 Protected!)
apiRouter.post('/devices/ingest', verifyDeviceSignature, (req: AuthenticatedDeviceRequest, res: Response) => {
  const { raw_content, provider_hint, device_captured_at } = req.body;
  const deviceCtx = req.deviceContext!;
  const nonce = req.header('X-Nonce')!;
  const signature = req.header('X-Signature')!;

  if (!raw_content) {
    res.status(400).json({ error: 'MISSING_CONTENT', message: 'raw_content string is required' });
    return;
  }

  const db = getDatabase();
  const rawEventId = `raw_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

  // Device binding is assigned by an owner/admin during registration.  Never
  // infer a source from a sender label, a request field, or SMS text.
  if (!deviceCtx.paymentSourceId) {
    try {
      db.prepare(`
        INSERT INTO raw_events (id, organization_id, device_id, adapter_type, nonce, client_timestamp, raw_payload, processing_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'review_required_source_binding')
      `).run(
        rawEventId,
        deviceCtx.organizationId,
        deviceCtx.deviceId,
        deviceCtx.adapterType,
        nonce,
        device_captured_at || new Date().toISOString(),
        raw_content
      );
    } catch (err: any) {
      if (String(err?.message || '').includes('UNIQUE constraint failed')) {
        res.status(409).json({ error: 'REPLAYED_NONCE', message: 'This signed event was already received.' });
        return;
      }
      res.status(500).json({ error: 'RAW_EVENT_PERSIST_FAILED', message: 'Unable to record the signed event.' });
      return;
    }

    res.status(422).json({
      error: 'DEVICE_SOURCE_UNBOUND',
      message: 'This capture device is not bound to an active receiving source.',
      raw_event_id: rawEventId,
    });
    return;
  }

  // Check subscription / trial entitlement for customer tenants
  if (deviceCtx.organizationId !== 'org_platform_ops') {
    const sub = SubscriptionService.getOrganizationSubscription(deviceCtx.organizationId);
    if (sub.status === 'trial_expired' || sub.status === 'expired') {
      // 1. Acknowledge device cellular connection and presence (separate connectivity from paid entitlement)
      try {
        db.prepare("UPDATE devices SET last_seen_at = datetime('now') WHERE id = ?").run(deviceCtx.deviceId);
      } catch {}

      // 2. Persist the raw event to prevent silent drops
      try {
        db.prepare(`
          INSERT INTO raw_events (id, organization_id, device_id, adapter_type, nonce, client_timestamp, raw_payload, processing_status)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'rejected_trial_expired')
        `).run(
          rawEventId,
          deviceCtx.organizationId,
          deviceCtx.deviceId,
          deviceCtx.adapterType,
          nonce,
          device_captured_at || new Date().toISOString(),
          raw_content
        );
      } catch {}

      // 3. Record in operational audit log with clear Arabic & English diagnostic reason
      AuditService.record({
        organizationId: deviceCtx.organizationId,
        actorIdentity: `Device:${deviceCtx.deviceId}`,
        action: 'INBOUND_EVENT_REJECTED_TRIAL_EXPIRED',
        resourceType: 'raw_event',
        resourceId: rawEventId,
        originIp: req.ip,
        details: {
          reason: 'انتهت التجربة المجانية (TRIAL_EXPIRED)',
          deviceId: deviceCtx.deviceId,
          clientCapturedAt: device_captured_at,
        },
      });

      res.status(403).json({
        error: 'TRIAL_EXPIRED',
        message: 'انتهت فترة التجربة المجانية لمساحة العمل. يرجى الاشتراك في إحدى الباقات لتفعيل معالجة ومطابقة الرسائل الجديدة.',
        subscriptionStatus: sub.status,
        raw_event_id: rawEventId,
      });
      return;
    }
  }

  // 1. Commit Raw Event Immutably Before Processing
  try {
    db.prepare(`
      INSERT INTO raw_events (id, organization_id, device_id, adapter_type, nonce, client_timestamp, raw_payload, processing_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'processing')
    `).run(
      rawEventId,
      deviceCtx.organizationId,
      deviceCtx.deviceId,
      deviceCtx.adapterType,
      nonce,
      device_captured_at || new Date().toISOString(),
      raw_content
    );
  } catch (err: any) {
    if (String(err?.message || '').includes('UNIQUE constraint failed')) {
      res.status(409).json({ error: 'REPLAYED_NONCE', message: 'This signed event was already received.' });
      return;
    }
    res.status(500).json({ error: 'RAW_EVENT_PERSIST_FAILED', message: 'Unable to record the signed event.' });
    return;
  }

  // 2. Parse Incoming Payload with Egyptian Telecom Engine
  const parsed = parseEgyptianPaymentMessage(raw_content, provider_hint);

  // Smart Filter: Filter out non-financial messages (Personal SMS, Promos, OTP codes, Outbound debits)
  if (!parsed.isFinancialTransaction) {
    db.prepare(`UPDATE raw_events SET processing_status = ? WHERE id = ?`).run('filtered_' + parsed.messageCategory, rawEventId);

    res.status(200).json({
      status: 'filtered',
      category: parsed.messageCategory,
      reason: parsed.ignoreReason || 'Non-financial message filtered out automatically',
      raw_event_id: rawEventId,
      message: 'تم استلام الرسالة وتصفيتها تلقائياً (ليست معاملة تحويل مالي واردة).',
    });
    return;
  }

  // 3. Reconcile with Section 12A Algorithm
  const result = ReconciliationService.processInboundTransaction({
    organizationId: deviceCtx.organizationId,
    deviceId: deviceCtx.deviceId,
    paymentSourceId: deviceCtx.paymentSourceId,
    rawEventId,
    adapterType: deviceCtx.adapterType,
    boundPaymentAddress: '',
    parsed,
    financialEventAt: device_captured_at || new Date().toISOString(),
    signature,
  });

  // Reconciliation persists any ledger movement, source usage, alert jobs, and
  // customer webhook job atomically. A signed SMS capture does not supply
  // independent settlement proof, so this device-only route normally returns
  // review_required until a documented operator verification occurs.

  // Return Duplicate Acknowledged if already seen
  if (result.isDuplicate) {
    res.status(200).json({
      status: 'duplicate_acknowledged',
      transaction_id: result.transactionId,
      external_trx_id: result.externalTrxId,
      reconciliation_state: result.reconciliationState,
      message: 'Transaction already committed to immutable ledger.',
    });
    return;
  }

  // Attempt automatic platform subscription match for incoming transfers
  let autoActivatedOrderId: string | undefined;
  let inReviewOrderId: string | undefined;
  if (result.transactionId) {
    try {
      const matchOutcome = SubscriptionService.handleInboundPlatformTransaction({
        id: result.transactionId,
        amountMinor: toMinor(parsed.amount),
        externalTrxId: result.externalTrxId,
        senderPhone: parsed.senderPhone,
        senderName: parsed.senderName,
        organizationId: deviceCtx.organizationId,
        paymentSourceId: deviceCtx.paymentSourceId,
      });
      autoActivatedOrderId = matchOutcome.autoActivatedOrderId;
      inReviewOrderId = matchOutcome.inReviewOrderId;
    } catch (err) {
      console.error('Error matching inbound platform transaction for subscription:', err);
    }

    // Google Sheets Real-Time Sync (if merchant connected a sheet)
    GoogleSheetsService.syncTransaction(deviceCtx.organizationId, {
      id: result.transactionId,
      externalTrxId: result.externalTrxId,
      amount: parsed.amount,
      currency: parsed.currency,
      provider: parsed.provider,
      senderName: parsed.senderName,
      senderPhone: parsed.senderPhone,
      status: result.status,
      balanceAfter: result.balanceAfter,
      financialEventAt: device_captured_at || new Date().toISOString(),
    }).catch((err) => console.warn('Google Sheets sync async error:', err));
  }

  // Return 202 Accepted
  res.status(202).json({
    status: 'accepted',
    raw_event_id: rawEventId,
    transaction_id: result.transactionId,
    external_trx_id: result.externalTrxId,
    reconciliation_status: result.status,
    balance_after: result.balanceAfter,
    review_required: result.status === 'review_required',
    review_reason: result.reviewReason,
    subscription_auto_activated_order_id: autoActivatedOrderId,
    subscription_in_review_order_id: inReviewOrderId,
  });
});

// The old webhook accepted pairing codes and device secrets in URLs/bodies.  It
// is deliberately retired: all adapters must pair once and use /devices/ingest
// with HMAC, timestamp, nonce, and the device-bound source.
apiRouter.post('/devices/webhook-ingest', (_req: Request, res: Response) => {
  res.status(410).json({
    error: 'LEGACY_WEBHOOK_RETIRED',
    message: 'This ingestion path was retired for security. Pair the device again and use the signed /devices/ingest protocol.',
  });
});


apiRouter.post('/devices/:id/revoke', requireAuth, requireRole(['owner', 'admin']), (req: AuthenticatedUserRequest, res: Response) => {
  const db = getDatabase();
  const revoked = db.prepare(`UPDATE devices SET status = 'revoked' WHERE id = ? AND organization_id = ?`).run(req.params.id, req.user!.organizationId);
  if (revoked.changes !== 1) {
    res.status(404).json({ error: 'NOT_FOUND' });
    return;
  }
  db.prepare(`
    UPDATE device_credentials SET revoked_at = datetime('now')
    WHERE device_id = ? AND device_id IN (SELECT id FROM devices WHERE organization_id = ?)
  `).run(req.params.id, req.user!.organizationId);

  AuditService.record({
    organizationId: req.user!.organizationId,
    actorIdentity: req.user!.email,
    action: 'DEVICE_REVOKED',
    resourceType: 'device',
    resourceId: req.params.id,
    originIp: req.ip,
  });

  res.json({ message: 'Device credentials permanently revoked' });
});

apiRouter.post('/devices/:id/toggle', requireAuth, requireRole(['owner', 'admin']), (req: AuthenticatedUserRequest, res: Response) => {
  const db = getDatabase();
  const current = db.prepare('SELECT status FROM devices WHERE id = ? AND organization_id = ?').get(req.params.id, req.user!.organizationId) as any;
  if (!current) {
    res.status(404).json({ error: 'NOT_FOUND' });
    return;
  }
  const nextStatus = current.status === 'online' ? 'offline' : 'online';
  db.prepare(`UPDATE devices SET status = ?, last_seen_at = datetime('now') WHERE id = ? AND organization_id = ?`).run(nextStatus, req.params.id, req.user!.organizationId);
  res.json({ id: req.params.id, status: nextStatus });
});

// ==========================================
// 5. TRANSACTIONS & RECONCILIATION QUEUE
// ==========================================

apiRouter.get('/transactions', requireAuth, (req: AuthenticatedUserRequest, res: Response) => {
  const db = getDatabase();
  const { status, provider, search } = req.query;

  let query = `
    SELECT t.id, t.external_trx_id as trxId, t.amount_minor / 100.0 as amount, t.currency, t.provider,
           t.sender_name as senderName, t.sender_phone as senderPhone, t.status,
           t.reconciliation_state, t.provenance_confidence as confidenceScore,
           t.review_reason as reviewReason, t.stated_balance_after_minor / 100.0 as balanceAfter,
           t.signature, t.financial_event_at as timestamp, r.raw_payload as rawMessage,
           d.device_number as deviceId, d.friendly_name as deviceName
    FROM transactions t
    LEFT JOIN raw_events r ON t.raw_event_id = r.id
    LEFT JOIN devices d ON r.device_id = d.id
    WHERE t.organization_id = ?
  `;
  const params: any[] = [req.user!.organizationId];

  if (status && status !== 'all') {
    query += ' AND t.status = ?';
    params.push(status);
  }
  if (provider && provider !== 'all') {
    query += ' AND t.provider = ?';
    params.push(provider);
  }
  if (search) {
    query += ' AND (t.sender_name LIKE ? OR t.sender_phone LIKE ? OR t.external_trx_id LIKE ?)';
    const term = `%${search}%`;
    params.push(term, term, term);
  }

  query += ' ORDER BY t.financial_event_at DESC LIMIT 100';

  const rows = db.prepare(query).all(...params);
  res.json(rows);
});

// View Raw & Filtered Messages Audit Log
apiRouter.get('/raw-events', requireAuth, requireRole(['owner', 'admin', 'manager']), (req: AuthenticatedUserRequest, res: Response) => {
  const db = getDatabase();
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
  const events = db.prepare(`
    SELECT r.id, r.adapter_type, r.client_timestamp, r.server_received_at, 
           r.raw_payload, r.processing_status, d.friendly_name as device_name,
           d.device_number
    FROM raw_events r
    LEFT JOIN devices d ON r.device_id = d.id
    WHERE r.organization_id = ?
    ORDER BY r.server_received_at DESC
    LIMIT ?
  `).all(req.user!.organizationId, limit);
  res.json(events);
});

// Live database files contain every tenant's data and are never a customer export.
apiRouter.get('/system/download-db', requireAuth, (_req: AuthenticatedUserRequest, res: Response) => {
  res.status(410).json({
    error: 'DATABASE_DOWNLOAD_RETIRED',
    message: 'Live database downloads are disabled. Use a tenant-scoped export or an operator-managed backup procedure.',
  });
});

// Operator Manual Approval of Review Item
apiRouter.post('/transactions/:id/approve', requireAuth, requireRole(['owner', 'admin', 'manager']), (req: AuthenticatedUserRequest, res: Response) => {
  const db = getDatabase();
  const { id } = req.params;
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';

  if (reason.length < 10) {
    res.status(400).json({
      error: 'VERIFICATION_REASON_REQUIRED',
      message: 'Document the independent bank or wallet verification evidence before approving this transaction.',
    });
    return;
  }

  const trx = db.prepare(`
    SELECT id, balance_account_id, payment_source_id, raw_event_id, amount_minor, currency,
           provider, external_trx_id, stated_balance_after_minor, financial_event_at, status
    FROM transactions
    WHERE id = ? AND organization_id = ?
  `).get(id, req.user!.organizationId) as any;
  if (!trx) {
    res.status(404).json({ error: 'TRANSACTION_NOT_FOUND' });
    return;
  }
  if (trx.status !== 'review_required') {
    res.status(409).json({
      error: 'TRANSACTION_NOT_AWAITING_REVIEW',
      message: 'Only a transaction currently awaiting review can be manually approved.',
    });
    return;
  }

  db.exec('BEGIN IMMEDIATE;');
  try {
    const account = db.prepare(`
      SELECT current_balance_minor FROM balance_accounts
      WHERE id = ? AND organization_id = ?
    `).get(trx.balance_account_id, req.user!.organizationId) as any;
    if (!account) {
      throw new Error('BALANCE_ACCOUNT_NOT_FOUND');
    }

    const currentMinor = Number(account.current_balance_minor);
    const amountMinor = Number(trx.amount_minor);
    if (!Number.isSafeInteger(currentMinor) || !Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
      throw new Error('INVALID_TRANSACTION_AMOUNT');
    }
    const nextMinor = currentMinor + amountMinor;
    if (trx.stated_balance_after_minor !== null && trx.stated_balance_after_minor !== undefined) {
      if (Number(trx.stated_balance_after_minor) !== nextMinor) {
        db.exec('ROLLBACK;');
        res.status(409).json({
          error: 'BALANCE_CHAIN_MISMATCH',
          message: 'This transaction is still out of order against the current ledger. Resolve the balance chain or record a new verified checkpoint first.',
        });
        return;
      }
    }

    const approved = db.prepare(`
      UPDATE transactions
      SET status = 'confirmed', reconciliation_state = 'consistent', review_reason = ?
      WHERE id = ? AND organization_id = ? AND status = 'review_required'
    `).run(`Manually verified: ${reason}`, id, req.user!.organizationId);
    if (approved.changes !== 1) {
      throw new Error('TRANSACTION_REVIEW_STATE_CHANGED');
    }

    db.prepare(`
      UPDATE balance_accounts
      SET current_balance_minor = ?, version = version + 1, updated_at = datetime('now')
      WHERE id = ? AND organization_id = ?
    `).run(nextMinor, trx.balance_account_id, req.user!.organizationId);

    if (trx.raw_event_id) {
      db.prepare(`
        UPDATE raw_events SET processing_status = 'confirmed'
        WHERE id = ? AND organization_id = ?
      `).run(trx.raw_event_id, req.user!.organizationId);
    }

    LimitEngine.recordTurnoverInTransaction(
      req.user!.organizationId,
      trx.payment_source_id,
      amountMinor,
      trx.financial_event_at
    );

    ReconciliationService.enqueueConfirmedWebhook(db, req.user!.organizationId, {
      id: trx.id,
      external_trx_id: trx.external_trx_id,
      amount_minor: amountMinor,
      currency: trx.currency,
      provider: trx.provider,
      financial_event_at: trx.financial_event_at,
    });

    try {
      CheckoutService.matchIncomingTransaction(db, req.user!.organizationId, {
        id: trx.id,
        external_trx_id: trx.external_trx_id,
        amount_minor: amountMinor,
        currency: trx.currency,
        provider: trx.provider,
        sender_phone: trx.sender_phone || undefined,
        financial_event_at: trx.financial_event_at,
      });
    } catch (e) {
      console.error('[ManualApproval] Checkout match error:', e);
    }

    AuditService.record({
      organizationId: req.user!.organizationId,
      actorIdentity: req.user!.email,
      action: 'TRANSACTION_MANUALLY_APPROVED',
      resourceType: 'transaction',
      resourceId: id,
      originIp: req.ip,
      details: { amount: fromMinor(amountMinor), amountMinor, reviewer: req.user!.fullName, verificationReason: reason },
    });

    db.exec('COMMIT;');

    // Sync manually approved transaction to Google Sheets
    GoogleSheetsService.syncTransaction(req.user!.organizationId, {
      id: trx.id,
      externalTrxId: trx.external_trx_id,
      amount: fromMinor(amountMinor),
      currency: trx.currency,
      provider: trx.provider,
      senderName: trx.sender_name,
      senderPhone: trx.sender_phone,
      status: 'confirmed',
      balanceAfter: fromMinor(nextMinor),
      financialEventAt: trx.financial_event_at,
    }).catch((err) => console.warn('Google Sheets sync async error:', err));

    res.json({ message: 'Transaction verified, ledger updated, and delivery queued.', balanceAfter: fromMinor(nextMinor) });
  } catch (err: any) {
    try { db.exec('ROLLBACK;'); } catch {}
    res.status(500).json({ error: 'APPROVAL_FAILED', message: 'Unable to approve the transaction at this time.' });
  }
});

// Operator Manual Rejection
apiRouter.post('/transactions/:id/reject', requireAuth, requireRole(['owner', 'admin', 'manager']), (req: AuthenticatedUserRequest, res: Response) => {
  const db = getDatabase();
  const { id } = req.params;
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  if (reason.length < 5) {
    res.status(400).json({ error: 'REJECTION_REASON_REQUIRED', message: 'Document the rejection reason for the audit trail.' });
    return;
  }

  const rejected = db.prepare(`
    UPDATE transactions
    SET status = 'failed', review_reason = ?
    WHERE id = ? AND organization_id = ? AND status IN ('review_required', 'pending_ordering')
  `).run(`Rejected by operator: ${reason}`, id, req.user!.organizationId);
  if (rejected.changes !== 1) {
    res.status(409).json({ error: 'TRANSACTION_NOT_REJECTABLE', message: 'Only a pending review or ordering item can be rejected.' });
    return;
  }

  db.prepare(`
    UPDATE raw_events SET processing_status = 'failed'
    WHERE organization_id = ?
      AND id = (SELECT raw_event_id FROM transactions WHERE id = ? AND organization_id = ?)
  `).run(req.user!.organizationId, id, req.user!.organizationId);

  AuditService.record({
    organizationId: req.user!.organizationId,
    actorIdentity: req.user!.email,
    action: 'TRANSACTION_REJECTED_AS_SUSPICIOUS',
    resourceType: 'transaction',
    resourceId: id,
    originIp: req.ip,
    details: { reason },
  });

  res.json({ message: 'Transaction flagged as rejected/failed' });
});

// ==========================================
// 6. AUDIT LOGS
// ==========================================

apiRouter.get('/audit', requireAuth, requireRole(['owner', 'admin', 'manager']), (req: AuthenticatedUserRequest, res: Response) => {
  const logs = AuditService.getLogs(req.user!.organizationId);
  res.json(logs);
});

// ==========================================
// 7. SUBSCRIPTIONS & BILLING (Section 7)
// ==========================================

// Get All Active Subscription Plans
apiRouter.get('/plans', (req: Request, res: Response) => {
  const plans = SubscriptionService.getPlans();
  const settings = SubscriptionService.getPlatformSettings();
  res.json({
    plans,
    platformInstapayNumber: settings.instapay_number,
    beneficiaryName: settings.beneficiary_name,
  });
});

apiRouter.get('/subscriptions/plans', (req: Request, res: Response) => {
  const plans = SubscriptionService.getPlans();
  const settings = SubscriptionService.getPlatformSettings();
  res.json({
    plans,
    platformInstapayNumber: settings.instapay_number,
    beneficiaryName: settings.beneficiary_name,
  });
});

// Get Current Subscription Details & Device Limit Usage
apiRouter.get('/subscriptions/current', requireAuth, (req: AuthenticatedUserRequest, res: Response) => {
  const sub = SubscriptionService.getOrganizationSubscription(req.user!.organizationId);
  res.json(sub);
});

// Get Organization Subscription Orders History
apiRouter.get('/subscriptions/orders', requireAuth, (req: AuthenticatedUserRequest, res: Response) => {
  const db = getDatabase();
  const orders = db.prepare(`
    SELECT *, price_minor / 100.0 AS price_egp FROM subscription_orders
    WHERE organization_id = ?
    ORDER BY created_at DESC
  `).all(req.user!.organizationId);
  res.json(orders);
});

// Get Specific Subscription Order Details
apiRouter.get('/subscriptions/orders/:id', requireAuth, (req: AuthenticatedUserRequest, res: Response) => {
  const db = getDatabase();
  const order = db.prepare(`
    SELECT *, price_minor / 100.0 AS price_egp FROM subscription_orders
    WHERE id = ? AND organization_id = ?
  `).get(req.params.id, req.user!.organizationId) as any;

  if (!order) {
    res.status(404).json({ error: 'ORDER_NOT_FOUND', message: 'Subscription order not found' });
    return;
  }

  const settings = SubscriptionService.getPlatformSettings();
  res.json({
    order,
    paymentInstructions: {
      instapayNumber: order.instapay_target_number || settings.instapay_number,
      beneficiaryName: settings.beneficiary_name,
      amountEgp: order.price_egp,
      orderNumber: order.order_number,
      note: 'يرجى فتح تطبيق إنستاباي وتحويل المبلغ المطلوب تماماً إلى الرقم الموضح، ثم النقر على زر (حوّلت المبلغ) لتسجيل تفاصيل التحويل للمطابقة.',
    },
  });
});

// Create New Subscription Order
apiRouter.post('/subscriptions/orders', requireAuth, requireRole(['owner', 'admin']), (req: AuthenticatedUserRequest, res: Response) => {
  const { planId } = req.body;
  if (!planId) {
    res.status(400).json({ error: 'MISSING_PLAN_ID', message: 'planId is required' });
    return;
  }

  try {
    const order = SubscriptionService.createOrder({
      organizationId: req.user!.organizationId,
      userId: req.user!.id,
      planId,
    });
    const settings = SubscriptionService.getPlatformSettings();

    res.status(201).json({
      order,
      paymentInstructions: {
        instapayNumber: order.instapay_target_number || settings.instapay_number,
        beneficiaryName: settings.beneficiary_name,
        amountEgp: order.price_egp,
        orderNumber: order.order_number,
        note: 'يرجى فتح تطبيق إنستاباي الخاص بك وإتمام التحويل إلى الرقم الشخصي لصاحب المنصة، ثم تأكيد الإرسال عبر النموذج.',
      },
    });
  } catch (err: any) {
    res.status(400).json({ error: 'CREATE_ORDER_FAILED', message: 'Unable to create the subscription order at this time.' });
  }
});

// Report Payment Execution (Submitting InstaPay transfer reference & sender info)
apiRouter.post('/subscriptions/orders/:id/report-payment', requireAuth, requireRole(['owner', 'admin']), (req: AuthenticatedUserRequest, res: Response) => {
  const { reportedTransferRef, reportedSenderInfo, reportedSenderPhone, reportedTransferTime, reportedNotes } = req.body;
  try {
    const result = SubscriptionService.reportPayment({
      orderId: req.params.id,
      organizationId: req.user!.organizationId,
      reportedTransferRef,
      reportedSenderInfo,
      reportedSenderPhone,
      reportedTransferTime,
      reportedNotes,
    });

    let message = 'تم استلام بيانات التحويل، وجارٍ التحقق والمطابقة مع رسائل الاستقبال في حساب المنصة.';
    if (result.matched) {
      message = '🎉 تم التحقق من استلام المبلغ ومطابقة رقم هاتفك بنجاح، وتم تفعيل باقتك أوتوماتيكياً!';
    } else if (result.order.status === 'in_review' && result.order.review_notes?.includes('أقل من قيمة الباقة')) {
      message = '⚠️ تم رصد التحويل بنجاح، ولكن المبلغ المحول أقل من سعر الباقة المطلوبة. تم تعليق الطلب للمراجعة اليدوية.';
    }

    res.json({
      order: result.order,
      matched: result.matched,
      message,
    });
  } catch (err: any) {
    res.status(400).json({ error: 'REPORT_PAYMENT_FAILED', message: err.message || 'Unable to submit the payment report at this time.' });
  }
});

// View Subscription Receipt
apiRouter.get('/subscriptions/receipts/:id', requireAuth, (req: AuthenticatedUserRequest, res: Response) => {
  const db = getDatabase();
  const receipt = db.prepare(`
    SELECT r.*, r.amount_paid_minor / 100.0 AS amount_paid, p.name_ar as plan_name_ar, p.name_en as plan_name_en, o.name as org_name, o.name_ar as org_name_ar
    FROM subscription_receipts r
    JOIN subscription_plans p ON r.plan_id = p.id
    JOIN organizations o ON r.organization_id = o.id
    WHERE (r.id = ? OR r.order_id = ?) AND r.organization_id = ?
  `).get(req.params.id, req.params.id, req.user!.organizationId);

  if (!receipt) {
    res.status(404).json({ error: 'RECEIPT_NOT_FOUND', message: 'Subscription receipt not found' });
    return;
  }

  res.json(receipt);
});

// Select Active Devices for Downgrade
apiRouter.post('/subscriptions/select-active-devices', requireAuth, requireRole(['owner', 'admin']), (req: AuthenticatedUserRequest, res: Response) => {
  const { activeDeviceIds } = req.body;
  if (!Array.isArray(activeDeviceIds)) {
    res.status(400).json({ error: 'INVALID_DEVICE_IDS', message: 'activeDeviceIds array required' });
    return;
  }

  const db = getDatabase();
  const sub = SubscriptionService.getOrganizationSubscription(req.user!.organizationId);
  if (activeDeviceIds.length > sub.deviceLimit) {
    res.status(400).json({
      error: 'EXCEEDS_PLAN_LIMIT',
      message: `Selected devices (${activeDeviceIds.length}) exceed plan limit (${sub.deviceLimit}).`,
    });
    return;
  }

  db.exec('BEGIN IMMEDIATE;');
  try {
    const allDevices = db.prepare('SELECT id FROM devices WHERE organization_id = ?').all(req.user!.organizationId) as any[];
    for (const d of allDevices) {
      if (activeDeviceIds.includes(d.id)) {
        db.prepare("UPDATE devices SET status = 'online' WHERE id = ?").run(d.id);
      } else {
        db.prepare("UPDATE devices SET status = 'revoked' WHERE id = ?").run(d.id);
      }
    }
    db.exec('COMMIT;');
    res.json({ message: 'Active devices updated successfully.', activeCount: activeDeviceIds.length });
  } catch (err: any) {
    db.exec('ROLLBACK;');
    res.status(500).json({ error: 'UPDATE_FAILED', message: 'Unable to update platform settings at this time.' });
  }
});

// ==========================================
// 8. PLATFORM OWNER DASHBOARD & SETTINGS
// ==========================================

// Platform Owner Overview & Stats
apiRouter.get('/platform/overview', requireAuth, requirePlatformOwner, (req: AuthenticatedUserRequest, res: Response) => {
  const db = getDatabase();

  const revenueRow = db.prepare("SELECT COALESCE(SUM(amount_paid_minor), 0) / 100.0 as totalRevenue FROM subscription_receipts").get() as any;
  const activeSubsRow = db.prepare("SELECT COUNT(*) as count FROM organization_subscriptions WHERE status = 'active'").get() as any;
  const inReviewRow = db.prepare("SELECT COUNT(*) as count FROM subscription_orders WHERE status IN ('payment_reported', 'in_review')").get() as any;
  const totalOrdersRow = db.prepare("SELECT COUNT(*) as count FROM subscription_orders").get() as any;
  const totalOrgsRow = db.prepare("SELECT COUNT(*) as count FROM organizations WHERE id != 'org_platform_ops'").get() as any;

  // Platform operational device status
  const platformDevice = db.prepare("SELECT * FROM devices WHERE organization_id = 'org_platform_ops' LIMIT 1").get() as any;

  res.json({
    totalRevenueEgp: revenueRow?.totalRevenue || 0,
    activeSubscriptions: activeSubsRow?.count || 0,
    pendingReviewOrders: inReviewRow?.count || 0,
    totalOrders: totalOrdersRow?.count || 0,
    totalMerchants: totalOrgsRow?.count || 0,
    platformDevice: platformDevice || null,
  });
});

// Platform Settings (InstaPay Receiving Number & Beneficiary Name)
apiRouter.get('/platform/settings', requireAuth, requirePlatformOwner, (req: AuthenticatedUserRequest, res: Response) => {
  const settings = SubscriptionService.getPlatformSettings();
  res.json(settings);
});

apiRouter.post('/platform/settings', requireAuth, requirePlatformOwner, (req: AuthenticatedUserRequest, res: Response) => {
  const { instapayNumber, beneficiaryName } = req.body;
  if (!instapayNumber) {
    res.status(400).json({ error: 'MISSING_FIELDS', message: 'instapayNumber required' });
    return;
  }

  const db = getDatabase();
  const cleanNum = String(instapayNumber).trim();
  const cleanName = beneficiaryName ? String(beneficiaryName).trim() : '******أحمد ع****** ع****** ر';

  db.prepare(`
    UPDATE platform_settings
    SET instapay_number = ?,
        beneficiary_name = ?,
        updated_at = datetime('now')
    WHERE id = 'current'
  `).run(cleanNum, cleanName);

  db.prepare(`
    UPDATE payment_sources
    SET wallet_number = ?, updated_at = datetime('now')
    WHERE id = 'src_platform_instapay'
  `).run(cleanNum);

  db.prepare(`
    UPDATE payment_addresses
    SET address_value = ?
    WHERE id = 'addr_platform_instapay'
  `).run(cleanNum);

  AuditService.record({
    organizationId: 'org_platform_ops',
    actorIdentity: req.user!.email,
    action: 'PLATFORM_SETTINGS_UPDATED',
    resourceType: 'platform_settings',
    resourceId: 'current',
    details: { instapayNumber: cleanNum, beneficiaryName: cleanName },
  });

  res.json({ message: 'Platform settings updated successfully', instapay_number: cleanNum, beneficiary_name: cleanName });
});

// Platform plan terms are centrally defined product policy.  They are not
// mutable through the dashboard because arbitrary price/device edits would
// create a mismatch with checkout and entitlement enforcement.
apiRouter.get('/platform/plans', requireAuth, requirePlatformOwner, (req: AuthenticatedUserRequest, res: Response) => {
  const db = getDatabase();
  const plans = db.prepare('SELECT *, price_minor / 100.0 AS price_egp FROM subscription_plans ORDER BY price_minor ASC').all();
  res.json(plans);
});

apiRouter.post('/platform/plans/:id', requireAuth, requirePlatformOwner, (req: AuthenticatedUserRequest, res: Response) => {
  res.status(405).json({
    error: 'PLAN_TERMS_LOCKED',
    message: 'Subscription prices, device limits, billing cycles, and included features are centrally controlled product terms.',
  });
});

// All Subscription Orders Across All Tenants
apiRouter.get('/platform/orders', requireAuth, requirePlatformOwner, (req: AuthenticatedUserRequest, res: Response) => {
  const db = getDatabase();
  const { status } = req.query;

  let query = `
    SELECT o.*, o.price_minor / 100.0 AS price_egp, org.name as org_name, org.name_ar as org_name_ar, u.email as user_email, u.full_name as user_full_name
    FROM subscription_orders o
    JOIN organizations org ON o.organization_id = org.id
    JOIN users u ON o.user_id = u.id
  `;
  const params: any[] = [];

  if (status) {
    query += ' WHERE o.status = ?';
    params.push(status);
  }

  query += ' ORDER BY o.created_at DESC';

  const orders = db.prepare(query).all(...params);
  res.json(orders);
});

// Platform Owner Manual Approval of an Order
apiRouter.post('/platform/orders/:id/approve', requireAuth, requirePlatformOwner, (req: AuthenticatedUserRequest, res: Response) => {
  const { reason, transactionId } = req.body;
  if (!reason) {
    res.status(400).json({ error: 'REASON_REQUIRED', message: 'A documented approval reason is mandatory for audit trail' });
    return;
  }

  try {
    SubscriptionService.manualApproveOrder({
      orderId: req.params.id,
      platformOwnerUserId: req.user!.id,
      transactionId: transactionId || undefined,
      reason,
    });

    res.json({ message: 'Order approved and subscription activated successfully' });
  } catch (err: any) {
    res.status(400).json({ error: 'APPROVAL_FAILED', message: 'Unable to approve the subscription order at this time.' });
  }
});

// Platform Owner Rejection of an Order
apiRouter.post('/platform/orders/:id/reject', requireAuth, requirePlatformOwner, (req: AuthenticatedUserRequest, res: Response) => {
  const { reason } = req.body;
  if (!reason) {
    res.status(400).json({ error: 'REASON_REQUIRED', message: 'A rejection reason is mandatory' });
    return;
  }

  try {
    SubscriptionService.rejectOrder({
      orderId: req.params.id,
      platformOwnerUserId: req.user!.id,
      reason,
    });

    res.json({ message: 'Order rejected successfully' });
  } catch (err: any) {
    res.status(400).json({ error: 'REJECTION_FAILED', message: 'Unable to reject the subscription order at this time.' });
  }
});

// All Active & Historical Organization Subscriptions
apiRouter.get('/platform/subscriptions', requireAuth, requirePlatformOwner, (req: AuthenticatedUserRequest, res: Response) => {
  const db = getDatabase();
  const subs = db.prepare(`
    SELECT s.*, org.name as org_name, org.name_ar as org_name_ar, p.name_ar as plan_name_ar, p.name_en as plan_name_en, p.price_minor / 100.0 AS price_egp
    FROM organization_subscriptions s
    JOIN organizations org ON s.organization_id = org.id
    JOIN subscription_plans p ON s.plan_id = p.id
    ORDER BY s.updated_at DESC
  `).all();
  res.json(subs);
});

// Platform Inbound Transactions (Transactions received on Platform Owner's wallet)
apiRouter.get('/platform/transactions', requireAuth, requirePlatformOwner, (req: AuthenticatedUserRequest, res: Response) => {
  const db = getDatabase();
  const txs = db.prepare(`
    SELECT t.*, t.amount_minor / 100.0 AS amount, t.stated_balance_after_minor / 100.0 AS stated_balance_after,
           (SELECT order_number FROM subscription_orders WHERE matched_transaction_id = t.id LIMIT 1) as matched_order_number
    FROM transactions t
    WHERE t.organization_id = 'org_platform_ops'
    ORDER BY t.financial_event_at DESC
  `).all();
  res.json(txs);
});

// ==========================================
// 8. SIMULATOR ENDPOINT (Strictly Disabled for Live Customer Workspaces)
// ==========================================

apiRouter.post('/simulator/ingest', (req: Request, res: Response) => {
  res.status(403).json({
    error: 'SIMULATOR_DISABLED',
    message: 'Simulator endpoints are strictly disabled in production customer environments. Use authenticated device protocol at /api/v1/devices/ingest.',
  });
});

// ==========================================
// 9. GOOGLE SHEETS LIVE INTEGRATION ROUTES
// ==========================================

// Get current Google Sheets integration status
apiRouter.get('/integrations/google-sheets', requireAuth, (req: AuthenticatedUserRequest, res: Response) => {
  const status = GoogleSheetsService.getStatus(req.user!.organizationId);
  res.json(status);
});

// Get Google OAuth 2.0 Authorization URL for 1-click connect
apiRouter.get('/integrations/google-sheets/oauth-url', requireAuth, (req: AuthenticatedUserRequest, res: Response) => {
  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.get('host');
  const redirectUri = `${protocol}://${host}/api/v1/integrations/google/callback`;

  const result = GoogleSheetsService.getOAuthAuthUrl(req.user!.organizationId, redirectUri);
  res.json(result);
});

// Google OAuth 2.0 Redirect Callback
apiRouter.get('/integrations/google/callback', async (req: Request, res: Response) => {
  const { code, state, error } = req.query;
  if (error || !code) {
    res.redirect('/app?tab=analytics&google_error=' + encodeURIComponent((error as string) || 'ACCESS_DENIED'));
    return;
  }

  const organizationId = state as string;
  if (!organizationId) {
    res.status(400).send('Invalid OAuth State');
    return;
  }

  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.get('host');
  const redirectUri = `${protocol}://${host}/api/v1/integrations/google/callback`;

  try {
    await GoogleSheetsService.handleOAuthCallback(code as string, organizationId, redirectUri);
    res.redirect('/app?tab=analytics&google_connected=true');
  } catch (err: any) {
    console.error('Google OAuth callback error:', err);
    res.redirect('/app?tab=analytics&google_error=' + encodeURIComponent(err.message || 'CONNECT_FAILED'));
  }
});

// Connect existing Google Sheet by URL or ID (Direct URL or Webhook)
apiRouter.post('/integrations/google-sheets/connect', requireAuth, requireRole(['owner', 'admin']), (req: AuthenticatedUserRequest, res: Response) => {
  const { url, name } = req.body;
  if (!url || typeof url !== 'string') {
    res.status(400).json({ error: 'URL_REQUIRED', message: 'يرجى إدخال رابط Google Sheet أو رابط الـ Webhook بشكل صحيح' });
    return;
  }

  try {
    const updated = GoogleSheetsService.connectSheet(req.user!.organizationId, url, name);
    AuditService.record({
      organizationId: req.user!.organizationId,
      actorIdentity: req.user!.email,
      action: 'GOOGLE_SHEETS_CONNECTED',
      resourceType: 'integration',
      resourceId: 'google_sheets',
      originIp: req.ip,
      details: { url, name },
    });
    res.json({ message: 'تم ربط Google Sheet بنجاح!', config: updated });
  } catch (err: any) {
    res.status(400).json({ error: 'CONNECT_FAILED', message: err.message || 'تعذر ربط Google Sheet' });
  }
});

// Disconnect Google Sheet
apiRouter.post('/integrations/google-sheets/disconnect', requireAuth, requireRole(['owner', 'admin']), (req: AuthenticatedUserRequest, res: Response) => {
  try {
    GoogleSheetsService.disconnectSheet(req.user!.organizationId);
    AuditService.record({
      organizationId: req.user!.organizationId,
      actorIdentity: req.user!.email,
      action: 'GOOGLE_SHEETS_DISCONNECTED',
      resourceType: 'integration',
      resourceId: 'google_sheets',
      originIp: req.ip,
      details: {},
    });
    res.json({ message: 'تم إلغاء الربط مع Google Sheet بنجاح، ولن يتم إرسال أي معاملات جديدة إليه.' });
  } catch (err: any) {
    res.status(500).json({ error: 'DISCONNECT_FAILED', message: 'تعذر إلغاء الربط' });
  }
});

// Test Connection
apiRouter.post('/integrations/google-sheets/test', requireAuth, async (req: AuthenticatedUserRequest, res: Response) => {
  const { url } = req.body;
  if (!url || typeof url !== 'string') {
    res.status(400).json({ error: 'URL_REQUIRED', message: 'رابط الشيت مطلوب للاختبار' });
    return;
  }

  try {
    const result = await GoogleSheetsService.connectSheet(req.user!.organizationId, url);
    res.json({ success: true, message: 'تم فحص الرابط بنجاح!' });
  } catch (err: any) {
    res.status(400).json({ error: 'TEST_FAILED', message: err.message || 'فشل الاتصال بالشيت' });
  }
});

// Backfill / Sync all historical transactions
apiRouter.post('/integrations/google-sheets/sync-all', requireAuth, requireRole(['owner', 'admin']), async (req: AuthenticatedUserRequest, res: Response) => {
  try {
    const outcome = await GoogleSheetsService.syncAllTransactions(req.user!.organizationId);
    AuditService.record({
      organizationId: req.user!.organizationId,
      actorIdentity: req.user!.email,
      action: 'GOOGLE_SHEETS_BATCH_SYNC',
      resourceType: 'integration',
      resourceId: 'google_sheets',
      originIp: req.ip,
      details: { syncedCount: outcome.syncedCount },
    });
    res.json({ message: `تمت مزامنة ${outcome.syncedCount} معاملة بنجاح إلى Google Sheet!`, syncedCount: outcome.syncedCount });
  } catch (err: any) {
    res.status(400).json({ error: 'SYNC_ALL_FAILED', message: err.message || 'تعذر مزامنة المعاملات إلى الشيت' });
  }
});

// Platform Owner: Configure Google OAuth Client ID & Secret
apiRouter.post('/platform/settings/google-oauth', requireAuth, requirePlatformOwner, (req: AuthenticatedUserRequest, res: Response) => {
  const { clientId, clientSecret } = req.body;
  if (!clientId || !clientSecret) {
    res.status(400).json({ error: 'CREDENTIALS_REQUIRED', message: 'Client ID and Client Secret are required' });
    return;
  }
  GoogleSheetsService.updatePlatformGoogleCredentials(clientId, clientSecret);
  res.json({ message: 'تم حفظ بيانات Google OAuth بنجاح!' });
});

// ==========================================
// 10. MERCHANT API KEYS & OPEN WORKSPACE
// ==========================================

// List API Keys
apiRouter.get('/api-keys', requireAuth, (req: AuthenticatedUserRequest, res: Response) => {
  const keys = ApiKeyService.listKeys(req.user!.organizationId);
  res.json(keys);
});

// Quick Setup: Auto-provision default keys if none exist
apiRouter.get('/api-keys/quick-setup', requireAuth, (req: AuthenticatedUserRequest, res: Response) => {
  const keys = ApiKeyService.getOrCreateDefaultKeys(req.user!.organizationId);
  const db = getDatabase();
  const org = db.prepare('SELECT webhook_url, webhook_secret FROM organizations WHERE id = ?').get(req.user!.organizationId) as any;
  const sourcesCount = (db.prepare('SELECT COUNT(*) as count FROM payment_sources WHERE organization_id = ? AND is_paused_for_new_instructions = 0 AND retired_at IS NULL').get(req.user!.organizationId) as any)?.count || 0;
  const devicesCount = (db.prepare('SELECT COUNT(*) as count FROM devices WHERE organization_id = ? AND status = "online"').get(req.user!.organizationId) as any)?.count || 0;

  res.json({
    keys,
    webhookUrl: org?.webhook_url || '',
    webhookSecretConfigured: Boolean(org?.webhook_secret),
    activeSourcesCount: sourcesCount,
    onlineDevicesCount: devicesCount,
    isReadyForPayments: sourcesCount > 0,
  });
});

// Generate new key set
apiRouter.post('/api-keys', requireAuth, requireRole(['owner', 'admin']), (req: AuthenticatedUserRequest, res: Response) => {
  const { name, mode } = req.body;
  if (!name || typeof name !== 'string') {
    res.status(400).json({ error: 'NAME_REQUIRED', message: 'اسم المفتاح مطلوب' });
    return;
  }

  const keyMode = mode === 'test' ? 'test' : 'live';
  try {
    const keySet = ApiKeyService.generateKeySet(req.user!.organizationId, name.trim(), keyMode);
    AuditService.record({
      organizationId: req.user!.organizationId,
      actorIdentity: req.user!.email,
      action: 'API_KEY_GENERATED',
      resourceType: 'api_key',
      resourceId: keySet.keyId,
      originIp: req.ip,
      details: { name, mode: keyMode },
    });
    res.status(201).json(keySet);
  } catch (err: any) {
    res.status(500).json({ error: 'KEY_GEN_FAILED', message: err.message || 'تعذر توليد المفتاح' });
  }
});

// Revoke API Key
apiRouter.post('/api-keys/:id/revoke', requireAuth, requireRole(['owner', 'admin']), (req: AuthenticatedUserRequest, res: Response) => {
  const success = ApiKeyService.revokeKey(req.user!.organizationId, req.params.id);
  if (!success) {
    res.status(404).json({ error: 'KEY_NOT_FOUND', message: 'المفتاح غير موجود أو تم إلغاؤه مسبقاً' });
    return;
  }

  AuditService.record({
    organizationId: req.user!.organizationId,
    actorIdentity: req.user!.email,
    action: 'API_KEY_REVOKED',
    resourceType: 'api_key',
    resourceId: req.params.id,
    originIp: req.ip,
    details: {},
  });
  res.json({ message: 'تم إيقاف المفتاح بنجاح' });
});

// ==========================================
// 11. QUICK PAYMENT LINKS
// ==========================================

// List Payment Links
apiRouter.get('/payment-links', requireAuth, (req: AuthenticatedUserRequest, res: Response) => {
  const links = PaymentLinkService.listPaymentLinks(req.user!.organizationId);
  res.json(links);
});

// Create Payment Link
apiRouter.post('/payment-links', requireAuth, requireRole(['owner', 'admin', 'manager']), (req: AuthenticatedUserRequest, res: Response) => {
  const { title, description, amount, reusable, redirectUrl } = req.body;
  if (!title || typeof title !== 'string' || !amount) {
    res.status(400).json({ error: 'MISSING_FIELDS', message: 'العنوان والمبلغ مطلوبان لإنشاء رابط الدفع' });
    return;
  }

  try {
    const link = PaymentLinkService.createPaymentLink(req.user!.organizationId, {
      title,
      description,
      amount: Number(amount),
      reusable: reusable !== false,
      redirectUrl,
    });

    AuditService.record({
      organizationId: req.user!.organizationId,
      actorIdentity: req.user!.email,
      action: 'PAYMENT_LINK_CREATED',
      resourceType: 'payment_link',
      resourceId: link.id,
      originIp: req.ip,
      details: { title, amount },
    });

    res.status(201).json(link);
  } catch (err: any) {
    res.status(400).json({ error: 'CREATE_LINK_FAILED', message: err.message || 'تعذر إنشاء رابط الدفع' });
  }
});

// Toggle Payment Link Active Status
apiRouter.post('/payment-links/:id/toggle', requireAuth, requireRole(['owner', 'admin', 'manager']), (req: AuthenticatedUserRequest, res: Response) => {
  const success = PaymentLinkService.togglePaymentLink(req.user!.organizationId, req.params.id);
  if (!success) {
    res.status(404).json({ error: 'LINK_NOT_FOUND', message: 'رابط الدفع غير موجود' });
    return;
  }
  res.json({ message: 'تم تحديث حالة الرابط' });
});

// Delete Payment Link
apiRouter.delete('/payment-links/:id', requireAuth, requireRole(['owner', 'admin']), (req: AuthenticatedUserRequest, res: Response) => {
  const success = PaymentLinkService.deletePaymentLink(req.user!.organizationId, req.params.id);
  if (!success) {
    res.status(404).json({ error: 'LINK_NOT_FOUND', message: 'رابط الدفع غير موجود' });
    return;
  }
  res.json({ message: 'تم حذف رابط الدفع بنجاح' });
});

// Public: Get Payment Link details
apiRouter.get('/payment-links/:id/public', (req: Request, res: Response) => {
  const link = PaymentLinkService.getPaymentLink(req.params.id);
  if (!link || !link.isActive) {
    res.status(404).json({ error: 'LINK_NOT_FOUND', message: 'رابط الدفع غير صالح أو تم إيقافه' });
    return;
  }

  const db = getDatabase();
  const org = db.prepare('SELECT name, name_ar FROM organizations WHERE id = ?').get(link.organizationId) as any;

  res.json({
    ...link,
    merchantName: org?.name || '',
    merchantNameAr: org?.name_ar || org?.name || '',
  });
});

// Public: Initialize Checkout Session from a Payment Link
apiRouter.post('/payment-links/:id/checkout', (req: Request, res: Response) => {
  const link = PaymentLinkService.getPaymentLink(req.params.id);
  if (!link || !link.isActive) {
    res.status(404).json({ error: 'LINK_NOT_FOUND', message: 'رابط الدفع غير متاح حالياً' });
    return;
  }

  const { customerName, customerPhone, customerEmail } = req.body;
  try {
    const session = CheckoutService.createSession(link.organizationId, {
      orderId: `LINK-${link.id.slice(-6).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`,
      amount: link.amount,
      customerName,
      customerPhone,
      customerEmail,
      paymentLinkId: link.id,
      returnUrl: link.redirectUrl || undefined,
    });

    res.status(201).json(session);
  } catch (err: any) {
    res.status(400).json({ error: 'CHECKOUT_FAILED', message: err.message || 'تعذر بدء عملية الدفع' });
  }
});

// ==========================================
// 12. CHECKOUT SESSIONS (PAYMENT GATEWAY API)
// ==========================================

// Create Checkout Session (External stores via API Key or dashboard user session)
apiRouter.post('/checkout/sessions', (req: Request, res: Response) => {
  let organizationId: string | null = null;
  let mode: 'live' | 'test' = 'live';

  // 1. Try Authenticating via Secret Key (Server-to-Server)
  const authHeader = req.headers.authorization || (req.headers['x-secret-key'] as string);
  if (authHeader) {
    const authResult = ApiKeyService.authenticateSecretKey(authHeader);
    if (authResult) {
      organizationId = authResult.organizationId;
      mode = authResult.mode;
    }
  }

  // 2. Try Authenticating via Public Key (Drop-in JS SDK)
  if (!organizationId && req.headers['x-public-key']) {
    const pubResult = ApiKeyService.authenticatePublicKey(req.headers['x-public-key'] as string);
    if (pubResult) {
      organizationId = pubResult.organizationId;
      mode = pubResult.mode;
    }
  }

  // 3. Fallback to Cookie Session (if requested from inside the dashboard)
  if (!organizationId) {
    const token = getSessionTokenFromRequest(req);
    if (token) {
      const db = getDatabase();
      const tokenHash = hashSessionToken(token);
      const session = db.prepare('SELECT organization_id FROM sessions WHERE token = ? AND expires_at > datetime("now")').get(tokenHash) as any;
      if (session) {
        organizationId = session.organization_id;
      }
    }
  }

  if (!organizationId) {
    res.status(401).json({
      error: 'AUTHENTICATION_REQUIRED',
      message: 'مفتاح الربط مطلوب لإنشاء جلسة دفع (Authorization: Bearer sk_... أو X-Public-Key: pk_...)',
    });
    return;
  }

  const {
    orderId,
    order_id,
    amount,
    currency,
    customerName,
    customer_name,
    customerPhone,
    customer_phone,
    customerEmail,
    customer_email,
    returnUrl,
    return_url,
    cancelUrl,
    cancel_url,
    webhookUrl,
    webhook_url,
    metadata,
    expiresInMinutes,
  } = req.body;

  const resolvedAmount = parseFloat(amount);
  if (!resolvedAmount || isNaN(resolvedAmount) || resolvedAmount <= 0) {
    res.status(400).json({ error: 'INVALID_AMOUNT', message: 'مبلغ الدفع يجب أن يكون رقماً موجباً أكبر من الصفر' });
    return;
  }

  try {
    const session = CheckoutService.createSession(organizationId, {
      orderId: orderId || order_id,
      amount: resolvedAmount,
      currency: currency || 'EGP',
      customerName: customerName || customer_name,
      customerPhone: customerPhone || customer_phone,
      customerEmail: customerEmail || customer_email,
      mode,
      returnUrl: returnUrl || return_url,
      cancelUrl: cancelUrl || cancel_url,
      webhookUrl: webhookUrl || webhook_url,
      metadata,
      expiresInMinutes,
    });

    res.status(201).json(session);
  } catch (err: any) {
    res.status(400).json({ error: 'SESSION_CREATE_FAILED', message: err.message || 'تعذر إنشاء جلسة الدفع' });
  }
});

// List recent sessions for merchant dashboard
apiRouter.get('/checkout/sessions', requireAuth, (req: AuthenticatedUserRequest, res: Response) => {
  const sessions = CheckoutService.listSessions(req.user!.organizationId, 50);
  res.json(sessions);
});

// Public: Get Session details for Hosted Checkout page
apiRouter.get('/checkout/sessions/:id', (req: Request, res: Response) => {
  const session = CheckoutService.getSession(req.params.id);
  if (!session) {
    res.status(404).json({ error: 'SESSION_NOT_FOUND', message: 'جلسة الدفع غير موجودة أو انتهت صلاحيتها' });
    return;
  }
  res.json(session);
});

// Public: Live Polling Status Check
apiRouter.get('/checkout/sessions/:id/status', (req: Request, res: Response) => {
  const status = CheckoutService.getSessionStatus(req.params.id);
  if (!status) {
    res.status(404).json({ error: 'SESSION_NOT_FOUND', message: 'جلسة الدفع غير موجودة' });
    return;
  }
  res.json(status);
});

// Public: Customer claims payment by providing phone or reference
apiRouter.post('/checkout/sessions/:id/claim', (req: Request, res: Response) => {
  const { senderPhone, transferRef } = req.body;
  try {
    const result = CheckoutService.claimManualReference(req.params.id, { senderPhone, transferRef });
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: 'CLAIM_FAILED', message: err.message || 'تعذر معالجة بيانات التحويل' });
  }
});

// Simulator: Simulate successful payment (Dashboard & Test Mode)
apiRouter.post('/checkout/sessions/:id/simulate', (req: Request, res: Response) => {
  try {
    const session = CheckoutService.simulateConfirmation(req.params.id);
    res.json({ success: true, message: 'تمت محاكاة الدفع بنجاح!', session });
  } catch (err: any) {
    res.status(400).json({ error: 'SIMULATION_FAILED', message: err.message || 'فشلت محاكاة الدفع' });
  }
});

// Public: Generate pre-filled WhatsApp customer receipt
apiRouter.get('/checkout/sessions/:id/whatsapp-receipt', (req: Request, res: Response) => {
  try {
    const url = CheckoutService.generateWhatsAppReceiptUrl(req.params.id);
    if (!url) {
      res.status(404).json({ error: 'SESSION_NOT_FOUND', message: 'جلسة الدفع غير موجودة أو غير مكتملة' });
      return;
    }
    res.json({ success: true, whatsappUrl: url });
  } catch (err: any) {
    res.status(400).json({ error: 'RECEIPT_FAILED', message: err.message });
  }
});

// ==========================================
// 13. E-COMMERCE INTEGRATION WEBHOOKS & PLUGINS
// ==========================================

// Webhook Delivery Logs for Merchant
apiRouter.get('/integrations/webhooks/deliveries', requireAuth, (req: AuthenticatedUserRequest, res: Response) => {
  const db = getDatabase();
  const deliveries = db.prepare(`
    SELECT wd.*, we.url, we.subscribed_events
    FROM webhook_deliveries wd
    JOIN webhook_endpoints we ON wd.endpoint_id = we.id
    WHERE we.organization_id = ?
    ORDER BY wd.delivered_at DESC
    LIMIT 50
  `).all(req.user!.organizationId);

  res.json(deliveries);
});

// Test Webhook Dispatch to Merchant Store
apiRouter.post('/integrations/webhooks/test-ping', requireAuth, requireRole(['owner', 'admin']), async (req: AuthenticatedUserRequest, res: Response) => {
  const db = getDatabase();
  const org = db.prepare('SELECT webhook_url, webhook_secret FROM organizations WHERE id = ?').get(req.user!.organizationId) as any;

  if (!org?.webhook_url) {
    res.status(400).json({ error: 'WEBHOOK_NOT_CONFIGURED', message: 'يرجى إدخال رابط Webhook URL أولاً في الإعدادات' });
    return;
  }

  const endpointUrl = org.webhook_url;
  const secret = org.webhook_secret || 'sec_default_test';

  const testEvent = {
    id: `evt_test_${Date.now()}`,
    type: 'webhook.test_ping',
    occurred_at: new Date().toISOString(),
    data: {
      message: 'هذا إشعار تجريبي من بوابة صرّاف للتأكد من نجاح الربط مع متجرك.',
      organization_id: req.user!.organizationId,
      timestamp: new Date().toISOString(),
    },
  };

  try {
    const signature = crypto.createHmac('sha256', secret).update(JSON.stringify(testEvent)).digest('hex');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(endpointUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Sarraf-Event': 'webhook.test_ping',
        'X-Sarraf-Signature': signature,
      },
      body: JSON.stringify(testEvent),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const responseText = await response.text().catch(() => '');

    AuditService.record({
      organizationId: req.user!.organizationId,
      actorIdentity: req.user!.email,
      action: 'WEBHOOK_TEST_PING',
      resourceType: 'webhook',
      resourceId: endpointUrl,
      originIp: req.ip,
      details: { status: response.status, responseText: responseText.slice(0, 500) },
    });

    res.json({
      success: response.ok,
      httpStatus: response.status,
      responseBody: responseText.slice(0, 300),
      message: response.ok ? 'تم إرسال الإشعار التجريبي واستلام الرد 200 OK بنجاح!' : `تم الاتصال ولكن المتجر أعاد كود ${response.status}`,
    });
  } catch (err: any) {
    res.status(400).json({
      success: false,
      error: 'PING_FAILED',
      message: err.message || 'تعذر الاتصال بالرابط المحدد (تأكد من عمل الرابط وصلاحيته)',
    });
  }
});

// Easy Orders (إيزي أوردرز) Native Webhook Receiver
apiRouter.post('/integrations/easyorders/webhook', (req: Request, res: Response) => {
  // Identify merchant via query param or header (accepts sk_ or pk_)
  const apiKey = (req.query.api_key as string) || (req.headers['x-api-key'] as string);
  const auth = apiKey ? ApiKeyService.authenticateAnyKey(apiKey) : null;

  if (!auth) {
    res.status(401).json({ error: 'UNAUTHORIZED', message: 'مفتاح الربط api_key غير صالح أو مفقود في الرابط' });
    return;
  }

  const payload = req.body || {};
  const orderId = String(payload.order_id || payload.id || payload.code || `EO-${Date.now().toString(36)}`);
  const amount = parseFloat(payload.grand_total || payload.total || payload.amount || '0');
  const customerName = payload.customer_name || payload.name || payload.customer?.name || '';
  const customerPhone = payload.customer_phone || payload.phone || payload.customer?.phone || '';

  if (!amount || amount <= 0) {
    res.status(400).json({ error: 'INVALID_AMOUNT', message: 'مبلغ الطلب غير صالح في إشعار Easy Orders' });
    return;
  }

  try {
    const session = CheckoutService.createSession(auth.organizationId, {
      orderId,
      amount,
      customerName,
      customerPhone,
      mode: auth.mode,
      metadata: { source: 'easy_orders', raw_payload: payload },
    });

    res.status(200).json({
      success: true,
      message: 'تم إنشاء جلسة دفع صرّاف بنجاح لطلب إيزي أوردرز',
      order_id: orderId,
      checkout_url: session.checkoutUrl,
      session_id: session.id,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'SESSION_CREATION_FAILED', message: err.message });
  }
});

// Shopify Order Webhook Receiver
apiRouter.post('/integrations/shopify/webhook', (req: Request, res: Response) => {
  // Identify merchant via query param or header (accepts sk_ or pk_)
  const apiKey = (req.query.api_key as string) || (req.headers['x-api-key'] as string);
  const auth = apiKey ? ApiKeyService.authenticateAnyKey(apiKey) : null;

  if (!auth) {
    res.status(401).json({ error: 'UNAUTHORIZED', message: 'API key required' });
    return;
  }

  const payload = req.body || {};
  const orderId = String(payload.name || payload.order_number || payload.id || `SHOP-${Date.now()}`);
  const amount = parseFloat(payload.total_price || payload.current_total_price || '0');
  const customerName = payload.customer ? `${payload.customer.first_name || ''} ${payload.customer.last_name || ''}`.trim() : '';
  const customerPhone = payload.customer?.phone || payload.billing_address?.phone || payload.phone || '';

  if (!amount || amount <= 0) {
    res.status(400).json({ error: 'INVALID_AMOUNT' });
    return;
  }

  try {
    const session = CheckoutService.createSession(auth.organizationId, {
      orderId,
      amount,
      customerName,
      customerPhone,
      mode: auth.mode,
      metadata: { source: 'shopify', order_id: payload.id },
    });

    res.status(200).json({
      success: true,
      order_id: orderId,
      checkout_url: session.checkoutUrl,
      session_id: session.id,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'SESSION_CREATION_FAILED', message: err.message });
  }
});

// Download WooCommerce Ready Plugin (ZIP for WordPress admin upload, or single PHP file)
apiRouter.get('/integrations/woocommerce/plugin-download', (req: Request, res: Response) => {
  const format = req.query.format as string;
  const zipPath = path.resolve(__dirname, 'templates', 'woocommerce', 'sarraf-pay.zip');
  const phpPath = path.resolve(__dirname, 'templates', 'woocommerce', 'class-wc-gateway-sarraf.php');

  if (format === 'php' || (!fs.existsSync(zipPath) && fs.existsSync(phpPath))) {
    if (!fs.existsSync(phpPath)) {
      res.status(404).send('Plugin file not found');
      return;
    }
    res.setHeader('Content-Disposition', 'attachment; filename="class-wc-gateway-sarraf.php"');
    res.setHeader('Content-Type', 'application/x-php');
    fs.createReadStream(phpPath).pipe(res);
    return;
  }

  if (fs.existsSync(zipPath)) {
    res.setHeader('Content-Disposition', 'attachment; filename="sarraf-pay.zip"');
    res.setHeader('Content-Type', 'application/zip');
    fs.createReadStream(zipPath).pipe(res);
    return;
  }

  res.status(404).send('Plugin archive not found');
});

// ==========================================
// 14. ANTI-FRAUD RADAR & REPUTATION MANAGEMENT
// ==========================================

// Get merchant's blocked senders list
apiRouter.get('/fraud/blocklist', requireAuth, (req: AuthenticatedUserRequest, res: Response) => {
  const blocklist = FraudProtectionService.listBlockedSenders(req.user!.organizationId);
  res.json(blocklist);
});

// Block suspicious customer phone
apiRouter.post('/fraud/blocklist', requireAuth, (req: AuthenticatedUserRequest, res: Response) => {
  const { phone, reason } = req.body;
  if (!phone) {
    res.status(400).json({ error: 'PHONE_REQUIRED', message: 'رقم الهاتف مطلوب' });
    return;
  }
  try {
    FraudProtectionService.blockSender(req.user!.organizationId, phone, reason || 'حظر يدوي من التاجر');
    AuditService.record({
      organizationId: req.user!.organizationId,
      actorIdentity: req.user!.id,
      action: 'fraud_block_sender',
      resourceType: 'fraud_blocklist',
      resourceId: phone,
      details: { phone, reason: reason || 'حظر يدوي من التاجر' },
    });
    res.json({ success: true, message: 'تم إدراج الرقم في القائمة السوداء بنجاح' });
  } catch (err: any) {
    res.status(400).json({ error: 'BLOCK_FAILED', message: err.message });
  }
});

// Unblock customer phone
apiRouter.delete('/fraud/blocklist/:phone', requireAuth, (req: AuthenticatedUserRequest, res: Response) => {
  try {
    FraudProtectionService.unblockSender(req.user!.organizationId, req.params.phone);
    AuditService.record({
      organizationId: req.user!.organizationId,
      actorIdentity: req.user!.id,
      action: 'fraud_unblock_sender',
      resourceType: 'fraud_blocklist',
      resourceId: req.params.phone,
      details: { phone: req.params.phone },
    });
    res.json({ success: true, message: 'تم رفع الحظر عن الرقم بنجاح' });
  } catch (err: any) {
    res.status(400).json({ error: 'UNBLOCK_FAILED', message: err.message });
  }
});

// ==========================================
// 15. SMART WALLET POOL & CAPACITY ENGINE
// ==========================================

// Get real-time capacity and headroom across all active payment sources
apiRouter.get('/wallet-pool/capacity', requireAuth, (req: AuthenticatedUserRequest, res: Response) => {
  const db = getDatabase();
  const sources = db.prepare(`
    SELECT id, name, type, identifier, is_active, daily_limit_minor, monthly_limit_minor
    FROM payment_sources
    WHERE organization_id = ? AND is_active = 1
  `).all(req.user!.organizationId) as any[];

  const capacities = sources.map(src => {
    const cap = LimitEngine.getSourceCapacity(req.user!.organizationId, src.id);
    return {
      ...src,
      dailyLimit: fromMinor(src.daily_limit_minor || 6000000),
      monthlyLimit: fromMinor(src.monthly_limit_minor || 20000000),
      capacity: cap ? {
        dailyUsage: fromMinor(cap.dailyIntakeMinor),
        dailyRemaining: fromMinor(cap.remainingDailyMinor),
        dailyPercent: cap.dailyPercentage,
        monthlyUsage: fromMinor(cap.monthlyIntakeMinor),
        monthlyRemaining: fromMinor(cap.remainingMonthlyMinor),
        monthlyPercent: cap.monthlyPercentage,
        isSaturated: cap.isSaturated,
      } : null
    };
  });

  const org = db.prepare(`
    SELECT wallet_routing_strategy, whatsapp_business_phone, whatsapp_auto_message
    FROM organizations
    WHERE id = ?
  `).get(req.user!.organizationId) as any;

  res.json({
    strategy: org?.wallet_routing_strategy || 'least_loaded',
    whatsappBusinessPhone: org?.whatsapp_business_phone || null,
    whatsappAutoMessage: org?.whatsapp_auto_message ?? 1,
    sources: capacities
  });
});

// Update wallet pool routing strategy and WhatsApp settings
apiRouter.post('/wallet-pool/settings', requireAuth, (req: AuthenticatedUserRequest, res: Response) => {
  const { strategy, whatsappBusinessPhone, whatsappAutoMessage } = req.body;
  const db = getDatabase();

  const updates: string[] = [];
  const params: any[] = [];

  if (strategy && ['least_loaded', 'round_robin', 'priority'].includes(strategy)) {
    updates.push('wallet_routing_strategy = ?');
    params.push(strategy);
  }
  if (whatsappBusinessPhone !== undefined) {
    updates.push('whatsapp_business_phone = ?');
    params.push(whatsappBusinessPhone ? whatsappBusinessPhone.trim() : null);
  }
  if (whatsappAutoMessage !== undefined) {
    updates.push('whatsapp_auto_message = ?');
    params.push(whatsappAutoMessage ? 1 : 0);
  }

  if (updates.length > 0) {
    params.push(req.user!.organizationId);
    db.prepare(`UPDATE organizations SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  }

  res.json({ success: true, message: 'تم حفظ إعدادات المحافظ والتوجيه الذكي بنجاح' });
});

