/**
 * Keyset cursor encoding and decoding for recommendation sessions.
 * Encodes `last_turn_at.toISOString() + '|' + id` as an opaque Base64URL string.
 * Normative reference: Plan 27 Section 9.2.
 */

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface DecodedSessionCursor {
  lastTurnAt: Date;
  id: string;
}

export function encodeSessionCursor(lastTurnAt: Date, id: string): string {
  const raw = `${lastTurnAt.toISOString()}|${id}`;
  return Buffer.from(raw, 'utf8').toString('base64url');
}

export function decodeSessionCursor(
  cursor: string | null | undefined,
): DecodedSessionCursor | null {
  if (!cursor || typeof cursor !== 'string') return null;
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const delimiterIndex = raw.indexOf('|');
    if (delimiterIndex === -1) return null;

    const dateStr = raw.slice(0, delimiterIndex);
    const id = raw.slice(delimiterIndex + 1);

    const lastTurnAt = new Date(dateStr);
    if (Number.isNaN(lastTurnAt.getTime())) return null;
    if (!UUID_REGEX.test(id)) return null;

    return { lastTurnAt, id };
  } catch {
    return null;
  }
}
