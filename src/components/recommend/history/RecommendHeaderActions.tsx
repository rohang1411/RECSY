'use client';

/**
 * Mobile toolbar buttons for History drawer and New recommendation CTA (Plan 27 WP-09).
 */
import React, { useState } from 'react';
import Link from 'next/link';
import { History, Plus } from 'lucide-react';
import { HistoryDrawer } from './HistoryDrawer';
import { clearDraft } from '@/lib/recommend-sessions/drafts';

export function RecommendHeaderActions(): React.JSX.Element {
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  return (
    <>
      <div className="flex items-center gap-2 lg:hidden">
        <button
          type="button"
          onClick={() => setIsDrawerOpen(true)}
          aria-label="Open recommendation history"
          className="border-outline-variant bg-surface-container hover:bg-surface-container-high text-foreground inline-flex items-center gap-1.5 border px-3 py-1.5 font-mono text-xs uppercase transition-colors"
        >
          <History className="size-3.5" aria-hidden />
          History
        </button>

        <Link
          href="/recommend"
          onClick={() => clearDraft('new')}
          aria-label="Start new recommendation"
          className="border-primary bg-primary/10 text-primary hover:bg-primary inline-flex items-center gap-1.5 border px-3 py-1.5 font-mono text-xs uppercase transition-colors hover:text-black"
        >
          <Plus className="size-3.5" aria-hidden />
          New
        </Link>
      </div>

      <HistoryDrawer isOpen={isDrawerOpen} onClose={() => setIsDrawerOpen(false)} />
    </>
  );
}
