'use client';

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { ExternalLink, Play, Radio, MessageSquare, Newspaper, CheckCircle2 } from 'lucide-react';
import type { ResolvedCitation } from '@/services/chat/citations';

const subscribe = () => () => {};
const getSnapshot = () => true;
const getServerSnapshot = () => false;

export interface CitationPopoverProps {
  readonly citation: ResolvedCitation;
  readonly label: string;
  readonly isOpen: boolean;
  readonly triggerRect: DOMRect | null;
  readonly onMouseEnter?: () => void;
  readonly onMouseLeave?: () => void;
  readonly onClose: () => void;
}

function formatTimestamp(seconds: number | null | undefined): string | null {
  if (seconds == null || Number.isNaN(seconds) || seconds < 0) return null;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function CitationPopover({
  citation,
  label,
  isOpen,
  triggerRect,
  onMouseEnter,
  onMouseLeave,
  onClose,
}: CitationPopoverProps) {
  const mounted = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Handle escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!mounted || !isOpen || !triggerRect) return null;

  const width = Math.min(380, typeof window !== 'undefined' ? window.innerWidth - 32 : 360);
  const triggerCenterX = triggerRect.left + triggerRect.width / 2;
  const idealLeft = triggerCenterX - width / 2;
  const minLeft = 16;
  const maxLeft = (typeof window !== 'undefined' ? window.innerWidth : 400) - width - 16;
  const left = Math.max(minLeft, Math.min(idealLeft, maxLeft));

  // Determine whether to place above or below trigger
  const spaceAbove = triggerRect.top;
  const placeAbove = spaceAbove >= 240;
  const top = placeAbove
    ? triggerRect.top + window.scrollY - 8
    : triggerRect.bottom + window.scrollY + 8;

  const tsStr = formatTimestamp(citation.startTs);
  const scorePct =
    citation.score != null ? Math.round(Math.min(1, Math.max(0, citation.score)) * 100) : null;

  const PlatformIcon =
    citation.type === 'youtube' ? Play : citation.type === 'reddit' ? MessageSquare : Newspaper;

  const platformBadgeColor =
    citation.type === 'youtube'
      ? 'text-[#ff4d00] border-[#ff4d00]/30 bg-[#ff4d00]/10'
      : citation.type === 'reddit'
        ? 'text-[#ff8736] border-[#ff8736]/30 bg-[#ff8736]/10'
        : 'text-primary border-outline-variant bg-surface-container';

  const popoverContent = (
    <AnimatePresence>
      <motion.div
        ref={popoverRef}
        role="tooltip"
        aria-label={`Citation [${label}] details`}
        initial={{ opacity: 0, y: placeAbove ? 6 : -6, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: placeAbove ? 4 : -4, scale: 0.98 }}
        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        style={{
          position: 'absolute',
          top: placeAbove ? undefined : `${top}px`,
          bottom: placeAbove ? `${window.innerHeight - top}px` : undefined,
          left: `${left}px`,
          width: `${width}px`,
          zIndex: 90,
        }}
        className="border-outline bg-surface/95 text-foreground border p-4 font-sans shadow-2xl backdrop-blur-md select-none"
      >
        {/* Header telemetry & badges */}
        <div className="border-outline-variant flex items-center justify-between gap-2 border-b pb-2.5">
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 border px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-widest uppercase ${platformBadgeColor}`}
            >
              <PlatformIcon className="size-2.5 fill-current" />
              {citation.type}
            </span>
            {citation.channel || citation.author ? (
              <span className="text-foreground truncate font-mono text-[11px] font-medium">
                {citation.channel || citation.author}
              </span>
            ) : null}
          </div>

          <div className="flex items-center gap-2 font-mono text-[10px]">
            {tsStr ? (
              <span className="border-accent/40 bg-accent/10 text-accent flex items-center gap-1 border px-1.5 py-0.5">
                <Radio className="size-2 animate-pulse" />
                {tsStr}
              </span>
            ) : null}
            {scorePct != null ? (
              <span className="text-muted-foreground flex items-center gap-1">
                <CheckCircle2 className="text-success size-2.5" />
                {scorePct}% match
              </span>
            ) : null}
          </div>
        </div>

        {/* Source title */}
        <p
          className="text-primary mt-2.5 line-clamp-1 font-mono text-xs font-semibold"
          title={citation.title}
        >
          {citation.title}
        </p>

        {/* Verbatim excerpt */}
        {citation.excerpt ? (
          <div className="border-accent bg-surface-container-low relative mt-2 border-l-2 p-2.5">
            <p className="text-muted-foreground line-clamp-4 font-mono text-xs leading-relaxed italic">
              &ldquo;{citation.excerpt}&rdquo;
            </p>
          </div>
        ) : (
          <p className="text-muted-foreground mt-2 text-xs italic">
            Direct citation validated against reviewer corpus.
          </p>
        )}

        {/* Micro-action footer */}
        <div className="border-outline-variant mt-3 flex items-center justify-between border-t pt-2.5 font-mono text-[10px] tracking-wider uppercase">
          <span className="text-muted-foreground">Citation [{label}]</span>
          <a
            href={citation.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent hover:text-primary flex items-center gap-1.5 underline-offset-2 transition-colors hover:underline"
          >
            <span>Open Source</span>
            <ExternalLink className="size-3" />
          </a>
        </div>
      </motion.div>
    </AnimatePresence>
  );

  return createPortal(popoverContent, document.body);
}
