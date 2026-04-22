interface PhoneImageProps {
  readonly src: string | null;
  /** Accessibility / fallback */
  readonly label: string;
  readonly className?: string;
  /** Square side in CSS px */
  readonly size?: number;
}

/**
 * Product shot when `image_url` is set; otherwise a neutral initial-based
 * placeholder. Uses a plain {@link HTMLImageElement} for remote URLs so CDNs
 * (e.g. Wikimedia) that are picky about referrers or optimizers still render;
 * `referrerPolicy="no-referrer"` avoids common hotlink blocks.
 */
export function PhoneImage({ src, label, className, size = 200 }: PhoneImageProps) {
  const initial = label.trim().charAt(0).toUpperCase() || '?';
  if (src && src.length > 0) {
    return (
      <div className={className}>
        {/* eslint-disable-next-line @next/next/no-img-element -- remote product art; see module docstring */}
        <img
          src={src}
          alt={label}
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          className="bg-muted/50 h-auto w-full max-w-full rounded-xl object-contain"
        />
      </div>
    );
  }
  return (
    <div
      role="img"
      aria-label={label}
      className={`bg-muted/60 text-muted-foreground flex items-center justify-center rounded-xl text-4xl font-semibold ${className ?? ''}`}
      style={{ width: size, height: size }}
    >
      {initial}
    </div>
  );
}
