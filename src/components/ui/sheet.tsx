'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SheetProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly title: string;
  readonly description?: string;
  readonly children: ReactNode;
  readonly className?: string;
  readonly width?: string; // desktop width override, defaults to var(--sheet-w, 440px)
}

export function Sheet({
  isOpen,
  onClose,
  title,
  description,
  children,
  className,
  width,
}: SheetProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const previouslyFocusedElement = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen) {
      previouslyFocusedElement.current = document.activeElement as HTMLElement | null;
      if (!dialog.open) {
        dialog.showModal();
      }
      document.body.style.overflow = 'hidden';

      // Focus first focusable element inside the dialog (excluding the close button if another exists)
      const focusables = dialog.querySelectorAll<HTMLElement>(
        'input:not([disabled]), button:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href]',
      );
      if (focusables.length > 1) {
        // focus the first interactive input/action element after close button
        focusables[1]?.focus();
      } else if (focusables.length === 1) {
        focusables[0]?.focus();
      }
    } else {
      if (dialog.open) {
        dialog.close();
      }
      document.body.style.overflow = '';
      if (previouslyFocusedElement.current) {
        previouslyFocusedElement.current.focus();
        previouslyFocusedElement.current = null;
      }
    }

    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  // Handle ESC key directly via dialog cancel event
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleCancel = (e: Event) => {
      e.preventDefault();
      onClose();
    };

    dialog.addEventListener('cancel', handleCancel);
    return () => dialog.removeEventListener('cancel', handleCancel);
  }, [onClose]);

  if (!isOpen) return null;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="sheet-title"
      aria-describedby={description ? 'sheet-desc' : undefined}
      onClick={(e) => {
        // Close if click target is the backdrop itself
        if (e.target === dialogRef.current) {
          onClose();
        }
      }}
      className={cn(
        'text-foreground fixed z-[60] m-0 bg-transparent p-0',
        'backdrop:bg-black/80 backdrop:backdrop-blur-none',
        // Desktop: right sheet
        'md:top-0 md:right-0 md:bottom-0 md:left-auto md:h-full md:max-h-full',
        // Mobile: bottom sheet
        'max-md:top-auto max-md:right-0 max-md:bottom-0 max-md:left-0 max-md:max-h-[92dvh] max-md:w-full',
        'border-0 outline-none',
      )}
      style={{
        width: width ?? 'var(--sheet-w, 440px)',
      }}
    >
      <div
        className={cn(
          'bg-card border-outline-variant flex h-full flex-col overflow-y-auto border',
          'max-md:border-x-0 max-md:border-t max-md:border-b-0',
          'md:border-y-0 md:border-r-0 md:border-l',
          'animate-in fade-in-0 duration-200',
          'md:slide-in-from-right-6 max-md:slide-in-from-bottom-6',
          className,
        )}
      >
        {/* Header row */}
        <div className="border-outline-variant bg-surface-container-lowest flex min-h-[56px] shrink-0 items-center justify-between border-b px-6 py-4">
          <div className="flex flex-col">
            <span
              id="sheet-title"
              className="meta-label text-primary font-mono text-[11px] tracking-[0.18em] uppercase"
            >
              {title}
            </span>
            {description && (
              <span id="sheet-desc" className="text-muted-foreground mt-0.5 text-xs">
                {description}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close sheet"
            className="text-muted-foreground hover:text-primary focus-visible:text-primary focus-visible:ring-primary -mr-2 flex h-11 w-11 items-center justify-center transition-colors focus-visible:ring-1 focus-visible:outline-none"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {/* Content body */}
        <div className="flex-1 overflow-y-auto px-6 py-6">{children}</div>
      </div>
    </dialog>
  );
}
