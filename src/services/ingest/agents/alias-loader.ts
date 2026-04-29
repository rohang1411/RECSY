/**
 * DB-backed `AliasLoader` + `PhoneLookupBySlug` implementations that plug
 * into the orchestrator. Kept separate so tests can import the agent without
 * pulling Drizzle into the unit-test graph.
 */
import { eq } from 'drizzle-orm';

import { summarizeErrorChainForLogs } from '@/lib/summarize-error';
import { hasMissingDbObjectError } from '@/services/db/schema-guard';
import { phoneAliases, phones } from '@/services/db/schema';
import { logger } from '@/services/logger';

import type { AliasRow } from './alias-match';
import type { PhoneDirectoryEntry, PhoneLookupBySlug } from '../orchestrator';
import type { Db } from '../writer';

const log = logger.child({ component: 'ingest.alias-loader' });

export function makeDbAliasLoader(db: Db): () => Promise<readonly AliasRow[]> {
  return async () => {
    try {
      const rows = await db
        .select({
          phoneId: phoneAliases.phoneId,
          slug: phones.slug,
          alias: phoneAliases.alias,
          priority: phoneAliases.priority,
        })
        .from(phoneAliases)
        .innerJoin(phones, eq(phones.id, phoneAliases.phoneId));
      return rows satisfies readonly AliasRow[];
    } catch (err) {
      if (hasMissingDbObjectError(err)) {
        log.warn(
          { err: summarizeErrorChainForLogs(err) },
          'phone_aliases unavailable; continuing with an empty alias set',
        );
        return [];
      }
      throw err;
    }
  };
}

export function makeDbPhoneLookup(db: Db): PhoneLookupBySlug {
  return async (slug: string): Promise<PhoneDirectoryEntry | null> => {
    const rows = await db
      .select({
        id: phones.id,
        slug: phones.slug,
        brand: phones.brand,
        model: phones.model,
      })
      .from(phones)
      .where(eq(phones.slug, slug))
      .limit(1);
    return rows[0] ?? null;
  };
}
