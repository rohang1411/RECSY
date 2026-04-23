import { ImageResponse } from 'next/og';

import { env } from '@/env';

export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = 'RECSY — honest smartphone recommendations';

export default function OpengraphImage() {
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
        background: 'linear-gradient(150deg, #0d0d10 0%, #1f2937 45%, #0b1220 100%)',
        color: '#f5f5f2',
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={{ fontSize: 64, fontWeight: 800, letterSpacing: -2, lineHeight: 1.05 }}>
          RECSY
        </div>
        <div
          style={{
            fontSize: 34,
            fontWeight: 500,
            maxWidth: 900,
            lineHeight: 1.3,
            color: '#c8cad1',
          }}
        >
          Honest smartphone recommendations — grounded in real reviews, with receipts.
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          fontSize: 22,
          color: '#9ca3af',
        }}
      >
        <span>Ask what matters. Get a fit, not a sales pitch.</span>
        <span style={{ color: '#6b7280' }}>{site}</span>
      </div>
    </div>,
    { ...size },
  );
}
