import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin } from '@/lib/same-origin';
import { readRequestJson } from '@/lib/request-json';
import { isAppError, toAppError, publicErrorMessage } from '@/lib/errors';
import { resolveSiteUrl } from '@/lib/site-url';
import { getDb } from '@/services/db/client';
import { requireUser, getUserProfile } from '@/services/auth/profile';
import { startCheckout } from '@/services/billing/checkout';
import type { BillingProductCode } from '@/services/billing/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const checkoutBodySchema = z.object({
  productCode: z.enum(['pack_s', 'pack_m', 'pro_monthly']),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    assertSameOrigin(request);

    const db = getDb();
    // Plan 26 WP-02: Billing checkout keeps authoritative getUser() server round trip to verify paying user identity.
    const identity = await requireUser(request, { db });
    const profile = await getUserProfile(db, identity.userId!);
    const email = profile?.email ?? '';

    const json = await readRequestJson(request, 4096);
    const body = checkoutBodySchema.parse(json);

    const siteUrl = resolveSiteUrl(request);
    const result = await startCheckout(
      identity.userId!,
      email,
      body.productCode as BillingProductCode,
      db,
      siteUrl,
    );

    return NextResponse.json(
      { url: result.url, checkoutId: result.checkoutId },
      {
        status: 200,
        headers: {
          'Cache-Control': 'private, no-store',
        },
      },
    );
  } catch (err) {
    if (isAppError(err)) {
      return NextResponse.json(
        {
          error: {
            code: err.code,
            message: publicErrorMessage(err),
            context: err.context,
          },
        },
        { status: err.status },
      );
    }

    if (err instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: {
            code: 'BAD_REQUEST',
            message: 'Invalid product code requested.',
            details: err.issues,
          },
        },
        { status: 400 },
      );
    }

    const appErr = toAppError(err);
    return NextResponse.json(
      {
        error: {
          code: appErr.code,
          message: publicErrorMessage(appErr),
        },
      },
      { status: appErr.status || 500 },
    );
  }
}
