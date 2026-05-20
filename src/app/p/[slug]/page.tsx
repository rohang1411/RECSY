import { and, eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';

import { PhoneSpecSchema } from '@/features/phones/schema';
import { PhoneHeader } from '@/components/phone/PhoneHeader';
import { PhoneSpecSummary } from '@/components/phone/PhoneSpecSummary';
import { ScorecardSection } from '@/components/phone/ScorecardSection';
import { getActiveRegion } from '@/lib/get-active-region';
import { getDb } from '@/services/db/client';
import { phones, phoneRegionalDetails } from '@/services/db/schema';

import { PhoneChat } from './phone-chat';

export const dynamic = 'force-dynamic';

interface PageProps {
  readonly params: Promise<{ slug: string }>;
}

export default async function PhonePage({ params }: PageProps) {
  const { slug } = await params;
  const activeRegion = await getActiveRegion();

  const db = getDb();
  const [phone] = await db
    .select({
      id: phones.id,
      slug: phones.slug,
      brand: phones.brand,
      model: phones.model,
      tagline: phones.tagline,
      status: phones.status,
      msrpUsd: phones.msrpUsd,
      imageUrl: phones.imageUrl,
      specJson: phones.specJson,
      localPrice: phoneRegionalDetails.price,
      isEstimated: phoneRegionalDetails.isEstimated,
    })
    .from(phones)
    .leftJoin(
      phoneRegionalDetails,
      and(
        eq(phoneRegionalDetails.phoneId, phones.id),
        eq(phoneRegionalDetails.countryCode, activeRegion.countryCode),
      ),
    )
    .where(eq(phones.slug, slug))
    .limit(1);

  if (!phone || phone.status !== 'active') {
    notFound();
  }

  const specParsed = PhoneSpecSchema.safeParse(phone.specJson);

  return (
    <div className="bg-background pb-16">
      <PhoneHeader
        brand={phone.brand}
        model={phone.model}
        tagline={phone.tagline}
        imageUrl={phone.imageUrl}
        localPrice={phone.localPrice ?? phone.msrpUsd}
        isEstimated={phone.isEstimated ?? false}
        activeRegion={activeRegion}
      />
      {specParsed.success ? (
        <PhoneSpecSummary
          spec={specParsed.data}
          localPrice={phone.localPrice ?? phone.msrpUsd}
          isEstimated={phone.isEstimated ?? false}
          activeRegion={activeRegion}
        />
      ) : null}
      <ScorecardSection phoneId={phone.id} />
      <PhoneChat phoneSlug={phone.slug} />
    </div>
  );
}
