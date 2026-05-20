#!/usr/bin/env tsx
import { drizzle } from 'drizzle-orm/postgres-js';
import { createPostgresClient } from '../src/services/db/connection';
import { phones, phoneRegionalDetails } from '../src/services/db/schema';

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set.');
    process.exit(1);
  }

  const client = createPostgresClient(url, { max: 1, prepare: false });
  const db = drizzle(client);

  try {
    console.log('[backfill-regional-us] fetching all phones...');
    const allPhones = await db
      .select({ id: phones.id, msrpUsd: phones.msrpUsd, slug: phones.slug })
      .from(phones);

    console.log(`[backfill-regional-us] found ${allPhones.length} phones. Starting backfill...`);

    let count = 0;
    for (const phone of allPhones) {
      if (!phone.msrpUsd) {
        continue;
      }

      await db
        .insert(phoneRegionalDetails)
        .values({
          phoneId: phone.id,
          countryCode: 'US',
          price: phone.msrpUsd,
          currency: 'USD',
          isAvailable: true,
          priceSource: 'catalog_pipeline',
          isEstimated: false,
        })
        .onConflictDoUpdate({
          target: [phoneRegionalDetails.phoneId, phoneRegionalDetails.countryCode],
          set: {
            price: phone.msrpUsd,
            currency: 'USD',
            isEstimated: false,
            updatedAt: new Date(),
          },
        });
      count++;
    }

    console.log(`[backfill-regional-us] successfully backfilled US pricing for ${count} phones.`);
  } catch (err) {
    console.error('[backfill-regional-us] FAILED');
    console.error(err);
    process.exitCode = 1;
  } finally {
    await client.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
