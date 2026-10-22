import disposableDomainsList from './disposable-domains.json';
import type { AppQueryDb } from '@/services/db/client';
import { sql } from 'drizzle-orm';

const DISPOSABLE_DOMAINS_SET = new Set(
  disposableDomainsList.map((d: string) => d.toLowerCase().trim()),
);

const KNOWN_PLUS_ADDRESSING_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'yahoo.com',
  'ymail.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'proton.me',
  'protonmail.com',
  'fastmail.com',
]);

/**
 * Normalizes an email address for identity matching and abuse defence:
 * - Trims and lowercases.
 * - Converts international domain names (IDN) to ASCII punycode.
 * - For Gmail/Googlemail: canonicalizes domain to gmail.com, strips dots in local-part, strips +tags.
 * - For other known plus-addressing providers: strips +tags.
 */
export function normalizeEmail(email: string): string {
  const trimmed = email.trim().toLowerCase();
  const atIndex = trimmed.lastIndexOf('@');
  if (atIndex <= 0 || atIndex === trimmed.length - 1) {
    return trimmed;
  }

  let local = trimmed.slice(0, atIndex);
  let domain = trimmed.slice(atIndex + 1);

  // Convert IDN domain to punycode
  try {
    domain = new URL(`http://${domain}`).hostname;
  } catch {
    // If invalid domain format, retain original lowercased string
  }

  // Canonicalize googlemail.com -> gmail.com
  if (domain === 'googlemail.com') {
    domain = 'gmail.com';
  }

  if (domain === 'gmail.com') {
    // Strip dots
    local = local.replace(/\./g, '');
    // Strip +tags
    const plusIndex = local.indexOf('+');
    if (plusIndex !== -1) {
      local = local.slice(0, plusIndex);
    }
  } else if (KNOWN_PLUS_ADDRESSING_DOMAINS.has(domain)) {
    // Strip +tags only
    const plusIndex = local.indexOf('+');
    if (plusIndex !== -1) {
      local = local.slice(0, plusIndex);
    }
  }

  return `${local}@${domain}`;
}

/**
 * Checks whether an email domain is in the disposable domains blocklist
 * or in the database `abuse_blocks` table.
 */
export async function isDisposableEmail(
  email: string,
  options?: { db?: AppQueryDb },
): Promise<boolean> {
  const normalized = normalizeEmail(email);
  const atIndex = normalized.lastIndexOf('@');
  if (atIndex === -1) return true;

  const domain = normalized.slice(atIndex + 1);

  // 1. In-memory static check
  if (DISPOSABLE_DOMAINS_SET.has(domain)) {
    return true;
  }

  // 2. Check database abuse_blocks if DB client is provided
  if (options?.db) {
    try {
      const rows = await options.db.execute<{ count: number }>(sql`
        SELECT count(*)::int AS count
          FROM abuse_blocks
         WHERE (kind = 'email_domain' AND value = ${domain})
            OR (kind = 'email_normalized' AND value = ${normalized})
           AND (expires_at IS NULL OR expires_at > now());
      `);
      if ((rows[0]?.count ?? 0) > 0) {
        return true;
      }
    } catch {
      // Fail-open for transient DB lookup errors on sign-in validation
    }
  }

  return false;
}
