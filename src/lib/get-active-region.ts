import { cookies } from 'next/headers';
import { getRegionConfig, type RegionConfig } from './regions';

/**
 * Reads the active region from the cookie set by middleware.
 * Only call from Server Components, API routes, or Server Actions.
 * Never call from client components — use the prop passed by the parent server component.
 */
export async function getActiveRegion(): Promise<RegionConfig> {
  const jar = await cookies();
  const code = jar.get('recsy_region')?.value;
  return getRegionConfig(code);
}
