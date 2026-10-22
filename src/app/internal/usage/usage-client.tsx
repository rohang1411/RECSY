'use client';

import React, { useState, useTransition } from 'react';
import type { UsageDashboardData } from '@/services/internal/usage-dashboard';

export function UsageDashboardClient({ initialData }: { initialData: UsageDashboardData }) {
  const [data, setData] = useState(initialData);
  const [isPending, startTransition] = useTransition();
  const [flagFeedback, setFlagFeedback] = useState<string | null>(null);
  const [flagError, setFlagError] = useState<string | null>(null);

  // Form states for flag edits
  const [killSwitchReason, setKillSwitchReason] = useState('');
  const [newCap, setNewCap] = useState(data.cap.cap);
  const [capReason, setCapReason] = useState('');

  // Form state for adding an abuse block
  const [blockKind, setBlockKind] = useState<'ip_key' | 'device' | 'email_normalized' | 'user'>(
    'ip_key',
  );
  const [blockValue, setBlockValue] = useState('');
  const [blockReason, setBlockReason] = useState('');
  const [blockTtlHours, setBlockTtlHours] = useState('24');
  const [blockFeedback, setBlockFeedback] = useState<string | null>(null);

  const isKillSwitchOn = Boolean(data.flags['kill_switch']?.value?.enabled);

  const handleToggleKillSwitch = () => {
    if (!killSwitchReason.trim()) {
      setFlagError('Operator reason is mandatory when toggling the emergency kill switch');
      return;
    }
    setFlagError(null);
    setFlagFeedback(null);

    startTransition(async () => {
      try {
        const nextState = !isKillSwitchOn;
        const res = await fetch('/api/internal/flags', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            key: 'kill_switch',
            value: {
              enabled: nextState,
              message: nextState ? 'Emergency platform pause active' : undefined,
            },
            reason: killSwitchReason,
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.message || 'Failed to update flag');
        }
        setData((prev) => ({
          ...prev,
          flags: {
            ...prev.flags,
            kill_switch: {
              value: { enabled: nextState },
              updatedAt: new Date().toISOString(),
              updatedBy: 'operator',
            },
          },
          cap: {
            ...prev.cap,
            rung: nextState ? 'paused' : prev.cap.ratio >= 0.8 ? 'busy' : 'ok',
          },
        }));
        setFlagFeedback(`Kill switch ${nextState ? 'ACTIVATED' : 'DEACTIVATED'} successfully.`);
        setKillSwitchReason('');
      } catch (err) {
        setFlagError(err instanceof Error ? err.message : 'Error toggling kill switch');
      }
    });
  };

  const handleUpdateCap = () => {
    if (!capReason.trim()) {
      setFlagError('Operator reason is mandatory when adjusting the global platform cap');
      return;
    }
    setFlagError(null);
    setFlagFeedback(null);

    startTransition(async () => {
      try {
        const res = await fetch('/api/internal/flags', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            key: 'global_daily_platform_cap',
            value: { cap: Number(newCap) },
            reason: capReason,
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.message || 'Failed to update cap');
        }
        setData((prev) => {
          const cap = Number(newCap);
          const ratio = cap > 0 ? prev.cap.used / cap : 0;
          return {
            ...prev,
            flags: {
              ...prev.flags,
              global_daily_platform_cap: {
                value: { cap },
                updatedAt: new Date().toISOString(),
                updatedBy: 'operator',
              },
            },
            cap: {
              ...prev.cap,
              cap,
              ratio,
              rung: isKillSwitchOn ? 'paused' : ratio >= 0.8 ? 'busy' : 'ok',
            },
          };
        });
        setFlagFeedback(`Platform daily cap updated to ${newCap}.`);
        setCapReason('');
      } catch (err) {
        setFlagError(err instanceof Error ? err.message : 'Error updating daily cap');
      }
    });
  };

  const handleAddAbuseBlock = () => {
    if (!blockValue.trim() || !blockReason.trim()) {
      setBlockFeedback('Block target value and reason are required.');
      return;
    }
    startTransition(async () => {
      try {
        const res = await fetch('/api/internal/billing/action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'create_abuse_block',
            kind: blockKind,
            value: blockValue.trim(),
            reason: blockReason.trim(),
            ttlHours: Number(blockTtlHours) || 24,
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.message || 'Failed to create block');
        }
        setBlockFeedback(`Abuse block created for ${blockKind}: ${blockValue}`);
        setBlockValue('');
        setBlockReason('');
      } catch (err) {
        setBlockFeedback(err instanceof Error ? err.message : 'Error creating abuse block');
      }
    });
  };

  const handleRemoveAbuseBlock = (id: string) => {
    startTransition(async () => {
      try {
        const res = await fetch('/api/internal/billing/action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'remove_abuse_block',
            id,
            reason: 'Operator cleared block manually',
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.message || 'Failed to delete block');
        }
        setData((prev) => ({
          ...prev,
          abuseBlocks: prev.abuseBlocks.filter((b) => b.id !== id),
        }));
      } catch (err) {
        alert(err instanceof Error ? err.message : 'Failed to remove block');
      }
    });
  };

  return (
    <div className="space-y-8 p-6 lg:p-8">
      {/* 1. Daily Capacity & State Gauge */}
      <section className="border-border-hairline bg-surface space-y-4 border p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-muted-foreground font-mono text-[10px] tracking-wider uppercase">
              Platform Telemetry
            </div>
            <h2 className="text-foreground text-xl font-bold">Daily Metering Admission & Cap</h2>
          </div>
          <div className="flex items-center gap-3">
            <span
              className={`border px-3 py-1 font-mono text-xs font-bold tracking-wider uppercase ${
                data.cap.rung === 'paused'
                  ? 'border-destructive/60 bg-destructive/10 text-destructive'
                  : data.cap.rung === 'busy'
                    ? 'border-warning/60 bg-warning/10 text-warning'
                    : 'border-accent/60 bg-accent/10 text-accent'
              }`}
            >
              Rung: {data.cap.rung.toUpperCase()}
            </span>
          </div>
        </div>

        {/* Progress bar */}
        <div className="space-y-2">
          <div className="text-muted-foreground flex justify-between font-mono text-xs">
            <span>
              Queries Today:{' '}
              <strong className="text-foreground">{data.cap.used.toLocaleString()}</strong>
            </span>
            <span>
              Cap: <strong className="text-foreground">{data.cap.cap.toLocaleString()}</strong> (
              {(data.cap.ratio * 100).toFixed(1)}%)
            </span>
          </div>
          <div className="border-border-hairline bg-surface-elevated h-3 w-full border">
            <div
              className={`h-full transition-all duration-300 ${
                data.cap.ratio >= 1.0
                  ? 'bg-destructive'
                  : data.cap.ratio >= 0.8
                    ? 'bg-warning'
                    : 'bg-accent'
              }`}
              style={{ width: `${Math.min(data.cap.ratio * 100, 100)}%` }}
            />
          </div>
        </div>
      </section>

      {/* 2. Platform Flags Operator Panel */}
      <section className="border-border-hairline bg-surface space-y-6 border p-6">
        <div>
          <div className="text-muted-foreground font-mono text-[10px] tracking-wider uppercase">
            Operational Controls
          </div>
          <h3 className="text-foreground text-lg font-bold">Platform State & Flag Editor</h3>
          <p className="text-muted-foreground mt-1 font-mono text-xs">
            Every flag change logs a mandatory audit record to the security log.
          </p>
        </div>

        {flagFeedback && (
          <div className="border-accent/40 bg-accent/5 text-accent border p-3 font-mono text-xs">
            {flagFeedback}
          </div>
        )}
        {flagError && (
          <div className="border-destructive/40 bg-destructive/5 text-destructive border p-3 font-mono text-xs">
            {flagError}
          </div>
        )}

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {/* Emergency Kill Switch */}
          <div className="border-border-hairline bg-surface-elevated space-y-3 border p-4">
            <div className="flex items-center justify-between">
              <span className="text-foreground font-mono text-xs font-bold uppercase">
                Kill Switch (503 Paused)
              </span>
              <span
                className={`font-mono text-xs font-bold ${
                  isKillSwitchOn ? 'text-destructive' : 'text-muted-foreground'
                }`}
              >
                {isKillSwitchOn ? 'ACTIVE' : 'OFF'}
              </span>
            </div>
            <p className="text-muted-foreground font-mono text-[11px]">
              Instant shedding of all non-BYOK traffic across the platform.
            </p>
            <input
              type="text"
              placeholder="Reason (mandatory for audit)..."
              value={killSwitchReason}
              onChange={(e) => setKillSwitchReason(e.target.value)}
              className="border-border-hairline bg-surface text-foreground placeholder:text-muted-foreground/60 focus:border-accent w-full border px-3 py-1.5 font-mono text-xs focus:outline-none"
            />
            <button
              type="button"
              disabled={isPending}
              onClick={handleToggleKillSwitch}
              className={`w-full border px-4 py-2 font-mono text-xs font-bold tracking-wider uppercase transition-colors ${
                isKillSwitchOn
                  ? 'border-accent bg-accent/10 text-accent hover:bg-accent hover:text-black'
                  : 'border-destructive bg-destructive/10 text-destructive hover:bg-destructive hover:text-white'
              }`}
            >
              {isKillSwitchOn ? 'Resume Normal Platform' : 'Emergency Kill Switch'}
            </button>
          </div>

          {/* Daily Platform Cap Adjustment */}
          <div className="border-border-hairline bg-surface-elevated space-y-3 border p-4">
            <div className="flex items-center justify-between">
              <span className="text-foreground font-mono text-xs font-bold uppercase">
                Daily Platform Cap
              </span>
              <span className="text-muted-foreground font-mono text-xs">
                {data.cap.cap} queries
              </span>
            </div>
            <div className="flex gap-2">
              <input
                type="number"
                min="0"
                step="500"
                value={newCap}
                onChange={(e) => setNewCap(Number(e.target.value))}
                className="border-border-hairline bg-surface text-foreground focus:border-accent w-32 border px-3 py-1.5 font-mono text-xs focus:outline-none"
              />
              <input
                type="text"
                placeholder="Reason (mandatory)..."
                value={capReason}
                onChange={(e) => setCapReason(e.target.value)}
                className="border-border-hairline bg-surface text-foreground placeholder:text-muted-foreground/60 focus:border-accent flex-1 border px-3 py-1.5 font-mono text-xs focus:outline-none"
              />
            </div>
            <button
              type="button"
              disabled={isPending}
              onClick={handleUpdateCap}
              className="border-border-hairline bg-surface hover:border-foreground w-full border px-4 py-2 font-mono text-xs tracking-wider uppercase transition-colors"
            >
              Update Global Cap
            </button>
          </div>
        </div>
      </section>

      {/* 3. 24h Leases Breakdown */}
      <section className="grid grid-cols-1 gap-6 md:grid-cols-3">
        {/* By Outcome */}
        <div className="border-border-hairline bg-surface space-y-3 border p-5">
          <h4 className="text-foreground font-mono text-xs font-bold tracking-wider uppercase">
            Outcomes (Last 24h)
          </h4>
          <div className="divide-border-hairline divide-y font-mono text-xs">
            {data.leasesByOutcome.map((item) => (
              <div key={item.outcome} className="text-muted-foreground flex justify-between py-2">
                <span className="capitalize">{item.outcome}</span>
                <span className="text-foreground font-bold">{item.count.toLocaleString()}</span>
              </div>
            ))}
            {data.leasesByOutcome.length === 0 && (
              <div className="text-muted-foreground py-2">Zero leases recorded.</div>
            )}
          </div>
        </div>

        {/* By Charge Source */}
        <div className="border-border-hairline bg-surface space-y-3 border p-5">
          <h4 className="text-foreground font-mono text-xs font-bold tracking-wider uppercase">
            Charge Sources (24h)
          </h4>
          <div className="divide-border-hairline divide-y font-mono text-xs">
            {data.leasesBySource.map((item) => (
              <div key={item.source} className="text-muted-foreground flex justify-between py-2">
                <span>{item.source}</span>
                <span className="text-foreground font-bold">{item.count.toLocaleString()}</span>
              </div>
            ))}
            {data.leasesBySource.length === 0 && (
              <div className="text-muted-foreground py-2">Zero leases recorded.</div>
            )}
          </div>
        </div>

        {/* Denial Reasons */}
        <div className="border-border-hairline bg-surface space-y-3 border p-5">
          <h4 className="text-foreground font-mono text-xs font-bold tracking-wider uppercase">
            Denial Reasons (24h)
          </h4>
          <div className="divide-border-hairline divide-y font-mono text-xs">
            {data.denialReasons.map((item) => (
              <div key={item.reason} className="text-muted-foreground flex justify-between py-2">
                <span className="truncate">{item.reason}</span>
                <span className="text-foreground font-bold">{item.count.toLocaleString()}</span>
              </div>
            ))}
            {data.denialReasons.length === 0 && (
              <div className="text-muted-foreground py-2">Zero denials recorded.</div>
            )}
          </div>
        </div>
      </section>

      {/* 4. Active Alert Rules Evaluated on Load */}
      <section className="border-border-hairline bg-surface space-y-4 border p-6">
        <div>
          <div className="text-muted-foreground font-mono text-[10px] tracking-wider uppercase">
            Health & Invariant Monitors
          </div>
          <h3 className="text-foreground text-lg font-bold">SQL Alert Rules Evaluation</h3>
        </div>

        <div className="divide-border-hairline border-border-hairline divide-y border font-mono text-xs">
          {data.alerts.map((alert) => (
            <div key={alert.key} className="flex items-center justify-between p-3">
              <div className="flex items-center gap-3">
                <span>{alert.fired ? (alert.severity === 'page' ? '🚨' : '⚠️') : '✅'}</span>
                <span className="text-foreground font-bold">{alert.key}</span>
                <span className="text-muted-foreground">{alert.summary}</span>
              </div>
              <span
                className={`border px-2 py-0.5 text-[10px] uppercase ${
                  alert.fired
                    ? alert.severity === 'page'
                      ? 'border-destructive bg-destructive/10 text-destructive font-bold'
                      : 'border-warning bg-warning/10 text-warning'
                    : 'border-border-hairline text-muted-foreground'
                }`}
              >
                {alert.fired ? alert.severity : 'OK'}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* 5. Abuse Blocks Management */}
      <section className="border-border-hairline bg-surface space-y-6 border p-6">
        <div>
          <div className="text-muted-foreground font-mono text-[10px] tracking-wider uppercase">
            Security Enforcement
          </div>
          <h3 className="text-foreground text-lg font-bold">Abuse Blocks (IP, Device, Domain)</h3>
        </div>

        {/* Create Block Form */}
        <div className="border-border-hairline bg-surface-elevated space-y-4 border p-4">
          <div className="text-foreground font-mono text-xs font-bold uppercase">
            Add Abuse Block
          </div>
          {blockFeedback && (
            <div className="border-accent/40 bg-accent/5 text-accent border p-2 font-mono text-xs">
              {blockFeedback}
            </div>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <select
              value={blockKind}
              onChange={(e) =>
                setBlockKind(e.target.value as 'ip_key' | 'device' | 'email_normalized' | 'user')
              }
              className="border-border-hairline bg-surface text-foreground focus:border-accent border px-3 py-1.5 font-mono text-xs focus:outline-none"
            >
              <option value="ip_key">IP Key (HMAC)</option>
              <option value="device">Device ID</option>
              <option value="email_normalized">Email</option>
              <option value="user">User UUID</option>
            </select>
            <input
              type="text"
              placeholder="Target value..."
              value={blockValue}
              onChange={(e) => setBlockValue(e.target.value)}
              className="border-border-hairline bg-surface text-foreground focus:border-accent border px-3 py-1.5 font-mono text-xs focus:outline-none sm:col-span-2"
            />
            <input
              type="number"
              placeholder="TTL hours"
              value={blockTtlHours}
              onChange={(e) => setBlockTtlHours(e.target.value)}
              className="border-border-hairline bg-surface text-foreground focus:border-accent border px-3 py-1.5 font-mono text-xs focus:outline-none"
            />
          </div>
          <div className="flex gap-3">
            <input
              type="text"
              placeholder="Reason for block (mandatory)..."
              value={blockReason}
              onChange={(e) => setBlockReason(e.target.value)}
              className="border-border-hairline bg-surface text-foreground focus:border-accent flex-1 border px-3 py-1.5 font-mono text-xs focus:outline-none"
            />
            <button
              type="button"
              disabled={isPending}
              onClick={handleAddAbuseBlock}
              className="border-destructive bg-destructive/10 text-destructive hover:bg-destructive border px-4 py-1.5 font-mono text-xs font-bold uppercase transition-colors hover:text-white"
            >
              Block Target
            </button>
          </div>
        </div>

        {/* Existing Blocks Table */}
        <div className="divide-border-hairline border-border-hairline divide-y border font-mono text-xs">
          {data.abuseBlocks.map((b) => (
            <div key={b.id} className="flex items-center justify-between p-3">
              <div>
                <span className="border-border-hairline text-muted-foreground mr-2 border px-1.5 py-0.5 text-[10px] uppercase">
                  {b.kind}
                </span>
                <span className="text-foreground font-bold">{b.value}</span>
                {b.reason && <span className="text-muted-foreground ml-2">— {b.reason}</span>}
              </div>
              <div className="flex items-center gap-3">
                <span className="text-muted-foreground text-[10px]">
                  Expires: {b.expiresAt ? new Date(b.expiresAt).toLocaleDateString() : 'Never'}
                </span>
                <button
                  type="button"
                  onClick={() => handleRemoveAbuseBlock(b.id)}
                  className="border-border-hairline text-destructive hover:border-destructive border px-2 py-0.5 text-[10px] uppercase transition-colors"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
          {data.abuseBlocks.length === 0 && (
            <div className="text-muted-foreground p-4 text-center">Zero active abuse blocks.</div>
          )}
        </div>
      </section>
    </div>
  );
}
