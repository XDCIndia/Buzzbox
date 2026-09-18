import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import { getDb } from './db';
import { secureCompare } from './secure-compare';

const SALT_LENGTH = 16;
const KEY_LENGTH = 32;
const SCRYPT_COST = 16384;
const SESSION_DURATION = 7 * 24 * 60 * 60; // 7 days

export interface User {
  id: number;
  username: string;
  role: string;
  created_at: string;
  email?: string | null;
  auth_provider?: string | null;
}

export interface UserRecord extends User {
  password_hash: string;
}

export type UserRole = 'admin' | 'editor' | 'viewer';
export type AuthProvider = 'local' | 'google';
export type LoginRequestStatus = 'pending' | 'approved' | 'denied';

export interface GoogleLoginRequest {
  id: number;
  email: string;
  google_sub?: string | null;
  status: LoginRequestStatus;
  requested_role: UserRole;
  attempts: number;
  last_error?: string | null;
  last_attempt_at: string;
  created_at: string;
  updated_at: string;
  reviewed_at?: string | null;
}

type UserRoleInput = UserRole | 'operator';

function normalizeRole(value: string): UserRole {
  if (value === 'operator') return 'editor';
  if (value === 'admin' || value === 'editor' || value === 'viewer') return value;
  return 'viewer';
}

function normalizeRoleInput(value: UserRoleInput): UserRole {
  return normalizeRole(value);
}

function normalizeRoleValue(value: unknown, fallback: UserRole = 'viewer'): UserRole {
  if (typeof value !== 'string') return fallback;
  return normalizeRole(value);
}

function requireEnv(name: 'AUTH_USER' | 'AUTH_PASS'): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} must be set`);
  }
  return value;
}

export function getConfiguredApiKey(): string | null {
  const value = process.env.API_KEY?.trim();
  return value ? value : null;
}

function hashPassword(password: string): string {
  const salt = randomBytes(SALT_LENGTH).toString('hex');
  const hash = scryptSync(password, salt, KEY_LENGTH, { N: SCRYPT_COST }).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const derived = scryptSync(password, salt, KEY_LENGTH, { N: SCRYPT_COST });
  const storedBuf = Buffer.from(hash, 'hex');
  if (derived.length !== storedBuf.length) return false;
  return timingSafeEqual(derived, storedBuf);
}

export function ensureAuthTables(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT UNIQUE NOT NULL,
      user_id INTEGER REFERENCES users(id),
      expires_at INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
    CREATE TABLE IF NOT EXISTS google_login_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      google_sub TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      requested_role TEXT NOT NULL DEFAULT 'viewer',
      attempts INTEGER NOT NULL DEFAULT 1,
      last_error TEXT,
      last_attempt_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      reviewed_at DATETIME
    );
    CREATE INDEX IF NOT EXISTS idx_google_login_requests_status ON google_login_requests(status);
  `);

  // Safe column migrations for auth-provider support.
  try {
    db.exec("ALTER TABLE users ADD COLUMN email TEXT");
  } catch { /* column exists */ }
  try {
    db.exec("ALTER TABLE users ADD COLUMN auth_provider TEXT NOT NULL DEFAULT 'local'");
  } catch { /* column exists */ }
  try {
    db.exec("ALTER TABLE users ADD COLUMN google_sub TEXT");
  } catch { /* column exists */ }
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub ON users(google_sub)');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email)');
  db.exec("UPDATE users SET role = 'editor' WHERE role = 'operator'");
  db.exec("UPDATE google_login_requests SET requested_role = 'editor' WHERE requested_role = 'operator'");
}

