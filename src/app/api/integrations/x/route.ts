import { NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import {
  deleteXConnectionByUserId,
  getXConnectionByUserId,
  toPublicStatus,
} from '@/lib/x-connections';
import { X_OAUTH_SCOPES, isXOAuthConfigured } from '@/lib/x-oauth';

/**
 * GET /api/integrations/x — token-free connection status for the current
 * Buzzbox user. Never returns access/refresh tokens.
 */
export async function GET(request: Request) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });

  const row = user.id === 0 ? null : getXConnectionByUserId(user.id);
  return NextResponse.json({
    ...toPublicStatus(row),
    configured: isXOAuthConfigured(),
    scopes: [...X_OAUTH_SCOPES],
  });
}

/**
 * DELETE /api/integrations/x — disconnects the current user's X account
 * (drops the stored tokens). Editor role or above, mirroring content
 * approval permissions.
 */
export async function DELETE(request: Request) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  if (user.role !== 'admin' && user.role !== 'editor') {
    return NextResponse.json({ error: 'Editor access required' }, { status: 403 });
  }
  if (user.id !== 0) {
    // Capture identity before deletion for the audit trail (tokens never logged).
    const row = getXConnectionByUserId(user.id);
    deleteXConnectionByUserId(user.id);
    if (row) {
      logAudit({
        actor: user,
        action: 'x.disconnect',
        target: `x:${row.x_user_id}`,
        detail: { x_username: row.x_username, reason: 'user_disconnect' },
      });
    }
  }
  return NextResponse.json({ ok: true, connected: false });
}
