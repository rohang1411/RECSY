import { NextResponse } from 'next/server';

let cachedRate: number = 83.5;
let lastFetchedAt: number = 0;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours (once per day)

export async function GET() {
  const now = Date.now();
  if (now - lastFetchedAt < CACHE_TTL_MS && cachedRate > 0) {
    return NextResponse.json({
      rate: cachedRate,
      base: 'USD',
      target: 'INR',
      cached: true,
      lastUpdated: new Date(lastFetchedAt).toISOString(),
    });
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);

    const res = await fetch('https://open.er-api.com/v6/latest/USD', {
      signal: controller.signal,
      next: { revalidate: 86400 },
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = (await res.json()) as { rates?: Record<string, number> };
      const inr = data.rates?.INR;
      if (typeof inr === 'number' && inr > 50 && inr < 150) {
        cachedRate = Math.round(inr * 100) / 100;
        lastFetchedAt = now;
      }
    }
  } catch (err) {
    console.warn('[exchange-rate] failed to fetch remote rate, using fallback:', err);
  }

  return NextResponse.json({
    rate: cachedRate,
    base: 'USD',
    target: 'INR',
    cached: false,
    lastUpdated: new Date(lastFetchedAt || now).toISOString(),
  });
}
