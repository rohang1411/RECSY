import { ImageResponse } from 'next/og';

export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

export default function Icon() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#0d0d10',
        color: '#f5f5f2',
        fontSize: 20,
        fontWeight: 700,
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
      }}
    >
      R
    </div>,
    { ...size },
  );
}
