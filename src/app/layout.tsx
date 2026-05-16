import type { Metadata, Viewport } from 'next';
import { Hanken_Grotesk, Inter, JetBrains_Mono } from 'next/font/google';
import { Toaster } from 'sonner';

import { AnalyticsClient } from '@/components/AnalyticsClient';
import { AppHeader } from '@/components/AppHeader';
import { ThemeProvider } from '@/components/ThemeProvider';
import { env } from '@/env';

import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const hanken = Hanken_Grotesk({
  subsets: ['latin'],
  variable: '--font-hanken',
  display: 'swap',
  weight: ['700', '800'],
});

const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL(env.NEXT_PUBLIC_SITE_URL),
  title: {
    default: 'RECSY - honest smartphone recommendations',
    template: '%s · RECSY',
  },
  description:
    'Ask what matters. Get the phone that actually fits you, grounded in real reviews, with receipts.',
  applicationName: 'RECSY',
  keywords: ['smartphone', 'phone recommender', 'phone reviews', 'consensus', 'recsy'],
  authors: [{ name: 'RECSY' }],
  creator: 'RECSY',
  robots: { index: true, follow: true },
  openGraph: {
    title: 'RECSY - honest smartphone recommendations',
    description: 'Phone picks and plain-English answers, grounded in real reviews.',
    type: 'website',
    siteName: 'RECSY',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'RECSY - honest smartphone recommendations',
    description: 'Phone picks and plain-English answers, grounded in real reviews.',
  },
};

export const viewport: Viewport = {
  themeColor: '#000000',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${inter.variable} ${hanken.variable} ${jetbrains.variable} bg-background text-foreground font-sans antialiased`}
      >
        <ThemeProvider forcedTheme="dark" enableSystem={false}>
          <div className="flex min-h-dvh flex-col">
            <AppHeader />
            <main className="flex-1">{children}</main>
            <footer className="border-outline-variant bg-background text-muted-foreground border-t py-6 text-center font-mono text-[11px] tracking-[0.14em] uppercase">
              <div className="px-grid-margin mx-auto max-w-7xl">
                Built with receipts. © {new Date().getFullYear()} RECSY
              </div>
            </footer>
          </div>
          <Toaster position="top-right" richColors closeButton />
          <AnalyticsClient />
        </ThemeProvider>
      </body>
    </html>
  );
}
