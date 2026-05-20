'use client';

import { useState } from 'react';
import { REGIONS, type RegionConfig } from '@/lib/regions';
import { Globe, X } from 'lucide-react';

interface RegionSelectorProps {
  readonly activeRegion: RegionConfig;
}

export function RegionSelector({ activeRegion }: RegionSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isChanging, setIsChanging] = useState(false);

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
      {/* Trigger Button */}
      <button
        onClick={() => setIsOpen(true)}
        className="border-primary bg-background hover:bg-primary hover:text-background focus-visible:bg-primary focus-visible:text-background flex cursor-pointer items-center gap-2 border-2 px-3 py-1 text-[11px] font-bold tracking-wider uppercase transition-all duration-150 focus-visible:outline-none"
        aria-label={`Select region (current: ${activeRegion.label})`}
      >
        <span className="text-[14px]" role="img" aria-label={activeRegion.label}>
          {activeRegion.flag}
        </span>
        <span>{activeRegion.countryCode}</span>
        <Globe className="h-3 w-3 shrink-0" />
      </button>

      {/* Backdrop */}
      {isOpen && (
        <div
          onClick={() => !isChanging && setIsOpen(false)}
          className="animate-in fade-in fixed inset-0 z-50 bg-black/60 backdrop-blur-xs transition-opacity duration-300"
        />
      )}

      {/* Slide-out Drawer */}
      <div
        className={`bg-background border-primary cubic-bezier(0.16, 1, 0.3, 1) fixed top-0 right-0 bottom-0 z-50 w-full max-w-[380px] border-l-3 p-6 transition-transform duration-300 ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        } flex flex-col justify-between`}
      >
        <div>
          {/* Drawer Header */}
          <div className="border-outline-variant mb-6 flex items-center justify-between border-b-2 pb-4">
            <h2 className="text-primary text-sm font-black tracking-widest uppercase">
              Select Region
            </h2>
            <button
              onClick={() => setIsOpen(false)}
              disabled={isChanging}
              className="border-outline hover:border-primary hover:bg-primary hover:text-background cursor-pointer border p-1 transition-colors focus-visible:outline-none disabled:opacity-50"
              aria-label="Close panel"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <p className="text-muted-foreground mb-6 text-[11px] leading-relaxed">
            We adapt catalog availability, brand pricing, and recommendation budgets based on your
            selection.
          </p>

          {/* Region Grid/List */}
          <div className="space-y-4">
            {Object.values(REGIONS).map((reg) => {
              const isSelected = reg.countryCode === activeRegion.countryCode;
              return (
                <button
                  key={reg.countryCode}
                  onClick={() => handleSelect(reg.countryCode)}
                  disabled={isChanging}
                  className={`w-full cursor-pointer border-2 p-4 text-left transition-all focus-visible:outline-none ${
                    isSelected
                      ? 'border-primary bg-surface-container-high'
                      : 'border-outline-variant hover:border-primary hover:bg-surface-container'
                  } disabled:opacity-50`}
                >
                  <div className="mb-2 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-2xl" role="img" aria-label={reg.label}>
                        {reg.flag}
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
                        {reg.countryCode === 'US' ? 'Official OEM / US' : 'India Local (Estimates)'}
                      </span>
                    </div>
                    {reg.countryCode === 'IN' && (
                      <div className="border-outline-variant text-accent mt-1 flex justify-between border-t border-dashed pt-1 text-[9px] font-bold">
                        <span>Rate:</span>
                        <span>1 USD = ₹83.50 INR</span>
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Drawer Footer */}
        <div className="border-outline-variant mt-6 border-t pt-4">
          <div className="text-muted-foreground text-center text-[9px]">
            RECSY V2 • Dynamic Regional Routing
            {isChanging && (
              <div className="text-primary mt-2 animate-pulse font-black tracking-widest uppercase">
                Applying region configuration...
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