export function seedAdmin(): void {
  const db = getDb();
  ensureAuthTables();

  const username = requireEnv('AUTH_USER').toLowerCase();
  const password = requireEnv('AUTH_PASS');
  if (username.length < 3) {
    throw new Error('AUTH_USER must be at least 3 characters');
  }
  if (password.length < 10) {
    throw new Error('AUTH_PASS must be at least 10 characters');
  }

  const existingAdmin = db.prepare('SELECT id FROM users WHERE username = ?').get(username) as { id: number } | undefined;
  if (!existingAdmin) {
    db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run(
      username,
      hashPassword(password),
      'admin',
    );
  } else if (!verifyPassword(password, (db.prepare('SELECT password_hash FROM users WHERE username = ?').get(username) as { password_hash: string }).password_hash)) {
    // Keep password in sync with .env.local if it has changed
    db.prepare('UPDATE users SET password_hash = ? WHERE username = ?').run(
      hashPassword(password),
      username,
    );
  }
}

export function authenticate(username: string, password: string): User | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username.trim().toLowerCase()) as UserRecord | undefined;
  if (!row || !verifyPassword(password, row.password_hash)) return null;
  return {
    id: row.id,
    username: row.username,
    role: normalizeRole(row.role),
    created_at: row.created_at,
    email: (row as UserRecord & { email?: string | null }).email ?? null,
    auth_provider: (row as UserRecord & { auth_provider?: string | null }).auth_provider ?? 'local',
  };
}

export function createSession(userId: number): string {
  const db = getDb();
  const token = randomBytes(32).toString('hex');
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_DURATION;
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expiresAt);
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Math.floor(Date.now() / 1000));
  return token;
}

export function validateSession(token: string): User | null {
  if (!token) return null;
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const row = db
    .prepare(
      `SELECT u.id, u.username, u.role, u.created_at, u.email, u.auth_provider
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > ?`,
    )
    .get(token, now) as User | undefined;
  if (!row) return null;
  return { ...row, role: normalizeRole(row.role) };
}

export function destroySession(token: string): void {
  getDb().prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

export function listUsers(): User[] {
  ensureAuthTables();
  const db = getDb();
  const rows = db
    .prepare('SELECT id, username, role, created_at, email, auth_provider FROM users ORDER BY id ASC')
    .all() as User[];
  return rows.map((row) => ({ ...row, role: normalizeRole(row.role) }));
}

export function createUser(username: string, password: string, role: UserRoleInput = 'editor'): User {
  ensureAuthTables();
  const db = getDb();
  const normalized = username.trim().toLowerCase();
  if (!normalized || normalized.length < 3) {
    throw new Error('Username must be at least 3 characters');
  }
  if (!password || password.length < 10) {
    throw new Error('Password must be at least 10 characters');
  }
  if (!['admin', 'editor', 'viewer', 'operator'].includes(role)) {
    throw new Error('Invalid role');
  }
  const normalizedRole = normalizeRoleInput(role);
  db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run(
    normalized,
    hashPassword(password),
    normalizedRole,
  );
  const row = db
    .prepare('SELECT id, username, role, created_at, email, auth_provider FROM users WHERE username = ?')
    .get(normalized) as User;
  return { ...row, role: normalizeRole(row.role) };
}

function parseAllowedList(value: string | undefined): string[] {
  return (value || '')
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
}

function ensureGoogleAllowed(email: string): void {
  const normalizedEmail = email.trim().toLowerCase();
  const db = getDb();
  const dbRule = db
    .prepare('SELECT status FROM google_login_requests WHERE email = ?')
    .get(normalizedEmail) as { status?: string } | undefined;
  if (dbRule?.status === 'approved') return;
  if (dbRule?.status === 'denied') {
    throw new Error('Google account access denied by admin');
  }
  if (dbRule?.status === 'pending') {
    throw new Error('Access request pending admin approval');
  }

  const allowedEmails = parseAllowedList(process.env.GOOGLE_AUTH_ALLOWED_EMAILS);
  const allowedDomains = parseAllowedList(process.env.GOOGLE_AUTH_ALLOWED_DOMAINS);

  if (allowedEmails.length === 0 && allowedDomains.length === 0) return;

  if (allowedEmails.includes(normalizedEmail)) return;

  const at = normalizedEmail.lastIndexOf('@');
  const domain = at >= 0 ? normalizedEmail.slice(at + 1) : '';
  if (domain && allowedDomains.includes(domain)) return;

  throw new Error('Google account is not allowed; request pending admin approval');
}

function getGoogleDefaultRole(): UserRole {
  const raw = (process.env.GOOGLE_AUTH_DEFAULT_ROLE || 'viewer').trim().toLowerCase();
  return normalizeRole(raw);
}

function getApprovedRequestedRole(email: string): UserRole | null {
  const db = getDb();
  const row = db
    .prepare('SELECT requested_role FROM google_login_requests WHERE email = ? AND status = ?')
    .get(email, 'approved') as { requested_role?: string } | undefined;
  if (!row) return null;
  return normalizeRoleValue(row.requested_role, getGoogleDefaultRole());
}

function makeUsernameFromEmail(email: string): string {
  const base = email
    .split('@')[0]
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '')
    .slice(0, 24);
  return base.length >= 3 ? base : `user${Math.floor(Math.random() * 9000 + 1000)}`;
}

