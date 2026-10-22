'use client';

import { useState } from 'react';
import { QuotaChip } from '@/components/quota/QuotaChip';
import { QuotaSheet } from '@/components/quota/QuotaSheet';
import { AccountMenu } from '@/components/auth/AccountMenu';
import { useQuota } from '@/components/quota/quota-store';
import { RegionSelector } from './RegionSelector';
import type { RegionConfig } from '@/lib/regions';

export interface HeaderRightClusterProps {
  readonly activeRegion: RegionConfig;
}

export function HeaderRightCluster({ activeRegion }: HeaderRightClusterProps) {
  const [isQuotaSheetOpen, setIsQuotaSheetOpen] = useState(false);
  const quota = useQuota();

  const handleCheckout = (code: 'pack_s' | 'pack_m' | 'pro_monthly') => {
    // Redirect to checkout or pricing page
    window.location.href = `/pricing?product=${code}`;
  };

  return (
    <div className="flex items-center gap-3">
      <QuotaChip onOpenDetails={() => setIsQuotaSheetOpen(true)} />
      <RegionSelector activeRegion={activeRegion} />
      <div className="from-accent/80 hidden h-px w-8 bg-gradient-to-r to-transparent md:block" />
      <AccountMenu
        signedIn={quota.signedIn}
        email={quota.email}
        displayName={quota.displayName}
        firstName={quota.firstName}
        avatarUrl={quota.avatarUrl}
      />

      <QuotaSheet
        isOpen={isQuotaSheetOpen}
        onClose={() => setIsQuotaSheetOpen(false)}
        onSelectProduct={handleCheckout}
      />
    </div>
  );
}
