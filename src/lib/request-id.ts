import { AppError } from '@/lib/errors';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseRequestId(raw: string | null | undefined): string | null {
  if (!raw || !raw.trim()) return null;
  const trimmed = raw.trim();
  if (!UUID_REGEX.test(trimmed)) {
    throw new AppError('VALIDATION', 'Invalid x-request-id header: must be a valid UUID', {
      status: 400,
      context: { header: 'x-request-id' },
    });
  }
  return trimmed;
}