function uniqueUsername(base: string): string {
  const db = getDb();
  const normalizedBase = base.trim().toLowerCase();
  let candidate = normalizedBase;
  let n = 1;
  while (db.prepare('SELECT 1 FROM users WHERE username = ?').get(candidate)) {
    n += 1;
    candidate = `${normalizedBase}${n}`;
  }
  return candidate;
}

export function upsertGoogleUser(googleSub: string, email: string): User {
  ensureAuthTables();
  if (!googleSub?.trim()) throw new Error('Missing Google subject');
  if (!email?.trim()) throw new Error('Missing Google email');

  const normalizedEmail = email.trim().toLowerCase();
  ensureGoogleAllowed(normalizedEmail);
  const db = getDb();

  // Prefer existing link by Google subject.
  const bySub = db
    .prepare('SELECT id, username, role, created_at, email, auth_provider FROM users WHERE google_sub = ?')
    .get(googleSub) as User | undefined;
  if (bySub) return { ...bySub, role: normalizeRole(bySub.role) };

  // Link existing account by email if present.
  const byEmail = db
    .prepare('SELECT id, username, role, created_at, email, auth_provider FROM users WHERE email = ?')
    .get(normalizedEmail) as User | undefined;
  if (byEmail) {
    db.prepare("UPDATE users SET google_sub = ?, auth_provider = 'google' WHERE id = ?").run(googleSub, byEmail.id);
    const row = db
      .prepare('SELECT id, username, role, created_at, email, auth_provider FROM users WHERE id = ?')
      .get(byEmail.id) as User;
    return { ...row, role: normalizeRole(row.role) };
  }

  const role = getApprovedRequestedRole(normalizedEmail) ?? getGoogleDefaultRole();
  const username = uniqueUsername(makeUsernameFromEmail(normalizedEmail));
  // Keep password_hash populated even for OAuth users to satisfy schema constraints.
  const pseudoPassword = randomBytes(24).toString('hex');
  db.prepare(
    "INSERT INTO users (username, password_hash, role, email, auth_provider, google_sub) VALUES (?, ?, ?, ?, 'google', ?)",
  ).run(username, hashPassword(pseudoPassword), role, normalizedEmail, googleSub);

  const row = db
    .prepare('SELECT id, username, role, created_at, email, auth_provider FROM users WHERE username = ?')
    .get(username) as User;
  return { ...row, role: normalizeRole(row.role) };
}

export function recordGoogleLoginAttempt(email: string, googleSub: string | null, reason: string): void {
  ensureAuthTables();
  const db = getDb();
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) return;

  db.prepare(
    `INSERT INTO google_login_requests
      (email, google_sub, status, requested_role, attempts, last_error, last_attempt_at, created_at, updated_at)
     VALUES (?, ?, 'pending', ?, 1, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT(email) DO UPDATE SET
      google_sub = COALESCE(excluded.google_sub, google_login_requests.google_sub),
      attempts = google_login_requests.attempts + 1,
      last_error = excluded.last_error,
      last_attempt_at = CURRENT_TIMESTAMP,
      status = CASE
        WHEN google_login_requests.status = 'approved' THEN 'approved'
        WHEN google_login_requests.status = 'denied' THEN 'denied'
        ELSE 'pending'
      END,
      updated_at = CURRENT_TIMESTAMP`,
  ).run(normalizedEmail, googleSub, getGoogleDefaultRole(), reason);
}

