#!/usr/bin/env tsx
import { drizzle } from 'drizzle-orm/postgres-js';
import { createPostgresClient } from '../src/services/db/connection';
import { phones, phoneRegionalDetails } from '../src/services/db/schema';

const DEFAULT_USD_INR_RATE = 83.5;

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set.');
    process.exit(1);
  }

  const client = createPostgresClient(url, { max: 1, prepare: false });
  const db = drizzle(client);

  try {
    console.log('[seed-regional-india] fetching all phones...');
    const allPhones = await db
      .select({ id: phones.id, msrpUsd: phones.msrpUsd, slug: phones.slug })
      .from(phones);

    console.log(
      `[seed-regional-india] found ${allPhones.length} phones. Seeding estimates for India...`,
    );

    let count = 0;
    for (const phone of allPhones) {
      if (!phone.msrpUsd) {
        continue;
      }

      const usdPrice = Number.parseFloat(phone.msrpUsd);
      if (Number.isNaN(usdPrice)) {
        continue;
      }

      // Compute estimated price
      const inrPrice = Math.round(usdPrice * DEFAULT_USD_INR_RATE);

      await db
        .insert(phoneRegionalDetails)
        .values({
          phoneId: phone.id,
          countryCode: 'IN',
          price: String(inrPrice),
          currency: 'INR',
          isAvailable: true,
          priceSource: 'estimated',
          isEstimated: true,
          exchangeRateUsed: String(DEFAULT_USD_INR_RATE),
        })
        .onConflictDoUpdate({
          target: [phoneRegionalDetails.phoneId, phoneRegionalDetails.countryCode],
          set: {
            price: String(inrPrice),
            currency: 'INR',
            isEstimated: true,
            exchangeRateUsed: String(DEFAULT_USD_INR_RATE),
            updatedAt: new Date(),
          },
        });
      count++;
    }

    console.log(
      `[seed-regional-india] successfully seeded/updated estimated IN pricing for ${count} phones.`,
    );
  } catch (err) {
    console.error('[seed-regional-india] FAILED');
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
