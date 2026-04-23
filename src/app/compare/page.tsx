import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Metadata } from 'next';
import Link from 'next/link';

import { appSearchParamsToURLSearchParams } from '@/app/browse/search-params-helpers';
import { ComparePhonePickers } from '@/app/compare/compare-phone-pickers';
import { CompareSlugForm } from '@/app/compare/compare-slug-form';
import { PhoneImage } from '@/components/phone/PhoneImage';
import { PhoneSpecSchema } from '@/features/phones/schema';
import { formatUsdFromNumericString } from '@/lib/format-usd';
import { getDb } from '@/services/db/client';
import { phones } from '@/services/db/schema';

export const metadata: Metadata = {
  title: 'Compare',
  description: 'Side-by-side phone specs in the RECSY catalog.',
};

export const dynamic = 'force-dynamic';

interface PageProps {
  readonly searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
}

type PhoneRow = {
  id: string;
  slug: string;
  brand: string;
  model: string;
  tagline: string | null;
  msrpUsd: string | null;
  imageUrl: string | null;
  specJson: unknown;
  status: 'active' | 'discontinued' | 'upcoming';
};

async function loadComparePickerOptions() {
  try {
    const db = getDb();
    const rows = await db
      .select({ slug: phones.slug, brand: phones.brand, model: phones.model })
      .from(phones)
      .where(eq(phones.status, 'active'))
      .orderBy(asc(phones.brand), asc(phones.model));
    return rows.map((r) => ({ slug: r.slug, label: `${r.brand} ${r.model}` }));
  } catch {
    return [];
  }
}

function specLine(label: string, left: string, right: string) {
  return (
    <tr className="border-border/60 border-b last:border-0">
      <th className="text-muted-foreground w-[28%] py-2 pr-2 text-left text-xs font-medium sm:w-1/4">
        {label}
      </th>
      <td className="text-foreground w-[36%] py-2 text-sm sm:w-[37.5%]">{left}</td>
      <td className="text-foreground w-[36%] py-2 text-sm sm:w-[37.5%]">{right}</td>
    </tr>
  );
}

