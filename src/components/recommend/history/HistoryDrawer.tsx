'use client';

/**
 * Mobile drawer for recommendation session history (Plan 27 WP-09).
 */
import React from 'react';
import { Sheet } from '@/components/ui/sheet';
import { HistoryPanel } from './HistoryPanel';

export interface HistoryDrawerProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
}

export function HistoryDrawer({ isOpen, onClose }: HistoryDrawerProps): React.JSX.Element {
  return (
    <Sheet
      isOpen={isOpen}
      onClose={onClose}
      title="Recommendation History"
      description="Past conversational recommendation sessions."
      width="320px"
      className="p-0"
    >
      <div className="h-[calc(100vh-100px)]">
        <HistoryPanel onSelect={onClose} />
      </div>
    </Sheet>
  );
}
