'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useQuota, quotaStore } from '@/components/quota/quota-store';
import { QuotaPips } from '@/components/quota/QuotaPips';
import { ResetCountdown } from '@/components/quota/ResetCountdown';
import { openAuthSheet } from '@/components/auth/AuthSheet';
import { toast } from 'sonner';

export default function AccountOverviewPage() {
  const quota = useQuota();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');

  if (!quota.signedIn) {
    return (
      <div className="border-border-hairline bg-surface border p-8 text-center md:p-12">
        <div className="text-accent mb-2 font-mono text-xs tracking-wider uppercase">
          Signed Out
        </div>
        <h2 className="text-foreground text-2xl font-bold">Sign In to View Your Account</h2>
        <p className="text-muted-foreground mx-auto mt-2 max-w-md font-mono text-xs leading-relaxed">
          Access your daily quota telemetry, billing history, credit balances, and cross-device
          search history.
        </p>
        <div className="mt-6">
          <button
            type="button"
            onClick={() => openAuthSheet({ reason: 'header' })}
            className="border-accent bg-accent hover:bg-accent-hover border px-6 py-2.5 font-mono text-xs font-bold tracking-wider text-black uppercase transition-colors"
          >
            Sign In Now
          </button>
        </div>
      </div>
    );
  }

  const isPro = quota.isSubscriber;
  const credits = quota.credits;
  const user = quota.user;

  const currentDisplayName =
    quota.displayName || (quota.email ? quota.email.split('@')[0] : 'Member');
  const currentDob = quota.dateOfBirth || '';
  const currentAvatar = quota.avatarUrl;
  const initial = ((currentDisplayName && currentDisplayName[0]) || 'U').toUpperCase();

  const handleStartEdit = () => {
    setDisplayName(quota.displayName || '');
    setDateOfBirth(quota.dateOfBirth || '');
    setEditing(true);
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch('/api/me/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: displayName.trim() || undefined,
          dateOfBirth: dateOfBirth.trim() || null,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to save profile');
      }

      toast.success('Profile updated successfully');
      setEditing(false);
      await quotaStore.refresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to update profile';
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Identity & Profile Strip */}
      <div className="border-border-hairline bg-surface border p-6">
        <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
          <div className="flex items-start gap-4">
            {/* Avatar Photo */}
            <div className="relative shrink-0">
              {currentAvatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={currentAvatar}
                  alt={currentDisplayName}
                  className="border-border-hairline h-16 w-16 rounded-full border object-cover shadow-sm"
                />
              ) : (
                <div className="bg-accent flex h-16 w-16 items-center justify-center rounded-full font-mono text-2xl font-bold text-black uppercase">
                  {initial}
                </div>
              )}
            </div>

            {/* Profile Data */}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2.5">
                <h2 className="text-foreground font-mono text-xl font-bold">
                  {currentDisplayName}
                </h2>
                <span className="border-border-hairline bg-surface-elevated text-text-primary border px-2.5 py-0.5 font-mono text-[10px] tracking-wider uppercase">
                  {isPro ? 'Pro Member' : credits > 0 ? 'Credit Holder' : 'Free Tier'}
                </span>
              </div>

              <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-3 font-mono text-xs">
                <span>{quota.email}</span>
                <span className="flex items-center gap-1 text-[11px] text-emerald-500">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  Verified
                </span>
              </div>

              {/* Date of Birth & Additional Info */}
              <div className="border-border-hairline/60 text-muted-foreground mt-3 flex flex-wrap items-center gap-4 border-t pt-3 font-mono text-xs">
                <div>
                  <span className="text-muted-foreground/80 block text-[10px] tracking-wider uppercase">
                    Date of Birth
                  </span>
                  <span className="text-foreground">
                    {currentDob ? (
                      currentDob
                    ) : (
                      <span className="text-muted-foreground italic">Not provided</span>
                    )}
                  </span>
                </div>
                {user?.createdAt && (
                  <div>
                    <span className="text-muted-foreground/80 block text-[10px] tracking-wider uppercase">
                      Member Since
                    </span>
                    <span className="text-foreground">
                      {new Date(user.createdAt).toLocaleDateString(undefined, {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                      })}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div>
            {!editing ? (
              <button
                type="button"
                onClick={handleStartEdit}
                className="border-border-hairline bg-surface hover:border-foreground hover:bg-surface-elevated border px-4 py-2 font-mono text-xs tracking-wider uppercase transition-colors"
              >
                Edit Profile
              </button>
            ) : null}
          </div>
        </div>

        {/* Inline Edit Form */}
        {editing && (
          <form onSubmit={handleSaveProfile} className="border-border-hairline mt-6 border-t pt-6">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="text-muted-foreground mb-1 block font-mono text-xs tracking-wider uppercase">
                  Full Name
                </label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="e.g. Rohan Sharma"
                  className="border-border-hairline bg-background text-foreground focus:border-accent w-full border px-3 py-2 font-mono text-xs outline-none"
                  required
                />
              </div>

              <div>
                <label className="text-muted-foreground mb-1 block font-mono text-xs tracking-wider uppercase">
                  Date of Birth (YYYY-MM-DD)
                </label>
                <input
                  type="date"
                  value={dateOfBirth}
                  onChange={(e) => setDateOfBirth(e.target.value)}
                  className="border-border-hairline bg-background text-foreground focus:border-accent w-full border px-3 py-2 font-mono text-xs outline-none"
                />
              </div>
            </div>

            <div className="mt-4 flex items-center gap-3">
              <button
                type="submit"
                disabled={saving}
                className="border-accent bg-accent hover:bg-accent-hover border px-5 py-2 font-mono text-xs font-bold tracking-wider text-black uppercase transition-colors disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                disabled={saving}
                className="border-border-hairline bg-surface text-muted-foreground hover:text-foreground border px-4 py-2 font-mono text-xs tracking-wider uppercase transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Today's Quota Instrument */}
      <div className="border-border-hairline bg-surface border p-6">
        <div className="border-border-hairline mb-5 flex flex-wrap items-center justify-between gap-4 border-b pb-4">
          <div>
            <div className="text-muted-foreground font-mono text-[10px] tracking-wider uppercase">
              Today&apos;s Quota Gauge
            </div>
            <h3 className="text-foreground text-base font-bold">Query Capacity</h3>
          </div>
          <QuotaPips allowance={quota.freeAllowance} remaining={quota.freeRemaining} />
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div>
            <div className="text-muted-foreground font-mono text-xs uppercase">
              Current Available Balance
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-foreground font-mono text-3xl font-extrabold">
                {isPro ? quota.subRemaining : quota.freeRemaining}
              </span>
              <span className="text-muted-foreground font-mono text-xs">
                {isPro ? 'Pro monthly queries remaining' : 'Daily free queries remaining'}
              </span>
            </div>
            {credits > 0 && (
              <div className="text-accent mt-2 font-mono text-xs">
                + {credits} purchased credits (never expires)
              </div>
            )}
          </div>

          <div className="border-border-hairline border-t pt-4 md:border-t-0 md:border-l md:pt-0 md:pl-6">
            <div className="text-muted-foreground font-mono text-xs uppercase">
              Daily Reset Clock
            </div>
            <div className="mt-1">
              <ResetCountdown resetAt={quota.resetAt} />
            </div>
          </div>
        </div>
      </div>

      {/* Plan Details & Actions */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className="border-border-hairline bg-surface flex flex-col justify-between border p-6">
          <div>
            <div className="text-muted-foreground font-mono text-[10px] tracking-wider uppercase">
              Subscription Status
            </div>
            <h3 className="text-foreground mt-1 text-lg font-bold">
              {isPro ? 'RECSY Pro Plan' : 'Free Daily Plan'}
            </h3>
            <p className="text-muted-foreground mt-2 font-mono text-xs leading-relaxed">
              {isPro
                ? '150 monthly queries with deep reasoning mode and cross-device multi-turn history.'
                : '2 queries every calendar day. Resets every night at 00:00 UTC.'}
            </p>
          </div>

          <div className="border-border-hairline mt-6 border-t pt-4">
            <Link
              href={isPro ? '/account/billing' : '/pricing'}
              className="border-border-hairline bg-surface-elevated text-foreground hover:border-foreground inline-flex w-full items-center justify-center border py-2.5 font-mono text-xs tracking-wider uppercase transition-colors"
            >
              {isPro ? 'Manage Subscription' : 'Upgrade to Pro'}
            </Link>
          </div>
        </div>

        <div className="border-border-hairline bg-surface flex flex-col justify-between border p-6">
          <div>
            <div className="text-muted-foreground font-mono text-[10px] tracking-wider uppercase">
              Credit Balance
            </div>
            <h3 className="text-foreground mt-1 text-lg font-bold">{credits} Query Credits</h3>
            <p className="text-muted-foreground mt-2 font-mono text-xs leading-relaxed">
              Purchased credit packs that never expire. Automatically used if your daily free
              queries run out.
            </p>
          </div>

          <div className="border-border-hairline mt-6 border-t pt-4">
            <Link
              href="/pricing"
              className="border-accent bg-accent/10 text-accent hover:bg-accent inline-flex w-full items-center justify-center border py-2.5 font-mono text-xs font-bold tracking-wider uppercase transition-colors hover:text-black"
            >
              Buy More Credits
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
