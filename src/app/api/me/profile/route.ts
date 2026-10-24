import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/services/db/client';
import { resolveRequestIdentity } from '@/services/auth/identity';
import { getUserProfile, updateUserProfile } from '@/services/auth/profile';
import { UnauthorizedError, ValidationError, isAppError, publicErrorMessage } from '@/lib/errors';
import { assertSameOrigin } from '@/lib/same-origin';
import { logger } from '@/services/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = logger.child({ route: '/api/me/profile' });

const UpdateProfileSchema = z.object({
  displayName: z.string().trim().min(1, 'Display name cannot be empty').max(100).optional(),
  dateOfBirth: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date of birth must be in YYYY-MM-DD format')
    .nullable()
    .optional(),
  avatarUrl: z.string().url('Invalid avatar URL').nullable().optional(),
});

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const db = getDb();
    const identity = await resolveRequestIdentity(request, { db });

    if (!identity.userId) {
      throw new UnauthorizedError('Sign-in required to access profile');
    }

    const profile = await getUserProfile(db, identity.userId);
    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    }

    const names = (profile.display_name ?? '').trim().split(/\s+/);
    const firstName = names[0] || (profile.email ? profile.email.split('@')[0] : 'Member');
    const lastName = names.slice(1).join(' ') || null;

    return NextResponse.json({
      id: profile.id,
      email: profile.email,
      displayName: profile.display_name,
      firstName,
      lastName,
      avatarUrl: profile.avatar_url,
      dateOfBirth: profile.date_of_birth ? String(profile.date_of_birth).slice(0, 10) : null,
      createdAt: profile.created_at,
      status: profile.status,
    });
  } catch (err) {
    if (isAppError(err)) {
      return NextResponse.json({ error: publicErrorMessage(err) }, { status: err.status });
    }
    log.error({ err }, 'failed to fetch user profile');
    return NextResponse.json({ error: 'Failed to fetch profile' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  try {
    assertSameOrigin(request);

    const db = getDb();
    const identity = await resolveRequestIdentity(request, { db });

    if (!identity.userId) {
      throw new UnauthorizedError('Sign-in required to update profile');
    }

    const body = await request.json().catch(() => null);
    const parsed = UpdateProfileSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid profile data');
    }

    const updated = await updateUserProfile(db, identity.userId, parsed.data);
    if (!updated) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    }

    const names = (updated.display_name ?? '').trim().split(/\s+/);
    const firstName = names[0] || (updated.email ? updated.email.split('@')[0] : 'Member');
    const lastName = names.slice(1).join(' ') || null;

    return NextResponse.json({
      id: updated.id,
      email: updated.email,
      displayName: updated.display_name,
      firstName,
      lastName,
      avatarUrl: updated.avatar_url,
      dateOfBirth: updated.date_of_birth ? String(updated.date_of_birth).slice(0, 10) : null,
      updatedAt: updated.updated_at,
    });
  } catch (err) {
    if (isAppError(err)) {
      return NextResponse.json({ error: publicErrorMessage(err) }, { status: err.status });
    }
    log.error({ err }, 'failed to update user profile');
    return NextResponse.json({ error: 'Failed to update profile' }, { status: 500 });
  }
}
