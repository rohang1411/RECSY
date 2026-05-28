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
          className={`image-reveal bg-surface-container h-full w-full ${
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
      className={`border-outline-variant bg-surface-container text-muted-foreground font-display flex items-center justify-center border text-4xl font-extrabold ${className ?? ''}`}
      style={wrapperStyle}
    >
      {initial}
    </div>
  );
}
