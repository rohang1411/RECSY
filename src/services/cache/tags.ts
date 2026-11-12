/**
 * Public data cache tags and validators.
 *
 * Contract reference: Plan 26 WP-07 Section 9.
 * Maximum tag length is 256 characters per Next.js specifications.
 */

export const TAGS = {
  phones: 'phones', // any active-set change
  phone: (slug: string) => `phone:${slug.toLowerCase()}`, // one phone's row, prices, media
  scorecard: (phoneId: string) => `scorecard:${phoneId}`,
  browse: 'browse',
  aspectDefinitions: 'aspect-definitions',
} as const;

/**
 * Validates a tag against the allowed pattern whitelist.
 * Reject any tag longer than 256 characters or outside known patterns.
 */
export function isValidTag(tag: string): boolean {
  if (typeof tag !== 'string' || tag.length === 0 || tag.length > 256) {
    return false;
  }
  if (tag === TAGS.phones || tag === TAGS.browse || tag === TAGS.aspectDefinitions) {
    return true;
  }
  if (/^phone:[a-z0-9_-]{1,200}$/.test(tag)) {
    return true;
  }
  if (/^scorecard:[0-9a-fA-F-]{36}$/.test(tag)) {
    return true;
  }
  return false;
}
