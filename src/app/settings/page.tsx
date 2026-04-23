import type { Metadata } from 'next';

import { SettingsClient } from './settings-client';

export const metadata: Metadata = {
  title: 'Settings',
  description: 'Personal preferences for RECSY — stored locally in your browser.',
};

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
      <h1 className="text-foreground text-3xl font-semibold tracking-tight">Settings</h1>
      <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
        Preferences are saved in <code className="text-foreground">localStorage</code> on this
        browser only — they are not synced to the server. Clearing site data resets them to the
        defaults.
      </p>

      <SettingsClient />
    </div>
  );
}
