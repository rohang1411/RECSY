import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Metadata } from 'next';
import Link from 'next/link';

import { appSearchParamsToURLSearchParams } from '@/app/browse/search-params-helpers';
import { ComparePhonePickers, type ComparePickerOption } from '@/app/compare/compare-phone-pickers';
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

type MetricValue = {
  slug: string;
  displayValue: string;
  numericValue?: number | null;
};

async function loadComparePickerOptions(): Promise<ComparePickerOption[]> {
  try {
    const db = getDb();
    const rows = await db
      .select({
        slug: phones.slug,
        brand: phones.brand,
        model: phones.model,
        imageUrl: phones.imageUrl,
        msrpUsd: phones.msrpUsd,
        specJson: phones.specJson,
      })
      .from(phones)
      .where(eq(phones.status, 'active'))
      .orderBy(asc(phones.brand), asc(phones.model));
    return rows.map((row) => {
      const spec = PhoneSpecSchema.safeParse(row.specJson);
      return {
        slug: row.slug,
        label: `${row.brand} ${row.model}`,
        brand: row.brand,
        model: row.model,
        imageUrl: row.imageUrl,
        msrpUsd: row.msrpUsd,
        batteryMah: spec.success ? spec.data.battery_mah : null,
        refreshRateHz: spec.success ? spec.data.display.refresh_rate_hz : null,
        cameraMp: spec.success ? (spec.data.rear_cameras[0]?.mp ?? null) : null,
      };
    });
  } catch {
    return [];
  }
}

function uniqueSlugs(...values: readonly string[]) {
  const result: string[] = [];
  for (const value of values) {
    const slug = value.trim();
    if (!slug || result.includes(slug)) continue;
    result.push(slug);
  }
  return result.slice(0, 3);
}

function winnerSlugs(values: readonly MetricValue[], higherIsBetter = true) {
  const numeric = values.filter(
    (value): value is MetricValue & { numericValue: number } =>
      typeof value.numericValue === 'number' && Number.isFinite(value.numericValue),
  );
  if (numeric.length < 2) return new Set<string>();

  const best = higherIsBetter
    ? Math.max(...numeric.map((value) => value.numericValue))
    : Math.min(...numeric.map((value) => value.numericValue));
  const winners = numeric.filter((value) => value.numericValue === best);
  if (winners.length === numeric.length) return new Set<string>();
  return new Set(winners.map((value) => value.slug));
}

function metricRow(label: string, values: readonly MetricValue[], higherIsBetter = true) {
  const winners = winnerSlugs(values, higherIsBetter);
  const winningCell =
    'bg-accent/10 text-primary font-semibold shadow-[inset_0_0_0_1px_var(--accent)] border-accent';
  return (
    <tr className="border-outline-variant border-b last:border-0">
      <th className="border-outline-variant bg-background text-muted-foreground w-[24%] border-r p-4 text-left font-mono text-[11px] font-normal tracking-[0.16em] uppercase">
        {label}
      </th>
      {values.map((value) => (
        <td
          key={`${label}-${value.slug}`}
          className={`border-outline-variant border-r p-4 text-sm last:border-r-0 ${
            winners.has(value.slug) ? winningCell : 'bg-background text-primary'
          }`}
        >
          {value.displayValue}
        </td>
      ))}
    </tr>
  );
}

function EmptyCompareShell({
  title = 'Compare Phones',
  children,
}: {
  readonly title?: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="grid-bg px-grid-margin py-10">
      <div className="border-outline-variant bg-background border p-6 sm:p-8">
        <p className="meta-label">Compare</p>
        <h1 className="heading-scanline text-gradient-accent-edge font-display mt-5 text-5xl leading-none font-extrabold tracking-normal uppercase sm:text-7xl">
          {title}
        </h1>
        <div className="mt-8">{children}</div>
      </div>
    </div>
  );
}

