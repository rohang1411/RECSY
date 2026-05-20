import { PhoneImage } from '@/components/phone/PhoneImage';
import { formatLocalPrice } from '@/lib/format-currency';
import type { RegionConfig } from '@/lib/regions';

interface PhoneHeaderProps {
  readonly brand: string;
  readonly model: string;
  readonly tagline: string | null;
  readonly imageUrl: string | null;
  readonly localPrice: string | null;
  readonly isEstimated?: boolean;
  readonly activeRegion: RegionConfig;
}

export function PhoneHeader({
  brand,
  model,
  tagline,
  imageUrl,
  localPrice,
  isEstimated,
  activeRegion,
}: PhoneHeaderProps) {
  const price = formatLocalPrice(localPrice, activeRegion, { isEstimated });
  const label = `${brand} ${model}`;

  return (
    <header className="grid-bg border-outline-variant px-grid-margin border-b py-10 sm:py-14">
      <div className="grid gap-8 lg:grid-cols-12 lg:items-end">
        <div className="lg:col-span-7">
          <p className="meta-label border-primary mb-5 border-l-2 pl-4">{brand}</p>
          <h1 className="font-display text-primary text-6xl leading-none font-extrabold tracking-normal uppercase sm:text-8xl lg:text-[112px]">
            {model}
          </h1>
          {tagline ? (
            <p className="text-muted-foreground mt-6 max-w-2xl text-sm leading-6">{tagline}</p>
          ) : null}
        </div>

        <div className="border-outline-variant bg-background border lg:col-span-5">
          <div className="border-outline-variant border-b p-4">
            <p className="meta-label text-primary">Product image</p>
          </div>
          <div className="flex min-h-80 items-center justify-center p-8">
            <PhoneImage src={imageUrl} label={label} size={300} className="h-72 w-72 max-w-full" />
          </div>
          <dl className="bg-outline-variant grid grid-cols-2 gap-px font-mono text-xs">
            <div className="bg-background p-4">
              <dt className="meta-label">MSRP</dt>
              <dd className="text-primary mt-2">{price ?? 'TBD'}</dd>
            </div>
            <div className="bg-background p-4">
              <dt className="meta-label">STATUS</dt>
              <dd className="text-primary mt-2">ACTIVE</dd>
            </div>
          </dl>
        </div>
      </div>
    </header>
  );
}
