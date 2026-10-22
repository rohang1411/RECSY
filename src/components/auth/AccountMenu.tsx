'use client';

import React, { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { openAuthSheet } from './AuthSheet';
import { toast } from 'sonner';
import { quotaStore } from '@/components/quota/quota-store';

export interface AccountMenuProps {
  email?: string | null;
  displayName?: string | null;
  firstName?: string | null;
  avatarUrl?: string | null;
  signedIn?: boolean;
  className?: string;
}

export function AccountMenu({
  email,
  displayName,
  firstName,
  avatarUrl,
  signedIn = false,
  className = '',
}: AccountMenuProps) {
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [imgError, setImgError] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [open]);

  // Close on Escape
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      const res = await fetch('/auth/signout', { method: 'POST' });
      if (res.ok) {
        toast.success('Signed out');
        setOpen(false);
        quotaStore.refresh();
        window.location.assign('/');
      } else {
        throw new Error('Failed to sign out');
      }
    } catch {
      toast.error('Sign-out error. Please try again.');
    } finally {
      setSigningOut(false);
    }
  };

  if (!signedIn) {
    return (
      <button
        type="button"
        onClick={() => openAuthSheet({ reason: 'header' })}
        className={`border-border-hairline bg-surface text-foreground hover:border-foreground hover:bg-surface-elevated inline-flex items-center gap-1.5 border px-3 py-1 font-mono text-xs tracking-wider uppercase transition-colors ${className}`}
      >
        Sign In
      </button>
    );
  }

  const localPart = email ? email.split('@')[0] : 'account';
  const resolvedFirstName =
    firstName || (displayName ? displayName.trim().split(/\s+/)[0] : null) || localPart;
  const initial = (resolvedFirstName ? resolvedFirstName[0] : 'U')?.toUpperCase();

  return (
    <div ref={menuRef} className={`relative inline-block text-left ${className}`}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label="Account navigation menu"
        className="border-border-hairline bg-surface hover:border-foreground hover:bg-surface-elevated flex items-center gap-2 border px-2 py-1 text-xs transition-colors"
      >
        {avatarUrl && !imgError ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatarUrl}
            alt={resolvedFirstName || 'User avatar'}
            onError={() => setImgError(true)}
            className="border-border-hairline h-5 w-5 shrink-0 rounded-full border object-cover"
          />
        ) : (
          <div className="bg-accent flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-black uppercase">
            {initial}
          </div>
        )}
        <span className="text-foreground hidden font-mono text-xs font-semibold tracking-tight md:inline">
          {resolvedFirstName}
        </span>
        <span className="text-muted-foreground font-mono text-[9px] select-none">
          {open ? '▲' : '▼'}
        </span>
      </button>

      {open && (
        <div
          role="menu"
          aria-orientation="vertical"
          className="border-border-hairline bg-surface animate-in fade-in zoom-in-95 absolute right-0 z-50 mt-1 w-64 border p-1 shadow-2xl duration-150"
        >
          {/* Identity Header */}
          <div className="border-border-hairline border-b px-3 py-2.5">
            <div className="flex items-center gap-2.5">
              {avatarUrl && !imgError ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={avatarUrl}
                  alt={displayName || resolvedFirstName || 'User avatar'}
                  className="border-border-hairline h-8 w-8 shrink-0 rounded-full border object-cover"
                />
              ) : (
                <div className="bg-accent flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-mono text-xs font-bold text-black uppercase">
                  {initial}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="text-foreground truncate font-mono text-xs font-bold">
                  {displayName || resolvedFirstName}
                </div>
                <div className="text-muted-foreground truncate font-mono text-[11px]">{email}</div>
              </div>
            </div>
          </div>

          {/* Account Navigation Links */}
          <div className="py-1">
            <Link
              href="/account"
              onClick={() => setOpen(false)}
              className="text-foreground hover:bg-surface-elevated flex items-center justify-between px-3 py-2 font-mono text-xs transition-colors"
              role="menuitem"
            >
              <span>Overview</span>
              <span className="text-muted-foreground text-[10px]">›</span>
            </Link>
            <Link
              href="/account/usage"
              onClick={() => setOpen(false)}
              className="text-foreground hover:bg-surface-elevated flex items-center justify-between px-3 py-2 font-mono text-xs transition-colors"
              role="menuitem"
            >
              <span>Usage & Quotas</span>
              <span className="text-muted-foreground text-[10px]">›</span>
            </Link>
            <Link
              href="/account/billing"
              onClick={() => setOpen(false)}
              className="text-foreground hover:bg-surface-elevated flex items-center justify-between px-3 py-2 font-mono text-xs transition-colors"
              role="menuitem"
            >
              <span>Billing & Credits</span>
              <span className="text-muted-foreground text-[10px]">›</span>
            </Link>
            <Link
              href="/account/history"
              onClick={() => setOpen(false)}
              className="text-foreground hover:bg-surface-elevated flex items-center justify-between px-3 py-2 font-mono text-xs transition-colors"
              role="menuitem"
            >
              <span>Search History</span>
              <span className="text-muted-foreground text-[10px]">›</span>
            </Link>
            <Link
              href="/account/privacy"
              onClick={() => setOpen(false)}
              className="text-foreground hover:bg-surface-elevated flex items-center justify-between px-3 py-2 font-mono text-xs transition-colors"
              role="menuitem"
            >
              <span>Data & Privacy</span>
              <span className="text-muted-foreground text-[10px]">›</span>
            </Link>
          </div>

          {/* Action Divider & Sign Out */}
          <div className="border-border-hairline border-t pt-1">
            <button
              type="button"
              disabled={signingOut}
              onClick={handleSignOut}
              className="text-destructive hover:bg-destructive/10 flex w-full items-center justify-between px-3 py-2 font-mono text-xs uppercase transition-colors disabled:opacity-50"
              role="menuitem"
            >
              <span>{signingOut ? 'Signing out…' : 'Sign Out'}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
