/**
 * POST /api/internal/billing/action — executes audited operator actions.
 *
 * Supported actions:
 * - grant_credits: calls recsy_apply_credit_delta with kind 'admin_adjustment'
 * - set_billing_hold: updates user_profiles.billing_hold
 * - set_account_status: updates user_profiles.status ('active' | 'suspended')
 * - create_abuse_block: inserts into abuse_blocks
 * - remove_abuse_block: deletes from abuse_blocks
 *
 * Normative reference: Plan 25 Section 13.5, WP-19.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { sql } from 'drizzle-orm';

import { AppError, isAppError, publicErrorMessage } from '@/lib/errors';
import { readRequestJson } from '@/lib/request-json';
import { getDb } from '@/services/db/client';
import { requestLogger } from '@/services/logger';
import { isOperatorAuthorized } from '@/services/internal/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function generateTraceId(): string {
  return randomBytes(16).toString('hex');
}

const actionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('grant_credits'),
    userId: z.string().uuid(),
    credits: z.number().int().min(1).max(100),
    reason: z.string().trim().min(3).max(500),
  }),
  z.object({
    action: z.literal('set_billing_hold'),
    userId: z.string().uuid(),
    hold: z.boolean(),
    reason: z.string().trim().min(3).max(500),
  }),
  z.object({
    action: z.literal('set_account_status'),
    userId: z.string().uuid(),
    status: z.enum(['active', 'suspended']),
    reason: z.string().trim().min(3).max(500),
  }),
  z.object({
    action: z.literal('create_abuse_block'),
    kind: z.enum(['user', 'device', 'ip_key', 'email_normalized', 'email_domain']),
    value: z.string().trim().min(1).max(255),
    reason: z.string().trim().min(3).max(500),
    ttlHours: z.number().int().min(1).max(8760).optional(),
  }),
  z.object({
    action: z.literal('remove_abuse_block'),
    id: z.string().uuid(),
    reason: z.string().trim().min(3).max(500),
  }),
]);

export async function POST(request: NextRequest): Promise<NextResponse> {
  const traceId = request.headers.get('x-trace-id')?.trim() || generateTraceId();
  const log = requestLogger({ traceId, route: 'POST /api/internal/billing/action' });

  try {
    const authorized = await isOperatorAuthorized();
    if (!authorized) {
      throw new AppError('UNAUTHORIZED', 'Operator authorization required', { status: 401 });
    }

    const body = await readRequestJson(request, 8192);
    const parsed = actionSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION', 'Invalid operator action payload', { status: 400 });
    }

    const db = getDb();
    const data = parsed.data;

    let result: Record<string, unknown> = {};

    switch (data.action) {
      case 'grant_credits': {
        const idempotencyKey = `admin-grant-${randomUUID()}`;
        const refId = `operator-${Date.now()}`;
        const rows = await db.execute<{
          success: boolean;
          new_balance: number;
        }>(sql`
          SELECT success, new_balance
          FROM recsy_apply_credit_delta(
            ${data.userId}::uuid,
            ${data.credits},
            'admin_adjustment'::ledger_kind,
            'operator',
            ${refId},
            ${idempotencyKey},
            jsonb_build_object('reason', ${data.reason})
          );
        `);
        result = {
          creditsGranted: data.credits,
          newBalance: rows[0]?.new_balance ?? null,
          idempotencyKey,
        };
        break;
      }

      case 'set_billing_hold': {
        await db.execute(sql`
          UPDATE user_profiles
          SET billing_hold = ${data.hold},
              updated_at = now()
          WHERE id = ${data.userId}::uuid;
        `);
        result = { userId: data.userId, billingHold: data.hold };
        break;
      }

      case 'set_account_status': {
        await db.execute(sql`
          UPDATE user_profiles
          SET status = ${data.status},
              updated_at = now()
          WHERE id = ${data.userId}::uuid;
        `);
        result = { userId: data.userId, status: data.status };
        break;
      }

      case 'create_abuse_block': {
        const expiresAt = data.ttlHours ? new Date(Date.now() + data.ttlHours * 3600 * 1000) : null;

        const rows = await db.execute<{ id: string }>(sql`
          INSERT INTO abuse_blocks (kind, value, reason, created_by, expires_at)
          VALUES (
            ${data.kind},
            ${data.value},
            ${data.reason},
            'operator',
            ${expiresAt ? expiresAt.toISOString() : null}::timestamptz
          )
          ON CONFLICT (kind, value) DO UPDATE
            SET reason = EXCLUDED.reason,
                expires_at = EXCLUDED.expires_at
          RETURNING id;
        `);
        result = { blockId: rows[0]?.id, kind: data.kind, value: data.value };
        break;
      }

      case 'remove_abuse_block': {
        await db.execute(sql`
          DELETE FROM abuse_blocks WHERE id = ${data.id}::uuid;
        `);
        result = { removedBlockId: data.id };
        break;
      }
    }

    log.warn(
      {
        event: 'operator_action',
        action: data.action,
        reason: data.reason,
        actor: 'operator',
        result,
        traceId,
      },
      'Operator administrative action executed successfully',
    );

    return NextResponse.json(
      { success: true, action: data.action, result },
      {
        status: 200,
        headers: {
          'Cache-Control': 'no-store, private',
          'X-Trace-Id': traceId,
        },
      },
    );
  } catch (err) {
    if (isAppError(err)) {
      log.warn({ code: err.code, status: err.status }, 'operator action rejected');
      return NextResponse.json(
        { code: err.code, message: publicErrorMessage(err) },
        { status: err.status, headers: { 'X-Trace-Id': traceId } },
      );
    }
    log.error({ err }, 'failed to execute operator action');
    return NextResponse.json(
      { code: 'INTERNAL', message: 'Failed to execute operator action' },
      { status: 500, headers: { 'X-Trace-Id': traceId } },
    );
  }
}