export default async function ComparePage({ searchParams }: PageProps) {
  const raw = await searchParams;
  const sp = appSearchParamsToURLSearchParams(raw);
  const slugs = uniqueSlugs(sp.get('a') ?? '', sp.get('b') ?? '', sp.get('c') ?? '');
  const compareOptions = await loadComparePickerOptions();

  if (slugs.length < 2) {
    return (
      <EmptyCompareShell>
        <p className="text-muted-foreground max-w-2xl text-sm leading-6">
          Pick two or three models from the catalog to compare their specs side by side.
        </p>
        {compareOptions.length > 0 ? <ComparePhonePickers options={compareOptions} /> : null}
        <p className="text-muted-foreground mt-5 text-sm">
          You can also start from{' '}
          <Link className="text-primary hover:underline" href="/browse">
            Browse
          </Link>
          .
        </p>
      </EmptyCompareShell>
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
    .where(and(eq(phones.status, 'active'), inArray(phones.slug, slugs)))) as PhoneRow[];

  const bySlug = new Map(list.map((row) => [row.slug, row]));
  const compared = slugs
    .map((slug) => bySlug.get(slug))
    .filter((phone): phone is PhoneRow => Boolean(phone))
    .map((phone) => ({
      ...phone,
      parsedSpec: PhoneSpecSchema.safeParse(phone.specJson),
    }));

  if (compared.length < 2) {
    const missing = slugs.filter((slug) => !bySlug.has(slug));
    return (
      <EmptyCompareShell title="Compare">
        <p className="text-muted-foreground max-w-2xl text-sm leading-6">
          We could not find at least two active catalog entries. Choose phones from the picker
          below.
        </p>
        {missing.length > 0 ? (
          <p className="text-destructive mt-4 font-mono text-sm">
            Not found: {missing.join(' / ')}
          </p>
        ) : null}
        {compareOptions.length > 0 ? (
          <ComparePhonePickers
            defaultA={slugs[0]}
            defaultB={slugs[1]}
            defaultC={slugs[2]}
            options={compareOptions}
          />
        ) : null}
      </EmptyCompareShell>
    );
  }

  const validSpecs = compared.every((phone) => phone.parsedSpec.success);
  const specs = compared.map((phone) => (phone.parsedSpec.success ? phone.parsedSpec.data : null));

  return (
    <div className="grid-bg px-grid-margin py-10">
      <header className="border-outline-variant bg-background border p-6 sm:p-8">
        <p className="meta-label">Compare</p>
        <h1 className="heading-scanline text-gradient-accent-edge font-display mt-5 text-5xl leading-none font-extrabold tracking-normal uppercase sm:text-7xl">
          Compare
        </h1>
        {!validSpecs ? (
          <p className="text-muted-foreground mt-4 text-sm">
            Full spec table needs valid specs on every selected phone. Open each page for details.
          </p>
        ) : null}
        {compareOptions.length > 0 ? (
          <ComparePhonePickers
            defaultA={slugs[0]}
            defaultB={slugs[1]}
            defaultC={slugs[2]}
            options={compareOptions}
          />
        ) : null}
      </header>

      <div
        className={`bg-outline-variant mt-8 grid gap-px ${compared.length === 3 ? 'lg:grid-cols-3' : 'sm:grid-cols-2'}`}
      >
        {compared.map((phone, index) => (
          <Link
            key={phone.slug}
            href={`/p/${phone.slug}`}
            className="interactive-panel group relative min-h-[360px] overflow-hidden border-0"
          >
            <PhoneImage
              src={phone.imageUrl}
              label={`${phone.brand} ${phone.model}`}
              fill
              fit="cover"
              className="absolute inset-0 h-full w-full"
            />
            <div className="from-background via-background/70 to-background/10 absolute inset-0 bg-gradient-to-t" />
            <div className="absolute inset-x-0 bottom-0 p-6 text-left">
              <p className="meta-label text-primary mb-3">Phone {index + 1}</p>
              <p className="text-muted-foreground font-mono text-[11px] tracking-[0.16em] uppercase">
                {phone.brand}
              </p>
              <p className="text-gradient-steel font-display mt-2 text-4xl font-bold tracking-normal uppercase">
                {phone.model}
              </p>
              {phone.tagline ? (
                <p className="text-muted-foreground mt-3 max-w-md text-sm leading-6">
                  {phone.tagline}
                </p>
              ) : null}
              <p className="text-primary mt-5 font-mono text-[11px] tracking-[0.18em] uppercase">
                Phone details
              </p>
            </div>
          </Link>
        ))}
      </div>

      <div className="border-outline-variant bg-background mt-8 overflow-x-auto border">
        <table className="w-full min-w-[760px] border-collapse text-left">
          <thead>
            <tr className="border-outline-variant border-b">
              <th className="border-outline-variant text-muted-foreground border-r p-4 text-left font-mono text-[11px] font-normal tracking-[0.16em] uppercase">
                Metric
              </th>
              {compared.map((phone) => (
                <th
                  key={phone.slug}
                  className="border-outline-variant text-primary border-r p-4 text-left font-mono text-[11px] font-normal tracking-[0.16em] uppercase last:border-r-0"
                >
                  {phone.brand} {phone.model}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {metricRow(
              'MSRP USD',
              compared.map((phone) => ({
                slug: phone.slug,
                displayValue: formatUsdFromNumericString(phone.msrpUsd) ?? 'N/A',
                numericValue: phone.msrpUsd ? Number.parseFloat(phone.msrpUsd) : null,
              })),
              false,
            )}
            {validSpecs ? (
              <>
                {metricRow(
                  'Display',
                  compared.map((phone, index) => {
                    const spec = specs[index]!;
                    return {
                      slug: phone.slug,
                      displayValue: `${spec.display.size_in}" ${spec.display.panel_type} / ${spec.display.resolution} / ${spec.display.refresh_rate_hz}Hz`,
                      numericValue: spec.display.refresh_rate_hz,
                    };
                  }),
                )}
                {metricRow(
                  'Chipset',
                  compared.map((phone, index) => ({
                    slug: phone.slug,
                    displayValue: specs[index]!.chipset,
                  })),
                )}
                {metricRow(
                  'RAM and storage GB',
                  compared.map((phone, index) => {
                    const spec = specs[index]!;
                    return {
                      slug: phone.slug,
                      displayValue: `${spec.ram_gb} / ${spec.storage_options_gb.join(', ')}`,
                      numericValue: spec.ram_gb + Math.max(...spec.storage_options_gb) / 1000,
                    };
                  }),
                )}
                {metricRow(
                  'Battery',
                  compared.map((phone, index) => ({
                    slug: phone.slug,
                    displayValue: `${specs[index]!.battery_mah}mAh`,
                    numericValue: specs[index]!.battery_mah,
                  })),
                )}
                {metricRow(
                  'Weight',
                  compared.map((phone, index) => ({
                    slug: phone.slug,
                    displayValue: `${specs[index]!.weight_g}g`,
                    numericValue: specs[index]!.weight_g,
                  })),
                  false,
                )}
                {metricRow(
                  'Main rear camera MP',
                  compared.map((phone, index) => ({
                    slug: phone.slug,
                    displayValue: `${specs[index]!.rear_cameras[0]?.mp ?? 'N/A'}MP`,
                    numericValue: specs[index]!.rear_cameras[0]?.mp ?? null,
                  })),
                )}
                {metricRow(
                  'OS',
                  compared.map((phone, index) => ({
                    slug: phone.slug,
                    displayValue: specs[index]!.os,
                  })),
                )}
                {metricRow(
                  'Foldable',
                  compared.map((phone, index) => ({
                    slug: phone.slug,
                    displayValue: specs[index]!.foldable ? 'Yes' : 'No',
                  })),
                )}
              </>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
