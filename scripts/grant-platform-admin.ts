/**
 * Controlled deployment bootstrap for the platform-owner console.
 *
 * This is intentionally a manual operator action. It never creates a user,
 * ships a default email address, or runs as part of application startup.
 */
import { getDatabase } from '../server/db';

const email = process.env.PLATFORM_BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();

if (!email) {
  throw new Error('PLATFORM_BOOTSTRAP_ADMIN_EMAIL_REQUIRED');
}

const db = getDatabase();
const user = db.prepare(`
  SELECT id, is_active, email_verified, COALESCE(is_platform_admin, 0) AS is_platform_admin
  FROM users
  WHERE email = ?
`).get(email) as { id: string; is_active: number; email_verified: number; is_platform_admin: number } | undefined;

if (!user) {
  throw new Error('PLATFORM_BOOTSTRAP_ADMIN_USER_NOT_FOUND');
}

if (!user.is_active || !user.email_verified) {
  throw new Error('PLATFORM_BOOTSTRAP_ADMIN_REQUIRES_ACTIVE_VERIFIED_USER');
}

if (!user.is_platform_admin) {
  db.prepare('UPDATE users SET is_platform_admin = 1 WHERE id = ?').run(user.id);
}

console.info('Platform administrator grant completed.');
