'use client';

import { useState } from 'react';

interface PhoneImageProps {
  readonly src: string | null;
  /** Accessibility / fallback */
  readonly label: string;
  readonly className?: string;
  /** Square side in CSS px */
  readonly size?: number;
  readonly fill?: boolean;
  readonly fit?: 'contain' | 'cover';
}

/**
 * Product shot when `image_url` is set; otherwise a neutral initial-based
 * placeholder. Uses a plain {@link HTMLImageElement} for remote URLs so CDNs
 * (e.g. Wikimedia) that are picky about referrers or optimizers still render;
 * `referrerPolicy="no-referrer"` avoids common hotlink blocks.
 */
export function PhoneImage({
  src,
  label,
  className,
  size = 200,
  fill = false,
  fit = 'contain',
}: PhoneImageProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const initial = label.trim().charAt(0).toUpperCase() || '?';
  const wrapperStyle = fill ? undefined : { width: size, height: size };
  const failed = src != null && src === failedSrc;

  if (src && src.length > 0 && !failed) {
    return (
      <div className={className} style={wrapperStyle}>
        {/* eslint-disable-next-line @next/next/no-img-element -- remote product art; see module docstring */}
        <img
          src={src}
          alt={label}
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailedSrc(src)}
          className={`image-reveal h-full w-full drop-shadow-md transition-transform duration-300 group-hover:scale-105 ${
            fit === 'cover' ? 'object-cover' : 'object-contain p-2'
          }`}
        />
      </div>
    );
  }
  return (
    <div
      role="img"
      aria-label={label}
      className={`border-outline-variant bg-surface-container/60 text-muted-foreground font-display flex flex-col items-center justify-center gap-2 border ${className ?? ''}`}
      style={wrapperStyle}
    >
      <svg
        className="text-muted-foreground/30 h-10 w-10"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <rect x="5" y="2" width="14" height="20" rx="3" ry="3" />
        <line x1="12" y1="18" x2="12" y2="18.01" strokeWidth={2.5} strokeLinecap="round" />
      </svg>
      <span className="font-mono text-xs tracking-widest uppercase opacity-60">{initial}</span>
    </div>
  );
}
