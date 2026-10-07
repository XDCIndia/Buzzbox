import { getDb } from './db';
import { refreshXAccessToken } from './x-oauth';
import { logAudit } from './audit';

// Persistent storage for per-user X OAuth connections.
//
// SECURITY NOTE (at-rest encryption): Buzzbox has no secret-encryption
// convention — every other credential (X_BEARER_TOKEN / X_ACCESS_TOKEN env
// vars, session tokens in `sessions`, password hashes in `users`) is stored
// as-is with the SQLite file + process environment as the trust boundary.
// This module follows that same convention deliberately:
//   - tokens live in SQLite, readable only server-side (never returned by
//     any API route, never logged, never committed);
//   - inventing an ad-hoc AES wrapper here would add key-management,
//     rotation, and backup-loss risks without a reviewer-approved design.
// If at-rest encryption is later required, it should be introduced as a
// single project-wide secret-envelope mechanism, not per-integration.

export interface XConnection {
  id: number;
  user_id: number;
  x_user_id: string;
  x_username: string;
  x_name: string | null;
  access_token: string;
  refresh_token: string | null;
  scope: string | null;
  token_type: string | null;
  expires_at: number | null;
  created_at: string;
  updated_at: string;
}

/** Public (token-free) view returned to the browser. */
export interface XConnectionStatus {
  connected: boolean;
  x_user_id?: string;
  username?: string;
  name?: string | null;
  expires_at?: number | null;
  has_refresh_token?: boolean;
}

export const X_TOKEN_REFRESH_BUFFER_S = 60;

export function ensureXConnectionsTable(): void {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS x_connections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      x_user_id TEXT NOT NULL,
      x_username TEXT NOT NULL,
      x_name TEXT,
      access_token TEXT NOT NULL,
      refresh_token TEXT,
      scope TEXT,
      token_type TEXT,
      expires_at INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_x_connections_user ON x_connections(user_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_x_connections_x_user ON x_connections(x_user_id);
  `);
}

/** Error code for "this X account belongs to another Buzzbox user". */
export const X_ACCOUNT_TAKEN_CODE = 'X_ACCOUNT_TAKEN';

function xAccountTakenError(): Error & { code?: string } {
  const err = new Error('This X account is already connected to another Buzzbox user.') as Error & {
    code?: string;
  };
  err.code = X_ACCOUNT_TAKEN_CODE;
  return err;
}

export function upsertXConnection(
  userId: number,
  opts: {
    xUserId: string;
    username: string;
    name?: string | null;
    accessToken: string;
    refreshToken?: string | null;
    scope?: string | null;
    tokenType?: string | null;
    expiresIn?: number | null;
  },
): XConnection {
  ensureXConnectionsTable();
  const db = getDb();
  // One X account maps to at most one Buzzbox user. Without this pre-check
  // (plus the UNIQUE(x_user_id) index as a race backstop) a second user
  // connecting the same X account would either hit a raw SQLite error or,
  // worse, silently steal the connection.
  const owner = db
    .prepare('SELECT user_id AS userId FROM x_connections WHERE x_user_id = ?')
    .get(opts.xUserId) as { userId: number } | undefined;
  if (owner && owner.userId !== userId) throw xAccountTakenError();
  // X rotates refresh tokens on use: only overwrite the stored refresh
  // token when the provider actually returned a new one.
  const expiresAt =
    typeof opts.expiresIn === 'number' && Number.isFinite(opts.expiresIn)
      ? Math.floor(Date.now() / 1000) + opts.expiresIn
      : null;
  try {
    db.prepare(
      `INSERT INTO x_connections (user_id, x_user_id, x_username, x_name, access_token, refresh_token, scope, token_type, expires_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id) DO UPDATE SET
         x_user_id = excluded.x_user_id,
         x_username = excluded.x_username,
         x_name = excluded.x_name,
         access_token = excluded.access_token,
         refresh_token = COALESCE(excluded.refresh_token, x_connections.refresh_token),
         scope = excluded.scope,
         token_type = excluded.token_type,
         expires_at = excluded.expires_at,
         updated_at = CURRENT_TIMESTAMP`,
    ).run(
      userId,
      opts.xUserId,
      opts.username,
      opts.name ?? null,
      opts.accessToken,
      opts.refreshToken ?? null,
      opts.scope ?? null,
      opts.tokenType ?? null,
      expiresAt,
    );
  } catch (err) {
    // Concurrent connect of the same X account by two users: the UNIQUE
    // index decides, the loser gets the friendly message, never a raw
    // constraint dump.
    if ((err as { code?: string })?.code === 'SQLITE_CONSTRAINT_UNIQUE') throw xAccountTakenError();
    throw err;
  }
  const row = db.prepare('SELECT * FROM x_connections WHERE user_id = ?').get(userId) as XConnection;
  return row;
}

export function getXConnectionByUserId(userId: number): XConnection | null {
  ensureXConnectionsTable();
  const row = getDb().prepare('SELECT * FROM x_connections WHERE user_id = ?').get(userId) as
    | XConnection
    | undefined;
  return row ?? null;
}

export function deleteXConnectionByUserId(userId: number): void {
  ensureXConnectionsTable();
  getDb().prepare('DELETE FROM x_connections WHERE user_id = ?').run(userId);
}

export function toPublicStatus(row: XConnection | null): XConnectionStatus {
  if (!row) return { connected: false };
  return {
    connected: true,
    x_user_id: row.x_user_id,
    username: row.x_username,
    name: row.x_name,
    expires_at: row.expires_at,
    has_refresh_token: Boolean(row.refresh_token),
  };
}

function isExpired(row: XConnection, nowS = Math.floor(Date.now() / 1000)): boolean {
  if (row.expires_at == null) return false;
  return row.expires_at - X_TOKEN_REFRESH_BUFFER_S <= nowS;
}

/**
 * Returns a usable access token for a connection row, refreshing first when
 * the access token is expired (or within the refresh buffer) and a refresh
 * token exists. On revoked/invalid refresh (invalid_grant) ONLY this row's
 * connection is deleted so the UI falls back to "not connected" instead of
 * retrying a dead credential forever. Returns null when no usable token exists.
 *
 * Callers must only ever pass the acting user's OWN row here: refreshing or
 * deleting as a side effect of another user's request is a cross-user
 * isolation violation.
 */
export async function getValidAccessTokenForConnection(
  row: XConnection,
): Promise<{ accessToken: string; username: string; xUserId: string } | null> {
  if (!isExpired(row)) return { accessToken: row.access_token, username: row.x_username, xUserId: row.x_user_id };
  if (!row.refresh_token) return { accessToken: row.access_token, username: row.x_username, xUserId: row.x_user_id };
  try {
    const refreshed = await refreshXAccessToken({ refreshToken: row.refresh_token });
    ensureXConnectionsTable();
    const expiresAt = Number.isFinite(refreshed.expires_in)
      ? Math.floor(Date.now() / 1000) + refreshed.expires_in
      : row.expires_at;
    getDb()
      .prepare(
        `UPDATE x_connections SET access_token = ?, refresh_token = COALESCE(?, refresh_token),
         scope = COALESCE(?, scope), expires_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      )
      .run(refreshed.access_token, refreshed.refresh_token ?? null, refreshed.scope ?? null, expiresAt, row.id);
    return { accessToken: refreshed.access_token, username: row.x_username, xUserId: row.x_user_id };
  } catch (err) {
    // Revoked authorization or otherwise dead refresh token: drop the
    // connection so callers surface "reconnect" instead of 502s. Audit it
    // (identity only, never tokens) so a vanished connection is explainable.
    if ((err as Error & { code?: string }).code === 'invalid_grant') {
      ensureXConnectionsTable();
      getDb().prepare('DELETE FROM x_connections WHERE id = ?').run(row.id);
      const owner = getDb().prepare('SELECT username FROM users WHERE id = ?').get(row.user_id) as
        | { username?: string }
        | undefined;
      logAudit({
        actor: null,
        action: 'x.disconnect',
        target: `x:${row.x_user_id}`,
        detail: {
          x_username: row.x_username,
          buzzbox_user_id: row.user_id,
          buzzbox_username: owner?.username ?? null,
          reason: 'invalid_grant_cleanup',
        },
      });
      return null;
    }
    // Transient refresh failure (network, 5xx): hand out the stale token so
    // a short X outage doesn't hard-block posting; the X API call itself
    // will decide with a real 401.
    console.error('[x] Refresh attempt failed, using stored token:', (err as Error).message);
    return { accessToken: row.access_token, username: row.x_username, xUserId: row.x_user_id };
  }
}

