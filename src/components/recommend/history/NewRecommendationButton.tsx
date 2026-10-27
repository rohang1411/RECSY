'use client';

/**
 * CTA Button to start a fresh recommendation session (Plan 27 WP-09).
 */
import React from 'react';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { clearDraft } from '@/lib/recommend-sessions/drafts';
import { cn } from '@/lib/utils';

export interface NewRecommendationButtonProps {
  readonly onSelect?: () => void;
  readonly className?: string;
}

export function NewRecommendationButton({
  onSelect,
  className,
}: NewRecommendationButtonProps): React.JSX.Element {
  const handleClick = () => {
    clearDraft('new');
    onSelect?.();
  };

  return (
    <Link
      href="/recommend"
      onClick={handleClick}
      className={cn(
        'border-primary bg-primary/10 text-primary hover:bg-primary inline-flex w-full items-center justify-center gap-2 border px-3 py-2.5 font-mono text-xs font-bold tracking-wider uppercase transition-colors hover:text-black',
        className,
      )}
    >
      <Plus className="size-3.5" aria-hidden />
      New recommendation
    </Link>
  );
}
