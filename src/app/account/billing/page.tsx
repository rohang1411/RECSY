'use client';

import React, { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { LedgerTable, type LedgerEntryRecord } from '@/components/billing/LedgerTable';
import { Skeleton } from '@/components/ui/skeleton';
import { useQuota } from '@/components/quota/quota-store';

interface SubscriptionData {
  planCode: string;
  status: string;
  includedQueries: number;
  used: number;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  entitledUntil: string;
}

interface OrderData {
  id: string;
  productCode: string;
  amountMinor: number;
  currency: string;
  status: string;
  createdAt: string;
}

interface RawLedgerItem {
  at: string;
  delta: number;
  balanceAfter: number;
  kind: string;
  description: string;
}

interface BillingPayload {
  credits: number;
  subscription: SubscriptionData | null;
  orders: OrderData[];
  ledger: RawLedgerItem[];
  nextCursor: string | null;
  billingHold?: boolean;
}

export default function AccountBillingPage() {
  const quota = useQuota();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<BillingPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isOpeningPortal, startOpeningPortal] = useTransition();
  const [portalError, setPortalError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchBilling() {
      try {
        const res = await fetch('/api/me/billing');
        if (!res.ok) {
          throw new Error('Failed to load billing history');
        }
        const json = (await res.json()) as BillingPayload;
        setData(json);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error loading billing data.');
      } finally {
        setLoading(false);
      }
    }
    fetchBilling();
  }, []);

  const handleOpenPortal = () => {
    setPortalError(null);
    startOpeningPortal(async () => {
      try {
        const res = await fetch('/api/billing/portal', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.message || 'Unable to access customer portal.');
        }
        const { url } = (await res.json()) as { url: string };
        if (url) {
          window.location.assign(url);
        }
      } catch (err) {
        setPortalError(err instanceof Error ? err.message : 'Portal request failed');
      }
    });
  };

  const ledgerEntries: LedgerEntryRecord[] = (data?.ledger ?? []).map((item) => ({
    id: `${item.at}-${item.delta}`,
    createdAt: item.at,
    reason: item.description || item.kind,
    delta: item.delta,
    balanceAfter: item.balanceAfter,
  }));

  const sub = data?.subscription;
  const isPro = Boolean(sub && (sub.status === 'active' || sub.status === 'past_due'));

  return (
    <div className="space-y-8">
      {/* Billing Hold Notice if present */}
      {data?.billingHold && (
        <div
          role="alert"
          className="border-destructive/60 bg-destructive/10 text-destructive flex items-center justify-between border p-4 font-mono text-xs"
        >
          <span>
            <strong>BILLING HOLD ACTIVE:</strong> Your account has an open billing dispute or
            chargeback. Metered queries are temporarily held. Contact support to resolve.
          </span>
          <Link href="/contact" className="hover:text-foreground ml-4 shrink-0 font-bold underline">
            Contact Support
          </Link>
        </div>
      )}

      {/* Account Balances and Active Plans */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {/* Credits Panel */}
        <div className="border-border-hairline bg-surface flex flex-col justify-between border p-6">
          <div>
            <div className="text-muted-foreground font-mono text-[10px] tracking-wider uppercase">
              Purchased Credit Wallet
            </div>
            {loading ? (
              <Skeleton className="mt-2 h-10 w-24" />
            ) : (
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-foreground font-mono text-3xl font-extrabold">
                  {data?.credits ?? quota.credits}
                </span>
                <span className="text-muted-foreground font-mono text-xs">
                  Credits (never expire)
                </span>
              </div>
            )}
            <p className="text-muted-foreground mt-3 font-mono text-xs leading-relaxed">
              Credits are drawn only when your daily free quota is fully utilized.
            </p>
          </div>

          <div className="border-border-hairline mt-6 border-t pt-4">
            <Link
              href="/pricing"
              className="border-accent bg-accent/10 text-accent hover:bg-accent inline-flex w-full items-center justify-center border py-2.5 font-mono text-xs font-bold tracking-wider uppercase transition-colors hover:text-black"
            >
              Add Query Credits
            </Link>
          </div>
        </div>

        {/* Subscription Status Panel */}
        <div className="border-border-hairline bg-surface flex flex-col justify-between border p-6">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground font-mono text-[10px] tracking-wider uppercase">
                Subscription Plan
              </span>
              {isPro && (
                <span className="border-accent/40 bg-accent/10 text-accent border px-2 py-0.5 font-mono text-[10px] font-bold uppercase">
                  {sub?.status}
                </span>
              )}
            </div>
            {loading ? (
              <Skeleton className="mt-2 h-10 w-36" />
            ) : (
              <div className="mt-2">
                <h3 className="text-foreground font-mono text-xl font-bold">
                  {isPro ? 'RECSY Pro Monthly' : 'Free Tier'}
                </h3>
                {isPro && sub?.currentPeriodEnd && (
                  <p className="text-muted-foreground mt-1 font-mono text-xs">
                    {sub.cancelAtPeriodEnd ? 'Ends on ' : 'Renews on '}
                    {new Date(sub.currentPeriodEnd).toLocaleDateString(undefined, {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                    })}
                  </p>
                )}
                {!isPro && (
                  <p className="text-muted-foreground mt-1 font-mono text-xs">
                    2 daily free queries with nightly reset at 00:00 UTC.
                  </p>
                )}
              </div>
            )}
            <p className="text-muted-foreground mt-3 font-mono text-xs leading-relaxed">
              {isPro
                ? `${sub?.used ?? 0} of ${sub?.includedQueries ?? 150} monthly queries utilized.`
                : 'Upgrade to Pro for 150 monthly queries and deep reasoning mode.'}
            </p>
          </div>

          <div className="border-border-hairline mt-6 border-t pt-4">
            {isPro ? (
              <button
                type="button"
                disabled={isOpeningPortal}
                onClick={handleOpenPortal}
                className="border-border-hairline bg-surface-elevated text-foreground hover:border-foreground inline-flex w-full items-center justify-center border py-2.5 font-mono text-xs tracking-wider uppercase transition-colors disabled:opacity-50"
              >
                {isOpeningPortal ? 'Redirecting to Portal…' : 'Manage Payment Method & Invoices'}
              </button>
            ) : (
              <Link
                href="/pricing"
                className="border-border-hairline bg-surface-elevated text-foreground hover:border-foreground inline-flex w-full items-center justify-center border py-2.5 font-mono text-xs tracking-wider uppercase transition-colors"
              >
                Upgrade to Pro
              </Link>
            )}
            {portalError && (
              <div className="text-destructive mt-2 font-mono text-[11px]">{portalError}</div>
            )}
          </div>
        </div>
      </div>

      {/* Credit Ledger Table */}
      <section aria-labelledby="ledger-heading" className="space-y-4">
        <div>
          <div className="text-muted-foreground font-mono text-[10px] tracking-wider uppercase">
            Credit Wallet Ledger
          </div>
          <h2 id="ledger-heading" className="text-foreground text-xl font-bold">
            Transaction & Consumption Audit
          </h2>
          <p className="text-muted-foreground mt-1 font-mono text-xs">
            Complete cryptographic audit trail of all purchases, query charges, and credit grants.
          </p>
        </div>

        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : error ? (
          <div className="border-destructive/40 bg-surface text-destructive border p-6 font-mono text-xs">
            {error}
          </div>
        ) : (
          <LedgerTable entries={ledgerEntries} />
        )}
      </section>
    </div>
  );
}
