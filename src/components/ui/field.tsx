'use client';

import { useId, forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  readonly label: string;
  readonly error?: string | null;
  readonly hint?: string;
  readonly optional?: boolean;
}

export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  { label, error, hint, optional, className, id: externalId, disabled, ...props },
  ref,
) {
  const generatedId = useId();
  const id = externalId ?? generatedId;
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;

  return (
    <div className="flex w-full flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <label
          htmlFor={id}
          className="meta-label text-primary font-mono text-[11px] tracking-[0.18em] uppercase"
        >
          {label}
        </label>
        {optional && (
          <span className="text-muted-foreground font-mono text-[10px] tracking-wider uppercase">
            Optional
          </span>
        )}
      </div>

      <input
        ref={ref}
        id={id}
        disabled={disabled}
        aria-invalid={error ? 'true' : 'false'}
        aria-describedby={error ? errorId : hint ? hintId : undefined}
        className={cn(
          // 16px on mobile (text-base) prevents iOS auto-zoom; md:text-sm for desktop
          'bg-surface-container-low text-foreground w-full rounded-none px-3 py-2.5 text-base md:text-sm',
          'border-outline border-b-2 transition-colors duration-150',
          'placeholder:text-muted-foreground/60',
          'focus:border-accent focus:bg-surface-container focus:outline-none',
          'disabled:cursor-not-allowed disabled:opacity-50',
          error && 'border-destructive focus:border-destructive',
          className,
        )}
        {...props}
      />

      {error ? (
        <p id={errorId} role="alert" className="text-destructive mt-0.5 text-xs">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-muted-foreground mt-0.5 text-xs">
          {hint}
        </p>
      ) : null}
    </div>
  );
});
