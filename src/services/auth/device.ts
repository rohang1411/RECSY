import { createHmac, randomBytes } from 'node:crypto';
import { env } from '@/env';

const DEV_FALLBACK_SECRET = 'dev-device-id-hmac-secret-min-32-chars-key';

export function getDeviceCookieName(): string {
  return env.NODE_ENV === 'production' ? '__Host-recsy_did' : 'recsy_did';
}

export function mintDeviceCookieValue(): string {
  return randomBytes(16).toString('base64url');
}

export function hashDeviceId(rawCookieValue: string): string {
  const secret = env.DEVICE_ID_SECRET || DEV_FALLBACK_SECRET;
  return createHmac('sha256', secret).update(rawCookieValue.trim()).digest('hex').slice(0, 32);
}

export function getDeviceCookieOptions(): {
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'lax';
  path: string;
  maxAge: number;
} {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 31536000, // 1 year in seconds
  };
}
