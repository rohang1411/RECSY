import Image from 'next/image';

interface PhoneImageProps {
  readonly src: string | null;
  /** Accessibility / fallback */
  readonly label: string;
  readonly className?: string;
  /** Square side in CSS px (passed to next/image) */
  readonly size?: number;
}

/**
 * Product shot when `image_url` is set; otherwise a neutral initial-based
 * placeholder. Uses `unoptimized` so we do not need per-CDN `remotePatterns`
 * for arbitrary press/CDN hosts.
 */
export function PhoneImage({ src, label, className, size = 200 }: PhoneImageProps) {
  const initial = label.trim().charAt(0).toUpperCase() || '?';
  if (src && src.length > 0) {
    return (
      <div className={className}>
        <Image
          src={src}
          alt={label}
          width={size}
          height={size}
          unoptimized
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
