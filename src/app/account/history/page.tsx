'use client';

import React, { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { Skeleton } from '@/components/ui/skeleton';

interface SearchSession {
  id: string;
  title: string;
  createdAt: string;
  deviceMarker?: string;
  turnsCount?: number;
}

export default function AccountHistoryPage() {
  const [loading, setLoading] = useState(true);
  const [sessions, setSessions] = useState<SearchSession[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isDeleting, startDeleting] = useTransition();
  const [deleteSuccess, setDeleteSuccess] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    async function fetchSessions() {
      try {
        const res = await fetch('/api/account/sessions');
        if (res.ok) {
          const data = await res.json();
          setSessions(data.sessions || []);
        } else if (res.status === 404) {
          // Sessions endpoint may be pending WP-18
          setSessions([]);
        } else {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.message || 'Failed to load search sessions');
        }
      } catch (_err) {
        // Fallback gracefully to empty history
        setSessions([]);
      } finally {
        setLoading(false);
      }
    }
    fetchSessions();
  }, []);

  const handleClearHistory = () => {
    setError(null);
    setDeleteSuccess(null);
    startDeleting(async () => {
      try {
        const res = await fetch('/api/account/history/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scope: 'all' }),
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.message || 'Failed to clear search history');
        }
        setSessions([]);
        setConfirmClear(false);
        setDeleteSuccess('Search history cleared successfully.');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error clearing history');
      }
    });
  };

  return (
    <div className="space-y-8">
      {/* Header and Actions */}
      <div className="border-border-hairline flex flex-wrap items-center justify-between gap-4 border-b pb-4">
        <div>
          <div className="text-muted-foreground font-mono text-[10px] tracking-wider uppercase">
            Search Archive
          </div>
          <h2 className="text-foreground text-xl font-bold">Cross-Device Search History</h2>
          <p className="text-muted-foreground mt-1 font-mono text-xs">
            Recommendation sessions synced across your devices. Only completed, verified searches
            are retained.
          </p>
        </div>

        {sessions.length > 0 && !confirmClear && (
          <button
            type="button"
            onClick={() => setConfirmClear(true)}
            className="border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive border px-4 py-2 font-mono text-xs tracking-wider uppercase transition-colors hover:text-white"
          >
            Clear History
          </button>
        )}
      </div>

      {/* Confirmation Callout */}
      {confirmClear && (
        <div role="alert" className="border-destructive bg-surface space-y-4 border p-6">
          <div className="text-destructive font-mono text-xs font-bold tracking-wider uppercase">
            Confirm Clear Search History
          </div>
          <p className="text-muted-foreground font-mono text-xs leading-relaxed">
            This will permanently delete all stored multi-turn recommendation sessions, query
            inputs, and phone chat turns linked to your user account. This action cannot be undone.
          </p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={isDeleting}
              onClick={handleClearHistory}
              className="border-destructive bg-destructive hover:bg-destructive-hover border px-5 py-2 font-mono text-xs font-bold tracking-wider text-white uppercase transition-colors disabled:opacity-50"
            >
              {isDeleting ? 'Deleting…' : 'Yes, Delete All History'}
            </button>
            <button
              type="button"
              disabled={isDeleting}
              onClick={() => setConfirmClear(false)}
              className="border-border-hairline bg-surface-elevated text-foreground hover:border-foreground border px-4 py-2 font-mono text-xs tracking-wider uppercase transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="border-destructive/40 bg-surface text-destructive border p-4 font-mono text-xs">
          {error}
        </div>
      )}

      {deleteSuccess && (
        <div className="border-accent/40 bg-surface text-accent border p-4 font-mono text-xs">
          {deleteSuccess}
        </div>
      )}

      {/* Sessions List */}
      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : sessions.length === 0 ? (
        <div className="border-border-hairline bg-surface border p-12 text-center">
          <div className="text-muted-foreground mb-2 font-mono text-xs tracking-wider uppercase">
            Archive Empty
          </div>
          <h3 className="text-foreground text-lg font-bold">Your searches will appear here.</h3>
          <p className="text-muted-foreground mx-auto mt-2 max-w-sm font-mono text-xs leading-relaxed">
            When you run recommendations or ask phone questions while signed in, your queries and
            results are organized here.
          </p>
          <div className="mt-6">
            <Link
              href="/recommend"
              className="border-accent bg-accent/10 text-accent hover:bg-accent inline-flex border px-6 py-2.5 font-mono text-xs font-bold tracking-wider uppercase transition-colors hover:text-black"
            >
              Start a New Search
            </Link>
          </div>
        </div>
      ) : (
        <div className="divide-border-hairline border-border-hairline bg-surface divide-y border">
          {sessions.map((session) => (
            <div
              key={session.id}
              className="hover:bg-surface-elevated flex flex-wrap items-center justify-between gap-4 p-4 transition-colors"
            >
              <div className="max-w-xl min-w-0">
                <h4 className="text-foreground truncate font-mono text-xs font-bold">
                  {session.title || 'Untitled Session'}
                </h4>
                <div className="text-muted-foreground mt-1 flex items-center gap-3 font-mono text-[10px]">
                  <span>
                    {new Date(session.createdAt).toLocaleDateString(undefined, {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                    })}
                  </span>
                  {session.deviceMarker && (
                    <span className="border-border-hairline border px-1.5 py-0.5">
                      {session.deviceMarker}
                    </span>
                  )}
                  {session.turnsCount !== undefined && <span>{session.turnsCount} turns</span>}
                </div>
              </div>

              <Link
                href={`/recommend/${session.id}`}
                className="border-accent/40 bg-accent/10 text-accent hover:bg-accent border px-3 py-1 font-mono text-[11px] uppercase transition-colors hover:text-black"
              >
                Open
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
