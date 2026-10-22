import { type NextRequest, NextResponse } from 'next/server';
import { getRequestClientIp } from '@/lib/request-ip';
import { RateLimitError } from '@/lib/errors';
import { consumeCspReportRateLimit } from '@/services/rate-limit';
import { logger } from '@/services/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_CSP_REPORT_BYTES = 8192;

/**
 * Strips query parameters and hashes from URLs to prevent inadvertent token leaks in violation logs.
 */
function sanitizeUrl(rawUrl: unknown): string {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return 'none';
  try {
    const parsed = new URL(rawUrl);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    // Relative or invalid URI, truncate and strip query/hash
    return rawUrl.split(/[?#]/)[0]?.slice(0, 256) || 'invalid';
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const contentLength = request.headers.get('content-length');
  if (contentLength && parseInt(contentLength, 10) > MAX_CSP_REPORT_BYTES) {
    return new NextResponse('Payload Too Large', { status: 413 });
  }

  const clientIp = getRequestClientIp(request);

  // Rate limit per IP hash (30 reports/min)
  try {
    await consumeCspReportRateLimit(clientIp);
  } catch (err) {
    if (err instanceof RateLimitError) {
      return new NextResponse('Too Many Requests', {
        status: 429,
        headers: { 'Retry-After': '60' },
      });
    }
    // Fail-open on database transient errors for telemetry ingestion
  }

  let text = '';
  try {
    text = await request.text();
  } catch {
    return new NextResponse('Bad Request', { status: 400 });
  }

  if (text.length > MAX_CSP_REPORT_BYTES) {
    return new NextResponse('Payload Too Large', { status: 413 });
  }

  if (!text.trim()) {
    return new NextResponse(null, { status: 204 });
  }

  try {
    const parsed = JSON.parse(text);

    // Support both standard legacy `csp-report` and modern Reporting API array format
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (item?.type === 'csp-violation' && item.body) {
          const body = item.body;
          logger.warn(
            {
              cspReport: {
                directive: String(body.effectiveDirective || 'unknown').slice(0, 100),
                blockedUri: sanitizeUrl(body.blockedURL),
                documentUri: sanitizeUrl(body.documentURL || item.url),
                disposition: String(body.disposition || 'report').slice(0, 30),
              },
            },
            'CSP violation report received',
          );
        }
      }
    } else {
      const report = parsed['csp-report'] || parsed;
      const directive = String(
        report['effective-directive'] || report['violated-directive'] || 'unknown',
      ).slice(0, 100);
      const blockedUri = sanitizeUrl(report['blocked-uri'] || report['blockedURL']);
      const documentUri = sanitizeUrl(report['document-uri'] || report['documentURL']);
      const disposition = String(report['disposition'] || 'report').slice(0, 30);

      logger.warn(
        {
          cspReport: {
            directive,
            blockedUri,
            documentUri,
            disposition,
          },
        },
        'CSP violation report received',
      );
    }
  } catch {
    // Malformed JSON is ignored safely without storing or crashing
  }

  return new NextResponse(null, { status: 204 });
}

export async function GET(): Promise<NextResponse> {
  return new NextResponse('Method Not Allowed', {
    status: 405,
    headers: { Allow: 'POST' },
  });
}
