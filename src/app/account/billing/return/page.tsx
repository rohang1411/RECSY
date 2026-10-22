'use client';

import React, { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { ReturnStatus, type ReturnStatusType } from '@/components/billing/ReturnStatus';
import { Skeleton } from '@/components/ui/skeleton';

function ReturnContent() {
  const searchParams = useSearchParams();
  const rawStatus = searchParams.get('status')?.toLowerCase() || 'paid';
  const creditsParam = searchParams.get('credits');
  const productParam = searchParams.get('product');

  let initialStatus: ReturnStatusType = 'paid';
  if (rawStatus === 'pro' || rawStatus === 'pro_active') {
    initialStatus = 'pro_active';
  } else if (rawStatus === 'processing' || rawStatus === 'pending') {
    initialStatus = 'processing';
  } else if (rawStatus === 'failed') {
    initialStatus = 'failed';
  } else if (rawStatus === 'canceled' || rawStatus === 'cancelled') {
    initialStatus = 'canceled';
  } else if (rawStatus === 'not_found') {
    initialStatus = 'not_found';
  }

  const creditsAdded = creditsParam ? Number.parseInt(creditsParam, 10) || 25 : 25;
  const productName =
    productParam || (initialStatus === 'pro_active' ? 'RECSY Pro Monthly' : 'Query Credit Pack');

  return (
    <div className="mx-auto max-w-2xl py-8">
      <ReturnStatus
        initialStatus={initialStatus}
        creditsAdded={creditsAdded}
        productName={productName}
      />
    </div>
  );
}

export default function BillingReturnPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-2xl py-8">
          <Skeleton className="h-64 w-full" />
        </div>
      }
    >
      <ReturnContent />
    </Suspense>
  );
}
