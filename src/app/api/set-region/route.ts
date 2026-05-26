import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { env } from '@/env';
import { isSupportedRegion } from '@/lib/regions';

const bodySchema = z.object({ countryCode: z.string().min(2).max(3) });

export const runtime = 'edge';

export async function POST(req: NextRequest): Promise<Response> {
  const json: unknown = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid country code' }, { status: 400 });
  }
  const { countryCode } = parsed.data;
  if (!isSupportedRegion(countryCode)) {
    return NextResponse.json({ error: 'Unsupported region' }, { status: 422 });
  }

  const res = NextResponse.json({ ok: true, countryCode });
  res.cookies.set({
    name: 'recsy_region',
    value: countryCode.toUpperCase(),
    path: '/',
    maxAge: 60 * 60 * 24 * 365, // 1 year
    sameSite: 'lax',
    secure: env.NODE_ENV === 'production',
    httpOnly: false, // client needs to read it
  });
  return res;
}
