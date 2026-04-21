import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { Toaster } from 'sonner';

import { AppHeader } from '@/components/AppHeader';
import { ThemeProvider } from '@/components/ThemeProvider';
import { env } from '@/env';

import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL(env.NEXT_PUBLIC_SITE_URL),
  title: {
    default: 'RECSY — honest smartphone recommendations',
    template: '%s · RECSY',
  },
  description:
    'Ask what matters. Get the phone that actually fits you — grounded in real reviews, with receipts.',
  applicationName: 'RECSY',
  keywords: ['smartphone', 'phone recommender', 'phone reviews', 'consensus', 'recsy'],
  authors: [{ name: 'RECSY' }],
  creator: 'RECSY',
  robots: { index: true, follow: true },
  openGraph: {
    title: 'RECSY — honest smartphone recommendations',
    description: 'Phone picks and plain-English answers, grounded in real reviews.',
    type: 'website',
    siteName: 'RECSY',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'RECSY — honest smartphone recommendations',
    description: 'Phone picks and plain-English answers, grounded in real reviews.',
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#111114' },
    { media: '(prefers-color-scheme: light)', color: '#fafaf8' },
  ],
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      // `next-themes` toggles `data-theme` post-mount; suppressHydrationWarning
      // silences the legitimate mismatch between SSR (no attribute) and the
      // client's first paint (attribute present). The actual paint is stable
      // because `color-scheme: dark` is set for html:not([data-theme]).
      suppressHydrationWarning
    >
      <body className={`${inter.variable} ${jetbrains.variable} font-sans antialiased`}>
        <ThemeProvider>
          <div className="flex min-h-dvh flex-col">
            <AppHeader />
            <main className="flex-1">{children}</main>
            <footer className="border-border/60 text-muted-foreground border-t py-6 text-center text-xs">
              <div className="mx-auto max-w-6xl px-4 sm:px-6">
                Built with receipts. © {new Date().getFullYear()} RECSY.
              </div>
            </footer>
          </div>
          <Toaster position="top-right" richColors closeButton />
        </ThemeProvider>
      </body>
    </html>
  );
}
