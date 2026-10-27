'use client';

/**
 * Recency-grouped history list with pagination and empty states (Plan 27 WP-09).
 */
import React, { useMemo } from 'react';
import { Loader2 } from 'lucide-react';
import { groupByRecency } from './group-by-recency';
import { HistoryItem } from './HistoryItem';
import type { SessionSummary } from '@/lib/recommend-sessions/api';

export interface HistoryListProps {
  readonly sessions: readonly SessionSummary[];
  readonly pinnedSessions?: readonly SessionSummary[];
  readonly activeId?: string;
  readonly searchQuery?: string;
  readonly isLoading?: boolean;
  readonly hasNextPage?: boolean;
  readonly isFetchingNextPage?: boolean;
  readonly onLoadMore?: () => void;
  readonly onSelect?: () => void;
  readonly onRename: (id: string, newTitle: string) => Promise<unknown>;
  readonly onPin: (id: string, isPinned: boolean) => Promise<unknown>;
  readonly onArchive: (id: string, status: 'active' | 'archived') => Promise<unknown>;
  readonly onDelete: (id: string) => Promise<unknown>;
  readonly onRestore: (id: string) => Promise<unknown>;
}

export function HistoryList({
  sessions,
  pinnedSessions = [],
  activeId,
  searchQuery,
  isLoading,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
  onSelect,
  onRename,
  onPin,
  onArchive,
  onDelete,
  onRestore,
}: HistoryListProps): React.JSX.Element {
  // Combine pinned sessions (if any) and regular sessions for grouping
  const allSessions = useMemo(() => {
    const combined = [...pinnedSessions];
    const seen = new Set(pinnedSessions.map((s) => s.id));
    for (const s of sessions) {
      if (!seen.has(s.id)) {
        seen.add(s.id);
        combined.push(s);
      }
    }
    return combined;
  }, [pinnedSessions, sessions]);

  const groups = useMemo(() => groupByRecency(allSessions), [allSessions]);

  if (isLoading) {
    return (
      <div className="text-muted-foreground flex items-center justify-center py-8 font-mono text-xs">
        <Loader2 className="mr-2 size-3.5 animate-spin" aria-hidden />
        Loading history…
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="p-4 text-center">
        <p className="text-muted-foreground font-mono text-xs">
          {searchQuery ? 'No conversations found.' : 'Your recommendations will appear here.'}
        </p>
      </div>
    );
  }

  return (
    <nav aria-label="Recommendation history" className="space-y-4">
      {groups.map((group) => (
        <div key={group.label}>
          <div className="text-muted-foreground border-outline-variant/60 border-b px-3 pb-1 font-mono text-[10px] font-semibold tracking-wider uppercase">
            {group.label}
          </div>
          <div className="mt-1 space-y-0.5">
            {group.items.map((session) => (
              <HistoryItem
                key={session.id}
                session={session}
                isActive={activeId === session.id}
                onSelect={onSelect}
                onRename={onRename}
                onPin={onPin}
                onArchive={onArchive}
                onDelete={onDelete}
                onRestore={onRestore}
              />
            ))}
          </div>
        </div>
      ))}

      {hasNextPage ? (
        <div className="pt-2 text-center">
          <button
            type="button"
            onClick={onLoadMore}
            disabled={isFetchingNextPage}
            className="border-outline-variant bg-surface-container hover:bg-surface-container-high text-muted-foreground hover:text-foreground border px-3 py-1 font-mono text-[11px] uppercase transition-colors disabled:opacity-50"
          >
            {isFetchingNextPage ? (
              <span className="inline-flex items-center gap-1.5">
                <Loader2 className="size-3 animate-spin" aria-hidden />
                Loading…
              </span>
            ) : (
              'Load more'
            )}
          </button>
        </div>
      ) : null}
    </nav>
  );
}
