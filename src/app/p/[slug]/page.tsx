import { notFound } from 'next/navigation';

import { PhoneSpecSchema } from '@/features/phones/schema';
import { PhoneHeader } from '@/components/phone/PhoneHeader';
import { PhoneSpecSummary } from '@/components/phone/PhoneSpecSummary';
import { ScorecardSection } from '@/components/phone/ScorecardSection';
import { getPhonePageData } from '@/services/cache/public-data';

import { PhoneChat } from './phone-chat';

export const revalidate = 600;

export async function generateStaticParams() {
  return [];
}

interface PageProps {
  readonly params: Promise<{ slug: string }>;
}

export default async function PhonePage({ params }: PageProps) {
  const { slug } = await params;
  const phone = await getPhonePageData(slug);

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
        regionalPrices={phone.regionalPrices}
        msrpUsd={phone.msrpUsd}
      />
      {specParsed.success ? (
        <PhoneSpecSummary
          spec={specParsed.data}
          regionalPrices={phone.regionalPrices}
          msrpUsd={phone.msrpUsd}
        />
      ) : null}
      <ScorecardSection phoneId={phone.id} />
      <PhoneChat phoneSlug={phone.slug} />
    </div>
  );
}
