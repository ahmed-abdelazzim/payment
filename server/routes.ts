import { Router, Request, Response } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { getDatabase } from './db';
import { verifyDeviceSignature, AuthenticatedDeviceRequest } from './middleware/deviceAuth';
import { requireAuth, requireRole, requirePlatformOwner, AuthenticatedUserRequest } from './middleware/auth';
import { parseEgyptianPaymentMessage } from './parser/engine';
import { ReconciliationService } from './services/reconciliationService';
import { LimitEngine } from './services/limitEngine';
import { AuditService } from './services/auditService';
import { SubscriptionService } from './services/subscriptionService';
import { hashPassword, verifyPassword } from './security/passwords';
import { EmailService } from './services/emailService';

export const apiRouter = Router();

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
  res.clearCookie('sarraf_session_token', { path: '/' });
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
    db.prepare(`
      INSERT INTO users (id, email, password_hash, full_name, email_verified, is_active)
      VALUES (?, ?, ?, ?, 0, 1)
    `).run(userId, normalizedEmail, scryptHash, fullName.trim());

    // 3. Bind Owner Role
    db.prepare(`
      INSERT INTO organization_members (id, organization_id, user_id, role)
      VALUES (?, ?, ?, 'owner')
    `).run(`mem_${Date.now()}`, orgId, userId);

    // 4. Create Clean Initial Balance Account (Zero Balance)
    db.prepare(`
      INSERT INTO balance_accounts (id, organization_id, account_name, currency, current_balance)
      VALUES (?, ?, 'Main Operational Account (EGP)', 'EGP', 0.0)
    `).run(`acc_${orgId}`, orgId);

    // 5. Generate Session Token (7 Days)
    const token = generateSessionToken();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare(`
      INSERT INTO sessions (token, user_id, organization_id, expires_at)
      VALUES (?, ?, ?, ?)
    `).run(token, userId, orgId, expiresAt);

    // 6. Generate Email Verification Token (24 Hours Expiry)
    const verifyToken = `verify_${crypto.randomBytes(24).toString('hex')}`;
    const verifyExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    db.prepare(`
      INSERT INTO email_verifications (token, user_id, email, expires_at)
      VALUES (?, ?, ?, ?)
    `).run(verifyToken, userId, normalizedEmail, verifyExpiresAt);

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
    }).catch((err) => console.error('[Signup] Email dispatch error:', err));

    res.status(201).json({
      token,
      user: { id: userId, email: normalizedEmail, fullName, role: 'owner', emailVerified: false },
      organization: { id: orgId, name: organizationName, nameAr: organizationNameAr || organizationName, slug },
      verification: {
        token: verifyToken,
        expiresAt: verifyExpiresAt,
        instructions: 'Click verification link or call /api/v1/auth/verify-email to confirm your business email.',
      },
    });
  } catch (err: any) {
    db.exec('ROLLBACK;');
    if (err.message && err.message.includes('UNIQUE constraint failed: users.email')) {
      res.status(409).json({ error: 'EMAIL_ALREADY_EXISTS', message: 'An account with this email already exists' });
      return;
    }
    res.status(500).json({ error: 'SIGNUP_FAILED', message: err.message });
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
    SELECT id, email, password_hash, full_name, email_verified, is_active FROM users WHERE email = ?
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
  `).run(token, user.id, member.organization_id, expiresAt);

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
    token,
    user: {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      role: member.role,
      emailVerified: Boolean(user.email_verified),
      isPlatformAdmin: Boolean(user.is_platform_admin === 1 || user.email === 'aabdo6043@gmail.com' || member.organization_id === 'org_platform_ops'),
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
  `).get(token) as any;

  if (!row || row.used_at || new Date() > new Date(row.expires_at)) {
    res.status(400).json({ error: 'INVALID_OR_EXPIRED_TOKEN', message: 'Email verification token is invalid or expired.' });
    return;
  }

  db.exec('BEGIN IMMEDIATE;');
  try {
    db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(row.user_id);
    db.prepare('UPDATE email_verifications SET used_at = datetime("now") WHERE token = ?').run(token);
    db.exec('COMMIT;');

    res.json({ message: 'Email verified successfully', email: row.email });
  } catch (err: any) {
    db.exec('ROLLBACK;');
    res.status(500).json({ error: 'VERIFICATION_FAILED', message: err.message });
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
  const user = db.prepare('SELECT id, email, email_verified FROM users WHERE email = ?').get(email.toLowerCase().trim()) as any;

  if (user && !user.email_verified) {
    const newToken = `verify_${crypto.randomBytes(24).toString('hex')}`;
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    db.prepare(`
      INSERT INTO email_verifications (token, user_id, email, expires_at)
      VALUES (?, ?, ?, ?)
    `).run(newToken, user.id, user.email, expiresAt);

    EmailService.sendVerificationEmail({
      to: user.email,
      fullName: user.full_name || user.email,
      token: newToken,
      organizationName: 'Sarraf Ops',
    }).catch((err) => console.error('[ResendVerification] Email dispatch error:', err));

    res.json({ message: 'Verification link dispatched', verificationToken: newToken });
    return;
  }

  res.json({ message: 'If this unverified email exists, a verification link has been dispatched.' });
});

