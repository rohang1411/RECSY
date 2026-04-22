import { PhoneImage } from '@/components/phone/PhoneImage';
import { formatUsdFromNumericString } from '@/lib/format-usd';

interface PhoneHeaderProps {
  readonly brand: string;
  readonly model: string;
  readonly tagline: string | null;
  readonly imageUrl: string | null;
  /** Postgres `msrp_usd` numeric as string */
  readonly msrpUsd: string | null;
}

export function PhoneHeader({ brand, model, tagline, imageUrl, msrpUsd }: PhoneHeaderProps) {
  const price = formatUsdFromNumericString(msrpUsd);
  const label = `${brand} ${model}`;
  return (
    <header className="border-border/80 bg-muted/25 border-b px-4 py-10 sm:px-6">
      <div className="mx-auto flex max-w-3xl flex-col gap-6 sm:flex-row sm:items-start sm:gap-8">
        <div className="shrink-0 self-center sm:self-start">
          <PhoneImage
            src={imageUrl}
            label={label}
            size={180}
            className="w-[min(100%,12rem)] sm:w-44"
          />
        </div>
        <div className="min-w-0 flex-1 text-center sm:text-left">
          <p className="text-muted-foreground text-sm font-medium tracking-wide uppercase">
            {brand}
          </p>
          <h1 className="text-foreground mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">
            {model}
          </h1>
          {price ? (
            <p className="text-foreground mt-2 text-lg font-medium tabular-nums">{price}</p>
          ) : null}
          {tagline ? (
            <p className="text-muted-foreground mt-3 max-w-2xl text-base leading-relaxed">
              {tagline}
            </p>
          ) : null}
        </div>
      </div>
    </header>
  );
}
