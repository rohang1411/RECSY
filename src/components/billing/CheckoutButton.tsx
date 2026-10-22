'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { openAuthSheet } from '@/components/auth/AuthSheet';
import { useQuota } from '@/components/quota/quota-store';

export interface CheckoutButtonProps {
  productId: 'pack_s' | 'pack_m' | 'pro_monthly';
  label?: string;
  variant?: 'solid' | 'outline' | 'ghost';
  className?: string;
  disabled?: boolean;
}

export function CheckoutButton({
  productId,
  label = 'Get Started',
  variant = 'solid',
  className = '',
  disabled = false,
}: CheckoutButtonProps) {
  const [loading, setLoading] = useState(false);
  const quota = useQuota();

  const handleCheckout = async () => {
    // If not signed in, open AuthSheet with purchase context
    if (!quota.signedIn) {
      openAuthSheet({ reason: 'purchase', next: window.location.pathname });
      return;
    }

    setLoading(true);

    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ productId }),
      });

      const data = await res.json().catch(() => ({}));

      if (res.status === 409 && data.code === 'ALREADY_SUBSCRIBED') {
        toast.info('You already have an active Pro subscription.');
        window.location.assign('/account/billing');
        return;
      }

      if (res.status === 503 && data.code === 'BILLING_NOT_AVAILABLE') {
        toast.error('Paid checkout is not yet enabled for public access.');
        return;
      }

      if (!res.ok || !data.url) {
        throw new Error(data.message || data.error || 'Checkout initialization failed.');
      }

      // Hosted Stripe navigation
      window.location.assign(data.url);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Unable to start checkout. Please try again.',
      );
      setLoading(false);
    }
  };

  return (
    <Button
      type="button"
      variant={variant}
      size="md"
      loading={loading}
      disabled={disabled || loading}
      onClick={handleCheckout}
      className={`font-mono text-xs tracking-wider uppercase ${className}`}
    >
      {loading ? 'Redirecting…' : label}
    </Button>
  );
}
