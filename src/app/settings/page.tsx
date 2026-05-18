import type { Metadata } from 'next';

import { SettingsClient } from './settings-client';

export const metadata: Metadata = {
  title: 'Settings',
  description: 'Personal preferences for RECSY stored locally in your browser.',
};

export default function SettingsPage() {
  return (
    <div className="grid-bg px-grid-margin py-10">
      <section className="border-outline-variant bg-background border p-6 sm:p-8">
        <p className="meta-label">Settings</p>
        <h1 className="heading-scanline text-gradient-accent-edge font-display mt-5 text-5xl leading-none font-extrabold tracking-normal uppercase sm:text-7xl">
          Settings
        </h1>
        <p className="text-muted-foreground mt-6 max-w-2xl text-sm leading-6">
          Preferences are saved in localStorage on this browser only. Clearing site data resets them
          to the defaults.
        </p>
      </section>

      <SettingsClient />
    </div>
  );
}
