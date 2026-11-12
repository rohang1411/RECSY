'use client';

import React, { useSyncExternalStore } from 'react';
import { Sheet } from '@/components/ui/sheet';
import { AuthForm, type AuthReason } from './AuthForm';

export interface AuthSheetOptions {
  reason?: AuthReason;
  next?: string;
}

// Simple event bus / external store for programmatic opening
let currentOptions: AuthSheetOptions | null = null;
const listeners = new Set<() => void>();

export function openAuthSheet(options: AuthSheetOptions = {}) {
  currentOptions = options;
  listeners.forEach((l) => l());
}

export function closeAuthSheet() {
  currentOptions = null;
  listeners.forEach((l) => l());
}

function subscribe(callback: () => void) {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

function getSnapshot() {
  return currentOptions;
}

export function AuthSheet() {
  const options = useSyncExternalStore(subscribe, getSnapshot, () => null);
  const isOpen = Boolean(options);

  return (
    <Sheet
      isOpen={isOpen}
      onClose={closeAuthSheet}
      title="Sign In"
      description="One-time code, no password. Your free queries carry over."
    >
      <div className="p-6 md:p-8">
        <AuthForm
          reason={options?.reason || 'header'}
          next={options?.next || '/'}
          onSuccess={closeAuthSheet}
        />
      </div>
    </Sheet>
  );
}
