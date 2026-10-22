import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import { Hanken_Grotesk, Inter, JetBrains_Mono } from 'next/font/google';

import { AnalyticsClient } from '@/components/AnalyticsClient';
import { AppHeader } from '@/components/AppHeader';
import { ThemeProvider } from '@/components/ThemeProvider';
import { EntitlementProvider } from '@/components/quota/EntitlementProvider';
import { Toaster } from '@/components/ui/toaster';
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
    <html lang="en" data-scroll-behavior="smooth" suppressHydrationWarning>
      <body
        className={`${inter.variable} ${hanken.variable} ${jetbrains.variable} bg-background text-foreground font-sans antialiased`}
      >
        <ThemeProvider forcedTheme="dark" enableSystem={false}>
          <EntitlementProvider>
            <div className="flex min-h-dvh flex-col">
              <AppHeader />
              <main className="flex-1">{children}</main>
              <footer className="border-outline-variant bg-background text-muted-foreground border-t py-6 text-center font-mono text-[11px] tracking-[0.14em] uppercase">
                <div className="px-grid-margin mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4">
                  <div>© {new Date().getFullYear()} RECSY</div>
                  <nav className="flex flex-wrap items-center gap-4 text-[10px]">
                    <Link href="/pricing" className="hover:text-foreground transition-colors">
                      Pricing
                    </Link>
                    <span className="text-border-hairline">·</span>
                    <Link href="/terms" className="hover:text-foreground transition-colors">
                      Terms
                    </Link>
                    <span className="text-border-hairline">·</span>
                    <Link href="/privacy" className="hover:text-foreground transition-colors">
                      Privacy
                    </Link>
                    <span className="text-border-hairline">·</span>
                    <Link href="/refunds" className="hover:text-foreground transition-colors">
                      Refunds
                    </Link>
                    <span className="text-border-hairline">·</span>
                    <Link href="/contact" className="hover:text-foreground transition-colors">
                      Contact
                    </Link>
                  </nav>
                </div>
              </footer>
            </div>
            <Toaster />
            <AnalyticsClient />
          </EntitlementProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
