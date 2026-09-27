import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { createPostgresClient } from '../src/services/db/connection';
import { phones, phoneRegionalDetails } from '../src/services/db/schema';

const DEFAULT_USD_INR_RATE = 83.5;

const PHONE_MSRP_MAP: Record<string, string> = {
  // Apple
  'apple-iphone-16-pro-max': '1199.00',
  'apple-iphone-16-pro': '999.00',
  'apple-iphone-16-plus': '899.00',
  'apple-iphone-16': '799.00',
  'apple-iphone-17-pro-max': '1199.00',
  'apple-iphone-17e': '599.00',
  'apple-iphone-18-pro': '999.00',
  'apple-iphone-18-pro-max': '1199.00',
  'apple-iphone-air': '899.00',
  'apple-iphone-duo': '1299.00',

  // Samsung Flagships & Foldables
  'samsung-galaxy-s25-ultra': '1299.00',
  'samsung-galaxy-s25-plus': '999.00',
  'samsung-galaxy-s25': '799.00',
  'samsung-galaxy-s26-ultra': '1299.00',
  'samsung-galaxy-s26-plus': '999.00',
  'samsung-galaxy-s26': '799.00',
  'samsung-galaxy-z-fold-6': '1899.00',
  'samsung-galaxy-z-fold-7': '1899.00',
  'samsung-galaxy-z-fold-8': '1899.00',
  'samsung-galaxy-z-flip-7-fe': '699.00',

  // Samsung Mid & Budget A/M/F Series
  'samsung-galaxy-a55-5g': '449.00',
  'samsung-galaxy-a56-5g': '449.00',
  'samsung-galaxy-a35-5g': '399.00',
  'samsung-galaxy-a36-5g': '399.00',
  'samsung-galaxy-a16': '199.00',
  'samsung-galaxy-f15-5g': '179.00',
  'samsung-galaxy-m15-5g': '169.00',
  'samsung-galaxy-m16-5g': '189.00',
  'samsung-galaxy-m35-5g': '249.00',
  'samsung-galaxy-m36-5g': '269.00',

  // Google
  'google-pixel-9-pro-xl': '1099.00',
  'google-pixel-9-pro': '999.00',
  'google-pixel-9': '799.00',
  'google-pixel-9a': '499.00',

  // OnePlus
  'oneplus-13': '899.00',
  'oneplus-nord-4': '499.00',

  // Xiaomi
  'xiaomi-14-ultra': '1499.00',
  'xiaomi-redmi-note-14-pro-plus': '329.00',

  // Nothing
  'nothing-phone-2a-plus': '449.00',
  'nothing-phone-3a-pro': '459.00',

  // Motorola
  'motorola-edge-50-fusion': '299.00',
};

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set.');
    process.exit(1);
  }

  const client = createPostgresClient(url, { max: 1, prepare: false });
  const db = drizzle(client);

  try {
    const allPhones = await db
      .select({
        id: phones.id,
        slug: phones.slug,
        msrpUsd: phones.msrpUsd,
        brand: phones.brand,
        model: phones.model,
      })
      .from(phones);

    console.log(`[backfill-prices] Checking ${allPhones.length} phones...`);

    let updatedCount = 0;
    for (const phone of allPhones) {
      let targetPrice = phone.msrpUsd;

      // If price is missing or mapped in our canonical map, apply it
      if (!targetPrice || PHONE_MSRP_MAP[phone.slug]) {
        targetPrice = PHONE_MSRP_MAP[phone.slug] ?? targetPrice;
      }

      if (!targetPrice) {
        console.warn(`[WARN] No price mapped for phone slug: ${phone.slug}`);
        continue;
      }

      // 1. Update phones.msrp_usd
      await db
        .update(phones)
        .set({
          msrpUsd: targetPrice,
          status: 'active',
        })
        .where(eq(phones.id, phone.id));

      const priceNum = Number.parseFloat(targetPrice);
      const inrPrice = Math.round(priceNum * DEFAULT_USD_INR_RATE);

      // 2. Upsert US regional price
      await db
        .insert(phoneRegionalDetails)
        .values({
          phoneId: phone.id,
          countryCode: 'US',
          price: targetPrice,
          currency: 'USD',
          isAvailable: true,
          priceSource: 'catalog_pipeline',
          isEstimated: false,
        })
        .onConflictDoUpdate({
          target: [phoneRegionalDetails.phoneId, phoneRegionalDetails.countryCode],
          set: {
            price: targetPrice,
            currency: 'USD',
            isAvailable: true,
            isEstimated: false,
            updatedAt: new Date(),
          },
        });

      // 3. Upsert IN regional price
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
            isAvailable: true,
            isEstimated: true,
            exchangeRateUsed: String(DEFAULT_USD_INR_RATE),
            updatedAt: new Date(),
          },
        });

      updatedCount++;
    }

    console.log(
      `[backfill-prices] Successfully updated prices and regional details for ${updatedCount} phones.`,
    );
  } catch (err) {
    console.error('Error during price backfill:', err);
    process.exit(1);
  } finally {
    await client.end({ timeout: 5 });
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
