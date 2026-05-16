import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';
import Link from 'next/link';

import { cn } from '@/lib/utils';

const base =
  'inline-flex items-center justify-center gap-2 border border-outline bg-transparent px-4 py-2 font-mono text-[11px] tracking-[0.18em] text-primary uppercase transition-colors duration-150 hover:bg-primary hover:text-background focus-visible:bg-primary focus-visible:text-background focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  readonly children: ReactNode;
};

type AnchorButtonProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  readonly href: string;
  readonly children: ReactNode;
};

export function BrutalistButton({ className, children, ...props }: ButtonProps) {
  return (
    <button className={cn(base, className)} {...props}>
      {children}
    </button>
  );
}

export function BrutalistLinkButton({ className, children, href, ...props }: AnchorButtonProps) {
  return (
    <Link href={href} className={cn(base, className)} {...props}>
      {children}
    </Link>
  );
}
