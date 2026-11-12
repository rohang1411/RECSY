import { describe, expect, it } from 'vitest';
import { createStageTimer, type StageName } from './stage-timer';

describe('StageTimer', () => {
  it('times an async function and records duration', async () => {
    let mockTime = 1000;
    const now = () => mockTime;
    const timer = createStageTimer(now);

    const result = await timer.time('auth', async () => {
      mockTime += 15.4;
      return 'user-123';
    });

    expect(result).toBe('user-123');
    expect(timer.snapshot().auth).toBe(15);
    expect(timer.serverTiming()).toBe('auth;dur=15.4');
  });

  it('sums durations when time is called with the same name twice (citation retry)', async () => {
    let mockTime = 0;
    const now = () => mockTime;
    const timer = createStageTimer(now);

    await timer.time('generate', async () => {
      mockTime += 100;
      return 'attempt 1';
    });

    await timer.time('generate', async () => {
      mockTime += 150.2;
      return 'attempt 2';
    });

    expect(timer.snapshot().generate).toBe(250);
    expect(timer.serverTiming()).toBe('generate;dur=250.2');
  });

  it('rethrows errors unchanged and still records duration', async () => {
    let mockTime = 0;
    const now = () => mockTime;
    const timer = createStageTimer(now);

    const boom = new Error('database connection failed');
    await expect(
      timer.time('reserve', async () => {
        mockTime += 30;
        throw boom;
      }),
    ).rejects.toThrow('database connection failed');

    expect(timer.snapshot().reserve).toBe(30);
  });

  it('marks time elapsed since creation with mark()', () => {
    let mockTime = 500;
    const now = () => mockTime;
    const timer = createStageTimer(now);

    mockTime += 120.6;
    timer.mark('firstDelta');

    expect(timer.snapshot().firstDelta).toBe(121);
    expect(timer.serverTiming()).toBe('firstDelta;dur=120.6');
  });

  it('formats multiple stages into W3C Server-Timing header', async () => {
    let mockTime = 100;
    const now = () => mockTime;
    const timer = createStageTimer(now);

    await timer.time('rl', async () => {
      mockTime += 5.2;
    });
    await timer.time('auth', async () => {
      mockTime += 12.8;
    });

    expect(timer.serverTiming()).toBe('rl;dur=5.2, auth;dur=12.8');
  });

  it('enforces StageName type at compile time', () => {
    const valid: StageName = 'embed';
    expect(valid).toBe('embed');
    // @ts-expect-error - invalid stage name
    const _invalid: StageName = 'not_a_real_stage';
  });
});
