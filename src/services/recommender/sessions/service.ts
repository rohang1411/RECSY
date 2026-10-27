/**
 * Recommendation session domain service.
 * Normative reference: Plan 27 Section 7, 8, 9, 17.3.
 */
import type { AppDb, AppQueryDb } from '@/services/db/client';
import type { SessionOwner } from './owner';
import {
  claimGuestSessionsInDb,
  formatDeviceMarker,
  getSessionDetailFromDb,
  listSessionsFromDb,
  resolveOrCreateSessionInDb,
  restoreSessionInDb,
  sanitizeSessionTitle,
  settleTurnInDb,
  softDeleteSessionInDb,
  updateSessionInDb,
} from './repository';
import type {
  ListSessionsOptions,
  ListSessionsResult,
  ResolveOrCreateSessionParams,
  ResolveOrCreateSessionResult,
  SessionDetail,
  SessionSummary,
  SettleTurnParams,
  SettleTurnResult,
  UpdateSessionPatch,
} from './types';

export { formatDeviceMarker, sanitizeSessionTitle };

export async function resolveOrCreateSession(
  db: AppDb,
  params: ResolveOrCreateSessionParams,
): Promise<ResolveOrCreateSessionResult | null> {
  return resolveOrCreateSessionInDb(db, params);
}

export async function settleTurn(
  tx: AppDb,
  params: SettleTurnParams,
): Promise<SettleTurnResult | null> {
  return settleTurnInDb(tx, params);
}

export async function listSessions(
  db: AppQueryDb,
  owner: SessionOwner,
  options: ListSessionsOptions = {},
): Promise<ListSessionsResult> {
  return listSessionsFromDb(db, owner, options);
}

export async function getSessionDetail(
  db: AppQueryDb,
  id: string,
  owner: SessionOwner,
  options?: { limit?: number; beforeTurnIndex?: number },
): Promise<SessionDetail | null> {
  return getSessionDetailFromDb(db, id, owner, options);
}

export async function updateSession(
  db: AppDb,
  id: string,
  owner: SessionOwner,
  patch: UpdateSessionPatch,
): Promise<{ session: SessionSummary | null; error?: string }> {
  return updateSessionInDb(db, id, owner, patch);
}

export async function softDeleteSession(
  db: AppDb,
  id: string,
  owner: SessionOwner,
): Promise<{ deleted: boolean }> {
  return softDeleteSessionInDb(db, id, owner);
}

export async function restoreSession(
  db: AppDb,
  id: string,
  owner: SessionOwner,
): Promise<{ restored: boolean }> {
  return restoreSessionInDb(db, id, owner);
}

export async function claimGuestSessions(
  db: AppDb,
  userId: string,
  deviceId: string,
  sessionIds?: string[],
): Promise<{ claimed: number }> {
  return claimGuestSessionsInDb(db, userId, deviceId, sessionIds);
}
