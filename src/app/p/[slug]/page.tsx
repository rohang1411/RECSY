import { eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';

import { PhoneHeader } from '@/components/phone/PhoneHeader';
import { getDb } from '@/services/db/client';
import { phones } from '@/services/db/schema';

import { PhoneChat } from './phone-chat';

export const dynamic = 'force-dynamic';

interface PageProps {
  readonly params: Promise<{ slug: string }>;
}

export default async function PhonePage({ params }: PageProps) {
  const { slug } = await params;
  const db = getDb();
  const [phone] = await db
    .select({
      slug: phones.slug,
      brand: phones.brand,
      model: phones.model,
      tagline: phones.tagline,
      status: phones.status,
    })
    .from(phones)
    .where(eq(phones.slug, slug))
    .limit(1);

  if (!phone || phone.status !== 'active') {
    notFound();
  }

  return (
    <div className="pb-16">
      <PhoneHeader brand={phone.brand} model={phone.model} tagline={phone.tagline} />
      <PhoneChat phoneSlug={phone.slug} />
    </div>
  );
}