// Logout: Revokes Session and Clears HTTP Cookie
apiRouter.post('/auth/logout', (req: Request, res: Response) => {
  let token = req.header('X-Session-Token') || req.header('Authorization')?.replace('Bearer ', '');
  if (!token && req.headers.cookie) {
    const match = req.headers.cookie.match(/(?:sarraf_session_token|session_token)=([^;]+)/);
    if (match) token = match[1];
  }

  if (token) {
    const db = getDatabase();
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
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
  const user = db.prepare('SELECT id FROM users WHERE email = ?').get(normalized) as any;

  if (user) {
    const resetToken = `reset_${crypto.randomBytes(24).toString('hex')}`;
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 minutes
    db.prepare(`
      INSERT INTO password_resets (token, user_id, expires_at)
      VALUES (?, ?, ?)
    `).run(resetToken, user.id, expiresAt);

    EmailService.sendPasswordResetEmail({
      to: normalized,
      fullName: user.full_name || '',
      token: resetToken,
    }).catch((err) => console.error('[ForgotPassword] Email dispatch error:', err));

    res.json({
      message: 'Password reset link generated. Check your inbox.',
      reset_token_instructions: `Use reset token ${resetToken} to set your new password. Valid for 15 minutes.`,
      reset_token: resetToken,
    });
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
  `).get(token) as any;

  if (!resetRow || resetRow.used_at || new Date() > new Date(resetRow.expires_at)) {
    res.status(400).json({ error: 'INVALID_OR_EXPIRED_TOKEN', message: 'Reset token is invalid or expired' });
    return;
  }

  db.exec('BEGIN IMMEDIATE;');
  try {
    const scryptHash = hashPassword(newPassword);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(scryptHash, resetRow.user_id);
    db.prepare('UPDATE password_resets SET used_at = datetime("now") WHERE token = ?').run(token);
    // Invalidate ALL existing sessions for this user across all devices
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(resetRow.user_id);
    db.exec('COMMIT;');

    clearSessionCookie(res);
    res.json({ message: 'Password updated successfully. Please sign in with your new password.' });
  } catch (err: any) {
    db.exec('ROLLBACK;');
    res.status(500).json({ error: 'RESET_FAILED', message: err.message });
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
  const token = req.header('X-Session-Token') || req.header('Authorization')?.replace('Bearer ', '');
  if (token) {
    db.prepare('UPDATE sessions SET organization_id = ? WHERE token = ?').run(organizationId, token);
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
    SELECT token, email, role, expires_at as expiresAt, created_at as createdAt
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
    `).run(inviteToken, req.user!.organizationId, normalizedEmail, role, req.user!.id);

    AuditService.record({
      organizationId: req.user!.organizationId,
      actorIdentity: req.user!.email,
      action: 'TEAM_MEMBER_INVITATION_ISSUED',
      resourceType: 'team_invitation',
      resourceId: inviteToken,
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
    }).catch((err) => console.error('[TeamInvite] Email dispatch error:', err));

    res.status(201).json({
      message: 'Invitation issued successfully and email dispatched',
      inviteToken,
      inviteLink: `/invite/${inviteToken}`,
      email: normalizedEmail,
      role,
      expiresAt,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'INVITE_FAILED', message: err.message });
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
  `).get(token) as any;

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

    db.prepare(`UPDATE team_invitations SET accepted_at = datetime('now') WHERE token = ?`).run(token);

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
    res.status(500).json({ error: 'ACCEPT_INVITATION_FAILED', message: err.message });
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
  `).get(token) as any;

  if (!invite) {
    res.status(404).json({ error: 'INVITATION_NOT_FOUND', message: 'Invitation not found' });
    return;
  }

  const isExpired = new Date() > new Date(invite.expires_at);
  const isAccepted = Boolean(invite.accepted_at);

  res.json({
    token: invite.token,
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
  `).get(token) as any;

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

    db.prepare(`UPDATE team_invitations SET accepted_at = datetime('now') WHERE token = ?`).run(token);

    // Create session
    const sessionToken = generateSessionToken();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare(`
      INSERT INTO sessions (token, user_id, organization_id, expires_at)
      VALUES (?, ?, ?, ?)
    `).run(sessionToken, userId, invite.organization_id, expiresAt);

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
      token: sessionToken,
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
    res.status(500).json({ error: 'JOIN_FAILED', message: err.message });
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
    telegramBotToken: org?.telegram_bot_token || '',
    telegramChatId: org?.telegram_chat_id || '',
    webhookUrl: org?.webhook_url || '',
    webhookSecret: org?.webhook_secret || `whsec_${crypto.randomBytes(16).toString('hex')}`,
  });
});

// Update Organization Settings (Telegram, Webhooks, Timezone)
apiRouter.post('/organizations/settings', requireAuth, requireRole(['owner', 'admin']), (req: AuthenticatedUserRequest, res: Response) => {
  const { name, nameAr, defaultTimezone, telegramBotToken, telegramChatId, webhookUrl, webhookSecret } = req.body;
  const db = getDatabase();

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
    telegramBotToken !== undefined ? telegramBotToken : null,
    telegramChatId !== undefined ? telegramChatId : null,
    webhookUrl !== undefined ? webhookUrl : null,
    webhookSecret !== undefined ? webhookSecret : null,
    req.user!.organizationId
  );

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
           s.daily_turnover_limit as dailyLimit, s.monthly_turnover_limit as monthlyLimit,
           s.is_paused_for_new_instructions as isPaused,
           a.address_value as primaryAddress, a.address_type as addressType, a.is_default_for_invoices as isDefault,
           COALESCE((SELECT SUM(amount) FROM transactions WHERE payment_source_id = s.id AND status = 'confirmed'), 0) as volume,
           COALESCE((SELECT COUNT(*) FROM transactions WHERE payment_source_id = s.id AND status = 'confirmed'), 0) as txnsCount
    FROM payment_sources s
    LEFT JOIN payment_addresses a ON (s.id = a.payment_source_id AND a.is_default_for_invoices = 1)
    WHERE s.organization_id = ? AND s.retired_at IS NULL
    ORDER BY s.created_at ASC
  `).all(req.user!.organizationId) as any[];

  const totalVol = rows.reduce((acc, r) => acc + (r.volume || 0), 0) || 1;

  const result = rows.map((r) => ({
    ...r,
    sharePercentage: Math.round(((r.volume || 0) / totalVol) * 100),
    isPaused: Boolean(r.isPaused),
    isDefault: Boolean(r.isDefault),
    color: r.provider === 'vodafone_cash' ? '#1e3a8a' : r.provider === 'instapay' ? '#00285e' : r.provider === 'orange_cash' ? '#565e74' : '#00236f',
  }));

  res.json(result);
});

// Add New Payment Source (Wallet, Bank Account, InstaPay)
apiRouter.post('/sources', requireAuth, requireRole(['owner', 'admin']), (req: AuthenticatedUserRequest, res: Response) => {
  const { provider, friendlyName, walletNumber, dailyLimit, monthlyLimit, addressType, setAsDefault } = req.body;
  if (!provider || !friendlyName || !walletNumber) {
    res.status(400).json({ error: 'MISSING_SOURCE_FIELDS', message: 'Provider, friendly name, and wallet number required' });
    return;
  }

  const db = getDatabase();
  const sourceId = `src_${Date.now()}`;

  // Find balance account
  const acc = db.prepare('SELECT id FROM balance_accounts WHERE organization_id = ? LIMIT 1').get(req.user!.organizationId) as any;
  const balanceAccountId = acc?.id || `acc_${req.user!.organizationId}`;

  // Default statutory limits if unprovided
  const defaultDaily = provider === 'instapay' ? 120000.0 : 60000.0;
  const defaultMonthly = provider === 'instapay' ? 400000.0 : 200000.0;

  db.exec('BEGIN IMMEDIATE;');
  try {
    db.prepare(`
      INSERT INTO payment_sources (id, organization_id, balance_account_id, provider, friendly_name, wallet_number, daily_turnover_limit, monthly_turnover_limit)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(sourceId, req.user!.organizationId, balanceAccountId, provider, friendlyName.trim(), walletNumber.trim(), dailyLimit || defaultDaily, monthlyLimit || defaultMonthly);

    const addrId = `addr_${Date.now()}`;
    const isDef = setAsDefault ? 1 : 0;

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
    `).run(addrId, sourceId, addressType || (provider === 'instapay' ? 'instapay_vpa' : 'msisdn'), walletNumber.trim(), isDef);

    AuditService.record({
      organizationId: req.user!.organizationId,
      actorIdentity: req.user!.email,
      action: 'PAYMENT_SOURCE_ADDED',
      resourceType: 'payment_source',
      resourceId: sourceId,
      originIp: req.ip,
      details: { provider, friendlyName, walletNumber },
    });

    db.exec('COMMIT;');
    res.status(201).json({ id: sourceId, friendlyName, walletNumber, provider });
  } catch (err: any) {
    db.exec('ROLLBACK;');
    res.status(500).json({ error: 'CREATE_SOURCE_FAILED', message: err.message });
  }
});

// Safe Switch: Set as Default for Invoices (Preserves historical capture on others)
apiRouter.post('/sources/:id/set-default', requireAuth, requireRole(['owner', 'admin', 'manager']), (req: AuthenticatedUserRequest, res: Response) => {
  const db = getDatabase();
  const { id } = req.params;

  db.exec('BEGIN IMMEDIATE;');
  try {
    // 1. Reset current defaults
    db.prepare(`
      UPDATE payment_addresses SET is_default_for_invoices = 0
      WHERE payment_source_id IN (SELECT id FROM payment_sources WHERE organization_id = ?)
    `).run(req.user!.organizationId);

    // 2. Set this source's address as default
    db.prepare(`UPDATE payment_addresses SET is_default_for_invoices = 1 WHERE payment_source_id = ?`).run(id);

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
    res.status(500).json({ error: 'SWITCH_FAILED', message: err.message });
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
  db.prepare('UPDATE payment_sources SET is_paused_for_new_instructions = ? WHERE id = ?').run(nextState, req.params.id);

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
           s.daily_turnover_limit as dailyLimit, s.monthly_turnover_limit as monthlyLimit,
           s.is_paused_for_new_instructions as isPaused,
           COALESCE((SELECT SUM(amount) FROM transactions WHERE payment_source_id = s.id AND status = 'confirmed'), 0) as volume,
           COALESCE((SELECT COUNT(*) FROM transactions WHERE payment_source_id = s.id AND status = 'confirmed'), 0) as txnsCount
    FROM payment_sources s
    WHERE s.organization_id = ? AND s.retired_at IS NULL
  `).all(req.user!.organizationId) as any[];

  const totalVol = rows.reduce((acc, r) => acc + (r.volume || 0), 0) || 1;

  const result = rows.map((r) => ({
    ...r,
    sharePercentage: Math.round(((r.volume || 0) / totalVol) * 100),
    isPaused: Boolean(r.isPaused),
    color: r.provider === 'vodafone_cash' ? '#1e3a8a' : r.provider === 'instapay' ? '#00285e' : r.provider === 'orange_cash' ? '#565e74' : '#00236f',
  }));

  res.json(result);
});

apiRouter.post('/rails/:id/toggle-pause', requireAuth, (req: AuthenticatedUserRequest, res: Response) => {
  const db = getDatabase();
  const current = db.prepare('SELECT is_paused_for_new_instructions FROM payment_sources WHERE id = ? AND organization_id = ?').get(req.params.id, req.user!.organizationId) as any;
  if (!current) {
    res.status(404).json({ error: 'NOT_FOUND' });
    return;
  }
  const nextState = current.is_paused_for_new_instructions ? 0 : 1;
  db.prepare('UPDATE payment_sources SET is_paused_for_new_instructions = ? WHERE id = ?').run(nextState, req.params.id);
  res.json({ id: req.params.id, isPaused: Boolean(nextState) });
});

// ==========================================
// 4. DEVICE REGISTRATION, PAIRING & INGESTION (Section 4B)
// ==========================================

apiRouter.get('/devices', requireAuth, (req: AuthenticatedUserRequest, res: Response) => {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT d.id, d.device_number, d.friendly_name, d.location, d.adapter_type, d.status,
           d.battery_level, d.last_seen_at, d.agent_version, d.config_version,
           d.verified_at, d.notification_listener_granted, d.battery_optimization_exempt,
           (SELECT COUNT(*) FROM transactions t WHERE t.organization_id = d.organization_id) as txns_count
    FROM devices d
    WHERE d.organization_id = ?
    ORDER BY d.created_at ASC
  `).all(req.user!.organizationId);
  res.json(rows);
});

// Device Telemetry Heartbeat & Permissions Verification (Proof from real device)
apiRouter.post('/devices/:id/telemetry', (req: Request, res: Response) => {
  const { id } = req.params;
  const {
    battery_level,
    notification_listener_granted,
    battery_optimization_exempt,
    agent_version,
  } = req.body;

  const db = getDatabase();
  const dev = db.prepare('SELECT id, organization_id FROM devices WHERE id = ?').get(id) as any;
  if (!dev) {
    res.status(404).json({ error: 'DEVICE_NOT_FOUND', message: 'Device not registered' });
    return;
  }

  const listenerGranted = notification_listener_granted === true || notification_listener_granted === 1 ? 1 : 0;
  const batteryExempt = battery_optimization_exempt === true || battery_optimization_exempt === 1 ? 1 : 0;
  const battery = typeof battery_level === 'number' ? battery_level : 100;

  db.prepare(`
    UPDATE devices
    SET status = 'online',
        battery_level = ?,
        notification_listener_granted = ?,
        battery_optimization_exempt = ?,
        verified_at = datetime('now'),
        last_seen_at = datetime('now'),
        agent_version = COALESCE(?, agent_version)
    WHERE id = ?
  `).run(battery, listenerGranted, batteryExempt, agent_version || null, id);

  AuditService.record({
    organizationId: dev.organization_id,
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
  const { deviceIdentifier, friendlyName, location, adapterType } = req.body;
  if (!deviceIdentifier || !friendlyName) {
    res.status(400).json({ error: 'MISSING_FIELDS', message: 'Device identifier and friendly name required' });
    return;
  }

  const db = getDatabase();
  const deviceId = `dev_${Date.now()}`;
  const pairingCode = 'SARRAF-' + crypto.randomBytes(3).toString('hex').toUpperCase();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  db.exec('BEGIN IMMEDIATE;');
  try {
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
      INSERT INTO devices (id, organization_id, device_number, friendly_name, location, adapter_type, status, battery_level, agent_version)
      VALUES (?, ?, ?, ?, ?, ?, 'offline', 100, 'v3.4.1-eg')
    `).run(deviceId, req.user!.organizationId, deviceIdentifier.trim(), friendlyName.trim(), location || 'Mobile Terminal', adapterType || 'macrodroid');

    // Create temporary pairing token
    db.prepare(`
      INSERT INTO pairing_tokens (token, organization_id, device_identifier, expires_at)
      VALUES (?, ?, ?, ?)
    `).run(pairingCode, req.user!.organizationId, deviceId, expiresAt);

    AuditService.record({
      organizationId: req.user!.organizationId,
      actorIdentity: req.user!.email,
      action: 'DEVICE_REGISTERED_PAIRING_ISSUED',
      resourceType: 'device',
      resourceId: deviceId,
      originIp: req.ip,
      details: { pairingCode, expiresAt },
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
    res.status(500).json({ error: 'DEVICE_REGISTRATION_FAILED', message: err.message });
  }
});

// Device Pairing Handshake (Executed by mobile adapter)
apiRouter.post('/devices/pair', (req: Request, res: Response) => {
  const { pairing_token, device_identifier, device_hardware_model, adapter_type } = req.body;
  if (!pairing_token) {
    res.status(400).json({ error: 'PAIRING_TOKEN_REQUIRED' });
    return;
  }

  const db = getDatabase();
  const tokenRow = db.prepare(`
    SELECT organization_id, device_identifier, expires_at, used_at FROM pairing_tokens WHERE token = ?
  `).get(pairing_token) as any;

  if (!tokenRow || tokenRow.used_at || new Date() > new Date(tokenRow.expires_at)) {
    res.status(400).json({ error: 'INVALID_OR_EXPIRED_PAIRING_TOKEN', message: 'Token has expired. Generate a new pairing code in dashboard.' });
    return;
  }

  const orgId = tokenRow.organization_id;
  const deviceId = tokenRow.device_identifier.startsWith('dev_') ? tokenRow.device_identifier : `dev_${Date.now()}`;
  const hmacSecret = `sec_${crypto.randomBytes(32).toString('hex')}`;

  db.exec('BEGIN IMMEDIATE;');
  try {
    const existingDev = db.prepare('SELECT id FROM devices WHERE id = ?').get(deviceId);
    if (!existingDev) {
      const limitCheck = SubscriptionService.checkDeviceLimit(orgId);
      if (!limitCheck.allowed) {
        db.exec('ROLLBACK;');
        const isExpired = limitCheck.subscriptionStatus === 'trial_expired' || limitCheck.subscriptionStatus === 'expired';
        res.status(403).json({
          error: isExpired ? 'TRIAL_EXPIRED' : 'PLAN_DEVICE_LIMIT_EXCEEDED',
          message: isExpired
            ? 'انتهت فترة التجربة المجانية لمساحة العمل. يرجى الاشتراك في إحدى الباقات للاستمرار في ربط أجهزة جديدة.'
            : `Organization has reached its plan device limit of ${limitCheck.maxLimit} devices. Upgrade plan to pair more devices.`,
        });
        return;
      }
    }

    db.prepare('UPDATE pairing_tokens SET used_at = datetime("now") WHERE token = ?').run(pairing_token);

    // Provision or update device credentials
    db.prepare(`
      INSERT INTO device_credentials (device_id, hmac_secret)
      VALUES (?, ?)
      ON CONFLICT(device_id) DO UPDATE SET hmac_secret = excluded.hmac_secret, revoked_at = NULL
    `).run(deviceId, hmacSecret);

    db.prepare(`UPDATE devices SET status = 'online', last_seen_at = datetime('now') WHERE id = ?`).run(deviceId);

    db.exec('COMMIT;');

    res.status(201).json({
      status: 'paired',
      device_id: deviceId,
      hmac_secret: hmacSecret,
      organization_id: orgId,
      ingestion_endpoint: '/api/v1/devices/ingest',
    });
  } catch (err: any) {
    db.exec('ROLLBACK;');
    res.status(500).json({ error: 'PAIRING_FAILED', message: err.message });
  }
});

// Real Cryptographic Ingestion Endpoint (HMAC-SHA256 Protected!)
apiRouter.post('/devices/ingest', verifyDeviceSignature, (req: AuthenticatedDeviceRequest, res: Response) => {
  const { raw_content, provider_hint, bound_payment_address, device_captured_at, client_event_id } = req.body;
  const deviceCtx = req.deviceContext!;
  const nonce = req.header('X-Nonce')!;
  const signature = req.header('X-Signature')!;

  if (!raw_content) {
    res.status(400).json({ error: 'MISSING_CONTENT', message: 'raw_content string is required' });
    return;
  }

  const db = getDatabase();
  const rawEventId = `raw_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

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
    rawEventId,
    adapterType: deviceCtx.adapterType,
    boundPaymentAddress: bound_payment_address || '',
    parsed,
    financialEventAt: device_captured_at || new Date().toISOString(),
    signature,
  });

  // 4. Update Limit Usage If Confirmed
  if (result.status === 'confirmed') {
    LimitEngine.recordTurnover(deviceCtx.organizationId, 'src_vf', parsed.amount, device_captured_at);

    // If inbound payment arrived on platform operations tenant, attempt automatic subscription order matching!
    if (deviceCtx.organizationId === 'org_platform_ops') {
      try {
        SubscriptionService.handleInboundPlatformTransaction({
          id: result.transactionId,
          amount: parsed.amount,
          externalTrxId: parsed.externalTrxId,
          senderPhone: parsed.senderPhone,
          senderName: parsed.senderName,
        });
      } catch (subErr) {
        console.error('Subscription auto-matching error:', subErr);
      }
    }
  }

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
  });
});

