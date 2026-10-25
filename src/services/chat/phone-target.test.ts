import { describe, expect, it, vi } from 'vitest';
import type { AppQueryDb } from '@/services/db/client';
import { getAskPhoneTarget } from './phone-target';

describe('getAskPhoneTarget', () => {
  it('returns phone when found', async () => {
    const mockDb = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([
              {
                id: 'p-123',
                status: 'active',
                brand: 'Google',
                model: 'Pixel 9',
                lastIngestAt: new Date('2026-01-01'),
                nextIngestAt: new Date('2026-02-01'),
              },
            ]),
          }),
        }),
      }),
    } as unknown as AppQueryDb;

    const result = await getAskPhoneTarget(mockDb, 'google-pixel-9');
    expect(result).toEqual({
      id: 'p-123',
      status: 'active',
      brand: 'Google',
      model: 'Pixel 9',
      lastIngestAt: expect.any(Date),
      nextIngestAt: expect.any(Date),
    });
  });

  it('returns null when phone not found', async () => {
    const mockDb = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
    } as unknown as AppQueryDb;

    const result = await getAskPhoneTarget(mockDb, 'unknown-slug');
    expect(result).toBeNull();
  });
});
