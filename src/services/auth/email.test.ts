import { describe, expect, it, vi } from 'vitest';
import { isDisposableEmail, normalizeEmail } from './email';
import type { AppQueryDb } from '@/services/db/client';

describe('normalizeEmail', () => {
  it('lowercases and trims', () => {
    expect(normalizeEmail('  USER@Example.COM  ')).toBe('user@example.com');
  });

  it('strips dots and +tags for Gmail and Googlemail', () => {
    expect(normalizeEmail('john.doe@gmail.com')).toBe('johndoe@gmail.com');
    expect(normalizeEmail('john.doe+spam@gmail.com')).toBe('johndoe@gmail.com');
    expect(normalizeEmail('j.o.h.n.d.o.e+test@googlemail.com')).toBe('johndoe@gmail.com');
  });

  it('strips +tags but keeps dots for Outlook/Proton/iCloud', () => {
    expect(normalizeEmail('first.last+newsletter@outlook.com')).toBe('first.last@outlook.com');
    expect(normalizeEmail('user.name+alias@proton.me')).toBe('user.name@proton.me');
    expect(normalizeEmail('user.name+apple@icloud.com')).toBe('user.name@icloud.com');
  });

  it('retains tags and dots for unknown domains', () => {
    expect(normalizeEmail('custom.corp+support@company.org')).toBe(
      'custom.corp+support@company.org',
    );
  });

  it('converts internationalized domains (IDN) to punycode', () => {
    expect(normalizeEmail('user@münchen.de')).toBe('user@xn--mnchen-3ya.de');
  });
});

describe('isDisposableEmail', () => {
  it('detects domains from static blocklist', async () => {
    expect(await isDisposableEmail('test@mailinator.com')).toBe(true);
    expect(await isDisposableEmail('temp@10minutemail.com')).toBe(true);
    expect(await isDisposableEmail('hacker@tempmail.com')).toBe(true);
  });

  it('returns false for legitimate domains', async () => {
    expect(await isDisposableEmail('user@gmail.com')).toBe(false);
    expect(await isDisposableEmail('developer@recsy.com')).toBe(false);
    expect(await isDisposableEmail('someone@outlook.com')).toBe(false);
  });

  it('queries abuse_blocks table when db client is supplied', async () => {
    const mockDb = {
      execute: vi.fn().mockResolvedValue([{ count: 1 }]),
    } as unknown as AppQueryDb;

    const blocked = await isDisposableEmail('attacker@custom-throwaway.org', { db: mockDb });
    expect(blocked).toBe(true);
    expect(mockDb.execute).toHaveBeenCalled();
  });
});