export default async function ComparePage({ searchParams }: PageProps) {
  const raw = await searchParams;
  const sp = appSearchParamsToURLSearchParams(raw);
  const a = (sp.get('a') ?? '').trim();
  const b = (sp.get('b') ?? '').trim();

  if (!a || !b) {
    const compareOptions = await loadComparePickerOptions();
    return (
      <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
        <h1 className="text-foreground text-2xl font-semibold">Compare phones</h1>
        <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
          Pick two models from the catalog, or add slugs to the URL — for example:
        </p>
        <p className="text-foreground bg-muted/50 mt-3 rounded-md px-3 py-2 font-mono text-sm break-all">
          /compare?a=first-phone-slug&b=second-phone-slug
        </p>
        {compareOptions.length > 0 ? <ComparePhonePickers options={compareOptions} /> : null}
        <p className="text-muted-foreground mt-4 text-sm">
          <span className="text-foreground font-medium">By slug: </span>
          from the recommender, use <strong>Compare the top 2</strong> after you get results, or
          pick from{' '}
          <Link className="text-primary font-medium hover:underline" href="/browse">
            Browse
          </Link>
          .
        </p>
        <CompareSlugForm />
      </div>
    );
  }

  if (a === b) {
    const compareOptions = await loadComparePickerOptions();
    return (
      <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
        <h1 className="text-foreground text-2xl font-semibold">Compare</h1>
        <p className="text-muted-foreground mt-2 text-sm">Choose two different phones.</p>
        {compareOptions.length > 0 ? <ComparePhonePickers options={compareOptions} /> : null}
        <p className="text-muted-foreground mt-4 text-sm">
          <Link className="text-primary" href="/browse">
            Browse
          </Link>
        </p>
      </div>
    );
  }

  const db = getDb();
  const list = (await db
    .select({
      id: phones.id,
      slug: phones.slug,
      brand: phones.brand,
      model: phones.model,
      tagline: phones.tagline,
      msrpUsd: phones.msrpUsd,
      imageUrl: phones.imageUrl,
      specJson: phones.specJson,
      status: phones.status,
    })
    .from(phones)
    .where(and(eq(phones.status, 'active'), inArray(phones.slug, [a, b])))) as PhoneRow[];

  const bySlug = new Map(list.map((r) => [r.slug, r]));
  const left = bySlug.get(a);
  const right = bySlug.get(b);

  if (!left || !right) {
    const foundSlugs = new Set(list.map((r) => r.slug));
    const missing = [a, b].filter((s) => !foundSlugs.has(s));
    const compareOptions = await loadComparePickerOptions();
    return (
      <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
        <h1 className="text-foreground text-2xl font-semibold">Compare</h1>
        <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
          We couldn&apos;t find <strong>both</strong> phones as active catalog entries. Slugs must
          match exactly (see{' '}
          <Link className="text-primary font-medium hover:underline" href="/browse">
            Browse
          </Link>
          ).
        </p>
        {missing.length > 0 ? (
          <p className="text-destructive mt-3 text-sm">
            Not found or not active:{' '}
            {missing.map((s) => (
              <code key={s} className="bg-muted/80 mr-2 rounded px-1.5 py-0.5">
                {s}
              </code>
            ))}
          </p>
        ) : (
          <p className="text-muted-foreground mt-3 text-sm">Only one of the two slugs matched.</p>
        )}
        {compareOptions.length > 0 ? (
          <ComparePhonePickers defaultA={a} defaultB={b} options={compareOptions} />
        ) : null}
        <p className="text-muted-foreground mt-2 text-sm">Or re-enter by slug:</p>
        <CompareSlugForm defaultA={a} defaultB={b} />
      </div>
    );
  }

  const sL = PhoneSpecSchema.safeParse(left.specJson);
  const sR = PhoneSpecSchema.safeParse(right.specJson);
  const pL = sL.success ? sL.data : null;
  const pR = sR.success ? sR.data : null;

  const priceL = formatUsdFromNumericString(left.msrpUsd) ?? '—';
  const priceR = formatUsdFromNumericString(right.msrpUsd) ?? '—';

  const canDetail = pL && pR;

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <h1 className="text-foreground text-2xl font-semibold tracking-tight sm:text-3xl">Compare</h1>
      <p className="text-muted-foreground mt-1 text-sm">Side-by-side from the current catalog</p>
      {!canDetail ? (
        <p className="text-muted-foreground mt-3 text-sm">
          Full spec table needs valid specs on both phones. Open each page for details.
        </p>
      ) : null}

      <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2">
        {[left, right].map((p) => (
          <div
            key={p.slug}
            className="border-border/80 bg-card/30 flex flex-col items-center gap-2 rounded-lg border p-4 text-center"
          >
            <PhoneImage
              src={p.imageUrl}
              label={`${p.brand} ${p.model}`}
              size={160}
              className="flex w-40 justify-center"
            />
            <p className="text-muted-foreground text-xs uppercase">{p.brand}</p>
            <p className="text-foreground text-lg font-semibold">{p.model}</p>
            {p.tagline ? <p className="text-muted-foreground text-sm">{p.tagline}</p> : null}
            <Link
              className="text-primary mt-1 text-sm font-medium hover:underline"
              href={`/p/${p.slug}`}
            >
              Open page →
            </Link>
          </div>
        ))}
      </div>

      <div className="border-border/80 bg-card/20 mt-8 overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[320px] border-collapse text-left">
          <tbody>
            {specLine('MSRP (USD)', priceL, priceR)}
            {canDetail ? (
              <>
                {specLine(
                  'Display',
                  `${pL.display.size_in}" ${pL.display.panel_type} · ${pL.display.resolution} · ${pL.display.refresh_rate_hz}Hz`,
                  `${pR.display.size_in}" ${pR.display.panel_type} · ${pR.display.resolution} · ${pR.display.refresh_rate_hz}Hz`,
                )}
                {specLine('Chipset', pL.chipset, pR.chipset)}
                {specLine(
                  'RAM / storage (GB)',
                  `${pL.ram_gb} / ${pL.storage_options_gb.join(', ')}`,
                  `${pR.ram_gb} / ${pR.storage_options_gb.join(', ')}`,
                )}
                {specLine('Battery (mAh)', String(pL.battery_mah), String(pR.battery_mah))}
                {specLine('Weight (g)', String(pL.weight_g), String(pR.weight_g))}
                {specLine(
                  'Main rear camera (MP)',
                  String(pL.rear_cameras[0]?.mp ?? '—'),
                  String(pR.rear_cameras[0]?.mp ?? '—'),
                )}
                {specLine('OS', pL.os, pR.os)}
                {specLine('Foldable', pL.foldable ? 'Yes' : 'No', pR.foldable ? 'Yes' : 'No')}
              </>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
