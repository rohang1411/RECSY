'use client';

import { Plus, X } from 'lucide-react';
import { useMemo, useState } from 'react';

import { PhoneImage } from '@/components/phone/PhoneImage';
import { formatUsdFromNumericString } from '@/lib/format-usd';
import { cn } from '@/lib/utils';

export type ComparePickerOption = {
  readonly slug: string;
  readonly label: string;
  readonly brand: string;
  readonly model: string;
  readonly imageUrl: string | null;
  readonly msrpUsd: string | null;
  readonly batteryMah: number | null;
  readonly refreshRateHz: number | null;
  readonly cameraMp: number | null;
};

export function ComparePhonePickers({
  options,
  defaultA = '',
  defaultB = '',
  defaultC = '',
}: {
  readonly options: readonly ComparePickerOption[];
  readonly defaultA?: string;
  readonly defaultB?: string;
  readonly defaultC?: string;
}) {
  const initial = [defaultA, defaultB, defaultC].filter(Boolean).slice(0, 3);
  const [slots, setSlots] = useState<string[]>(initial.length > 0 ? initial : ['', '']);
  const [openSlot, setOpenSlot] = useState<number | null>(null);
  const selectedSet = useMemo(() => new Set(slots.filter(Boolean)), [slots]);
  const canCompare = selectedSet.size >= 2;

  function setSlot(index: number, slug: string) {
    setSlots((current) => current.map((value, i) => (i === index ? slug : value)));
    setOpenSlot(null);
  }

  function clearSlot(index: number) {
    setSlots((current) => current.map((value, i) => (i === index ? '' : value)));
  }

  return (
    <form action="/compare" method="get" className="mt-8">
      <div className="bg-outline-variant grid gap-px lg:grid-cols-3">
        {slots.map((slug, index) => (
          <PickerSlot
            key={index}
            index={index}
            slug={slug}
            options={options}
            selectedSet={selectedSet}
            open={openSlot === index}
            onToggle={() => setOpenSlot((current) => (current === index ? null : index))}
            onSelect={(nextSlug) => setSlot(index, nextSlug)}
            onClear={() => clearSlot(index)}
          />
        ))}
        {slots.length < 3 ? (
          <button
            type="button"
            onClick={() => setSlots((current) => [...current, ''])}
            className="interactive-panel text-muted-foreground hover:text-primary flex min-h-56 items-center justify-center gap-3 p-5 font-mono text-xs tracking-[0.16em] uppercase"
          >
            <Plus className="size-4" aria-hidden />
            Add third phone
          </button>
        ) : null}
      </div>

      {slots[0] ? <input type="hidden" name="a" value={slots[0]} /> : null}
      {slots[1] ? <input type="hidden" name="b" value={slots[1]} /> : null}
      {slots[2] ? <input type="hidden" name="c" value={slots[2]} /> : null}

      <button
        type="submit"
        disabled={!canCompare}
        className="border-outline text-primary hover:bg-primary hover:text-background focus-visible:bg-primary focus-visible:text-background mt-6 border px-5 py-3 font-mono text-[11px] tracking-[0.18em] uppercase transition-colors focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40"
      >
        Compare
      </button>
    </form>
  );
}

function PickerSlot({
  index,
  slug,
  options,
  selectedSet,
  open,
  onToggle,
  onSelect,
  onClear,
}: {
  readonly index: number;
  readonly slug: string;
  readonly options: readonly ComparePickerOption[];
  readonly selectedSet: ReadonlySet<string>;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly onSelect: (slug: string) => void;
  readonly onClear: () => void;
}) {
  const selected = options.find((option) => option.slug === slug) ?? null;
  const availableOptions = options.filter(
    (option) => option.slug === slug || !selectedSet.has(option.slug),
  );

  return (
    <div className="interactive-panel group relative min-h-56 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="meta-label text-accent">Slot {index + 1}</p>
          <h3 className="text-gradient-steel font-display mt-3 text-3xl font-bold uppercase">
            {selected ? selected.model : 'Select phone'}
          </h3>
          {selected ? (
            <p className="text-muted-foreground mt-2 font-mono text-[11px] tracking-[0.14em] uppercase">
              {selected.brand} / {formatUsdFromNumericString(selected.msrpUsd) ?? 'price unknown'}
            </p>
          ) : null}
        </div>
        {selected ? (
          <button
            type="button"
            onClick={onClear}
            aria-label={`Remove ${selected.label}`}
            className="border-outline text-muted-foreground hover:border-accent hover:text-accent border p-2 transition-colors"
          >
            <X className="size-4" aria-hidden />
          </button>
        ) : null}
      </div>

      {selected ? (
        <div className="mt-5 grid grid-cols-[96px_1fr] gap-4">
          <PhoneImage
            src={selected.imageUrl}
            label={selected.label}
            size={96}
            className="h-24 w-24"
          />
          <dl className="grid content-start gap-2 font-mono text-[11px]">
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Battery</dt>
              <dd className="text-primary">
                {selected.batteryMah ? `${selected.batteryMah}mAh` : 'n/a'}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Display</dt>
              <dd className="text-primary">
                {selected.refreshRateHz ? `${selected.refreshRateHz}Hz` : 'n/a'}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Camera</dt>
              <dd className="text-primary">
                {selected.cameraMp ? `${selected.cameraMp}MP` : 'n/a'}
              </dd>
            </div>
          </dl>
        </div>
      ) : null}

      <div className="mt-5">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="border-outline text-primary hover:border-accent hover:text-accent inline-flex cursor-pointer border px-3 py-2 font-mono text-[11px] tracking-[0.16em] uppercase transition-colors"
        >
          {selected ? 'Change phone' : 'Open catalog'}
        </button>
        {open ? (
          <div className="border-outline-variant bg-background absolute inset-x-5 top-[calc(100%-1rem)] z-20 max-h-96 overflow-y-auto border shadow-2xl">
            {availableOptions.map((option) => (
              <button
                key={option.slug}
                type="button"
                onClick={() => onSelect(option.slug)}
                className={cn(
                  'group/option border-outline-variant hover:bg-surface-container focus-visible:bg-surface-container grid w-full grid-cols-[56px_1fr] gap-3 border-b p-3 text-left transition-colors last:border-b-0',
                  option.slug === slug && 'bg-surface-container',
                )}
              >
                <PhoneImage
                  src={option.imageUrl}
                  label={option.label}
                  size={56}
                  className="h-14 w-14 transition-transform duration-200 group-hover/option:scale-110"
                />
                <span>
                  <span className="text-primary block font-mono text-xs tracking-[0.12em] uppercase">
                    {option.label}
                  </span>
                  <span className="text-muted-foreground mt-1 block text-xs">
                    {formatUsdFromNumericString(option.msrpUsd) ?? 'price unknown'}
                  </span>
                  <span className="text-muted-foreground grid grid-cols-3 gap-2 overflow-hidden pt-0 font-mono text-[10px] tracking-[0.1em] uppercase opacity-0 transition-all duration-200 group-hover/option:pt-2 group-hover/option:opacity-100 group-focus-visible/option:pt-2 group-focus-visible/option:opacity-100">
                    <span>{option.batteryMah ? `${option.batteryMah}mAh` : 'battery n/a'}</span>
                    <span>
                      {option.refreshRateHz ? `${option.refreshRateHz}Hz` : 'display n/a'}
                    </span>
                    <span>{option.cameraMp ? `${option.cameraMp}MP` : 'camera n/a'}</span>
                  </span>
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
