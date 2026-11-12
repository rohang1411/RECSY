'use client';

/**
 * Desktop sidebar history panel embedded inside SideNav on Recommend routes (Plan 27 WP-09).
 */
import React, { useState } from 'react';
import { useParams } from 'next/navigation';
import { toast } from 'sonner';
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
  const [isDismissed, setIsDismissed] = useState(() => {
    try {
      return Boolean(localStorage.getItem('recsy:dismiss-guest-import'));
    } catch {
      return false;
    }
  });

  const {
    sessions,
    pinnedSessions,
    guestImportAvailable,
    isLoading,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    renameSession,
    pinSession,
    archiveSession,
    deleteSession,
    restoreSession,
    claimGuestSessions,
  } = useSessionList({
    q: searchQuery,
    status: 'active',
  });

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Guest Import Banner */}
      {guestImportAvailable > 0 && !isDismissed && (
        <div className="bg-primary/5 border-outline-variant border-b px-3 py-2.5 text-xs">
          <p className="text-foreground mb-1.5 font-mono text-[11px] font-medium">
            Import {guestImportAvailable} guest conversation
            {guestImportAvailable === 1 ? '' : 's'} from this browser
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={async () => {
                try {
                  const res = await claimGuestSessions();
                  toast.success(
                    `Imported ${res.claimed} conversation${res.claimed === 1 ? '' : 's'}`,
                  );
                } catch {
                  toast.error('Failed to import conversations');
                }
              }}
              className="bg-primary text-primary-foreground hover:bg-primary/90 rounded px-2.5 py-1 font-mono text-[11px] font-medium transition-colors"
            >
              Import
            </button>
            <button
              type="button"
              onClick={() => {
                setIsDismissed(true);
                try {
                  localStorage.setItem('recsy:dismiss-guest-import', 'true');
                } catch {
                  // Ignore
                }
              }}
              className="text-muted-foreground hover:text-foreground px-2 py-1 font-mono text-[11px] transition-colors"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

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
