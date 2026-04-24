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
    <section className="mt-8 space-y-6">
      <fieldset className="border-border/80 bg-card/40 rounded-xl border p-5">
        <legend className="text-foreground text-sm font-semibold">Chat input</legend>
        <div className="mt-4 space-y-4">
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
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p id={labelId} className="text-foreground text-sm font-medium">
          Enter key sends message
        </p>
        <p id={descId} className="text-muted-foreground mt-1 text-xs leading-relaxed">
          When enabled, pressing{' '}
          <kbd className="border-border/80 bg-muted rounded border px-1 py-0.5 text-[10px]">
            Enter
          </kbd>{' '}
          submits the message on the recommend and phone Q&amp;A pages. Use{' '}
          <kbd className="border-border/80 bg-muted rounded border px-1 py-0.5 text-[10px]">
            Shift + Enter
          </kbd>{' '}
          for a newline. When disabled, Enter always inserts a newline and you must click{' '}
          <em>Send</em>.
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
          'focus-visible:ring-ring relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none',
          enabled ? 'bg-primary' : 'bg-muted border-border/80 border',
        )}
      >
        <span
          aria-hidden
          className={cn(
            'bg-background inline-block size-4 transform rounded-full shadow transition-transform',
            enabled ? 'translate-x-6' : 'translate-x-1',
          )}
        />
      </button>
    </div>
  );
}
