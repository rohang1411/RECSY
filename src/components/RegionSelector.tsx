'use client';

import { useEffect, useState } from 'react';
import { REGIONS, type RegionConfig } from '@/lib/regions';
import { useClientRegion } from '@/lib/region-client';
import { Globe } from 'lucide-react';
import { Sheet } from '@/components/ui/sheet';

interface RegionSelectorProps {
  readonly activeRegion?: RegionConfig;
}

export function RegionSelector({ activeRegion: initialActiveRegion }: RegionSelectorProps = {}) {
  const { region: clientRegion } = useClientRegion();
  const activeRegion = initialActiveRegion ?? clientRegion;
  const [isOpen, setIsOpen] = useState(false);
  const [isChanging, setIsChanging] = useState(false);
  const [liveInrRate, setLiveInrRate] = useState<number>(83.5);

  useEffect(() => {
    // Fetch cached daily exchange rate
    fetch('/api/exchange-rate')
      .then((res) => res.json())
      .then((data: { rate?: number }) => {
        if (typeof data.rate === 'number' && data.rate > 0) {
          setLiveInrRate(data.rate);
        }
      })
      .catch(() => {});
  }, []);

  const handleSelect = async (countryCode: string) => {
    if (countryCode === activeRegion.countryCode) {
      setIsOpen(false);
      return;
    }

    setIsChanging(true);
    try {
      const res = await fetch('/api/set-region', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ countryCode }),
      });

      if (res.ok) {
        // Refresh the page to trigger edge/server component re-evaluation
        window.location.reload();
      } else {
        console.error('Failed to change region');
        setIsChanging(false);
      }
    } catch (err) {
      console.error('Error changing region:', err);
      setIsChanging(false);
    }
  };

  return (
    <div className="relative font-mono">
      {/* Trigger Button with reserved width to avoid layout shift (CLS < 0.05) */}
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="border-outline bg-background hover:border-primary hover:bg-primary hover:text-background focus-visible:bg-primary focus-visible:text-background flex min-w-[76px] cursor-pointer items-center justify-between gap-2 border px-3 py-1 text-[11px] font-bold tracking-wider uppercase transition-colors duration-150 focus-visible:outline-none"
        aria-label={`Select region (current: ${activeRegion.label})`}
      >
        <span>
          {activeRegion.countryCode} ({activeRegion.symbol})
        </span>
        <Globe className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      </button>

      <Sheet
        isOpen={isOpen}
        onClose={() => !isChanging && setIsOpen(false)}
        title="SELECT REGION"
        description="We adapt catalog availability, pricing, and recommendations based on your selection."
      >
        <div className="flex h-full flex-col justify-between space-y-6">
          <div className="space-y-4">
            {Object.values(REGIONS).map((reg) => {
              const isSelected = reg.countryCode === activeRegion.countryCode;
              return (
                <button
                  key={reg.countryCode}
                  type="button"
                  onClick={() => handleSelect(reg.countryCode)}
                  disabled={isChanging}
                  className={`w-full cursor-pointer border p-4 text-left transition-all focus-visible:outline-none ${
                    isSelected
                      ? 'border-primary bg-surface-container-high'
                      : 'border-outline-variant hover:border-primary hover:bg-surface-container'
                  } disabled:opacity-50`}
                >
                  <div className="mb-2 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-primary font-mono text-sm font-bold">
                        {reg.countryCode} ({reg.symbol})
                      </span>
                      <span className="text-xs font-black tracking-wider uppercase">
                        {reg.label}
                      </span>
                    </div>
                    {isSelected && (
                      <span className="bg-primary text-background px-1.5 py-0.5 text-[9px] font-bold tracking-widest uppercase">
                        Active
                      </span>
                    )}
                  </div>

                  <div className="text-muted-foreground space-y-1 text-[10px]">
                    <div className="flex justify-between">
                      <span>Currency:</span>
                      <span className="text-foreground font-bold">
                        {reg.currency} ({reg.symbol})
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Catalog Source:</span>
                      <span className="text-foreground font-bold">
                        {reg.countryCode === 'US'
                          ? 'Official OEM / US'
                          : 'India Local (Live Estimates)'}
                      </span>
                    </div>
                    {reg.countryCode === 'IN' && (
                      <div className="border-outline-variant text-accent mt-1 flex justify-between border-t border-dashed pt-1 text-[9px] font-bold">
                        <span>Rate:</span>
                        <span>1 USD = ₹{liveInrRate.toFixed(2)} INR</span>
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="border-outline-variant border-t pt-4 text-center">
            <p className="text-muted-foreground font-mono text-[10px] tracking-wider uppercase">
              Dynamic Regional Routing
            </p>
            {isChanging && (
              <p className="text-primary mt-2 animate-pulse font-mono text-xs font-bold tracking-widest uppercase">
                Applying region configuration...
              </p>
            )}
          </div>
        </div>
      </Sheet>
    </div>
  );
}
