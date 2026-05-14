'use client';

import { CheckCircle2, Search, Smartphone } from 'lucide-react';

import type { PhoneOption } from '@/services/internal/phone-evidence';

export function PhonePicker({
  options,
  selectedSlug,
  onChange,
}: {
  readonly options: readonly PhoneOption[];
  readonly selectedSlug: string;
  readonly onChange: (slug: string) => void;
}) {
  const selected = options.find((option) => option.slug === selectedSlug);

  return (
    <div className="border-border/60 bg-background/70 rounded-lg border p-3 shadow-xl shadow-black/10">
      <label className="text-muted-foreground flex items-center gap-2 text-xs font-medium">
        <Search className="size-3.5" aria-hidden />
        Evidence subject
      </label>
      <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <select
          value={selectedSlug}
          onChange={(event) => onChange(event.target.value)}
          className="border-border/70 bg-card text-foreground focus:border-primary h-10 w-full rounded-md border px-3 text-sm transition outline-none"
        >
          {options.map((option) => (
            <option key={option.slug} value={option.slug}>
              {option.label} - {option.sourceCount} sources, {option.chunkCount} chunks
            </option>
          ))}
        </select>
        <div className="text-muted-foreground border-border/60 bg-card/65 flex min-h-10 items-center gap-2 rounded-md border px-3 text-xs">
          {selected?.hasSpecEmbedding ? (
            <CheckCircle2 className="text-success size-4" aria-hidden />
          ) : (
            <Smartphone className="text-warning size-4" aria-hidden />
          )}
          <span>{selected?.hasSpecEmbedding ? 'Spec vector ready' : 'Spec vector pending'}</span>
        </div>
      </div>
    </div>
  );
}
