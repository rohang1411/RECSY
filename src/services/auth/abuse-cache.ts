import { sql } from 'drizzle-orm';
import type { AppQueryDb } from '@/services/db/client';

export interface AbuseBlockEntry {
  readonly kind: 'email_domain' | 'email_normalized' | 'ip_key' | 'device' | 'user';
  readonly value: string;
}

let cachedBlocks: Set<string> | null = null;
let cachedAt = 0;
let refreshInFlight: Promise<Set<string>> | null = null;

const CACHE_TTL_MS = 30_000; // 30 seconds

export function invalidateAbuseCache(): void {
  cachedBlocks = null;
  cachedAt = 0;
  refreshInFlight = null;
}

export function setAbuseCacheForTest(blocks: AbuseBlockEntry[]): void {
  cachedBlocks = new Set(blocks.map((b) => `${b.kind}:${b.value.toLowerCase().trim()}`));
  cachedAt = Date.now();
}

async function loadActiveBlocks(db: AppQueryDb): Promise<Set<string>> {
  try {
    const rows = await db.execute<{ kind: string; value: string }>(sql`
      SELECT kind, value
        FROM abuse_blocks
       WHERE expires_at IS NULL OR expires_at > now();
    `);
    const set = new Set<string>();
    for (const r of rows) {
      if (r.kind && r.value) {
        set.add(`${r.kind}:${r.value.toLowerCase().trim()}`);
      }
    }
    return set;
  } catch {
    // Fail-open: return existing cache if available, or empty set
    return cachedBlocks ?? new Set<string>();
  }
}

export async function getActiveAbuseBlocks(db?: AppQueryDb): Promise<Set<string>> {
  const now = Date.now();
  if (cachedBlocks && now - cachedAt < CACHE_TTL_MS) {
    return cachedBlocks;
  }

  if (!db) {
    return cachedBlocks ?? new Set<string>();
  }

  if (refreshInFlight) {
    return refreshInFlight;
  }

  refreshInFlight = loadActiveBlocks(db)
    .then((blocks) => {
      cachedBlocks = blocks;
      cachedAt = Date.now();
      return blocks;
    })
    .finally(() => {
      refreshInFlight = null;
    });

  return refreshInFlight;
}

export async function isSubjectBlocked(
  kind: 'email_domain' | 'email_normalized' | 'ip_key' | 'device' | 'user',
  value: string | null | undefined,
  db?: AppQueryDb,
): Promise<boolean> {
  if (!value) return false;
  const blocks = await getActiveAbuseBlocks(db);
  return blocks.has(`${kind}:${value.toLowerCase().trim()}`);
}