/** Usable OAuth token for a specific Buzzbox user (null when not connected). */
export async function getValidXAccessTokenForUser(
  userId: number,
): Promise<{ accessToken: string; username: string; xUserId: string } | null> {
  const row = getXConnectionByUserId(userId);
  if (!row) return null;
  return getValidAccessTokenForConnection(row);
}

export interface XPostingCredential {
  accessToken: string;
  source: 'oauth' | 'env';
  username: string | null;
  xUserId: string | null;
}

/**
 * Credential resolution order for posting (strict per-user isolation):
 *   1. the given user's OWN connected X account,
 *   2. the explicitly shared/admin-configured legacy X_ACCESS_TOKEN env var,
 *   3. otherwise null (caller returns 412 "connect X").
 *
 * There is intentionally NO "any connected account" step: falling back to
 * another user's OAuth connection (e.g. ORDER BY updated_at DESC LIMIT 1)
 * lets one user silently post as another and lets one user's request
 * refresh/invalidate another user's connection. With userId == null (API-key
 * / job context with no actor) only the shared env sender may be used.
 */
export async function resolveXPostingCredential(
  userId?: number | null,
): Promise<XPostingCredential | null> {
  if (userId != null) {
    const mine = await getValidXAccessTokenForUser(userId);
    if (mine) {
      return { accessToken: mine.accessToken, source: 'oauth', username: mine.username, xUserId: mine.xUserId };
    }
  }
  const envToken = process.env.X_ACCESS_TOKEN?.trim();
  if (envToken) return { accessToken: envToken, source: 'env', username: null, xUserId: null };
  return null;
}
