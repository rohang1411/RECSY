'use client';

import React, { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { openAuthSheet } from './AuthSheet';
import { toast } from 'sonner';
import { quotaStore } from '@/components/quota/quota-store';

export interface AccountMenuProps {
  email?: string | null;
  signedIn?: boolean;
  className?: string;
}

export function AccountMenu({ email, signedIn = false, className = '' }: AccountMenuProps) {
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
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
  const initial = localPart ? localPart[0]?.toUpperCase() : 'U';

  return (
    <div ref={menuRef} className={`relative inline-block text-left ${className}`}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label="Account navigation menu"
        className="border-border-hairline bg-surface hover:border-foreground hover:bg-surface-elevated flex items-center gap-2 border px-2.5 py-1 text-xs transition-colors"
      >
        <div className="bg-accent flex h-5 w-5 items-center justify-center text-[11px] font-bold text-black uppercase">
          {initial}
        </div>
        <span className="text-foreground hidden font-mono tracking-tight md:inline">
          {localPart}
        </span>
        <span className="text-muted-foreground font-mono text-[9px] select-none">
          {open ? '▲' : '▼'}
        </span>
      </button>

      {open && (
        <div
          role="menu"
          aria-orientation="vertical"
          className="border-border-hairline bg-surface animate-in fade-in zoom-in-95 absolute right-0 z-50 mt-1 w-56 border p-1 shadow-2xl duration-150"
        >
          {/* Identity Header */}
          <div className="border-border-hairline border-b px-3 py-2">
            <div className="text-muted-foreground font-mono text-[10px] tracking-wider uppercase">
              Signed in as
            </div>
            <div className="text-foreground truncate font-mono text-xs font-semibold">{email}</div>
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
