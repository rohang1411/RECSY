import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * IDOR Matrix and API Route Security Audit.
 * Normative reference: Plan 25 Section 10.6, Section 10.9.
 *
 * Checks:
 * 1. `/api/me/*` never accepts a `userId` or `user_id` query parameter or body field.
 * 2. Enumerates all API routes and validates URL parameter capabilities against an explicit allowlist.
 * 3. Asserts that data-access queries verify caller ownership via verified user identity.
 */
const API_DIR = join(process.cwd(), 'src', 'app', 'api');

function findRouteFiles(dir: string): string[] {
  const routes: string[] = [];
  const entries = readdirSync(dir);

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      routes.push(...findRouteFiles(fullPath));
    } else if (entry === 'route.ts') {
      routes.push(fullPath);
    }
  }

  return routes;
}

describe('IDOR Defence & Route Security Audit', () => {
  const routeFiles = findRouteFiles(API_DIR);

  it('found and enumerates API routes', () => {
    expect(routeFiles.length).toBeGreaterThan(0);
  });

  it('/api/me/* routes NEVER accept a userId parameter from caller input', () => {
    const meRoutes = routeFiles.filter((path) => path.includes(join('api', 'me')));
    expect(meRoutes.length).toBeGreaterThan(0);

    for (const routePath of meRoutes) {
      const content = readFileSync(routePath, 'utf8');
      const relPath = relative(API_DIR, routePath).replace(/\\/g, '/');

      // Assert that userId is never parsed from query string or body
      expect(
        content.includes("searchParams.get('userId')"),
        `${relPath} must not read userId from searchParams`,
      ).toBe(false);

      expect(
        content.includes("searchParams.get('user_id')"),
        `${relPath} must not read user_id from searchParams`,
      ).toBe(false);

      expect(
        content.includes("searchParams.get('id')"),
        `${relPath} must not read id from searchParams`,
      ).toBe(false);

      // Must derive caller identity from server-verified session
      expect(
        content.includes('resolveRequestIdentity') || content.includes('requireUser'),
        `${relPath} must derive caller identity from server-verified identity helper`,
      ).toBe(true);
    }
  });

  it('validates dynamic route segment allowlist', () => {
    // Only allowlisted internal routes are permitted to use dynamic URL path parameters like [id]
    const ALLOWLISTED_DYNAMIC_API_ROUTES: string[] = ['internal/eval/runs/[id]/route.ts'];

    const dynamicRoutes = routeFiles
      .filter((path) => path.includes('['))
      .map((path) => relative(API_DIR, path).replace(/\\/g, '/'));

    for (const route of dynamicRoutes) {
      expect(
        ALLOWLISTED_DYNAMIC_API_ROUTES,
        `Unexpected dynamic API route found: ${route}. Resource IDs in URLs must be audited for IDOR capabilities.`,
      ).toContain(route);
    }
  });

  it('account mutation routes (/api/account/*) enforce requireUser and assertSameOrigin', () => {
    const accountRoutes = routeFiles.filter((path) => path.includes(join('api', 'account')));
    expect(accountRoutes.length).toBeGreaterThan(0);

    for (const routePath of accountRoutes) {
      const content = readFileSync(routePath, 'utf8');
      const relPath = relative(API_DIR, routePath).replace(/\\/g, '/');

      // Every account mutation route must verify same-origin and require authenticated user
      expect(
        content.includes('assertSameOrigin'),
        `${relPath} must call assertSameOrigin(request)`,
      ).toBe(true);

      expect(content.includes('requireUser'), `${relPath} must call requireUser(request)`).toBe(
        true,
      );
    }
  });

  it('verifies IDOR ownership pattern: session queries never query by ID alone', () => {
    // Verifies that session queries in services always guard by sessionCookie or user_id
    const sessionFile = join(process.cwd(), 'src', 'services', 'recommender', 'session.ts');
    const content = readFileSync(sessionFile, 'utf8');

    // Never query bare id without token/user guard in findSessionByCookie
    expect(content).toContain('eq(recommendationSessions.sessionCookie, sessionCookie)');
    expect(content).toContain(
      'innerJoin(recommendationClients, eq(recommendationSessions.clientId, recommendationClients.id))',
    );
  });
});
