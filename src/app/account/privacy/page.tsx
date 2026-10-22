'use client';

import React, { useEffect, useState, useTransition } from 'react';

interface ProfileState {
  status: 'active' | 'pending_deletion' | 'suspended';
  deletionRequestedAt?: string | null;
  email?: string;
}

export default function AccountPrivacyPage() {
  const [profile, setProfile] = useState<ProfileState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Export state
  const [isExporting, startExporting] = useTransition();

  // Sign out everywhere state
  const [isSigningOut, startSigningOut] = useTransition();

  // Delete modal state
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [isDeleting, startDeleting] = useTransition();
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Cancel deletion state
  const [isCanceling, startCanceling] = useTransition();

  useEffect(() => {
    async function fetchAccountStatus() {
      try {
        const res = await fetch('/api/me/entitlements');
        if (res.ok) {
          const data = await res.json();
          // Profile status
          setProfile({
            status: data.isRestricted ? 'pending_deletion' : 'active',
          });
        }
      } catch {
        // Fallback
      } finally {
        setLoading(false);
      }
    }
    fetchAccountStatus();
  }, []);

  const handleExportData = () => {
    setError(null);
    setSuccess(null);
    startExporting(async () => {
      try {
        const res = await fetch('/api/account/export', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.message || 'Export failed or rate limit reached (max 1/day).');
        }

        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const dateStr = new Date().toISOString().split('T')[0];
        a.download = `recsy-export-${dateStr}.json`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        a.remove();

        setSuccess('Data export downloaded successfully.');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to export data');
      }
    });
  };

  const handleSignOutEverywhere = () => {
    setError(null);
    startSigningOut(async () => {
      try {
        const res = await fetch('/auth/signout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
        if (res.ok) {
          window.location.assign('/');
        } else {
          throw new Error('Sign out failed');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error signing out');
      }
    });
  };

  const handleDeleteAccount = () => {
    setDeleteError(null);
    if (deleteConfirmation.trim() !== 'DELETE') {
      setDeleteError('Please type DELETE to confirm.');
      return;
    }

    startDeleting(async () => {
      try {
        const res = await fetch('/api/account/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ confirm: 'DELETE' }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.message || 'Failed to schedule account deletion');
        }

        const result = await res.json();
        setProfile({
          status: 'pending_deletion',
          deletionRequestedAt: result.executeAfter || new Date().toISOString(),
        });
        setShowDeleteModal(false);
        setSuccess('Account scheduled for permanent deletion after 30-day cooling period.');
      } catch (err) {
        setDeleteError(err instanceof Error ? err.message : 'Failed to schedule deletion');
      }
    });
  };

  const handleCancelDeletion = () => {
    setError(null);
    startCanceling(async () => {
      try {
        const res = await fetch('/api/account/delete/cancel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.message || 'Failed to cancel deletion');
        }

        setProfile({ status: 'active' });
        setSuccess('Account deletion cancelled. Your account remains active.');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to cancel deletion');
      }
    });
  };

  return (
    <div className="space-y-8">
      {/* Pending Deletion Warning Banner */}
      {profile?.status === 'pending_deletion' && (
        <div role="alert" className="border-destructive bg-destructive/10 space-y-4 border p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="text-destructive font-mono text-xs font-bold tracking-wider uppercase">
                Account Scheduled for Deletion
              </div>
              <p className="text-muted-foreground mt-1 font-mono text-xs leading-relaxed">
                Your account is currently in the 30-day cooling-off period. Metered queries are
                restricted, but you may cancel deletion at any time to restore full access.
              </p>
            </div>
            <button
              type="button"
              disabled={isCanceling}
              onClick={handleCancelDeletion}
              className="border-destructive bg-destructive hover:bg-destructive-hover shrink-0 border px-5 py-2 font-mono text-xs font-bold tracking-wider text-white uppercase transition-colors disabled:opacity-50"
            >
              {isCanceling ? 'Cancelling…' : 'Cancel Deletion'}
            </button>
          </div>
        </div>
      )}

      {/* Global Notifications */}
      {error && (
        <div className="border-destructive/40 bg-surface text-destructive border p-4 font-mono text-xs">
          {error}
        </div>
      )}
      {success && (
        <div className="border-accent/40 bg-surface text-accent border p-4 font-mono text-xs">
          {success}
        </div>
      )}

      {/* Data Export & Sessions */}
      <section aria-labelledby="export-heading" className="space-y-4">
        <div>
          <div className="text-muted-foreground font-mono text-[10px] tracking-wider uppercase">
            Data Portability
          </div>
          <h2 id="export-heading" className="text-foreground text-xl font-bold">
            GDPR & CCPA Data Export
          </h2>
          <p className="text-muted-foreground mt-1 font-mono text-xs">
            Download a cryptographic snapshot of your complete account records, recommendation
            turns, credit purchases, and consents.
          </p>
        </div>

        <div className="border-border-hairline bg-surface flex flex-wrap items-center justify-between gap-4 border p-6">
          <div>
            <h3 className="text-foreground font-mono text-xs font-bold">
              Complete Account Archive (.json)
            </h3>
            <p className="text-muted-foreground mt-0.5 font-mono text-[11px]">
              Limited to once every 24 hours. Excludes internal security telemetry and hashes.
            </p>
          </div>
          <button
            type="button"
            disabled={isExporting || loading}
            onClick={handleExportData}
            className="border-border-hairline bg-surface-elevated text-foreground hover:border-foreground border px-4 py-2 font-mono text-xs tracking-wider uppercase transition-colors disabled:opacity-50"
          >
            {isExporting ? 'Exporting Archive…' : 'Export My Data (JSON)'}
          </button>
        </div>
      </section>

      {/* Active Session Management */}
      <section aria-labelledby="sessions-heading" className="space-y-4">
        <div>
          <div className="text-muted-foreground font-mono text-[10px] tracking-wider uppercase">
            Access Security
          </div>
          <h2 id="sessions-heading" className="text-foreground text-xl font-bold">
            Authentication Sessions
          </h2>
          <p className="text-muted-foreground mt-1 font-mono text-xs">
            Terminate all active browser cookies, API sessions, and device tokens across all
            platforms.
          </p>
        </div>

        <div className="border-border-hairline bg-surface flex flex-wrap items-center justify-between gap-4 border p-6">
          <div>
            <h3 className="text-foreground font-mono text-xs font-bold">Global Device Sign Out</h3>
            <p className="text-muted-foreground mt-0.5 font-mono text-[11px]">
              Invalidates all current sessions. You will be required to re-authenticate with a
              one-time code.
            </p>
          </div>
          <button
            type="button"
            disabled={isSigningOut || loading}
            onClick={handleSignOutEverywhere}
            className="border-border-hairline bg-surface-elevated text-foreground hover:border-foreground border px-4 py-2 font-mono text-xs tracking-wider uppercase transition-colors disabled:opacity-50"
          >
            {isSigningOut ? 'Signing Out…' : 'Sign Out Everywhere'}
          </button>
        </div>
      </section>

      {/* Danger Zone */}
      <section
        aria-labelledby="danger-heading"
        className="border-border-hairline space-y-4 border-t pt-4"
      >
        <div>
          <div className="text-destructive font-mono text-[10px] tracking-wider uppercase">
            Danger Zone
          </div>
          <h2 id="danger-heading" className="text-foreground text-xl font-bold">
            Permanent Account Deletion
          </h2>
          <p className="text-muted-foreground mt-1 font-mono text-xs">
            Irreversible removal of all user profiles, recommendation sessions, queries, and device
            linkages.
          </p>
        </div>

        <div className="border-destructive/40 bg-surface flex flex-wrap items-center justify-between gap-4 border p-6">
          <div className="max-w-xl">
            <h3 className="text-destructive font-mono text-xs font-bold">
              Delete Account & Associated Data
            </h3>
            <p className="text-muted-foreground mt-1 font-mono text-[11px] leading-relaxed">
              Schedules your account for deletion. Active subscriptions are cancelled immediately at
              period end. Any remaining purchased query credits are forfeited.
            </p>
          </div>
          <button
            type="button"
            disabled={profile?.status === 'pending_deletion'}
            onClick={() => setShowDeleteModal(true)}
            className="border-destructive bg-destructive/10 text-destructive hover:bg-destructive border px-4 py-2 font-mono text-xs font-bold tracking-wider uppercase transition-colors hover:text-white disabled:opacity-40"
          >
            {profile?.status === 'pending_deletion' ? 'Deletion Pending' : 'Delete Account'}
          </button>
        </div>
      </section>

      {/* Delete Confirmation Modal */}
      {showDeleteModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-modal-title"
          className="animate-in fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 duration-200"
        >
          <div className="border-destructive bg-surface w-full max-w-lg space-y-6 border p-6 md:p-8">
            <div>
              <div className="text-destructive mb-1 font-mono text-xs font-bold tracking-wider uppercase">
                Caution · Irreversible Action
              </div>
              <h3 id="delete-modal-title" className="text-foreground text-2xl font-bold">
                Confirm Account Deletion
              </h3>
            </div>

            <div className="text-muted-foreground border-border-hairline space-y-2 border-y py-4 font-mono text-xs">
              <p>
                • Your account will enter a mandatory <strong>30-day cooling-off period</strong>.
              </p>
              <p>• You may cancel deletion at any time before the 30 days expire by logging in.</p>
              <p>• Any active Pro subscription will be cancelled at period end.</p>
              <p>• Unused query credit packs are permanently forfeited.</p>
              <p>
                • After 30 days, your email, turns, and history will be cryptographically purged.
              </p>
            </div>

            <div className="space-y-3">
              <label htmlFor="confirm-delete" className="text-foreground block font-mono text-xs">
                Type <span className="text-destructive font-bold">DELETE</span> below to confirm:
              </label>
              <input
                id="confirm-delete"
                type="text"
                autoComplete="off"
                value={deleteConfirmation}
                onChange={(e) => setDeleteConfirmation(e.target.value)}
                placeholder="DELETE"
                className="border-border-hairline bg-background text-foreground focus:border-destructive w-full border px-3 py-2 font-mono text-sm focus:outline-none"
              />
              {deleteError && (
                <div className="text-destructive font-mono text-xs">{deleteError}</div>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => {
                  setShowDeleteModal(false);
                  setDeleteConfirmation('');
                  setDeleteError(null);
                }}
                className="border-border-hairline bg-surface-elevated text-foreground hover:border-foreground border px-4 py-2 font-mono text-xs tracking-wider uppercase transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isDeleting || deleteConfirmation.trim() !== 'DELETE'}
                onClick={handleDeleteAccount}
                className="border-destructive bg-destructive hover:bg-destructive-hover border px-5 py-2 font-mono text-xs font-bold tracking-wider text-white uppercase transition-colors disabled:opacity-40"
              >
                {isDeleting ? 'Scheduling Deletion…' : 'Schedule Account Deletion'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
