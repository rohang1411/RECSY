import type { BrowseFilterState } from '@/features/browse/search-params';

/** Next App Router `searchParams` → `URLSearchParams` for shared parsers. */
export function appSearchParamsToURLSearchParams(
  sp: Readonly<Record<string, string | string[] | undefined>>,
): URLSearchParams {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) {
      for (const x of v) p.append(k, x);
    } else {
      p.set(k, v);
    }
  }
  return p;
}

export function filterStateToInputDefaults(state: BrowseFilterState): {
  minInput: string;
  maxInput: string;
} {
  return {
    minInput: state.minPriceUsd != null ? String(state.minPriceUsd) : '',
    maxInput: state.maxPriceUsd != null ? String(state.maxPriceUsd) : '',
  };
}

export function foldableSelectValue(state: BrowseFilterState): string {
  if (state.foldable === 'yes') return '1';
  if (state.foldable === 'no') return '0';
  return '';
}
