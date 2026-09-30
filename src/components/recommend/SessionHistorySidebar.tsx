'use client';

import { Check, Edit2, MoreVertical, Pin, PinOff, Plus, Share2, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import type { SessionSummary } from '@/lib/recommend-session-store';
import { cn } from '@/lib/utils';

export interface SessionHistorySidebarProps {
  readonly sessions: readonly SessionSummary[];
  readonly activeSessionId: string | null;
  readonly isLoading?: boolean;
  readonly onSelectSession: (sessionId: string) => void;
  readonly onNewSession: () => void;
  readonly onRenameSession: (sessionId: string, newTitle: string) => Promise<void>;
  readonly onTogglePin: (sessionId: string, isPinned: boolean) => Promise<void>;
  readonly onDeleteSession: (sessionId: string) => Promise<void>;
  readonly onRestoreSession: (sessionId: string) => Promise<void>;
  readonly onShareSession: (sessionId: string) => Promise<{ shareUrl: string }>;
  readonly className?: string;
}

interface GroupedSessions {
  readonly pinned: readonly SessionSummary[];
  readonly today: readonly SessionSummary[];
  readonly yesterday: readonly SessionSummary[];
  readonly previous7Days: readonly SessionSummary[];
  readonly older: readonly SessionSummary[];
}

function groupSessions(sessions: readonly SessionSummary[]): GroupedSessions {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterdayStart = todayStart - 24 * 60 * 60 * 1000;
  const sevenDaysStart = todayStart - 7 * 24 * 60 * 60 * 1000;

  const pinned: SessionSummary[] = [];
  const today: SessionSummary[] = [];
  const yesterday: SessionSummary[] = [];
  const previous7Days: SessionSummary[] = [];
  const older: SessionSummary[] = [];

  for (const session of sessions) {
    if (session.status === 'deleted') continue;

    if (session.isPinned) {
      pinned.push(session);
      continue;
    }

    const sessionTime = new Date(session.updatedAt).getTime();
    if (sessionTime >= todayStart) {
      today.push(session);
    } else if (sessionTime >= yesterdayStart) {
      yesterday.push(session);
    } else if (sessionTime >= sevenDaysStart) {
      previous7Days.push(session);
    } else {
      older.push(session);
    }
  }

  return { pinned, today, yesterday, previous7Days, older };
}

export function SessionHistorySidebar({
  sessions,
  activeSessionId,
  isLoading = false,
  onSelectSession,
  onNewSession,
  onRenameSession,
  onTogglePin,
  onDeleteSession,
  onRestoreSession,
  onShareSession,
  className,
}: SessionHistorySidebarProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  const grouped = useMemo(() => groupSessions(sessions), [sessions]);

  // Global Ctrl+N / Cmd+N shortcut for New Recommendation
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        onNewSession();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onNewSession]);

  // Close context menu on outside click
  useEffect(() => {
    function handleClickOutside() {
      setOpenMenuId(null);
    }
    if (openMenuId) {
      window.addEventListener('click', handleClickOutside);
      return () => window.removeEventListener('click', handleClickOutside);
    }
  }, [openMenuId]);

  function startRename(session: SessionSummary) {
    setEditingId(session.id);
    setEditTitle(session.title);
    setOpenMenuId(null);
  }

  async function submitRename(sessionId: string) {
    const trimmed = editTitle.trim();
    if (trimmed && trimmed !== sessions.find((s) => s.id === sessionId)?.title) {
      try {
        await onRenameSession(sessionId, trimmed);
        toast.success('Chat renamed');
      } catch {
        toast.error('Failed to rename chat');
      }
    }
    setEditingId(null);
  }

  async function handleShare(sessionId: string) {
    setOpenMenuId(null);
    try {
      const { shareUrl } = await onShareSession(sessionId);
      const fullUrl = `${window.location.origin}${shareUrl}`;
      await navigator.clipboard.writeText(fullUrl);
      toast.success('Share link copied to clipboard');
    } catch {
      toast.error('Failed to generate share link');
    }
  }

  async function handleDelete(sessionId: string) {
    setOpenMenuId(null);
    try {
      await onDeleteSession(sessionId);
      toast('Chat deleted', {
        action: {
          label: 'Undo',
          onClick: () => {
            void onRestoreSession(sessionId).then(() => {
              toast.success('Chat restored');
            });
          },
        },
      });
    } catch {
      toast.error('Failed to delete chat');
    }
  }

  async function handleTogglePin(sessionId: string, currentPinned: boolean) {
    setOpenMenuId(null);
    try {
      await onTogglePin(sessionId, !currentPinned);
      toast.success(currentPinned ? 'Chat unpinned' : 'Chat pinned');
    } catch {
      toast.error('Failed to update pin state');
    }
  }

  function renderSessionItem(session: SessionSummary) {
    const isActive = session.id === activeSessionId;
    const isEditing = session.id === editingId;
    const isMenuOpen = session.id === openMenuId;

    if (isEditing) {
      return (
        <li key={session.id} className="p-1">
          <div className="border-primary bg-background flex items-center gap-1 border px-2 py-1">
            <input
              type="text"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submitRename(session.id);
                if (e.key === 'Escape') setEditingId(null);
              }}
              autoFocus
              className="text-primary w-full bg-transparent font-mono text-xs focus:outline-none"
            />
            <button
              type="button"
              onClick={() => void submitRename(session.id)}
              className="text-primary hover:text-accent p-1"
              aria-label="Save title"
            >
              <Check className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setEditingId(null)}
              className="text-muted-foreground hover:text-primary p-1"
              aria-label="Cancel rename"
            >
              <X className="size-3.5" />
            </button>
          </div>
        </li>
      );
    }

    return (
      <li key={session.id} className="group relative">
        <div
          className={cn(
            'flex items-center justify-between border-l-2 transition-colors duration-150',
            isActive
              ? 'border-primary bg-surface-container-high text-primary'
              : 'text-muted-foreground hover:border-outline-variant hover:bg-surface-container hover:text-primary border-transparent',
          )}
        >
          <button
            type="button"
            onClick={() => onSelectSession(session.id)}
            className="flex-1 truncate px-3 py-2.5 text-left"
          >
            <span className="block truncate font-mono text-xs">
              {session.isPinned && <Pin className="text-accent mr-1.5 inline size-3" />}
              {session.title}
            </span>
            {session.picksSummary.length > 0 ? (
              <span className="text-muted-foreground/80 mt-0.5 block truncate font-mono text-[10px]">
                {session.picksSummary.slice(0, 2).join(' • ')}
              </span>
            ) : null}
          </button>

          {/* Context Actions Menu */}
          <div className="relative pr-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setOpenMenuId(isMenuOpen ? null : session.id);
              }}
              className="text-muted-foreground hover:text-primary hover:bg-surface-container-highest rounded p-1.5 transition-colors"
              aria-label="Chat options"
            >
              <MoreVertical className="size-3.5" />
            </button>

            {isMenuOpen && (
              <div
                onClick={(e) => e.stopPropagation()}
                className="border-outline bg-background absolute top-full right-0 z-30 mt-1 w-36 border p-1 font-mono text-xs shadow-xl"
              >
                <button
                  type="button"
                  onClick={() => startRename(session)}
                  className="hover:bg-surface-container hover:text-primary text-muted-foreground flex w-full items-center gap-2 px-2 py-1.5 text-left"
                >
                  <Edit2 className="size-3" />
                  Rename
                </button>
                <button
                  type="button"
                  onClick={() => void handleTogglePin(session.id, session.isPinned)}
                  className="hover:bg-surface-container hover:text-primary text-muted-foreground flex w-full items-center gap-2 px-2 py-1.5 text-left"
                >
                  {session.isPinned ? <PinOff className="size-3" /> : <Pin className="size-3" />}
                  {session.isPinned ? 'Unpin' : 'Pin'}
                </button>
                <button
                  type="button"
                  onClick={() => void handleShare(session.id)}
                  className="hover:bg-surface-container hover:text-primary text-muted-foreground flex w-full items-center gap-2 px-2 py-1.5 text-left"
                >
                  <Share2 className="size-3" />
                  Share
                </button>
                <div className="border-outline-variant my-1 border-t" />
                <button
                  type="button"
                  onClick={() => void handleDelete(session.id)}
                  className="hover:bg-destructive/10 text-destructive flex w-full items-center gap-2 px-2 py-1.5 text-left"
                >
                  <Trash2 className="size-3" />
                  Delete
                </button>
              </div>
            )}
          </div>
        </div>
      </li>
    );
  }

  function renderGroup(title: string, groupSessions: readonly SessionSummary[]) {
    if (groupSessions.length === 0) return null;
    return (
      <div key={title} className="mb-4">
        <p className="text-muted-foreground/70 px-3 pb-1 font-mono text-[10px] tracking-[0.16em] uppercase">
          {title}
        </p>
        <ul className="space-y-0.5">{groupSessions.map(renderSessionItem)}</ul>
      </div>
    );
  }

  return (
    <aside
      className={cn(
        'border-outline-variant bg-background flex h-full shrink-0 flex-col border-r',
        className,
      )}
    >
      {/* Header with New Recommendation Button */}
      <div className="border-outline-variant border-b p-3">
        <button
          type="button"
          onClick={onNewSession}
          className="border-outline text-primary hover:bg-primary hover:text-background flex w-full items-center justify-between border px-3 py-2 font-mono text-[11px] tracking-[0.14em] uppercase transition-colors"
        >
          <span className="flex items-center gap-2">
            <Plus className="size-3.5" />
            New Chat
          </span>
          <kbd className="border-outline text-muted-foreground border px-1.5 py-0.5 font-mono text-[9px]">
            Ctrl+N
          </kbd>
        </button>
      </div>

      {/* Sessions Scroll Area */}
      <div className="flex-1 overflow-y-auto py-3">
        {isLoading && sessions.length === 0 ? (
          <div className="text-muted-foreground px-4 py-8 text-center font-mono text-xs">
            Loading chats…
          </div>
        ) : sessions.length === 0 ? (
          <div className="text-muted-foreground px-4 py-8 text-center font-mono text-xs">
            No previous chats
          </div>
        ) : (
          <>
            {renderGroup('Pinned', grouped.pinned)}
            {renderGroup('Today', grouped.today)}
            {renderGroup('Yesterday', grouped.yesterday)}
            {renderGroup('Previous 7 Days', grouped.previous7Days)}
            {renderGroup('Older', grouped.older)}
          </>
        )}
      </div>
    </aside>
  );
}
