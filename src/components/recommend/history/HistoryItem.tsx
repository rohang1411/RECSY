'use client';

/**
 * Single recommendation history item with inline rename and action menu (Plan 27 WP-09).
 */
import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Archive,
  ArchiveRestore,
  MoreVertical,
  Pin,
  PinOff,
  SquarePen,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';

import type { SessionSummary } from '@/lib/recommend-sessions/api';
import { cn } from '@/lib/utils';

export interface HistoryItemProps {
  readonly session: SessionSummary;
  readonly isActive?: boolean;
  readonly onSelect?: () => void;
  readonly onRename: (id: string, newTitle: string) => Promise<unknown>;
  readonly onPin: (id: string, isPinned: boolean) => Promise<unknown>;
  readonly onArchive: (id: string, status: 'active' | 'archived') => Promise<unknown>;
  readonly onDelete: (id: string) => Promise<unknown>;
  readonly onRestore: (id: string) => Promise<unknown>;
}

function formatItemTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMins = Math.floor(diffMs / (60 * 1000));
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

export function HistoryItem({
  session,
  isActive = false,
  onSelect,
  onRename,
  onPin,
  onArchive,
  onDelete,
  onRestore,
}: HistoryItemProps): React.JSX.Element {
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(session.title);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  // Click-outside listener for actions menu
  useEffect(() => {
    if (!isMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isMenuOpen]);

  const handleSaveRename = async () => {
    const trimmed = editTitle.trim();
    if (!trimmed || trimmed === session.title) {
      setIsEditing(false);
      return;
    }
    try {
      await onRename(session.id, trimmed);
    } catch {
      toast.error('Failed to rename conversation');
    } finally {
      setIsEditing(false);
    }
  };

  const handleTogglePin = async () => {
    setIsMenuOpen(false);
    try {
      await onPin(session.id, !session.isPinned);
    } catch {
      toast.error(session.isPinned ? 'Failed to unpin' : 'Pin limit exceeded (max 50)');
    }
  };

  const handleToggleArchive = async () => {
    setIsMenuOpen(false);
    const newStatus = session.status === 'archived' ? 'active' : 'archived';
    try {
      await onArchive(session.id, newStatus);
      toast.success(newStatus === 'archived' ? 'Conversation archived' : 'Conversation unarchived');
    } catch {
      toast.error('Failed to update archive status');
    }
  };

  const handleDelete = async () => {
    setIsMenuOpen(false);
    try {
      await onDelete(session.id);
      toast('Conversation deleted', {
        duration: 10000,
        action: {
          label: 'Undo',
          onClick: () => {
            void onRestore(session.id);
          },
        },
      });
    } catch {
      toast.error('Failed to delete conversation');
    }
  };

  if (isEditing) {
    return (
      <div className="border-accent bg-surface-container/80 flex items-center gap-1 border p-2">
        <input
          ref={inputRef}
          type="text"
          value={editTitle}
          onChange={(e) => setEditTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void handleSaveRename();
            } else if (e.key === 'Escape') {
              setIsEditing(false);
              setEditTitle(session.title);
            }
          }}
          className="border-outline-variant bg-background text-foreground flex-1 border px-2 py-1 font-mono text-xs focus:outline-none"
        />
        <button
          type="button"
          onClick={() => void handleSaveRename()}
          className="text-primary hover:bg-primary/20 px-2 py-1 font-mono text-[10px] uppercase"
        >
          Save
        </button>
      </div>
    );
  }

  const relativeTime = formatItemTime(session.lastTurnAt || session.createdAt);

  return (
    <div
      className={cn(
        'group relative flex items-center justify-between transition-colors',
        isActive ? 'bg-surface-container-high' : 'hover:bg-surface-container',
      )}
    >
      <Link
        href={`/recommend/${session.id}`}
        onClick={onSelect}
        aria-current={isActive ? 'page' : undefined}
        className="min-w-0 flex-1 px-3 py-2 text-left focus:outline-none"
      >
        <div className="flex items-center gap-1.5">
          {session.isPinned ? (
            <Pin className="text-accent size-3 shrink-0 rotate-45" aria-hidden />
          ) : null}
          <p
            className={cn(
              'truncate font-mono text-xs font-medium',
              isActive ? 'text-primary' : 'text-foreground/90 group-hover:text-primary',
            )}
          >
            {session.title || 'Untitled search'}
          </p>
        </div>
        <div className="text-muted-foreground mt-1 flex items-center gap-2 font-mono text-[10px] tracking-wider uppercase">
          <span>{relativeTime}</span>
          <span>•</span>
          <span>{session.turnCount} turns</span>
          {session.topPick ? (
            <>
              <span>•</span>
              <span className="max-w-[90px] truncate">{session.topPick.model}</span>
            </>
          ) : null}
        </div>
      </Link>

      {/* Actions trigger */}
      <div className="relative pr-2" ref={menuRef}>
        <button
          type="button"
          onClick={() => setIsMenuOpen((prev) => !prev)}
          aria-label={`Options for ${session.title}`}
          aria-expanded={isMenuOpen}
          className="text-muted-foreground hover:text-foreground hover:bg-surface-container-highest p-1 transition-colors"
        >
          <MoreVertical className="size-3.5" aria-hidden />
        </button>

        {/* Dropdown Menu */}
        {isMenuOpen ? (
          <div
            role="menu"
            className="border-outline-variant bg-surface-container-highest absolute top-full right-0 z-30 mt-1 w-36 border shadow-lg"
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setIsMenuOpen(false);
                setEditTitle(session.title);
                setIsEditing(true);
              }}
              className="text-muted-foreground hover:bg-surface-container hover:text-foreground flex w-full items-center gap-2 px-3 py-2 text-left font-mono text-xs"
            >
              <SquarePen className="size-3.5" aria-hidden />
              Rename
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => void handleTogglePin()}
              className="text-muted-foreground hover:bg-surface-container hover:text-foreground flex w-full items-center gap-2 px-3 py-2 text-left font-mono text-xs"
            >
              {session.isPinned ? (
                <>
                  <PinOff className="size-3.5" aria-hidden />
                  Unpin
                </>
              ) : (
                <>
                  <Pin className="size-3.5" aria-hidden />
                  Pin
                </>
              )}
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => void handleToggleArchive()}
              className="text-muted-foreground hover:bg-surface-container hover:text-foreground flex w-full items-center gap-2 px-3 py-2 text-left font-mono text-xs"
            >
              {session.status === 'archived' ? (
                <>
                  <ArchiveRestore className="size-3.5" aria-hidden />
                  Unarchive
                </>
              ) : (
                <>
                  <Archive className="size-3.5" aria-hidden />
                  Archive
                </>
              )}
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => void handleDelete()}
              className="text-destructive hover:bg-destructive/10 flex w-full items-center gap-2 px-3 py-2 text-left font-mono text-xs"
            >
              <Trash2 className="size-3.5" aria-hidden />
              Delete
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
