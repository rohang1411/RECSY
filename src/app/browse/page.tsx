import Link from 'next/link';

import { PhoneImage } from '@/components/phone/PhoneImage';
import { parseBrowseSearchParams } from '@/features/browse/search-params';
import { getActiveRegion } from '@/lib/get-active-region';
import { formatLocalPrice } from '@/lib/format-currency';
import { getBrowseResults, getActiveBrands } from '@/services/cache/public-data';

import { BrowseFiltersForm } from './browse-filters-form';
import { appSearchParamsToURLSearchParams } from './search-params-helpers';

export const dynamic = 'force-dynamic';

interface PageProps {
  readonly searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
}

export default async function BrowsePage({ searchParams }: PageProps) {
  const raw = await searchParams;
  const urlParams = appSearchParamsToURLSearchParams(raw);
  const filter = parseBrowseSearchParams(urlParams);

  const activeRegion = await getActiveRegion();

  const [rows, allBrands] = await Promise.all([
    getBrowseResults(filter, activeRegion.countryCode),
    getActiveBrands(),
  ]);

  return (
    <div className="grid-bg px-grid-margin py-10">
      <header className="border-outline-variant bg-background border p-6 sm:p-8">
        <p className="meta-label">Browse</p>
        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <h1 className="heading-scanline text-gradient-accent-edge font-display text-5xl leading-none font-extrabold tracking-normal uppercase sm:text-7xl">
              Browse Phones
            </h1>
            <p className="text-muted-foreground mt-4 max-w-2xl text-sm leading-6">
              Filter the active corpus by brand, MSRP, and form factor. Open a phone for its
              scorecard and Q&A.
            </p>
          </div>
          <p className="border-outline-variant text-primary border px-4 py-3 font-mono text-[11px] tracking-[0.18em] uppercase">
            {rows.length} {rows.length === 1 ? 'Device' : 'Devices'}
          </p>
        </div>
      </header>

      <BrowseFiltersForm
        allBrands={allBrands}
        current={filter}
        hasResults={rows.length > 0}
        activeRegion={activeRegion}
      />

      <ul className="mt-8 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {rows.map((p, index) => {
          const displayPrice = p.localPrice ?? p.msrpUsd;
          const price = formatLocalPrice(displayPrice, activeRegion, {
            isEstimated: p.isEstimated ?? false,
          });

          const releaseDate = p.releasedAt ?? p.launchDate;
          const releaseLabel = releaseDate
            ? new Date(releaseDate).toLocaleDateString('en-US', {
                month: 'short',
                year: 'numeric',
              })
            : null;

          return (
            <li key={p.slug}>
              <Link
                href={`/p/${p.slug}`}
                className="interactive-panel group grid min-h-full overflow-hidden focus-visible:outline-none"
              >
                <div className="border-outline-variant bg-surface-container relative h-64 overflow-hidden border-b">
                  <PhoneImage
                    src={p.imageUrl}
                    label={`${p.brand} ${p.model}`}
                    fill
                    fit="contain"
                    className="h-full w-full p-4"
                  />
                  <div className="from-background/90 via-background/10 pointer-events-none absolute inset-0 bg-gradient-to-t to-transparent" />
                  <p className="bg-background/80 text-primary absolute right-4 bottom-4 px-3 py-2 font-mono text-[11px]">
                    {price ?? 'Price not listed'}
                  </p>
                </div>
                <div className="p-5">
                  <div className="flex items-start justify-between gap-4">
                    <p className="meta-label">Phone {String(index + 1).padStart(2, '0')}</p>
                    {releaseLabel ? (
                      <span className="border-outline-variant bg-surface-container text-muted-foreground border px-2 py-0.5 font-mono text-[10px] tracking-wider uppercase">
                        {releaseLabel}
                      </span>
                    ) : null}
                  </div>
                  <p className="text-muted-foreground mt-5 font-mono text-xs tracking-[0.16em] uppercase">
                    {p.brand}
                  </p>
                  <h2 className="text-gradient-steel font-display mt-2 text-3xl font-bold tracking-normal uppercase">
                    {p.model}
                  </h2>
                  {p.tagline ? (
                    <p className="text-muted-foreground mt-4 text-sm leading-6">{p.tagline}</p>
                  ) : null}
                  <p className="text-primary mt-8 font-mono text-[11px] tracking-[0.18em] uppercase">
                    Phone details
                  </p>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
