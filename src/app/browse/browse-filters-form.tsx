import Link from 'next/link';

import { cn } from '@/lib/utils';
import type { BrowseFilterState } from '@/features/browse/search-params';

import { filterStateToInputDefaults, foldableSelectValue } from './search-params-helpers';

interface BrowseFiltersFormProps {
  readonly allBrands: readonly string[];
  readonly current: BrowseFilterState;
  readonly hasResults: boolean;
}

/**
 * Server-rendered `GET /browse?…` form — no client JS required to filter.
 * Brand filters use `name="brand"` checkboxes; parsed by {@link parseBrowseSearchParams} via `getAll('brand')`.
 */
export function BrowseFiltersForm({ allBrands, current, hasResults }: BrowseFiltersFormProps) {
  const { minInput, maxInput } = filterStateToInputDefaults(current);
  const foldableVal = foldableSelectValue(current);

  return (
    <div className="border-border/80 bg-card/30 mb-8 rounded-lg border p-4 sm:p-5">
      <h2 className="text-foreground text-sm font-semibold">Filter</h2>
      <p className="text-muted-foreground mt-1 text-xs">
        URL updates so you can share a filtered list. MSRP is in USD. Price filters ignore phones
        without a listed price.
      </p>

      <form method="get" action="/browse" className="mt-4 space-y-5">
        {allBrands.length > 0 ? (
          <fieldset>
            <legend className="text-foreground mb-2 text-sm font-medium">Brands</legend>
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {allBrands.map((b) => (
                <li key={b}>
                  <label className="text-muted-foreground flex cursor-pointer items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      name="brand"
                      value={b}
                      defaultChecked={current.brands.includes(b)}
                      className="border-input text-primary focus-visible:ring-ring h-4 w-4 rounded"
                    />
                    {b}
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2 sm:gap-6">
          <div>
            <label htmlFor="b-min" className="text-foreground text-sm font-medium">
              Min price (USD)
            </label>
            <input
              id="b-min"
              name="min"
              type="number"
              min={0}
              step={1}
              placeholder="Any"
              defaultValue={minInput}
              className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring mt-1.5 w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
            />
          </div>
          <div>
            <label htmlFor="b-max" className="text-foreground text-sm font-medium">
              Max price (USD)
            </label>
            <input
              id="b-max"
              name="max"
              type="number"
              min={0}
              step={1}
              placeholder="Any"
              defaultValue={maxInput}
              className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring mt-1.5 w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
            />
          </div>
        </div>

        <div>
          <label htmlFor="b-fold" className="text-foreground text-sm font-medium">
            Form factor
          </label>
          <select
            id="b-fold"
            name="foldable"
            defaultValue={foldableVal}
            className="border-input bg-background focus-visible:ring-ring mt-1.5 w-full max-w-sm rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            <option value="">Any</option>
            <option value="1">Foldable only</option>
            <option value="0">Non-foldable only</option>
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            className="bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-ring inline-flex h-10 items-center justify-center rounded-md px-4 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            Apply
          </button>
          <Link
            href="/browse"
            className={cn(
              'text-muted-foreground hover:text-foreground text-sm',
              'focus-visible:ring-ring inline-flex rounded-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none',
            )}
          >
            Clear filters
          </Link>
          {!hasResults ? (
            <span className="text-muted-foreground text-sm">
              No matches — try wider bounds or another brand.
            </span>
          ) : null}
        </div>
      </form>
    </div>
  );
}
