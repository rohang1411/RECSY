import { ImageResponse } from 'next/og';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(160deg, #0d0d10 0%, #1a1a22 100%)',
        color: '#f5f5f2',
        fontSize: 72,
        fontWeight: 800,
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        letterSpacing: -2,
      }}
    >
      R
    </div>,
    { ...size },
  );
}
