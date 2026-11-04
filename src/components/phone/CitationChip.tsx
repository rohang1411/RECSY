'use client';

import { useRef, useState, useCallback, type MouseEvent } from 'react';
import type { ResolvedCitation } from '@/services/chat/citations';
import { CitationPopover } from './CitationPopover';

export interface CitationChipProps {
  readonly citation: ResolvedCitation | undefined;
  readonly label: string;
}

function isSafeUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function CitationChip({ citation, label }: CitationChipProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [triggerRect, setTriggerRect] = useState<DOMRect | null>(null);
  const anchorRef = useRef<HTMLAnchorElement | null>(null);
  const openTimerRef = useRef<NodeJS.Timeout | null>(null);
  const closeTimerRef = useRef<NodeJS.Timeout | null>(null);

  const clearTimers = useCallback(() => {
    if (openTimerRef.current) {
      clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const handleMouseEnter = useCallback(() => {
    clearTimers();
    openTimerRef.current = setTimeout(() => {
      if (anchorRef.current) {
        setTriggerRect(anchorRef.current.getBoundingClientRect());
        setIsOpen(true);
      }
    }, 90);
  }, [clearTimers]);

  const handleMouseLeave = useCallback(() => {
    clearTimers();
    closeTimerRef.current = setTimeout(() => {
      setIsOpen(false);
    }, 180);
  }, [clearTimers]);

  const handlePopoverMouseEnter = useCallback(() => {
    clearTimers();
  }, [clearTimers]);

  const handlePopoverMouseLeave = useCallback(() => {
    clearTimers();
    closeTimerRef.current = setTimeout(() => {
      setIsOpen(false);
    }, 150);
  }, [clearTimers]);

  const handleClick = useCallback(
    (e: MouseEvent<HTMLAnchorElement>) => {
      // Allow default external navigation on normal click
      if (!isSafeUrl(citation?.sourceUrl)) {
        e.preventDefault();
        return;
      }
      // Close popover on click
      setIsOpen(false);
    },
    [citation?.sourceUrl],
  );

  if (!citation || !isSafeUrl(citation.sourceUrl)) {
    return (
      <span
        className="border-outline-variant bg-muted text-muted-foreground mx-0.5 inline-flex items-center border px-1.5 py-0.5 align-baseline font-mono text-xs select-none"
        title={citation?.title}
      >
        {label}
      </span>
    );
  }

  return (
    <>
      <a
        ref={anchorRef}
        href={citation.sourceUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={handleClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onFocus={handleMouseEnter}
        onBlur={handleMouseLeave}
        className="group border-outline-variant bg-surface-container-high text-accent hover:border-accent hover:bg-accent focus-visible:ring-accent relative mx-0.5 inline-flex items-center border px-1.5 py-0.5 align-baseline font-mono text-[11px] font-bold transition-all duration-150 hover:text-black focus-visible:ring-1 focus-visible:outline-none"
        title={citation.title}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
      >
        <span>{label}</span>
      </a>

      <CitationPopover
        citation={citation}
        label={label}
        isOpen={isOpen}
        triggerRect={triggerRect}
        onMouseEnter={handlePopoverMouseEnter}
        onMouseLeave={handlePopoverMouseLeave}
        onClose={() => setIsOpen(false)}
      />
    </>
  );
}
