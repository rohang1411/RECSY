import { eq } from 'drizzle-orm';
import type { AppQueryDb } from '@/services/db/client';
import { phones } from '@/services/db/schema';

export interface AskPhoneTarget {
  id: string;
  status: string;
  brand: string;
  model: string;
  lastIngestAt: Date | string | null;
  nextIngestAt: Date | string | null;
}

/**
 * Retrieves the target phone metadata for `/api/ask` by slug.
 * Safe to run in parallel with admission rate-limiting and before quota reservation.
 */
export async function getAskPhoneTarget(
  db: AppQueryDb,
  slug: string,
): Promise<AskPhoneTarget | null> {
  const [phone] = await db
    .select({
      id: phones.id,
      status: phones.status,
      brand: phones.brand,
      model: phones.model,
      lastIngestAt: phones.lastIngestAt,
      nextIngestAt: phones.nextIngestAt,
    })
    .from(phones)
    .where(eq(phones.slug, slug))
    .limit(1);

  return (phone as AskPhoneTarget | undefined) ?? null;
}
