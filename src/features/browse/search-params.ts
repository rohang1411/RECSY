/**
 * URL query contract for `/browse` (Phase 6). Single-page filters; all server-side.
 *
 * - `brands` — comma-separated brand names (must match `phones.brand` exactly).
 * - `min` / `max` — USD MSRP bounds (`phones.msrp_usd`); null MSRP rows excluded when either bound is set.
 * - `foldable` — `1` = foldable only, `0` = non-foldable, omitted = any.
 */
export type BrowseFoldableFilter = 'any' | 'yes' | 'no';

export interface BrowseFilterState {
  readonly brands: readonly string[];
  readonly minPriceUsd: number | null;
  readonly maxPriceUsd: number | null;
  readonly foldable: BrowseFoldableFilter;
}

const DEFAULT_STATE: BrowseFilterState = {
  brands: [],
  minPriceUsd: null,
  maxPriceUsd: null,
  foldable: 'any',
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

  return { brands, minPriceUsd: minP, maxPriceUsd: maxP, foldable };
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
  return p.toString();
}

export function isDefaultBrowseState(state: BrowseFilterState): boolean {
  return (
    state.brands.length === 0 &&
    state.minPriceUsd == null &&
    state.maxPriceUsd == null &&
    state.foldable === 'any'
  );
}
