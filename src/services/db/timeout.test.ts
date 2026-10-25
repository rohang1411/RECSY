import { describe, it, expect, vi } from 'vitest';
import { withStatementTimeout } from './timeout';
import type { AppDb, AppQueryDb } from './client';

describe('withStatementTimeout', () => {
  it('executes SET LOCAL statement_timeout within a transaction', async () => {
    const mockTx = {
      execute: vi.fn().mockResolvedValue(undefined),
      select: vi.fn(),
    } as unknown as AppQueryDb;

    const mockDb = {
      transaction: vi.fn(async (callback) => callback(mockTx)),
    } as unknown as AppDb;

    const result = await withStatementTimeout(mockDb, '3s', async (tx) => {
      expect(tx).toBe(mockTx);
      return 'success';
    });

    expect(result).toBe('success');
    expect(mockDb.transaction).toHaveBeenCalledTimes(1);
    expect(mockTx.execute).toHaveBeenCalledTimes(1);

    const executeCall = vi.mocked(mockTx.execute).mock.calls[0]?.[0];
    const sqlChunks = (executeCall as unknown as { queryChunks: Array<{ value?: string[] }> })
      ?.queryChunks;
    expect(sqlChunks?.[0]?.value?.[0]).toContain("SET LOCAL statement_timeout = '3s'");
  });

  it('falls back to running directly if transaction is not available', async () => {
    const mockDb = {
      select: vi.fn(),
    } as unknown as AppQueryDb;

    const result = await withStatementTimeout(mockDb, '3s', async (db) => {
      expect(db).toBe(mockDb);
      return 42;
    });

    expect(result).toBe(42);
  });
});
