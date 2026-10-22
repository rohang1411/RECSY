'use client';

import React, { useState } from 'react';

export interface AccordionItem {
  id: string;
  title: string;
  content: React.ReactNode;
}

export interface AccordionProps {
  items: readonly AccordionItem[];
  allowMultiple?: boolean;
  defaultExpanded?: readonly string[];
  className?: string;
}

export function Accordion({
  items,
  allowMultiple = false,
  defaultExpanded = [],
  className = '',
}: AccordionProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set(defaultExpanded));

  const toggleItem = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        if (!allowMultiple) {
          next.clear();
        }
        next.add(id);
      }
      return next;
    });
  };

  return (
    <div
      className={`divide-border-hairline border-border-hairline bg-surface divide-y border ${className}`}
    >
      {items.map((item) => {
        const isOpen = expanded.has(item.id);
        const buttonId = `accordion-button-${item.id}`;
        const panelId = `accordion-panel-${item.id}`;

        return (
          <div key={item.id} className="group">
            <h3>
              <button
                id={buttonId}
                type="button"
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() => toggleItem(item.id)}
                className="hover:bg-surface-elevated/50 focus-visible:ring-accent flex w-full items-center justify-between px-5 py-4 text-left transition-colors focus-visible:ring-1 focus-visible:outline-none"
              >
                <span className="text-foreground text-sm font-semibold tracking-tight md:text-base">
                  {item.title}
                </span>
                <span
                  className="text-accent ml-4 flex h-6 w-6 shrink-0 items-center justify-center font-mono text-base font-bold transition-transform duration-200 select-none"
                  aria-hidden="true"
                >
                  {isOpen ? '−' : '+'}
                </span>
              </button>
            </h3>
            {isOpen && (
              <div
                id={panelId}
                role="region"
                aria-labelledby={buttonId}
                className="text-muted-foreground px-5 pt-1 pb-5 text-sm leading-relaxed"
              >
                {item.content}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
