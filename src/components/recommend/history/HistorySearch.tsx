'use client';

/**
 * Debounced search input for recommendation history (Plan 27 WP-09).
 */
import React, { useEffect, useState } from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface HistorySearchProps {
  readonly value: string;
  readonly onChange: (query: string) => void;
  readonly className?: string;
  readonly placeholder?: string;
}

export function HistorySearch({
  value,
  onChange,
  className,
  placeholder = 'Search history…',
}: HistorySearchProps): React.JSX.Element {
  const [localValue, setLocalValue] = useState(value);
  const [prevValue, setPrevValue] = useState(value);

  // Sync state during render when prop changes (React recommended pattern)
  if (value !== prevValue) {
    setPrevValue(value);
    setLocalValue(value);
  }

  // Debounce notification
  useEffect(() => {
    const timer = setTimeout(() => {
      if (localValue !== value) {
        onChange(localValue);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [localValue, onChange, value]);

  const handleClear = () => {
    setLocalValue('');
    onChange('');
  };

  return (
    <div className={cn('relative w-full', className)}>
      <Search
        className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2"
        aria-hidden
      />
      <input
        type="search"
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        placeholder={placeholder}
        aria-label="Search conversation history"
        className="border-outline-variant bg-surface-container text-foreground placeholder:text-muted-foreground w-full border py-1.5 pr-7 pl-8 font-mono text-xs focus:outline-none"
      />
      {localValue ? (
        <button
          type="button"
          onClick={handleClear}
          aria-label="Clear search"
          className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2 p-0.5"
        >
          <X className="size-3" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}
