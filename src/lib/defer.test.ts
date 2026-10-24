import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockAfter = vi.fn();

vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    after: (task: () => unknown) => mockAfter(task),
  };
});

import { deferOrRun } from './defer';

describe('deferOrRun (WP-04 / WP-10)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs inline when outside request scope where after() throws', async () => {
    mockAfter.mockImplementation(() => {
      throw new Error('`after` was called outside a request scope');
    });

    let executed = false;
    await deferOrRun('test-task', async () => {
      executed = true;
    });
    expect(executed).toBe(true);
  });

  it('does not rethrow errors when task fails inline', async () => {
    mockAfter.mockImplementation(() => {
      throw new Error('`after` was called outside a request scope');
    });

    const errorTask = async () => {
      throw new Error('boom');
    };
    await expect(deferOrRun('failing-task', errorTask)).resolves.not.toThrow();
  });

  it('schedules task via after() when available', async () => {
    let scheduledCallback: (() => Promise<void>) | null = null;
    mockAfter.mockImplementation((cb: () => Promise<void>) => {
      scheduledCallback = cb;
    });

    let executed = false;
    await deferOrRun('scheduled-task', async () => {
      executed = true;
    });

    // deferOrRun returned immediately, task scheduled in after()
    expect(executed).toBe(false);
    expect(scheduledCallback).not.toBeNull();

    // Invoking the scheduled callback executes the task
    if (scheduledCallback) {
      await (scheduledCallback as () => Promise<void>)();
    }
    expect(executed).toBe(true);
  });

  it('catches and logs error inside after() callback without throwing', async () => {
    let scheduledCallback: (() => Promise<void>) | null = null;
    mockAfter.mockImplementation((cb: () => Promise<void>) => {
      scheduledCallback = cb;
    });

    await deferOrRun('failing-scheduled-task', async () => {
      throw new Error('async error in after');
    });

    expect(scheduledCallback).not.toBeNull();
    if (scheduledCallback) {
      await expect((scheduledCallback as () => Promise<void>)()).resolves.not.toThrow();
    }
  });
});
