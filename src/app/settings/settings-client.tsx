'use client';

import { useId } from 'react';

import {
  CLIENT_SETTING_DEFAULTS,
  CLIENT_SETTING_KEYS,
  useClientSetting,
} from '@/lib/client-settings';
import { cn } from '@/lib/utils';

export function SettingsClient() {
  return (
    <section className="mt-8">
      <fieldset className="border-outline-variant bg-background border">
        <legend className="meta-label text-primary ml-5 px-2">Chat input</legend>
        <div className="p-5">
          <EnterToSendToggle />
        </div>
      </fieldset>
    </section>
  );
}

function EnterToSendToggle() {
  const [enabled, setEnabled] = useClientSetting<boolean>(
    CLIENT_SETTING_KEYS.enterToSend,
    CLIENT_SETTING_DEFAULTS[CLIENT_SETTING_KEYS.enterToSend],
  );
  const labelId = useId();
  const descId = useId();

  return (
    <div className="grid gap-5 sm:grid-cols-[1fr_auto] sm:items-start">
      <div className="min-w-0">
        <p id={labelId} className="text-primary font-mono text-sm tracking-[0.12em] uppercase">
          Enter key sends message
        </p>
        <p id={descId} className="text-muted-foreground mt-3 max-w-2xl text-xs leading-5">
          When enabled, pressing Enter submits messages on recommend and phone Q&A pages. Use
          Shift+Enter for a newline. When disabled, Enter always inserts a newline.
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-labelledby={labelId}
        aria-describedby={descId}
        onClick={() => setEnabled(!enabled)}
        className={cn(
          'relative inline-flex h-8 w-16 shrink-0 cursor-pointer items-center border transition-colors focus-visible:outline-none',
          enabled ? 'border-primary bg-primary' : 'border-outline bg-background',
        )}
      >
        <span
          aria-hidden
          className={cn(
            'bg-background inline-block size-6 transform transition-transform',
            enabled ? 'translate-x-9' : 'translate-x-1',
          )}
        />
      </button>
    </div>
  );
}
