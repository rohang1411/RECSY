'use client';

import { Toaster as SonnerToaster } from 'sonner';

export function Toaster() {
  return (
    <SonnerToaster
      position="top-right"
      toastOptions={{
        className:
          '!bg-card !text-foreground !border !border-outline !rounded-none !font-sans !shadow-none !px-4 !py-3',
        descriptionClassName: '!text-muted-foreground !text-xs',
      }}
    />
  );
}