// Simple Mobile Webhook Ingestion (For MacroDroid, Tasker, Apple Shortcuts, and Direct Webhooks)
apiRouter.post('/devices/webhook-ingest', (req: Request, res: Response) => {
  const token = (req.query.token as string) || req.header('X-Device-Token') || req.body?.token || req.body?.pairing_code || req.body?.pairing_token;

  // Extract raw content
  let rawContent: string = '';
  if (typeof req.body === 'string') {
    rawContent = req.body;
  } else if (req.body && typeof req.body === 'object') {
    rawContent =
      req.body.sms_message ||
      req.body.raw_content ||
      req.body.message ||
      req.body.sms_body ||
      req.body.text ||
      req.body.body ||
      req.body.content ||
      '';
  } else if ((req as any).rawBody) {
    rawContent = (req as any).rawBody;
  }

  // Regex fallback if rawContent starts with '{' or is inside rawBody (e.g. malformed JSON with unescaped newlines)
  if ((!rawContent || rawContent.trim().startsWith('{')) && (req as any).rawBody) {
    const raw = (req as any).rawBody as string;
    const msgMatch =
      raw.match(/"sms_message"\s*:\s*"([\s\S]*?)"\s*,\s*"/i) ||
      raw.match(/"sms_message"\s*:\s*"([\s\S]*?)"\s*}/i) ||
      raw.match(/"raw_content"\s*:\s*"([\s\S]*?)"\s*,\s*"/i);
    if (msgMatch) {
      rawContent = msgMatch[1];
    }
  }

  // Also check query params if not found in body
  if (!rawContent && typeof req.query.sms_message === 'string') rawContent = req.query.sms_message;
  if (!rawContent && typeof req.query.message === 'string') rawContent = req.query.message;
  if (!rawContent && typeof req.query.raw_content === 'string') rawContent = req.query.raw_content;
  if (!rawContent && typeof req.query.text === 'string') rawContent = req.query.text;

  // Extract sender
  let sender = 'Unknown';
  if (req.body && typeof req.body === 'object') {
    sender =
      req.body.sms_number ||
      req.body.sender ||
      req.body.from ||
      req.body.sms_name ||
      req.body.sender_identity ||
      'Unknown';
  }
  if (sender === 'Unknown' && (req as any).rawBody) {
    const numMatch = ((req as any).rawBody as string).match(/"sms_number"\s*:\s*"([^"]+)"/i);
    if (numMatch) sender = numMatch[1];
  }
  if (sender === 'Unknown' && typeof req.query.sms_number === 'string') sender = req.query.sms_number;
  if (sender === 'Unknown' && typeof req.query.sender === 'string') sender = req.query.sender;
  if (sender === 'Unknown' && typeof req.query.from === 'string') sender = req.query.from;
  const providerHint = (req.query.provider_hint as string) || req.body?.provider_hint;

  // Extract Battery & Device Telemetry (from MacroDroid Magic Text)
  let batteryLevel: number | null = null;
  const rawBat = req.body?.battery ?? req.query?.battery;
  if (rawBat !== undefined && rawBat !== null && rawBat !== '') {
    const parsedBat = parseInt(String(rawBat), 10);
    if (!isNaN(parsedBat)) batteryLevel = parsedBat;
  }
  if (batteryLevel === null && (req as any).rawBody) {
    const batMatch = ((req as any).rawBody as string).match(/"battery"\s*:\s*"?(\d+)"?/i);
    if (batMatch) batteryLevel = parseInt(batMatch[1], 10);
  }

  let deviceModel = (req.body?.device_model || req.query?.device_model || '') as string;
  if (!deviceModel && (req as any).rawBody) {
    const modelMatch = ((req as any).rawBody as string).match(/"device_model"\s*:\s*"([^"]+)"/i);
    if (modelMatch) deviceModel = modelMatch[1];
  }
  if (deviceModel === '{device_model}') deviceModel = '';

  let powerStatus = (req.body?.power || req.query?.power || '') as string;
  if (!powerStatus && (req as any).rawBody) {
    const pwrMatch = ((req as any).rawBody as string).match(/"power"\s*:\s*"([^"]+)"/i);
    if (pwrMatch) powerStatus = pwrMatch[1];
  }
  if (powerStatus === '{power}') powerStatus = '';

  let simName = (req.body?.sms_sim_name || req.query?.sms_sim_name || '') as string;
  if (!simName && (req as any).rawBody) {
    const simMatch = ((req as any).rawBody as string).match(/"sms_sim_name"\s*:\s*"([^"]+)"/i);
    if (simMatch) simName = simMatch[1];
  }
  if (simName === '{sms_sim_name}') simName = '';

  console.log(
    `[WebhookIngest] Received webhook: token=${token}, sender=${sender}, battery=${batteryLevel}%, model=${deviceModel}, length=${rawContent?.length}`
  );

  if (!token) {
    res.status(401).json({
      error: 'TOKEN_REQUIRED',
      message: 'Device pairing token or secret token is required (via ?token= or JSON body)',
    });
    return;
  }

  if (!rawContent || rawContent.trim() === '') {
    res.status(400).json({
      error: 'MISSING_CONTENT',
      message: 'raw_content or message string is required',
    });
    return;
  }

  const db = getDatabase();

  // 1. Resolve Device & Organization:
  let orgId: string | null = null;
  let deviceId: string | null = null;

  const pairTokenRow = db.prepare(`
    SELECT organization_id, device_identifier, expires_at, used_at
    FROM pairing_tokens WHERE token = ?
  `).get(token) as any;

  if (pairTokenRow) {
    orgId = pairTokenRow.organization_id;
    deviceId = pairTokenRow.device_identifier;
  } else {
    const devRow = db.prepare(`
      SELECT d.id, d.organization_id, d.status, c.revoked_at
      FROM devices d
      LEFT JOIN device_credentials c ON d.id = c.device_id
      WHERE d.id = ? OR c.hmac_secret = ?
    `).get(token, token) as any;

    if (devRow) {
      if (devRow.status === 'revoked' || devRow.revoked_at) {
        res.status(403).json({ error: 'REVOKED_DEVICE', message: 'Device credentials have been revoked.' });
        return;
      }
      orgId = devRow.organization_id;
      deviceId = devRow.id;
    }
  }

  if (!orgId || !deviceId) {
    res.status(401).json({
      error: 'INVALID_TOKEN',
      message: 'Device token or pairing code is invalid or expired. Check dashboard for active code.',
    });
    return;
  }

  // Update device status and battery / hardware telemetry
  try {
    const telemetryObj = {
      battery: batteryLevel,
      device_model: deviceModel || undefined,
      power: powerStatus || undefined,
      sim_name: simName || undefined,
      last_updated: new Date().toISOString(),
    };
    if (batteryLevel !== null) {
      db.prepare(`
        UPDATE devices 
        SET status = 'online', 
            last_seen_at = datetime('now'),
            battery_level = ?,
            last_telemetry_payload = ?
        WHERE id = ?
      `).run(batteryLevel, JSON.stringify(telemetryObj), deviceId);
    } else {
      db.prepare(`
        UPDATE devices 
        SET status = 'online', 
            last_seen_at = datetime('now'),
            last_telemetry_payload = ?
        WHERE id = ?
      `).run(JSON.stringify(telemetryObj), deviceId);
    }
  } catch (tErr) {
    console.error('Error updating device telemetry:', tErr);
  }

  // 2. Check subscription / trial status
  if (orgId !== 'org_platform_ops') {
    const sub = SubscriptionService.getOrganizationSubscription(orgId);
    if (sub.status === 'trial_expired' || sub.status === 'expired') {
      res.status(403).json({
        error: 'TRIAL_EXPIRED',
        message: 'انتهت فترة التجربة المجانية لمساحة العمل. يرجى الاشتراك للاستمرار.',
      });
      return;
    }
  }

  // 3. Save raw event
  const rawEventId = `raw_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const nonce = `wh_${Date.now()}_${Math.floor(Math.random() * 100000)}`;

  db.prepare(`
    INSERT INTO raw_events (id, organization_id, device_id, adapter_type, nonce, client_timestamp, raw_payload, processing_status)
    VALUES (?, ?, ?, 'macrodroid_webhook', ?, datetime('now'), ?, 'processing')
  `).run(rawEventId, orgId, deviceId, nonce, rawContent);

  // 4. Parse using Egyptian parser
  const parsed = parseEgyptianPaymentMessage(rawContent, providerHint);

  // Smart Filter: Filter out non-financial messages (Personal SMS, Promos, OTP codes, Outbound debits)
  if (!parsed.isFinancialTransaction) {
    db.prepare(`UPDATE raw_events SET processing_status = ? WHERE id = ?`).run('filtered_' + parsed.messageCategory, rawEventId);

    console.log(`[WebhookIngest:Filter] Non-financial SMS filtered out. Category=${parsed.messageCategory}, Reason=${parsed.ignoreReason}`);

    res.status(200).json({
      status: 'filtered',
      category: parsed.messageCategory,
      reason: parsed.ignoreReason || 'Non-financial message filtered out automatically',
      raw_event_id: rawEventId,
      message: 'تم استلام الرسالة وتصفيتها تلقائياً (ليست معاملة تحويل مالي واردة).',
    });
    return;
  }

  // 5. Reconcile
  const result = ReconciliationService.processInboundTransaction({
    organizationId: orgId,
    deviceId,
    rawEventId,
    adapterType: 'macrodroid_webhook',
    boundPaymentAddress: sender,
    parsed,
    financialEventAt: new Date().toISOString(),
    signature: 'webhook_token_verified',
  });

  // 6. Update Turnover Limits
  if (result.status === 'confirmed') {
    LimitEngine.recordTurnover(orgId, 'src_vf', parsed.amount);

    if (orgId === 'org_platform_ops') {
      try {
        SubscriptionService.handleInboundPlatformTransaction({
          id: result.transactionId,
          amount: parsed.amount,
          externalTrxId: parsed.externalTrxId,
          senderPhone: parsed.senderPhone,
          senderName: parsed.senderName,
        });
      } catch (subErr) {
        console.error('Subscription auto-matching error:', subErr);
      }
    }
  }

  res.status(200).json({
    status: 'accepted',
    raw_event_id: rawEventId,
    transaction_id: result.transactionId,
    reconciliation_status: result.status,
    amount: parsed.amount,
    provider: parsed.provider,
    is_duplicate: result.isDuplicate,
    message: result.isDuplicate ? 'Transaction already committed.' : 'Payment captured and processed successfully.',
  });
});

apiRouter.post('/devices/:id/revoke', requireAuth, requireRole(['owner', 'admin']), (req: AuthenticatedUserRequest, res: Response) => {
  const db = getDatabase();
  db.prepare(`UPDATE devices SET status = 'revoked' WHERE id = ? AND organization_id = ?`).run(req.params.id, req.user!.organizationId);
  db.prepare(`UPDATE device_credentials SET revoked_at = datetime('now') WHERE device_id = ?`).run(req.params.id);

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

apiRouter.post('/devices/:id/toggle', requireAuth, (req: AuthenticatedUserRequest, res: Response) => {
  const db = getDatabase();
  const current = db.prepare('SELECT status FROM devices WHERE id = ? AND organization_id = ?').get(req.params.id, req.user!.organizationId) as any;
  if (!current) {
    res.status(404).json({ error: 'NOT_FOUND' });
    return;
  }
  const nextStatus = current.status === 'online' ? 'offline' : 'online';
  db.prepare(`UPDATE devices SET status = ?, last_seen_at = datetime('now') WHERE id = ?`).run(nextStatus, req.params.id);
  res.json({ id: req.params.id, status: nextStatus });
});

// ==========================================
// 5. TRANSACTIONS & RECONCILIATION QUEUE
// ==========================================

apiRouter.get('/transactions', requireAuth, (req: AuthenticatedUserRequest, res: Response) => {
  const db = getDatabase();
  const { status, provider, search } = req.query;

  let query = `
    SELECT t.id, t.external_trx_id as trxId, t.amount, t.currency, t.provider,
           t.sender_name as senderName, t.sender_phone as senderPhone, t.status,
           t.reconciliation_state, t.provenance_confidence as confidenceScore,
           t.review_reason as reviewReason, t.stated_balance_after as balanceAfter,
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
apiRouter.get('/raw-events', requireAuth, (req: AuthenticatedUserRequest, res: Response) => {
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

// Export & Download Live SQLite Database File (.db) for local inspection in DB Browser
apiRouter.get('/system/download-db', requireAuth, requireRole(['owner', 'admin']), (req: AuthenticatedUserRequest, res: Response) => {
  const db = getDatabase();
  try {
    // Flush all pending WAL write-ahead logs into the main sqlite file
    db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  } catch (e) {
    console.error('WAL checkpoint error before download:', e);
  }

  const finalPath = process.env.DATABASE_FILE || path.join(process.cwd(), 'data', 'sarraf_ops.db');
  if (fs.existsSync(finalPath)) {
    const dateStr = new Date().toISOString().slice(0, 10);
    res.download(finalPath, `sarraf_ops_railway_${dateStr}.db`);
  } else {
    res.status(404).json({ error: 'DATABASE_NOT_FOUND', message: 'Database file not found on server.' });
  }
});

// Operator Manual Approval of Review Item
apiRouter.post('/transactions/:id/approve', requireAuth, requireRole(['owner', 'admin', 'manager']), (req: AuthenticatedUserRequest, res: Response) => {
  const db = getDatabase();
  const { id } = req.params;

  const trx = db.prepare('SELECT id, balance_account_id, amount, stated_balance_after FROM transactions WHERE id = ? AND organization_id = ?').get(id, req.user!.organizationId) as any;
  if (!trx) {
    res.status(404).json({ error: 'TRANSACTION_NOT_FOUND' });
    return;
  }

  db.exec('BEGIN IMMEDIATE;');
  try {
    db.prepare(`
      UPDATE transactions
      SET status = 'confirmed', reconciliation_state = 'consistent', review_reason = 'Approved manually by operator: ' || ?
      WHERE id = ?
    `).run(req.user!.fullName, id);

    db.prepare(`
      UPDATE balance_accounts
      SET current_balance = current_balance + ?, version = version + 1, updated_at = datetime('now')
      WHERE id = ?
    `).run(trx.amount, trx.balance_account_id);

    AuditService.record({
      organizationId: req.user!.organizationId,
      actorIdentity: req.user!.email,
      action: 'TRANSACTION_MANUALLY_APPROVED',
      resourceType: 'transaction',
      resourceId: id,
      originIp: req.ip,
      details: { amount: trx.amount, reviewer: req.user!.fullName },
    });

    db.exec('COMMIT;');
    res.json({ message: 'Transaction confirmed and balance ledger updated' });
  } catch (err: any) {
    db.exec('ROLLBACK;');
    res.status(500).json({ error: 'APPROVAL_FAILED', message: err.message });
  }
});

// Operator Manual Rejection
apiRouter.post('/transactions/:id/reject', requireAuth, requireRole(['owner', 'admin', 'manager']), (req: AuthenticatedUserRequest, res: Response) => {
  const db = getDatabase();
  const { id } = req.params;

  db.prepare(`
    UPDATE transactions
    SET status = 'failed', review_reason = 'Rejected as suspicious by operator: ' || ?
    WHERE id = ? AND organization_id = ?
  `).run(req.user!.fullName, id, req.user!.organizationId);

  AuditService.record({
    organizationId: req.user!.organizationId,
    actorIdentity: req.user!.email,
    action: 'TRANSACTION_REJECTED_AS_SUSPICIOUS',
    resourceType: 'transaction',
    resourceId: id,
    originIp: req.ip,
  });

  res.json({ message: 'Transaction flagged as rejected/failed' });
});

// ==========================================
// 6. AUDIT LOGS
// ==========================================

apiRouter.get('/audit', requireAuth, (req: AuthenticatedUserRequest, res: Response) => {
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
    SELECT * FROM subscription_orders
    WHERE organization_id = ?
    ORDER BY created_at DESC
  `).all(req.user!.organizationId);
  res.json(orders);
});

// Get Specific Subscription Order Details
apiRouter.get('/subscriptions/orders/:id', requireAuth, (req: AuthenticatedUserRequest, res: Response) => {
  const db = getDatabase();
  const order = db.prepare(`
    SELECT * FROM subscription_orders
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
    res.status(400).json({ error: 'CREATE_ORDER_FAILED', message: err.message });
  }
});

// Report Payment Execution (Submitting InstaPay transfer reference & sender info)
apiRouter.post('/subscriptions/orders/:id/report-payment', requireAuth, requireRole(['owner', 'admin']), (req: AuthenticatedUserRequest, res: Response) => {
  const { reportedTransferRef, reportedSenderInfo, reportedTransferTime, reportedNotes } = req.body;
  try {
    const result = SubscriptionService.reportPayment({
      orderId: req.params.id,
      organizationId: req.user!.organizationId,
      reportedTransferRef,
      reportedSenderInfo,
      reportedTransferTime,
      reportedNotes,
    });

    res.json({
      order: result.order,
      matched: result.matched,
      message: result.matched
        ? 'تمت مطابقة التحويل وتفعيل الاشتراك بنجاح!'
        : 'تم استلام بيانات التحويل، وجارٍ التحقق والمطابقة مع رسائل الاستقبال في حساب المنصة.',
    });
  } catch (err: any) {
    res.status(400).json({ error: 'REPORT_PAYMENT_FAILED', message: err.message });
  }
});

// View Subscription Receipt
apiRouter.get('/subscriptions/receipts/:id', requireAuth, (req: AuthenticatedUserRequest, res: Response) => {
  const db = getDatabase();
  const receipt = db.prepare(`
    SELECT r.*, p.name_ar as plan_name_ar, p.name_en as plan_name_en, o.name as org_name, o.name_ar as org_name_ar
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
    res.status(500).json({ error: 'UPDATE_FAILED', message: err.message });
  }
});

// ==========================================
// 8. PLATFORM OWNER DASHBOARD & SETTINGS
// ==========================================

// Platform Owner Overview & Stats
apiRouter.get('/platform/overview', requireAuth, requirePlatformOwner, (req: AuthenticatedUserRequest, res: Response) => {
  const db = getDatabase();

  const revenueRow = db.prepare("SELECT COALESCE(SUM(amount_paid), 0) as totalRevenue FROM subscription_receipts").get() as any;
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
  const cleanName = beneficiaryName ? String(beneficiaryName).trim() : 'عبدالرحمن عبده';

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

// Platform Plans Management (View & Edit)
apiRouter.get('/platform/plans', requireAuth, requirePlatformOwner, (req: AuthenticatedUserRequest, res: Response) => {
  const db = getDatabase();
  const plans = db.prepare('SELECT * FROM subscription_plans ORDER BY price_egp ASC').all();
  res.json(plans);
});

apiRouter.post('/platform/plans/:id', requireAuth, requirePlatformOwner, (req: AuthenticatedUserRequest, res: Response) => {
  const { nameEn, nameAr, priceEgp, deviceLimit, featuresJson, isActive } = req.body;
  const db = getDatabase();

  db.prepare(`
    UPDATE subscription_plans
    SET name_en = COALESCE(?, name_en),
        name_ar = COALESCE(?, name_ar),
        price_egp = COALESCE(?, price_egp),
        device_limit = COALESCE(?, device_limit),
        features_json = COALESCE(?, features_json),
        is_active = COALESCE(?, is_active),
        updated_at = datetime('now')
    WHERE id = ?
  `).run(
    nameEn || null,
    nameAr || null,
    priceEgp !== undefined ? Number(priceEgp) : null,
    deviceLimit !== undefined ? Number(deviceLimit) : null,
    featuresJson ? (typeof featuresJson === 'string' ? featuresJson : JSON.stringify(featuresJson)) : null,
    isActive !== undefined ? (isActive ? 1 : 0) : null,
    req.params.id
  );

  AuditService.record({
    organizationId: 'org_platform_ops',
    actorIdentity: req.user!.email,
    action: 'SUBSCRIPTION_PLAN_MODIFIED',
    resourceType: 'subscription_plan',
    resourceId: req.params.id,
    details: { priceEgp, deviceLimit, featuresJson },
  });

  res.json({ message: 'Plan updated successfully' });
});

// All Subscription Orders Across All Tenants
apiRouter.get('/platform/orders', requireAuth, requirePlatformOwner, (req: AuthenticatedUserRequest, res: Response) => {
  const db = getDatabase();
  const { status } = req.query;

  let query = `
    SELECT o.*, org.name as org_name, org.name_ar as org_name_ar, u.email as user_email, u.full_name as user_full_name
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
    res.status(400).json({ error: 'APPROVAL_FAILED', message: err.message });
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
    res.status(400).json({ error: 'REJECTION_FAILED', message: err.message });
  }
});

// All Active & Historical Organization Subscriptions
apiRouter.get('/platform/subscriptions', requireAuth, requirePlatformOwner, (req: AuthenticatedUserRequest, res: Response) => {
  const db = getDatabase();
  const subs = db.prepare(`
    SELECT s.*, org.name as org_name, org.name_ar as org_name_ar, p.name_ar as plan_name_ar, p.name_en as plan_name_en, p.price_egp
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
    SELECT t.*,
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
