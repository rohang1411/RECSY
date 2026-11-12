'use client';

import React, { useState, useTransition } from 'react';
import type { BillingDashboardData } from '@/services/internal/billing-dashboard';

interface LookedUpUser {
  profile: {
    id: string;
    email: string;
    displayName: string | null;
    status: string;
    billingHold: boolean;
    createdAt: string;
    lastSeenAt: string;
  };
  balance: number;
  leases: Array<{
    id: string;
    status: string;
    charge_source: string;
    cost_micros: number;
    latency_ms: number | null;
    trace_id: string;
    created_at: string;
  }>;
  ledger: Array<{
    id: string;
    delta: number;
    kind: string;
    source: string;
    ref_id: string | null;
    created_at: string;
  }>;
  orders: Array<{
    id: string;
    provider: string;
    product_code: string;
    amount_cents: number;
    status: string;
    created_at: string;
  }>;
  subscriptions: Array<{
    id: string;
    provider: string;
    plan_code: string;
    status: string;
    current_period_end: string;
  }>;
}

export function BillingDashboardClient({ initialData }: { initialData: BillingDashboardData }) {
  const [data] = useState(initialData);
  const [isPending, startTransition] = useTransition();

  // User search
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [lookedUpUser, setLookedUpUser] = useState<LookedUpUser | null>(null);

  // Action states
  const [creditsToGrant, setCreditsToGrant] = useState('5');
  const [grantReason, setGrantReason] = useState('');
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const handleSearchUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setSearching(true);
    setSearchError(null);
    setActionFeedback(null);
    setActionError(null);

    try {
      const res = await fetch(
        `/api/internal/billing/user?q=${encodeURIComponent(searchQuery.trim())}`,
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'User not found');
      }
      const json = await res.json();
      setLookedUpUser(json.user);
    } catch (err) {
      setLookedUpUser(null);
      setSearchError(err instanceof Error ? err.message : 'Error finding user');
    } finally {
      setSearching(false);
    }
  };

  const handleGrantCredits = () => {
    if (!lookedUpUser || !grantReason.trim()) {
      setActionError('Reason is mandatory when granting operator credits');
      return;
    }
    setActionError(null);
    setActionFeedback(null);

    startTransition(async () => {
      try {
        const res = await fetch('/api/internal/billing/action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'grant_credits',
            userId: lookedUpUser.profile.id,
            credits: Number(creditsToGrant) || 5,
            reason: grantReason.trim(),
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.message || 'Failed to grant credits');
        }
        const json = await res.json();
        setLookedUpUser((prev) =>
          prev
            ? {
                ...prev,
                balance:
                  (json.result.newBalance as number) ?? prev.balance + Number(creditsToGrant),
              }
            : null,
        );
        setActionFeedback(`Granted ${creditsToGrant} credits to ${lookedUpUser.profile.email}.`);
        setGrantReason('');
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'Error granting credits');
      }
    });
  };

  const handleToggleHold = () => {
    if (!lookedUpUser) return;
    const nextHold = !lookedUpUser.profile.billingHold;
    const reason = prompt(`Reason for setting billing hold to ${nextHold ? 'ON' : 'OFF'}:`);
    if (!reason || !reason.trim()) return;

    startTransition(async () => {
      try {
        const res = await fetch('/api/internal/billing/action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'set_billing_hold',
            userId: lookedUpUser.profile.id,
            hold: nextHold,
            reason: reason.trim(),
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.message || 'Failed to toggle hold');
        }
        setLookedUpUser((prev) =>
          prev ? { ...prev, profile: { ...prev.profile, billingHold: nextHold } } : null,
        );
        setActionFeedback(`Billing hold set to ${nextHold ? 'ON' : 'OFF'}.`);
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'Failed to update billing hold');
      }
    });
  };

  const handleToggleSuspend = () => {
    if (!lookedUpUser) return;
    const isSuspended = lookedUpUser.profile.status === 'suspended';
    const nextStatus = isSuspended ? 'active' : 'suspended';
    const reason = prompt(`Reason for setting account status to ${nextStatus}:`);
    if (!reason || !reason.trim()) return;

    startTransition(async () => {
      try {
        const res = await fetch('/api/internal/billing/action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'set_account_status',
            userId: lookedUpUser.profile.id,
            status: nextStatus,
            reason: reason.trim(),
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.message || 'Failed to update status');
        }
        setLookedUpUser((prev) =>
          prev ? { ...prev, profile: { ...prev.profile, status: nextStatus } } : null,
        );
        setActionFeedback(`Account status set to ${nextStatus}.`);
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'Failed to update status');
      }
    });
  };

  return (
    <div className="space-y-8 p-6 lg:p-8">
      {/* 1. High-Level Revenue & Invariant Stats */}
      <section className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {/* Today's Revenue */}
        <div className="border-border-hairline bg-surface space-y-2 border p-5 font-mono">
          <div className="text-muted-foreground text-[10px] tracking-wider uppercase">
            Today&apos;s Revenue
          </div>
          <div className="text-foreground text-2xl font-bold">
            ${(data.revenue.todayCents / 100).toFixed(2)}
          </div>
          <div className="text-muted-foreground text-xs">
            {data.revenue.ordersCountToday} orders fulfilled
          </div>
        </div>

        {/* 30-Day Revenue */}
        <div className="border-border-hairline bg-surface space-y-2 border p-5 font-mono">
          <div className="text-muted-foreground text-[10px] tracking-wider uppercase">
            30-Day Revenue
          </div>
          <div className="text-foreground text-2xl font-bold">
            ${(data.revenue.monthCents / 100).toFixed(2)}
          </div>
          <div className="text-muted-foreground text-xs">
            7d: ${(data.revenue.weekCents / 100).toFixed(2)}
          </div>
        </div>

        {/* Active Subscriptions */}
        <div className="border-border-hairline bg-surface space-y-2 border p-5 font-mono">
          <div className="text-muted-foreground text-[10px] tracking-wider uppercase">
            Active Pro Subs
          </div>
          <div className="text-foreground text-2xl font-bold">{data.subscriptions.activeCount}</div>
          <div className="text-muted-foreground text-xs">
            ~${(data.subscriptions.estimatedMrrCents / 100).toFixed(0)} MRR
          </div>
        </div>

        {/* Ledger Invariant Check */}
        <div className="border-border-hairline bg-surface space-y-2 border p-5 font-mono">
          <div className="text-muted-foreground text-[10px] tracking-wider uppercase">
            Ledger Invariant
          </div>
          <div
            className={`text-2xl font-bold ${
              data.ledgerDrift.fired ? 'text-destructive' : 'text-accent'
            }`}
          >
            {data.ledgerDrift.fired ? 'DRIFT' : 'EXACT'}
          </div>
          <div className="text-muted-foreground text-xs">{data.ledgerDrift.summary}</div>
        </div>
      </section>

      {/* 2. Customer Lookup & Administrative Action Suite */}
      <section className="border-border-hairline bg-surface space-y-6 border p-6">
        <div>
          <div className="text-muted-foreground font-mono text-[10px] tracking-wider uppercase">
            Customer Operations
          </div>
          <h3 className="text-foreground text-lg font-bold">Account Search & Action Console</h3>
          <p className="text-muted-foreground mt-1 font-mono text-xs">
            Search by user email or UUID to inspect entitlements, audit ledger rows, grant credits,
            or manage holds.
          </p>
        </div>

        {/* Search Form */}
        <form onSubmit={handleSearchUser} className="flex gap-3">
          <input
            type="text"
            placeholder="Search by user email or UUID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="border-border-hairline bg-surface-elevated text-foreground placeholder:text-muted-foreground/60 focus:border-accent flex-1 border px-3 py-2 font-mono text-xs focus:outline-none"
          />
          <button
            type="submit"
            disabled={searching}
            className="border-border-hairline bg-surface hover:border-foreground border px-5 py-2 font-mono text-xs font-bold tracking-wider uppercase transition-colors"
          >
            {searching ? 'Searching…' : 'Lookup'}
          </button>
        </form>

        {searchError && (
          <div className="border-destructive/40 bg-destructive/5 text-destructive border p-3 font-mono text-xs">
            {searchError}
          </div>
        )}
        {actionFeedback && (
          <div className="border-accent/40 bg-accent/5 text-accent border p-3 font-mono text-xs">
            {actionFeedback}
          </div>
        )}
        {actionError && (
          <div className="border-destructive/40 bg-destructive/5 text-destructive border p-3 font-mono text-xs">
            {actionError}
          </div>
        )}

        {/* Looked Up User Card */}
        {lookedUpUser && (
          <div className="border-border-hairline bg-surface-elevated space-y-6 border p-6 font-mono text-xs">
            {/* Header info */}
            <div className="border-border-hairline flex flex-wrap items-center justify-between gap-4 border-b pb-4">
              <div>
                <div className="text-foreground text-sm font-bold">
                  {lookedUpUser.profile.email}
                </div>
                <div className="text-muted-foreground mt-0.5 text-[11px]">
                  ID: {lookedUpUser.profile.id}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="border-border-hairline border px-2 py-0.5 text-[10px] uppercase">
                  Status: {lookedUpUser.profile.status}
                </span>
                {lookedUpUser.profile.billingHold && (
                  <span className="border-destructive text-destructive border px-2 py-0.5 text-[10px] uppercase">
                    Billing Hold Active
                  </span>
                )}
                <span className="border-accent text-accent border px-2 py-0.5 text-[10px] uppercase">
                  Balance: {lookedUpUser.balance} credits
                </span>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {/* Grant Credits */}
              <div className="border-border-hairline bg-surface space-y-3 border p-4">
                <div className="text-foreground font-bold uppercase">Grant Adjustment Credits</div>
                <div className="flex gap-2">
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={creditsToGrant}
                    onChange={(e) => setCreditsToGrant(e.target.value)}
                    className="border-border-hairline bg-surface-elevated text-foreground focus:border-accent w-24 border px-2 py-1 focus:outline-none"
                  />
                  <input
                    type="text"
                    placeholder="Reason (mandatory for audit)..."
                    value={grantReason}
                    onChange={(e) => setGrantReason(e.target.value)}
                    className="border-border-hairline bg-surface-elevated text-foreground focus:border-accent flex-1 border px-2 py-1 focus:outline-none"
                  />
                </div>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={handleGrantCredits}
                  className="border-accent bg-accent/10 text-accent hover:bg-accent w-full border px-3 py-1.5 font-bold uppercase transition-colors hover:text-black"
                >
                  Apply Credit Grant
                </button>
              </div>

              {/* Status Toggles */}
              <div className="border-border-hairline bg-surface space-y-3 border p-4">
                <div className="text-foreground font-bold uppercase">Account Security Controls</div>
                <div className="flex gap-3">
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={handleToggleHold}
                    className="border-border-hairline hover:border-foreground flex-1 border px-3 py-1.5 uppercase transition-colors"
                  >
                    {lookedUpUser.profile.billingHold ? 'Clear Hold' : 'Set Billing Hold'}
                  </button>
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={handleToggleSuspend}
                    className="border-destructive/60 bg-destructive/10 text-destructive hover:bg-destructive flex-1 border px-3 py-1.5 uppercase transition-colors hover:text-white"
                  >
                    {lookedUpUser.profile.status === 'suspended'
                      ? 'Restore User'
                      : 'Suspend Account'}
                  </button>
                </div>
              </div>
            </div>

            {/* Recent Leases Table */}
            <div className="space-y-2">
              <div className="text-foreground font-bold uppercase">
                Recent Metered Leases (Last 50)
              </div>
              <div className="divide-border-hairline border-border-hairline max-h-56 divide-y overflow-y-auto border">
                {lookedUpUser.leases.map((l) => (
                  <div
                    key={l.id}
                    className="text-muted-foreground flex justify-between p-2 text-[11px]"
                  >
                    <span>
                      <strong className="text-foreground capitalize">{l.status}</strong> via{' '}
                      {l.charge_source}
                    </span>
                    <span>
                      {l.latency_ms ?? 0}ms · ${((l.cost_micros ?? 0) / 1_000_000).toFixed(4)} ·{' '}
                      {new Date(l.created_at).toLocaleTimeString()}
                    </span>
                  </div>
                ))}
                {lookedUpUser.leases.length === 0 && (
                  <div className="text-muted-foreground p-3 text-center">
                    No recent leases found.
                  </div>
                )}
              </div>
            </div>

            {/* Ledger Transactions */}
            <div className="space-y-2">
              <div className="text-foreground font-bold uppercase">Credit Ledger Trail</div>
              <div className="divide-border-hairline border-border-hairline max-h-48 divide-y overflow-y-auto border">
                {lookedUpUser.ledger.map((ld) => (
                  <div
                    key={ld.id}
                    className="text-muted-foreground flex justify-between p-2 text-[11px]"
                  >
                    <span>
                      Delta:{' '}
                      <strong className={ld.delta > 0 ? 'text-accent' : 'text-foreground'}>
                        {ld.delta > 0 ? `+${ld.delta}` : ld.delta}
                      </strong>{' '}
                      ({ld.kind} / {ld.source})
                    </span>
                    <span>{new Date(ld.created_at).toLocaleDateString()}</span>
                  </div>
                ))}
                {lookedUpUser.ledger.length === 0 && (
                  <div className="text-muted-foreground p-3 text-center">
                    No ledger transactions.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </section>

      {/* 3. Platform Recent Orders */}
      <section className="border-border-hairline bg-surface space-y-4 border p-6 font-mono text-xs">
        <div>
          <div className="text-muted-foreground text-[10px] tracking-wider uppercase">
            Platform Transactions
          </div>
          <h3 className="text-foreground text-lg font-bold">Recent Billing Orders</h3>
        </div>

        <div className="divide-border-hairline border-border-hairline divide-y border">
          {data.recentOrders.map((ord) => (
            <div
              key={ord.id}
              className="text-muted-foreground flex items-center justify-between p-3"
            >
              <div>
                <strong className="text-foreground">{ord.productCode}</strong> via {ord.provider}
                <div className="text-[10px]">User: {ord.userId}</div>
              </div>
              <div className="text-right">
                <div className="text-foreground font-bold">
                  ${(ord.amountCents / 100).toFixed(2)}
                </div>
                <div className="text-[10px] uppercase">{ord.status}</div>
              </div>
            </div>
          ))}
          {data.recentOrders.length === 0 && (
            <div className="text-muted-foreground p-4 text-center">Zero orders recorded.</div>
          )}
        </div>
      </section>
    </div>
  );
}
