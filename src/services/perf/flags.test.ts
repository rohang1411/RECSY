import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  DEFAULT_PERF_FLAGS,
  PERF_FLAGS_KEY,
  inCanary,
  parsePerfFlags,
  perfFlagsSchema,
  resetPerfFlagsLogLatch,
  getPerfFlags,
} from './flags';
import type { AppQueryDb } from '@/services/db/client';

describe('Runtime Performance Flags (WP-01)', () => {
  beforeEach(() => {
    resetPerfFlagsLogLatch();
    vi.restoreAllMocks();
  });

  describe('Schema & Defaults', () => {
    it('has the expected PERF_FLAGS_KEY', () => {
      expect(PERF_FLAGS_KEY).toBe('perf_flags');
    });

    it('has sensible safe defaults for all performance switches', () => {
      expect(DEFAULT_PERF_FLAGS).toEqual({
        ask_streaming: 'off',
        ask_streaming_canary_pct: 0,
        auth_local_claims: false,
        admission_single_statement: true,
        public_data_cache: true,
        defer_telemetry: true,
        redis_rate_limit: false,
        grounded_thinking: 'default',
        recommend_sessions: 'off',
        recommend_sessions_internal_user_ids: [],
        recommend_session_llm_titles: false,
      });
    });

    it('validates recommend_sessions product flags (Plan 27 WP-02)', () => {
      expect(perfFlagsSchema.safeParse({ recommend_sessions: 'off' }).success).toBe(true);
      expect(perfFlagsSchema.safeParse({ recommend_sessions: 'internal' }).success).toBe(true);
      expect(perfFlagsSchema.safeParse({ recommend_sessions: 'on' }).success).toBe(true);
      expect(perfFlagsSchema.safeParse({ recommend_sessions: 'invalid' }).success).toBe(false);

      expect(
        perfFlagsSchema.safeParse({
          recommend_sessions_internal_user_ids: ['a0000000-0000-4000-8000-000000000001'],
        }).success,
      ).toBe(true);
      expect(
        perfFlagsSchema.safeParse({
          recommend_sessions_internal_user_ids: ['not-a-uuid'],
        }).success,
      ).toBe(false);

      expect(perfFlagsSchema.safeParse({ recommend_session_llm_titles: true }).success).toBe(true);
    });

    it('strictly rejects unknown keys during direct schema validation', () => {
      const result = perfFlagsSchema.safeParse({
        ask_streaming: 'on',
        unknown_key: true,
      });
      expect(result.success).toBe(false);
    });

    it('validates grounded_thinking enum options', () => {
      expect(perfFlagsSchema.safeParse({ grounded_thinking: 'low' }).success).toBe(true);
      expect(perfFlagsSchema.safeParse({ grounded_thinking: 'minimal' }).success).toBe(true);
      expect(perfFlagsSchema.safeParse({ grounded_thinking: 'invalid' }).success).toBe(false);
    });
  });

  describe('parsePerfFlags', () => {
    it('returns defaults for null or undefined', () => {
      expect(parsePerfFlags(null)).toEqual(DEFAULT_PERF_FLAGS);
      expect(parsePerfFlags(undefined)).toEqual(DEFAULT_PERF_FLAGS);
    });

    it('returns defaults when given empty object', () => {
      expect(parsePerfFlags({})).toEqual(DEFAULT_PERF_FLAGS);
    });

    it('parses valid JSON string representation', () => {
      const parsed = parsePerfFlags(
        JSON.stringify({
          ask_streaming: 'canary',
          ask_streaming_canary_pct: 25,
        }),
      );
      expect(parsed.ask_streaming).toBe('canary');
      expect(parsed.ask_streaming_canary_pct).toBe(25);
      expect(parsed.admission_single_statement).toBe(true); // default preserved
    });

    it('preserves valid flags while filling omitted keys with defaults', () => {
      const parsed = parsePerfFlags({
        ask_streaming: 'on',
        auth_local_claims: true,
      });
      expect(parsed.ask_streaming).toBe('on');
      expect(parsed.auth_local_claims).toBe(true);
      expect(parsed.public_data_cache).toBe(true);
      expect(parsed.redis_rate_limit).toBe(false);
    });

    it('strips unknown keys in stored jsonb without crashing, applying valid values', () => {
      const parsed = parsePerfFlags({
        ask_streaming: 'on',
        obsolete_migration_flag: true,
        some_other_garbage: 123,
      });
      expect(parsed.ask_streaming).toBe('on');
      expect((parsed as Record<string, unknown>).obsolete_migration_flag).toBeUndefined();
    });

    it('falls back to defaults on malformed JSON string', () => {
      const parsed = parsePerfFlags('not-a-valid-json-string');
      expect(parsed).toEqual(DEFAULT_PERF_FLAGS);
    });

    it('falls back to defaults on invalid types (primitive, array)', () => {
      expect(parsePerfFlags(42)).toEqual(DEFAULT_PERF_FLAGS);
      expect(parsePerfFlags(['array', 'of', 'items'])).toEqual(DEFAULT_PERF_FLAGS);
      expect(parsePerfFlags(true)).toEqual(DEFAULT_PERF_FLAGS);
    });

    it('falls back to defaults on invalid field values (e.g. invalid enum or out-of-bounds pct)', () => {
      expect(parsePerfFlags({ ask_streaming: 'unsupported_mode' })).toEqual(DEFAULT_PERF_FLAGS);
      expect(parsePerfFlags({ ask_streaming_canary_pct: 150 })).toEqual(DEFAULT_PERF_FLAGS);
      expect(parsePerfFlags({ ask_streaming_canary_pct: -1 })).toEqual(DEFAULT_PERF_FLAGS);
    });
  });

  describe('inCanary Bucketing', () => {
    it('returns false for percentage <= 0', () => {
      expect(inCanary('device-123', 0)).toBe(false);
      expect(inCanary('device-123', -10)).toBe(false);
    });

    it('returns true for percentage >= 100', () => {
      expect(inCanary('device-123', 100)).toBe(true);
      expect(inCanary('device-123', 105)).toBe(true);
    });

    it('is completely deterministic for a given deviceId and pct', () => {
      const deviceId = 'test-device-uuid-9876';
      const first = inCanary(deviceId, 30);
      for (let i = 0; i < 50; i++) {
        expect(inCanary(deviceId, 30)).toBe(first);
      }
    });

    it('distributes 10,000 synthetic device IDs within ±2% of target', () => {
      const sampleSize = 10_000;
      const targets = [10, 50]; // 10% and 50%

      for (const targetPct of targets) {
        let insideCanaryCount = 0;
        for (let i = 0; i < sampleSize; i++) {
          const deviceId = `synth-device-id-${i}-${targetPct}`;
          if (inCanary(deviceId, targetPct)) {
            insideCanaryCount++;
          }
        }

        const actualPct = (insideCanaryCount / sampleSize) * 100;
        // Acceptance criterion: ±2% of target percentage (e.g. 10% -> 8% to 12%)
        expect(actualPct).toBeGreaterThanOrEqual(targetPct - 2);
        expect(actualPct).toBeLessThanOrEqual(targetPct + 2);
      }
    });
  });

  describe('getPerfFlags Helper', () => {
    it('reads perf flags directly from platform state', async () => {
      const mockDb = {
        execute: vi.fn().mockResolvedValue([
          {
            kill_switch: { enabled: false },
            cap: 1000,
            perf_flags: { ask_streaming: 'on', auth_local_claims: true },
            used_today: 10,
          },
        ]),
      } as unknown as AppQueryDb;

      const flags = await getPerfFlags(mockDb);
      expect(flags.ask_streaming).toBe('on');
      expect(flags.auth_local_claims).toBe(true);
      expect(flags.admission_single_statement).toBe(true);
    }, 15000);
  });
});
