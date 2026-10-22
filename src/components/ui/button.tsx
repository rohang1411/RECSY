import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';
import Link from 'next/link';

import { cn } from '@/lib/utils';

export type ButtonVariant = 'outline' | 'solid' | 'ghost' | 'danger';
export type ButtonSize = 'md' | 'lg';

const base =
  'inline-flex items-center justify-center gap-2 font-mono uppercase transition-colors duration-150 rounded-none focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40 select-none';

const variantClasses: Record<ButtonVariant, string> = {
  outline:
    'border border-outline bg-transparent text-primary hover:bg-primary hover:text-background focus-visible:bg-primary focus-visible:text-background',
  solid:
    'border border-primary bg-primary text-background hover:bg-white/90 hover:text-background focus-visible:bg-white/90 focus-visible:text-background',
  ghost:
    'border border-transparent bg-transparent text-muted-foreground hover:border-outline hover:text-primary focus-visible:border-outline focus-visible:text-primary',
  danger:
    'border border-destructive/50 bg-destructive/10 text-destructive hover:bg-destructive hover:text-background focus-visible:bg-destructive focus-visible:text-background',
};

const sizeClasses: Record<ButtonSize, string> = {
  md: 'px-4 py-2 text-[11px] tracking-[0.18em]',
  lg: 'min-h-11 px-5 py-3 text-[12px] tracking-[0.18em]',
};

export interface BrutalistButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly loading?: boolean;
  readonly children: ReactNode;
}

export interface BrutalistLinkButtonProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  readonly href: string;
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly children: ReactNode;
}

function LoadingSpinner() {
  return (
    <svg
      className="h-3 w-3 animate-spin text-current"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

export function BrutalistButton({
  className,
  children,
  variant = 'outline',
  size = 'md',
  loading = false,
  disabled,
  ...props
}: BrutalistButtonProps) {
  return (
    <button
      className={cn(base, variantClasses[variant], sizeClasses[size], className)}
      disabled={disabled || loading}
      aria-busy={loading ? 'true' : undefined}
      {...props}
    >
      {loading && <LoadingSpinner />}
      {children}
    </button>
  );
}

export function BrutalistLinkButton({
  className,
  children,
  href,
  variant = 'outline',
  size = 'md',
  ...props
}: BrutalistLinkButtonProps) {
  return (
    <Link
      href={href}
      className={cn(base, variantClasses[variant], sizeClasses[size], className)}
      {...props}
    >
      {children}
    </Link>
  );
}
