import { describe, expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { recommendationSessions, recommendationTurns } from './schema';

interface NamedEntity {
  name?: string;
  config?: { name?: string };
}

describe('recommendation_sessions v2 schema (Plan 27 WP-02)', () => {
  it('has all added v2 columns on recommendation_sessions', () => {
    const config = getTableConfig(recommendationSessions);
    const columnNames = config.columns.map((c) => c.name);

    expect(columnNames).toContain('user_id');
    expect(columnNames).toContain('device_id');
    expect(columnNames).toContain('title_source');
    expect(columnNames).toContain('first_message');
    expect(columnNames).toContain('turn_count');
    expect(columnNames).toContain('next_turn_index');
    expect(columnNames).toContain('last_turn_at');
    expect(columnNames).toContain('last_picks_summary');
    expect(columnNames).toContain('deleted_at');
    expect(columnNames).toContain('archived_at');
  });

  it('has default values for counters and title_source', () => {
    const config = getTableConfig(recommendationSessions);
    const titleSourceCol = config.columns.find((c) => c.name === 'title_source');
    const turnCountCol = config.columns.find((c) => c.name === 'turn_count');
    const nextTurnIndexCol = config.columns.find((c) => c.name === 'next_turn_index');

    expect(titleSourceCol?.default).toBe('default');
    expect(turnCountCol?.default).toBe(0);
    expect(nextTurnIndexCol?.default).toBe(0);
  });

  it('has result_meta column on recommendation_turns', () => {
    const config = getTableConfig(recommendationTurns);
    const columnNames = config.columns.map((c) => c.name);

    expect(columnNames).toContain('result_meta');
  });

  it('defines partial indexes for user recent, device recent, and deleted purge', () => {
    const config = getTableConfig(recommendationSessions);
    const indexNames = (config.indexes as unknown as NamedEntity[]).map(
      (idx) => idx.name ?? idx.config?.name,
    );

    expect(indexNames).toContain('rs_user_recent_idx');
    expect(indexNames).toContain('rs_device_recent_idx');
    expect(indexNames).toContain('rs_deleted_purge_idx');
  });

  it('defines check constraint for title_source', () => {
    const config = getTableConfig(recommendationSessions);
    const checkNames = (config.checks as unknown as NamedEntity[]).map(
      (chk) => chk.name ?? chk.config?.name,
    );

    expect(checkNames).toContain('recommendation_sessions_title_source_chk');
  });
});