export function listGoogleLoginRequests(): GoogleLoginRequest[] {
  ensureAuthTables();
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, email, google_sub, status, requested_role, attempts, last_error, last_attempt_at, created_at, updated_at, reviewed_at
       FROM google_login_requests
       ORDER BY
         CASE status WHEN 'pending' THEN 0 WHEN 'denied' THEN 1 ELSE 2 END,
         last_attempt_at DESC`,
    )
    .all() as GoogleLoginRequest[];
  return rows.map((row) => ({
    ...row,
    status: (row.status === 'approved' || row.status === 'denied' || row.status === 'pending') ? row.status : 'pending',
    requested_role: normalizeRoleValue(row.requested_role),
  }));
}

export function reviewGoogleLoginRequest(email: string, action: 'approve' | 'deny', role: UserRole = 'viewer'): void {
  ensureAuthTables();
  const db = getDb();
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) throw new Error('Email is required');

  if (action === 'approve') {
    const approvedRole = normalizeRoleValue(role, 'viewer');
    db.transaction(() => {
      db.prepare(
        `INSERT INTO google_login_requests
          (email, status, requested_role, attempts, last_error, last_attempt_at, created_at, updated_at, reviewed_at)
         VALUES (?, 'approved', ?, 0, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT(email) DO UPDATE SET
          status = 'approved',
          requested_role = excluded.requested_role,
          attempts = 0,
          last_error = NULL,
          updated_at = CURRENT_TIMESTAMP,
          reviewed_at = CURRENT_TIMESTAMP`,
      ).run(normalizedEmail, approvedRole);
      db.prepare('UPDATE users SET role = ? WHERE email = ?').run(approvedRole, normalizedEmail);
    })();
    return;
  }

  db.prepare(
    `INSERT INTO google_login_requests
      (email, status, requested_role, attempts, last_error, last_attempt_at, created_at, updated_at, reviewed_at)
     VALUES (?, 'denied', ?, 0, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT(email) DO UPDATE SET
      status = 'denied',
      attempts = 0,
      last_error = NULL,
      updated_at = CURRENT_TIMESTAMP,
      reviewed_at = CURRENT_TIMESTAMP`,
  ).run(normalizedEmail, normalizeRoleValue(role, 'viewer'));
}

export function updateUserRole(userId: number, role: UserRoleInput): void {
  if (!['admin', 'editor', 'viewer', 'operator'].includes(role)) {
    throw new Error('Invalid role');
  }
  const normalizedRole = normalizeRoleInput(role);
  const db = getDb();
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(normalizedRole, userId);
}

export function resetUserPassword(userId: number, password: string): void {
  if (!password || password.length < 10) {
    throw new Error('Password must be at least 10 characters');
  }
  const db = getDb();
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), userId);
}

export function deleteUser(userId: number): void {
  const db = getDb();
  db.transaction(() => {
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  })();
}

export function getUserFromRequest(request: Request): User | null {
  const cookie = request.headers.get('cookie') || '';
  const match = cookie.match(/(?:^|;\s*)hermes-session=([^;]*)/);
  const token = match ? decodeURIComponent(match[1]) : null;
  if (token) {
    const user = validateSession(token);
    if (user) return user;
  }

  const apiKey = request.headers.get('x-api-key');
  const configuredApiKey = getConfiguredApiKey();
  if (apiKey && configuredApiKey && secureCompare(apiKey, configuredApiKey)) {
    return { id: 0, username: 'api', role: 'admin', created_at: '' };
  }

  return null;
}

export function requireUser(request: Request): User {
  const user = getUserFromRequest(request);
  if (!user) {
    throw new Error('unauthorized');
  }
  return user;
}

export function requireAdmin(request: Request): User {
  const user = requireUser(request);
  if (user.role !== 'admin') {
    throw new Error('forbidden');
  }
  return user;
}
