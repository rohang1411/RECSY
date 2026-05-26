import Link from 'next/link';

import { cn } from '@/lib/utils';
import type { BrowseFilterState } from '@/features/browse/search-params';
import type { RegionConfig } from '@/lib/regions';

import { filterStateToInputDefaults, foldableSelectValue } from './search-params-helpers';

interface BrowseFiltersFormProps {
  readonly allBrands: readonly string[];
  readonly current: BrowseFilterState;
  readonly hasResults: boolean;
  readonly activeRegion: RegionConfig;
}

export function BrowseFiltersForm({
  allBrands,
  current,
  hasResults,
  activeRegion,
}: BrowseFiltersFormProps) {
  const { minInput, maxInput } = filterStateToInputDefaults(current);
  const foldableVal = foldableSelectValue(current);

  const curSymbol = activeRegion.symbol;
  const curCode = activeRegion.currency;

  return (
    <section className="border-outline-variant bg-background mt-8 border">
      <div className="border-outline-variant border-b p-5">
        <h2 className="meta-label text-primary">Filters</h2>
        <p className="text-muted-foreground mt-2 text-xs leading-5">
          Native GET filters keep the catalog shareable. MSRP is in {curCode}; phones without
          pricing in this region are omitted from bounds.
        </p>
      </div>

      <form
        method="get"
        action="/browse"
        className="bg-outline-variant grid gap-px lg:grid-cols-12"
      >
        {allBrands.length > 0 ? (
          <fieldset className="bg-background p-5 lg:col-span-6">
            <legend className="meta-label text-primary mb-4">Brand</legend>
            <ul className="bg-outline-variant grid grid-cols-2 gap-px sm:grid-cols-3">
              {allBrands.map((b) => (
                <li key={b} className="bg-background">
                  <label className="text-muted-foreground hover:bg-surface-container-high hover:text-primary flex cursor-pointer items-center gap-2 px-3 py-3 font-mono text-[11px] tracking-[0.12em] uppercase transition-colors">
                    <input
                      type="checkbox"
                      name="brand"
                      value={b}
                      defaultChecked={current.brands.includes(b)}
                      className="border-input text-primary focus-visible:ring-ring bg-background size-3 border"
                    />
                    {b}
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        ) : null}

        <div className="bg-outline-variant grid gap-px lg:col-span-6 lg:grid-cols-2">
          <div className="bg-background p-5">
            <label htmlFor="b-min" className="meta-label text-primary">
              Min price ({curCode})
            </label>
            <div className="relative mt-3 flex items-center">
              <span className="text-muted-foreground mr-2 font-mono text-sm">{curSymbol}</span>
              <input
                id="b-min"
                name="min"
                type="number"
                min={0}
                step={1}
                placeholder="ANY"
                defaultValue={minInput}
                className="border-outline bg-background placeholder:text-muted-foreground text-primary focus-visible:border-primary w-full border-b px-0 py-2 font-mono text-sm focus-visible:ring-0 focus-visible:outline-none"
              />
            </div>
          </div>
          <div className="bg-background p-5">
            <label htmlFor="b-max" className="meta-label text-primary">
              Max price ({curCode})
            </label>
            <div className="relative mt-3 flex items-center">
              <span className="text-muted-foreground mr-2 font-mono text-sm">{curSymbol}</span>
              <input
                id="b-max"
                name="max"
                type="number"
                min={0}
                step={1}
                placeholder="ANY"
                defaultValue={maxInput}
                className="border-outline bg-background placeholder:text-muted-foreground text-primary focus-visible:border-primary w-full border-b px-0 py-2 font-mono text-sm focus-visible:ring-0 focus-visible:outline-none"
              />
            </div>
          </div>
          <div className="bg-background p-5 lg:col-span-2">
            <label htmlFor="b-fold" className="meta-label text-primary">
              Form factor
            </label>
            <select
              id="b-fold"
              name="foldable"
              defaultValue={foldableVal}
              className="border-outline bg-background text-primary focus-visible:border-primary mt-3 w-full border px-3 py-3 font-mono text-sm focus-visible:ring-0 focus-visible:outline-none"
            >
              <option value="">Any</option>
              <option value="1">Foldable only</option>
              <option value="0">Non-foldable only</option>
            </select>
          </div>
        </div>

        <div className="bg-background flex flex-wrap items-center gap-3 p-5 lg:col-span-12">
          <button
            type="submit"
            className="border-outline text-primary hover:bg-primary hover:text-background focus-visible:bg-primary focus-visible:text-background border px-5 py-3 font-mono text-[11px] tracking-[0.18em] uppercase transition-colors focus-visible:outline-none"
          >
            Apply
          </button>
          <Link
            href="/browse"
            className={cn(
              'text-muted-foreground hover:text-primary px-3 py-3 font-mono text-[11px] tracking-[0.18em] uppercase',
              'focus-visible:text-primary focus-visible:outline-none',
            )}
          >
            Clear Filters
          </Link>
          {!hasResults ? (
            <span className="text-muted-foreground font-mono text-[11px] tracking-[0.14em] uppercase">
              No matches. Try wider bounds or remove brand filters.
            </span>
          ) : null}
        </div>
      </form>
    </section>
  );
}
