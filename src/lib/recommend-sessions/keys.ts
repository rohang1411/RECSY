/**
 * TanStack Query key factories for recommendation sessions (Plan 27 WP-07).
 */

export const sessionKeys = {
  all: ['rec-sessions'] as const,
  lists: () => [...sessionKeys.all, 'list'] as const,
  list: (ownerKey: string, status = 'active', q = '') =>
    [...sessionKeys.lists(), { ownerKey, status, q }] as const,
  details: () => ['rec-session'] as const,
  detail: (id: string | null | undefined) => [...sessionKeys.details(), id] as const,
};

/**
 * Derives a cache isolation owner key from a user object or guest state.
 * Prevents session cache leaks across user sign-in / sign-out.
 */
export function getOwnerKey(user: { id?: string | null } | null | undefined): string {
  if (user?.id) {
    return `user:${user.id}`;
  }
  return 'guest';
}
