import { type NextRequest, NextResponse } from 'next/server';
import { assertSameOrigin } from '@/lib/same-origin';
import { isAppError, toAppError, publicErrorMessage } from '@/lib/errors';
import { getDb } from '@/services/db/client';
import { requireUser } from '@/services/auth/profile';
import { startPortal } from '@/services/billing/checkout';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    assertSameOrigin(request);

    const db = getDb();
    const identity = await requireUser(request, { db });

    const result = await startPortal(identity.userId!, db);

    return NextResponse.json(
      { url: result.url },
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
