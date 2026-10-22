import { NextResponse, type NextRequest } from 'next/server';
import { getAuthDriver } from '@/services/auth/driver';
import { assertSameOrigin } from '@/lib/same-origin';
import { logger } from '@/services/logger';

export const runtime = 'nodejs';

const log = logger.child({ route: 'POST /auth/signout' });

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    assertSameOrigin(request);
    const driver = getAuthDriver();
    await driver.signOut();
    return NextResponse.json({ ok: true });
  } catch (err) {
    log.error({ err }, 'error during signout');
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
