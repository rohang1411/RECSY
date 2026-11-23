import { randomBytes } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { AppError, isAppError, publicErrorMessage } from '@/lib/errors';
import { readRequestJson } from '@/lib/request-json';
import { requestLogger } from '@/services/logger';
import { isOperatorAuthorized } from '@/services/internal/auth';
import { runIntegrityRemediation } from '@/services/internal/integrity-remediation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function generateTraceId(): string {
  return randomBytes(16).toString('hex');
}

const remediationRequestSchema = z.object({
  action: z.enum(['prune_zombie_runs', 'clean_orphan_chunks', 'normalize_pricing', 'all']),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  const traceId = request.headers.get('x-trace-id')?.trim() || generateTraceId();
  const log = requestLogger({ traceId, route: 'POST /api/internal/integrity/remediate' });

  try {
    const authorized = await isOperatorAuthorized();
    if (!authorized) {
      throw new AppError('UNAUTHORIZED', 'Operator authorization required', { status: 401 });
    }

    const json = await readRequestJson(request);
    const parsed = remediationRequestSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        {
          code: 'VALIDATION',
          message: parsed.error.issues[0]?.message ?? 'Invalid remediation payload',
          details: parsed.error.flatten(),
        },
        { status: 400, headers: { 'X-Trace-Id': traceId } },
      );
    }

    const result = await runIntegrityRemediation(parsed.data.action);
    log.info({ action: parsed.data.action, result }, 'integrity_remediation_completed');

    return NextResponse.json(result, {
      status: 200,
      headers: { 'X-Trace-Id': traceId },
    });
  } catch (err) {
    if (isAppError(err)) {
      log.warn({ code: err.code, status: err.status }, 'remediation_request_rejected');
      return NextResponse.json(
        { code: err.code, message: publicErrorMessage(err), traceId },
        { status: err.status, headers: { 'X-Trace-Id': traceId } },
      );
    }

    log.error({ err }, 'unexpected_remediation_failure');
    return NextResponse.json(
      { code: 'INTERNAL', message: 'Internal server error', traceId },
      { status: 500, headers: { 'X-Trace-Id': traceId } },
    );
  }
}
