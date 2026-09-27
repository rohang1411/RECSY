/**
 * URL query contract for `/browse` (Phase 6). Single-page filters; all server-side.
 *
 * - `brands` — comma-separated brand names (must match `phones.brand` exactly).
 * - `min` / `max` — USD MSRP bounds (`phones.msrp_usd`); null MSRP rows excluded when either bound is set.
 * - `foldable` — `1` = foldable only, `0` = non-foldable, omitted = any.
 * - `sort` — `latest` (default) | `price-asc` | `price-desc` | `name-asc` | `name-desc`.
 */
export type BrowseFoldableFilter = 'any' | 'yes' | 'no';
export type BrowseSortOption = 'latest' | 'price-asc' | 'price-desc' | 'name-asc' | 'name-desc';

export interface BrowseFilterState {
  readonly brands: readonly string[];
  readonly minPriceUsd: number | null;
  readonly maxPriceUsd: number | null;
  readonly foldable: BrowseFoldableFilter;
  readonly sort: BrowseSortOption;
}

const DEFAULT_STATE: BrowseFilterState = {
  brands: [],
  minPriceUsd: null,
  maxPriceUsd: null,
  foldable: 'any',
  sort: 'latest',
};

function parseIntOrNull(s: string | undefined): number | null {
  if (s == null || s === '') return null;
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

type SearchParamsInput =
  | URLSearchParams
  | {
      readonly get: (k: string) => string | null;
      readonly getAll?: (k: string) => string[];
    };

function parseBrands(sp: SearchParamsInput): string[] {
  const raw = sp.get('brands')?.trim() ?? '';
  if (raw.length > 0) {
    return raw
      .split(',')
      .map((b) => b.trim())
      .filter((b) => b.length > 0);
  }
  if ('getAll' in sp && typeof sp.getAll === 'function') {
    return sp
      .getAll('brand')
      .map((b) => b.trim())
      .filter((b) => b.length > 0);
  }
  return [];
}

const VALID_SORTS = new Set<BrowseSortOption>([
  'latest',
  'price-asc',
  'price-desc',
  'name-asc',
  'name-desc',
]);

/** Parse `nextUrl.searchParams` or a plain `URLSearchParams` (tests). */
export function parseBrowseSearchParams(sp: SearchParamsInput): BrowseFilterState {
  const brands = parseBrands(sp);

  const minPriceUsd = parseIntOrNull(sp.get('min') ?? undefined);
  const maxPriceUsd = parseIntOrNull(sp.get('max') ?? undefined);
  let minP = minPriceUsd;
  let maxP = maxPriceUsd;
  if (minP != null && maxP != null && minP > maxP) {
    [minP, maxP] = [maxP, minP];
  }

  const f = sp.get('foldable');
  let foldable: BrowseFoldableFilter = 'any';
  if (f === '1' || f === 'true') foldable = 'yes';
  else if (f === '0' || f === 'false') foldable = 'no';

  const rawSort = sp.get('sort')?.trim() as BrowseSortOption;
  const sort: BrowseSortOption = VALID_SORTS.has(rawSort) ? rawSort : 'latest';

  return { brands, minPriceUsd: minP, maxPriceUsd: maxP, foldable, sort };
}

export function browseFiltersToQueryString(state: BrowseFilterState): string {
  const p = new URLSearchParams();
  if (state.brands.length) {
    p.set('brands', state.brands.join(','));
  }
  if (state.minPriceUsd != null) {
    p.set('min', String(state.minPriceUsd));
  }
  if (state.maxPriceUsd != null) {
    p.set('max', String(state.maxPriceUsd));
  }
  if (state.foldable === 'yes') p.set('foldable', '1');
  if (state.foldable === 'no') p.set('foldable', '0');
  if (state.sort && state.sort !== 'latest') p.set('sort', state.sort);
  return p.toString();
}

export function isDefaultBrowseState(state: BrowseFilterState): boolean {
  return (
    state.brands.length === 0 &&
    state.minPriceUsd === DEFAULT_STATE.minPriceUsd &&
    state.maxPriceUsd === DEFAULT_STATE.maxPriceUsd &&
    state.foldable === DEFAULT_STATE.foldable &&
    state.sort === DEFAULT_STATE.sort
  );
}
