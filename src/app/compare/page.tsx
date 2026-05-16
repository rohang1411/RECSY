import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Metadata } from 'next';
import Link from 'next/link';

import { appSearchParamsToURLSearchParams } from '@/app/browse/search-params-helpers';
import { ComparePhonePickers } from '@/app/compare/compare-phone-pickers';
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

type Winner = 'left' | 'right' | 'tie' | null;

function winnerByNumber(left: number | null, right: number | null, higherIsBetter = true): Winner {
  if (left == null || right == null || left === right) return null;
  return higherIsBetter ? (left > right ? 'left' : 'right') : left < right ? 'left' : 'right';
}

function specLine(label: string, left: string, right: string, winner: Winner = null) {
  const winningCell =
    'bg-accent/10 text-primary font-semibold shadow-[inset_0_0_0_1px_var(--accent)] border-accent';
  const normalCell = 'bg-background text-primary';
  return (
    <tr className="border-outline-variant border-b last:border-0">
      <th className="border-outline-variant bg-background text-muted-foreground w-[28%] border-r p-4 text-left font-mono text-[11px] font-normal tracking-[0.16em] uppercase sm:w-1/4">
        {label}
      </th>
      <td
        className={`border-outline-variant w-[36%] border-r p-4 text-sm sm:w-[37.5%] ${
          winner === 'left' ? winningCell : normalCell
        }`}
      >
        {left}
      </td>
      <td
        className={`w-[36%] p-4 text-sm sm:w-[37.5%] ${
          winner === 'right' ? winningCell : normalCell
        }`}
      >
        {right}
      </td>
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
        <h1 className="font-display text-primary mt-5 text-5xl leading-none font-extrabold tracking-normal uppercase sm:text-7xl">
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
  const a = (sp.get('a') ?? '').trim();
  const b = (sp.get('b') ?? '').trim();

  if (!a || !b) {
    const compareOptions = await loadComparePickerOptions();
    return (
      <EmptyCompareShell>
        <p className="text-muted-foreground max-w-2xl text-sm leading-6">
          Pick two models from the catalog to compare their specs side by side.
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

  if (a === b) {
    const compareOptions = await loadComparePickerOptions();
    return (
      <EmptyCompareShell title="Compare">
        <p className="text-muted-foreground text-sm">Choose two different phones.</p>
        {compareOptions.length > 0 ? <ComparePhonePickers options={compareOptions} /> : null}
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
    .where(and(eq(phones.status, 'active'), inArray(phones.slug, [a, b])))) as PhoneRow[];

  const bySlug = new Map(list.map((r) => [r.slug, r]));
  const left = bySlug.get(a);
  const right = bySlug.get(b);

  if (!left || !right) {
    const foundSlugs = new Set(list.map((r) => r.slug));
    const missing = [a, b].filter((s) => !foundSlugs.has(s));
    const compareOptions = await loadComparePickerOptions();
    return (
      <EmptyCompareShell title="Compare">
        <p className="text-muted-foreground max-w-2xl text-sm leading-6">
          We could not find both phones as active catalog entries. Choose two phones from the
          dropdowns below.
        </p>
        {missing.length > 0 ? (
          <p className="text-destructive mt-4 font-mono text-sm">
            Not found: {missing.join(' / ')}
          </p>
        ) : null}
        {compareOptions.length > 0 ? (
          <ComparePhonePickers defaultA={a} defaultB={b} options={compareOptions} />
        ) : null}
      </EmptyCompareShell>
    );
  }

  const sL = PhoneSpecSchema.safeParse(left.specJson);
  const sR = PhoneSpecSchema.safeParse(right.specJson);
  const pL = sL.success ? sL.data : null;
  const pR = sR.success ? sR.data : null;

  const priceL = formatUsdFromNumericString(left.msrpUsd) ?? 'N/A';
  const priceR = formatUsdFromNumericString(right.msrpUsd) ?? 'N/A';
  const canDetail = pL && pR;

  return (
    <div className="grid-bg px-grid-margin py-10">
      <header className="border-outline-variant bg-background border p-6 sm:p-8">
        <p className="meta-label">Compare</p>
        <h1 className="font-display text-primary mt-5 text-5xl leading-none font-extrabold tracking-normal uppercase sm:text-7xl">
          Compare
        </h1>
        {!canDetail ? (
          <p className="text-muted-foreground mt-4 text-sm">
            Full spec table needs valid specs on both phones. Open each page for details.
          </p>
        ) : null}
      </header>

      <div className="bg-outline-variant mt-8 grid gap-px sm:grid-cols-2">
        {[left, right].map((p, index) => (
          <Link
            key={p.slug}
            href={`/p/${p.slug}`}
            className="group bg-background relative min-h-[360px] overflow-hidden transition-colors"
          >
            <PhoneImage
              src={p.imageUrl}
              label={`${p.brand} ${p.model}`}
              fill
              fit="cover"
              className="absolute inset-0 h-full w-full"
            />
            <div className="from-background via-background/65 to-background/10 absolute inset-0 bg-gradient-to-t" />
            <div className="absolute inset-x-0 bottom-0 p-6 text-left">
              <p className="meta-label text-primary mb-3">Phone {index + 1}</p>
              <p className="text-muted-foreground font-mono text-[11px] tracking-[0.16em] uppercase">
                {p.brand}
              </p>
              <p className="font-display text-primary mt-2 text-4xl font-bold tracking-normal uppercase">
                {p.model}
              </p>
              {p.tagline ? (
                <p className="text-muted-foreground mt-3 max-w-md text-sm leading-6">{p.tagline}</p>
              ) : null}
              <p className="text-primary mt-5 font-mono text-[11px] tracking-[0.18em] uppercase">
                Phone details
              </p>
            </div>
          </Link>
        ))}
      </div>

      <div className="border-outline-variant bg-background mt-8 overflow-x-auto border">
        <table className="w-full min-w-[680px] border-collapse text-left">
          <tbody>
            {specLine(
              'MSRP USD',
              priceL,
              priceR,
              winnerByNumber(
                left.msrpUsd ? Number.parseFloat(left.msrpUsd) : null,
                right.msrpUsd ? Number.parseFloat(right.msrpUsd) : null,
                false,
              ),
            )}
            {canDetail ? (
              <>
                {specLine(
                  'Display',
                  `${pL.display.size_in}" ${pL.display.panel_type} / ${pL.display.resolution} / ${pL.display.refresh_rate_hz}Hz`,
                  `${pR.display.size_in}" ${pR.display.panel_type} / ${pR.display.resolution} / ${pR.display.refresh_rate_hz}Hz`,
                  winnerByNumber(pL.display.refresh_rate_hz, pR.display.refresh_rate_hz),
                )}
                {specLine('Chipset', pL.chipset, pR.chipset)}
                {specLine(
                  'RAM and storage GB',
                  `${pL.ram_gb} / ${pL.storage_options_gb.join(', ')}`,
                  `${pR.ram_gb} / ${pR.storage_options_gb.join(', ')}`,
                  winnerByNumber(
                    pL.ram_gb + Math.max(...pL.storage_options_gb) / 1000,
                    pR.ram_gb + Math.max(...pR.storage_options_gb) / 1000,
                  ),
                )}
                {specLine(
                  'Battery mAh',
                  String(pL.battery_mah),
                  String(pR.battery_mah),
                  winnerByNumber(pL.battery_mah, pR.battery_mah),
                )}
                {specLine(
                  'Weight g',
                  String(pL.weight_g),
                  String(pR.weight_g),
                  winnerByNumber(pL.weight_g, pR.weight_g, false),
                )}
                {specLine(
                  'Main rear camera MP',
                  String(pL.rear_cameras[0]?.mp ?? 'N/A'),
                  String(pR.rear_cameras[0]?.mp ?? 'N/A'),
                  winnerByNumber(pL.rear_cameras[0]?.mp ?? null, pR.rear_cameras[0]?.mp ?? null),
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
