import { notFound } from 'next/navigation';

import { PhoneSpecSchema } from '@/features/phones/schema';
import { PhoneHeader } from '@/components/phone/PhoneHeader';
import { PhoneSpecSummary } from '@/components/phone/PhoneSpecSummary';
import { ScorecardSection } from '@/components/phone/ScorecardSection';
import { getActiveRegion } from '@/lib/get-active-region';
import { getPhonePageData } from '@/services/cache/public-data';

import { PhoneChat } from './phone-chat';

export const dynamic = 'force-dynamic';

interface PageProps {
  readonly params: Promise<{ slug: string }>;
}

export default async function PhonePage({ params }: PageProps) {
  const { slug } = await params;
  const activeRegion = await getActiveRegion();

  const phone = await getPhonePageData(slug, activeRegion.countryCode);

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
