import { ImageResponse } from 'next/og';

import { env } from '@/env';

export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = 'RECSY Pricing — Transparent, Fair Smartphone Intelligence';

export default function PricingOpengraphImage() {
  const site = new URL(env.NEXT_PUBLIC_SITE_URL).host;

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: 64,
        background: 'linear-gradient(150deg, #0d0d10 0%, #181c24 50%, #0d1117 100%)',
        color: '#f5f5f2',
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div
            style={{
              display: 'flex',
              padding: '6px 14px',
              border: '1px solid #d86b38',
              color: '#d86b38',
              fontSize: 16,
              fontWeight: 700,
              letterSpacing: 2,
              textTransform: 'uppercase',
              fontFamily: 'monospace',
            }}
          >
            Pricing & Quotas
          </div>
          <span style={{ color: '#71717a', fontSize: 16, fontFamily: 'monospace' }}>
            TECHNICAL SPECIFICATION · RECSY
          </span>
        </div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            fontSize: 58,
            fontWeight: 800,
            letterSpacing: -2,
            lineHeight: 1.08,
          }}
        >
          <span>Transparent intelligence.</span>
          <span>No subscriptions required.</span>
        </div>
        <div
          style={{
            display: 'flex',
            fontSize: 26,
            fontWeight: 400,
            maxWidth: 960,
            lineHeight: 1.4,
            color: '#a1a1aa',
          }}
        >
          2 free daily queries for everyone. Credit packs that never expire. Optional Pro monthly
          for power users. Zero sponsored bias.
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          paddingTop: 24,
          borderTop: '1px solid #27272a',
          fontSize: 20,
          color: '#71717a',
          fontFamily: 'monospace',
        }}
      >
        <span>FREE DAILY · PAY AS YOU GO · PRO MONTHLY · BYOK FRIENDLY</span>
        <span style={{ color: '#9ca3af' }}>{site}</span>
      </div>
    </div>,
    { ...size },
  );
}
