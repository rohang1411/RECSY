'use client';

/**
 * Desktop sidebar history panel embedded inside SideNav on Recommend routes (Plan 27 WP-09).
 */
import React, { useState } from 'react';
import { useParams } from 'next/navigation';
import { useSessionList } from '@/lib/recommend-sessions/use-session-list';
import { NewRecommendationButton } from './NewRecommendationButton';
import { HistorySearch } from './HistorySearch';
import { HistoryList } from './HistoryList';

export interface HistoryPanelProps {
  readonly onSelect?: () => void;
}

export function HistoryPanel({ onSelect }: HistoryPanelProps): React.JSX.Element {
  const params = useParams();
  const activeId = typeof params?.id === 'string' ? params.id : undefined;

  const [searchQuery, setSearchQuery] = useState('');

  const {
    sessions,
    pinnedSessions,
    isLoading,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    renameSession,
    pinSession,
    archiveSession,
    deleteSession,
    restoreSession,
  } = useSessionList({
    q: searchQuery,
    status: 'active',
  });

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Top CTA */}
      <div className="p-3">
        <NewRecommendationButton onSelect={onSelect} />
      </div>

      {/* Search Bar */}
      <div className="border-outline-variant border-b px-3 pb-3">
        <HistorySearch value={searchQuery} onChange={setSearchQuery} />
      </div>

      {/* Scrollable list */}
      <div className="flex-1 overflow-y-auto px-1 py-3">
        <HistoryList
          sessions={sessions}
          pinnedSessions={pinnedSessions}
          activeId={activeId}
          searchQuery={searchQuery}
          isLoading={isLoading}
          hasNextPage={hasNextPage}
          isFetchingNextPage={isFetchingNextPage}
          onLoadMore={() => void fetchNextPage()}
          onSelect={onSelect}
          onRename={renameSession}
          onPin={pinSession}
          onArchive={archiveSession}
          onDelete={deleteSession}
          onRestore={restoreSession}
        />
      </div>
    </div>
  );
}
