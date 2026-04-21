import { asc, eq } from 'drizzle-orm';
import Link from 'next/link';

import { parseBrowseSearchParams } from '@/features/browse/search-params';
import { browseWhereFromState } from '@/features/browse/query';
import { getDb } from '@/services/db/client';
import { phones } from '@/services/db/schema';

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
  const where = browseWhereFromState(filter);

  const db = getDb();
  const [rows, brandRows] = await Promise.all([
    db
      .select({
        slug: phones.slug,
        brand: phones.brand,
        model: phones.model,
        tagline: phones.tagline,
        msrpUsd: phones.msrpUsd,
      })
      .from(phones)
      .where(where)
      .orderBy(asc(phones.brand), asc(phones.model)),
    db
      .select({ brand: phones.brand })
      .from(phones)
      .where(eq(phones.status, 'active'))
      .groupBy(phones.brand)
      .orderBy(asc(phones.brand)),
  ]);

  const allBrands = brandRows.map((r) => r.brand);
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="text-foreground text-3xl font-semibold tracking-tight">Browse phones</h1>
      <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
        Filter the active corpus by brand, US MSRP, and form factor. Open a phone for the scorecard
        and Q&A.
      </p>

      <BrowseFiltersForm allBrands={allBrands} current={filter} hasResults={rows.length > 0} />

      <p className="text-muted-foreground mb-3 text-sm">
        {rows.length} {rows.length === 1 ? 'phone' : 'phones'}
      </p>

      <ul className="divide-border/80 border-border/80 divide-y rounded-lg border">
        {rows.map((p) => (
          <li key={p.slug}>
            <Link
              href={`/p/${p.slug}`}
              className="hover:bg-muted/40 focus-visible:ring-ring block px-4 py-4 transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
            >
              <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                {p.brand}
              </p>
              <p className="text-foreground font-medium">{p.model}</p>
              <div className="text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm">
                {p.msrpUsd != null ? (
                  <span>From ${Number.parseFloat(p.msrpUsd).toLocaleString('en-US')}</span>
                ) : null}
                {p.tagline ? <span>{p.tagline}</span> : null}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
